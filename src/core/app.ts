// One renderer, scene, camera and loop for every lab and, later, the game.
// WebGPU first; Three.js falls back to WebGL 2 by itself. ?webgl in the URL forces WebGL (used by headless shots).
import * as THREE from "three/webgpu";
import { restoreEmptyPools, trimInstanceUploads } from "./instanceUploads";
import { ShadowProxies } from "../look/shadowProxies";
import { FrameHud } from "./hud";
import { mountTouchPad } from "./touch";
import { asyncShaders, shaderFrameDone } from "./asyncShaders";
import { skipHiddenMatrices } from "./matrixSkip";
import { Clock, clockFromUrl } from "./clock";
import { InterpSet, setBetweenTicks, runAfterTick, runFrameDrawers } from "../look/treeInterp";

export type Tick = (dt: number, time: number) => void;

export interface App {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hud: FrameHud;
  backend: "WebGPU" | "WebGL2";
  /** Called once per sim tick before rendering (src/core/clock.ts): 60 times a second at dt = 1/60 (or ?tick=N), 0 to 4
   *  per drawn frame. */
  onTick(fn: Tick): void;
  /** Called once per drawn frame after the frame's ticks (0 or more), before rendering: cameras, effects, drawing.
   *  dt: the frame's real time (clamped to 1/20 s); alpha: how far between the last tick and the next (src/core/clock.ts). */
  onFrame(fn: (dt: number, alpha: number) => void): void;
  /** Called after each render (e.g. to put back a model posed between ticks: src/look/treeInterp.ts). */
  onAfterRender(fn: () => void): void;
  /** The game clock: ticks run, alpha between ticks. */
  clock: Clock;
  /** The models drawn between ticks (src/look/treeInterp.ts). */
  interp: InterpSet;
  /** URL flags shared by every lab: ?webgl, ?auto, ?shot, ?seed=N, ?norender */
  params: URLSearchParams;
  /** A PNG data URL of the next rendered frame (taken right after it renders, before the canvas clears). */
  capture(): Promise<string>;
  /** The last frame: its times (ms: the whole frame, the ticks, the render call's CPU submit), draw calls, triangles. */
  last: { frame: number; tick: number; render: number; calls: number; tris: number };
  /** For probes: true skips the ticks, so frames redraw the same moment (e.g. to compare render settings). */
  hold: boolean;
}

export async function createApp(container: HTMLElement): Promise<App> {
  const params = new URLSearchParams(location.search);
  skipHiddenMatrices(!params.has("allmatrices"));
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has("webgl") });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  // New shaders build in the background instead of stalling the frame (?syncshaders: three's own sync build).
  const shaders = asyncShaders(renderer, !params.has("syncshaders"));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
  const hud = new FrameHud(container, backend);
  mountTouchPad(container, renderer.domElement);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const ticks: Tick[] = [];
  const frames: ((dt: number, alpha: number) => void)[] = [];
  const afters: (() => void)[] = [];
  const captures: ((url: string) => void)[] = [];
  let prev = performance.now(), time = 0;
  const last = { frame: 0, tick: 0, render: 0, calls: 0, tris: 0 };
  const clock = clockFromUrl(params);
  // Every model on drawBetweenTicks' list is drawn between its last two ticks (stage 6c); swarm drawers (RobotsDraw...)
  // draw once per drawn frame, between ticks, instead of in the tick (6d).
  const interp = new InterpSet();
  setBetweenTicks(true);
  hud.set("clock", () => `${clock.hud()}; ${interp.models} models (${interp.parts} parts) drawn between ticks`);
  // ?dt=seconds: every drawn frame advances that much time, however long it took (repeatable headless shots, ?bench).
  const stepDt = params.has("dt") ? Number(params.get("dt")) || 0 : 0;
  const noRender = params.has("norender");
  let up = { trimmed: 0, savedKB: 0, empty: 0 };
  hud.set("shaders", () => `shaders: ${shaders.total} pipelines built (${shaders.async ? "in the background" : "sync, ?syncshaders"}), ${shaders.totalMs.toFixed(0)} ms in frames (code ${shaders.totalGenMs.toFixed(0)}), worst frame ${shaders.worstMs.toFixed(0)} ms`);
  // Batched shadow casters (src/look/shadowProxies.ts); ?noproxy draws every part into the shadow map as before.
  const proxies = params.has("noproxy") ? null : new ShadowProxies();
  if (proxies) hud.set("shadow batches", () => { const p = proxies.stats; return `shadow batches: ${p.shown} of ${p.parts} parts cast through ${p.batches} batches (${p.released} handed back)`; });
  hud.set("uploads", () => `instance uploads trimmed: ${up.trimmed} buffers, ${up.savedKB.toFixed(0)} KB a frame not sent; ${up.empty} empty pools not drawn`);
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const real = (now - prev) / 1000, raw = stepDt || real;
    prev = now;
    const t0 = performance.now();
    if (!app.hold) {
      clock.run(raw, (dt) => { time += dt; for (const t of ticks) t(dt, time); interp.capture(); runAfterTick(); });
      const fdt = Math.min(raw, 1 / 20);
      interp.apply(clock.alpha); runFrameDrawers(fdt, clock.alpha);
      for (const f of frames) f(fdt, clock.alpha);
    }
    const t1 = performance.now();
    // ?norender: run the ticks without drawing (headless CPU measurements, e.g. the stress lab on a software GPU).
    if (!noRender) { up = trimInstanceUploads(scene);
      // The batches copy world matrices, so they bring them up to date first and the render needn't do it again.
      if (proxies && renderer.shadowMap.enabled) { proxies.update(scene); scene.matrixWorldAutoUpdate = false; renderer.render(scene, camera); scene.matrixWorldAutoUpdate = true; }
      else renderer.render(scene, camera);
      restoreEmptyPools();
    }
    interp.restore();
    for (const f of afters) f();
    const t2 = performance.now();
    hud.note(shaders.frameNew || shaders.frameGenMs > 1 ? `new shaders ${shaders.frameNew} (code ${shaders.frameGenMs.toFixed(0)} ms, GPU ${shaders.frameMs.toFixed(0)} ms)` : "");
    shaderFrameDone(shaders, now > 5000);
    if (captures.length) {
      let url = "";
      try { url = renderer.domElement.toDataURL("image/png"); } catch { /* tainted or lost: send without */ }
      for (const c of captures.splice(0)) c(url);
    }
    last.frame = real * 1000; last.tick = t1 - t0; last.render = t2 - t1;
    last.calls = renderer.info.render.drawCalls; last.tris = renderer.info.render.triangles;
    hud.frame(real * 1000, renderer.info.render.drawCalls, renderer.info.render.triangles, t1 - t0, t2 - t1);
  });

  const app: App = {
    renderer, scene, camera, hud, backend, params, last, hold: false, clock, interp,
    onTick: (fn) => ticks.push(fn),
    onFrame: (fn) => frames.push(fn),
    onAfterRender: (fn) => afters.push(fn),
    capture: () => new Promise<string>((res) => captures.push(res)),
  };
  // For agents' probes in a headless browser (scene contents, triangle counts): window.__app.
  (window as unknown as { __app: App }).__app = app;
  (window as unknown as { __shadowBatches: ShadowProxies | null }).__shadowBatches = proxies;
  return app;
}
