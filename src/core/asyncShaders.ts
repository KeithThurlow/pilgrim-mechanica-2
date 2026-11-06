// New shaders build in the background (perf, Keith 2026-11-06: "a four-second hitch" when venturing out from the
// convoy). Three builds a render pipeline the first time a material/object combination is drawn, and in a normal
// render() it asks the GPU for it synchronously: the frame waits while the driver compiles (on Windows, WGSL to HLSL to
// DXIL; tens to hundreds of ms each). Out in the field many kinds show up for the first time at once (camps, robots,
// bandits, salvage, wrecks, their shadows), so dozens of compiles landed in one frame. Here every pipeline goes through
// three's async path instead (the one compileAsync uses: createRenderPipelineAsync on WebGPU, KHR_parallel_shader_compile
// on WebGL 2): the frame carries on and the object is skipped (three checks isReady) until its pipeline is done, a few
// frames later. The shader code generation (CPU, in JS) still runs in the frame; its cost shows as "shaders" in the
// HUD's details and in the spike log. ?syncshaders turns this off (three's own behaviour), to compare.
import type * as THREE from "three/webgpu";

interface Pipelines {
  caches: Map<string, unknown>;
  getForRender(renderObject: unknown, promises?: Promise<void>[] | null): unknown;
  updateForRender(renderObject: unknown): void;
}

/**
 * Materials that must draw the first frame they're asked to (passes that carry state from frame to frame, like the
 * dent layer's ping-pong: a skipped pass with its copy drawn would lose what was stamped). These build sync.
 */
const mustDraw = new WeakSet<object>();
export function buildSync(material: object) { mustDraw.add(material); }

export interface ShaderStats {
  /** Pipelines built this frame, and the ms the frame spent on them: three's shader code generation (TSL to
   * WGSL/GLSL, in JS) and the hand-off to the GPU (the whole compile when sync). */
  frameNew: number;
  frameMs: number;
  frameGenMs: number;
  /** Since the page loaded. */
  total: number;
  totalMs: number;
  totalGenMs: number;
  /** The worst frame so far, after the first seconds. */
  worstMs: number;
  async: boolean;
}

export function asyncShaders(renderer: THREE.WebGPURenderer, async: boolean): ShaderStats {
  const stats: ShaderStats = { frameNew: 0, frameMs: 0, frameGenMs: 0, total: 0, totalMs: 0, totalGenMs: 0, worstMs: 0, async };
  // The code generation: timed where three builds a node material's shaders (a new one only, cached after).
  const nodes = (renderer as unknown as { _nodes?: { getForRender(ro: unknown): unknown; nodeBuilderCache?: Map<string, unknown> } })._nodes;
  if (nodes && typeof nodes.getForRender === "function" && nodes.nodeBuilderCache instanceof Map) {
    const cache = nodes.nodeBuilderCache, build = nodes.getForRender.bind(nodes);
    nodes.getForRender = (ro: unknown) => {
      const before = cache.size, t0 = performance.now();
      const r = build(ro);
      if (cache.size > before) stats.frameGenMs += performance.now() - t0;
      return r;
    };
  }
  const pl = (renderer as unknown as { _pipelines?: Pipelines })._pipelines;
  if (!pl || typeof pl.getForRender !== "function" || !(pl.caches instanceof Map)) return stats; // three changed: leave it
  // The backends push a promise per pipeline here; nothing waits on them, so drop them as they come.
  const sink: Promise<void>[] = [];
  const get = pl.getForRender.bind(pl);
  pl.updateForRender = (ro: unknown) => {
    const before = pl.caches.size, gen = stats.frameGenMs, t0 = performance.now();
    const mat = (ro as { material?: object }).material;
    get(ro, async && !(mat && mustDraw.has(mat)) ? sink : null);
    if (sink.length) sink.length = 0;
    const n = pl.caches.size - before;
    if (n > 0) { stats.frameNew += n; stats.frameMs += performance.now() - t0 - (stats.frameGenMs - gen); }
  };
  return stats;
}

/** Call once a frame after the render: folds the frame into the totals and clears it. */
export function shaderFrameDone(s: ShaderStats, warm: boolean) {
  s.total += s.frameNew;
  s.totalMs += s.frameMs + s.frameGenMs;
  s.totalGenMs += s.frameGenMs;
  if (warm) s.worstMs = Math.max(s.worstMs, s.frameMs + s.frameGenMs);
  s.frameNew = 0;
  s.frameMs = 0;
  s.frameGenMs = 0;
}
