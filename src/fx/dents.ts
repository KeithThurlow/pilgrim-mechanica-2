// Ground dents (Keith 2026-10-25, after the Snowflow demo): a GPU texture of dents around the camera focus, real
// displacement for footprints, ruts, dash furrows and round strikes, with berms of the sand they push aside. It is
// for looks only: feet, wheels and AI stand on DuneField.height (craters that matter go in the true ground).
//
// The texture is toroidal (a texel's place is fract(world / coverage)), so following the focus copies nothing, and it
// is ping-ponged through one full-screen pass a frame: scroll, relax, splat this frame's brushes, clamp. The rules are
// in src/fx/dentRule.ts (pure, with a CPU copy the headless check runs); the detail patch (src/world/detailPatch.ts)
// draws them. Channels: depression, berm, compression, surface id.
import * as THREE from "three/webgpu";
import {
  Fn, uniform, texture, textureLoad, screenCoordinate, vec2, vec4, ivec2, int, float, abs, max, min, round, exp, smoothstep,
  length, select, If, Loop, mx_noise_float, vec3, clamp,
} from "three/tsl";
import type { Param } from "../core/tweaks";
import type { DuneField, GroundSample } from "../world/terrain";
import {
  SURFACE_IDS, SURFACE_COUNT, SET_RATES, relaxRates, bermRatio, packBrush, BRUSH_ROWS, MAX_DIF, BERM_DECAY, COMP_DECAY,
  CORE_IN, CORE_OUT, RING_AT, RING_K, REACH, type Brush, type DentSurface, type SurfaceFeel, type RelaxRates,
} from "./dentRule";

export const DENT_DEFAULTS = {
  dentCoverage: 100,
  dentRes: 2048,
  patchSpacing: 0.25,
  patchEdge: 4,
  patchBudget: 3,
  dentScale: 1,
  dentPrint: 0.1,
  dentRut: 0.06,
  dentRutWidth: 1,
  dentFurrow: 0.12,
  dentRound: 0.05,
  dentRoundEvery: 1,
  dentBlast: 0.14,
  dentComp: 0.6,
  dentDark: 0.22,
  dentRough: 0.6,
  dentMaxDepth: 0.6,
  dentRelaxStep: 0.3,
  printSize: 1,
  craterSize: 0.35,
  slideOnSlope: 1,
  dentSandDepth: 1, dentSandBerm: 1, dentSandSoften: 6, dentSandSlump: 0.5, dentSandLife: 90,
  dentDirtDepth: 0.45, dentDirtBerm: 0.5, dentDirtSoften: 1.5, dentDirtSlump: 0.1, dentDirtLife: 400,
  dentGravelDepth: 0.3, dentGravelBerm: 0.6, dentGravelSoften: 2, dentGravelSlump: 0.1, dentGravelLife: 300,
  dentSnowDepth: 2.5, dentSnowBerm: 0.35, dentSnowSoften: 1, dentSnowSlump: 0.02, dentSnowLife: 900,
};
export type DentValues = typeof DENT_DEFAULTS;

const G = "Ground dents", GS = "Ground dents: surfaces";
const surfaceParams = (name: string, key: string): Param[] => [
  { key: `dent${key}Depth`, label: `${name}: depth ×`, min: 0, max: 4, step: 0.05, group: GS },
  { key: `dent${key}Berm`, label: `${name}: berm share`, min: 0, max: 1.5, step: 0.05, group: GS, tip: "Share of the pushed-down sand piled up round the dent (1 keeps it all; packed ground less)" },
  { key: `dent${key}Soften`, label: `${name}: softens (cm/min)`, min: 0, max: 30, step: 0.5, group: GS, tip: "How far a dent's edge spreads out in a minute (berms three times faster than hollows)" },
  { key: `dent${key}Slump`, label: `${name}: slumps back (/min)`, min: 0, max: 3, step: 0.01, group: GS, tip: "Share of a berm that slides back into its hollow each minute" },
  { key: `dent${key}Life`, label: `${name}: heals over (s)`, min: 0, max: 2000, step: 5, group: GS, tip: "Time constant of the slow healing; 0 never heals" },
];
export const DENT_PARAMS: Param[] = [
  { key: "dentCoverage", label: "Dent area (m)", min: 32, max: 200, step: 4, group: G, onRelease: true, tip: "Width of the square around the camera focus that carries dents (and the fine patch)" },
  { key: "dentRes", label: "Dent texels across", min: 512, max: 4096, step: 512, group: G, onRelease: true, tip: "Resolution of the dent texture: area / texels = detail (2048 over 100 m: 5 cm)" },
  { key: "patchSpacing", label: "Patch spacing (m)", min: 0.125, max: 1, step: 0.125, group: G, onRelease: true, tip: "Vertex spacing of the fine ground patch (rounded to divide the chunk grid)" },
  { key: "patchEdge", label: "Patch edge blend (m)", min: 0.5, max: 12, step: 0.5, group: G, tip: "Over this width at its edge the patch eases back to the chunks' shape, so no seam shows" },
  { key: "patchBudget", label: "Patch fill budget (ms/frame)", min: 0.5, max: 16, step: 0.5, group: G, tip: "CPU time per frame for sampling the true ground into the patch after a jump or a rebuild" },
  { key: "dentScale", label: "Dent height ×", min: 0, max: 4, step: 0.05, group: G, tip: "Look only: scales every dent and berm as drawn" },
  { key: "dentPrint", label: "Footprint depth (m)", min: 0, max: 0.5, step: 0.005, group: G },
  { key: "dentRut", label: "Rut depth (m)", min: 0, max: 0.4, step: 0.005, group: G },
  { key: "dentRutWidth", label: "Rut width ×", min: 0.3, max: 3, step: 0.05, group: G },
  { key: "dentFurrow", label: "Dash furrow depth (m)", min: 0, max: 0.5, step: 0.005, group: G },
  { key: "dentRound", label: "Round dent depth (m)", min: 0, max: 0.3, step: 0.005, group: G, tip: "Each round into the sand; they add up into a churned patch under a burst" },
  { key: "dentRoundEvery", label: "Round dent every Nth", min: 1, max: 10, step: 1, group: G },
  { key: "printSize", label: "Footprint size ×", min: 0.3, max: 2, step: 0.01, group: G },
  { key: "craterSize", label: "Round dent size (m)", min: 0.1, max: 2, step: 0.01, group: G },
  { key: "slideOnSlope", label: "Slides on steep sand", min: 0, max: 3, step: 0.05, group: G, tip: "On steep dune faces a step breaks sand loose downhill: a longer trough the steeper it is" },
  { key: "dentBlast", label: "Blast dent depth (m)", min: 0, max: 1, step: 0.01, group: G, tip: "Shells and vehicle blasts (the fine rim; real craters belong in the true ground)" },
  { key: "dentComp", label: "Packing", min: 0, max: 1, step: 0.01, group: G, tip: "How packed a print or rut floor gets (it reads darker)" },
  { key: "dentDark", label: "Packed ground darker", min: 0, max: 1, step: 0.01, group: G },
  { key: "dentRough", label: "Rim roughness", min: 0, max: 1.5, step: 0.05, group: G, tip: "Breaks up the rim of each dent and grains its berm, so it isn't a clean bevel" },
  { key: "dentMaxDepth", label: "Deepest dent (m)", min: 0.05, max: 2, step: 0.05, group: G },
  { key: "dentRelaxStep", label: "Relax every (s)", min: 0.05, max: 2, step: 0.05, group: G, tip: "Healing is banked and applied in steps this long (a slow heal is below half-float precision per frame)" },
  ...surfaceParams("Sand", "Sand"), ...surfaceParams("Dirt", "Dirt"), ...surfaceParams("Gravel", "Gravel"), ...surfaceParams("Snow", "Snow"),
];

const MAX_BRUSHES = 128;
const NAMES: Record<DentSurface, string> = { sand: "Sand", dirt: "Dirt", gravel: "Gravel", snow: "Snow", set: "" };

/** Options for one stamp. */
export interface StampOptions {
  /** Share of the pushed-down mass piled into the berm, before the surface's own share (default 1). */
  berm?: number;
  /** Compression 0..1 (default the Packing slider). */
  comp?: number;
  /** "press" (default): re-stamping doesn't dig deeper than this dent; "add": strikes add up (churned ground). */
  mode?: "press" | "add";
  /** Force a surface (else surfaceAt). */
  surface?: DentSurface;
}

interface Persistent { b: Brush; reach: number; done: boolean; key: string }

export class DentLayer {
  /** Texels across, coverage (m) and texel size: from the sliders, the targets remade when they change. */
  res = 0;
  size = 0;
  texel = 0;
  /** What the ground is at (x, z) for dents; null: rock or water, no dents. Labs can force one (?surface=). */
  surfaceAt: (x: number, z: number) => DentSurface | null;
  /** The texture the patch reads (its value swaps to the newest target each frame). */
  readonly tex: THREE.TextureNode;
  /** Window centre (snapped to texels) and size, for the patch. */
  readonly uCentre = uniform(new THREE.Vector2());
  readonly uSize: THREE.UniformNode<"float", number>;
  readonly uTexel: THREE.UniformNode<"float", number>;
  readonly stats = { brushes: 0, dropped: 0, passMs: 0 };
  private targets: THREE.RenderTarget[] = [];
  private quad: THREE.QuadMesh;
  private copy: THREE.QuadMesh;
  private prevTex: THREE.TextureNode;
  private brushData: Float32Array;
  private brushTex: THREE.DataTexture;
  private brushes: Brush[] = [];
  private carry: Brush[] = [];
  private persistent: Persistent[] = [];
  private uPrevCentre = uniform(new THREE.Vector2(1e6, 1e6));
  private uCount = uniform(0, "int");
  private uRes = uniform(1024, "int");
  private uResF = uniform(1024);
  private uDt = uniform(0);
  private uMaxDepth = uniform(0.6);
  private uMaxBerm = uniform(0.4);
  private uRough = uniform(0.6);
  private uRates = Array.from({ length: SURFACE_COUNT }, () => uniform(new THREE.Vector4()));
  private owed = 0;
  // Far away at first, so the first pass sees every texel as new and clears it.
  private cx = 1e6; private cz = 1e6;
  private pcx = 1e6; private pcz = 1e6;
  private rounds = 0;
  private s: GroundSample = { h: 0, crest: 0, flat: 0 };

  constructor(private renderer: THREE.WebGPURenderer, readonly field: DuneField, public v: DentValues) {
    this.uSize = uniform(100);
    this.uTexel = uniform(0.05);
    this.surfaceAt = (x, z) => {
      const s = field.surfaceAt(x, z);
      return s === "concrete" ? null : s;
    };
    this.brushData = new Float32Array(MAX_BRUSHES * BRUSH_ROWS * 4);
    this.brushTex = new THREE.DataTexture(this.brushData, MAX_BRUSHES, BRUSH_ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.brushTex.minFilter = this.brushTex.magFilter = THREE.NearestFilter;
    this.brushTex.generateMipmaps = false;
    this.brushTex.needsUpdate = true;
    const mk = () => {
      const t = new THREE.RenderTarget(64, 64, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false });
      t.texture.wrapS = t.texture.wrapT = THREE.RepeatWrapping;
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      return t;
    };
    this.targets = [mk(), mk()];
    this.resize();
    this.prevTex = texture(this.targets[0].texture);
    this.tex = texture(this.targets[0].texture);
    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = this.passNode();
    mat.depthTest = false; mat.depthWrite = false;
    this.quad = new THREE.QuadMesh(mat);
    const cm = new THREE.NodeMaterial();
    cm.fragmentNode = textureLoad(texture(this.targets[1].texture), ivec2(screenCoordinate.xy.floor()));
    cm.depthTest = false; cm.depthWrite = false;
    this.copy = new THREE.QuadMesh(cm);
  }

  /** Size the two targets for the sliders' resolution and coverage; everything starts clear. */
  private resize() {
    this.res = Math.max(64, Math.round(this.v.dentRes));
    this.size = Math.max(8, this.v.dentCoverage);
    this.texel = this.size / this.res;
    this.uSize.value = this.size; this.uTexel.value = this.texel;
    this.uRes.value = this.res; this.uResF.value = this.res;
    for (const t of this.targets) t.setSize(this.res, this.res);
    this.cx = this.cz = this.pcx = this.pcz = 1e6;
    for (const p of this.persistent) p.done = false;
  }

  /** The pass, per texel: scroll, relax, splat, clamp (the same rules as dentRule.ts). */
  private passNode() {
    const N = this.uRes, NF = this.uResF, prev = this.prevTex, bt = this.brushTex;
    const size = this.uSize, half = size.mul(0.5);
    return Fn(() => {
      const pix = screenCoordinate.xy.floor();
      const ix = int(pix.x), iy = int(pix.y);
      const base = pix.add(0.5).div(NF).mul(size);
      const world = base.add(size.mul(round(this.uCentre.sub(base).div(size)))).toVar();
      const st = vec4(0, 0, 0, 0).toVar();
      // Rim wobble and berm grain: noise read once per texel, outside the brush loop (inside it, per brush, the shader
      // was too big for WebGL 2 on a software GPU). Anchored to the world, so every dent still gets its own rim.
      const wobN = mx_noise_float(vec3(world.mul(2.3), 0.7)).toVar(), grainN = mx_noise_float(vec3(world.mul(9.1), 3.1)).toVar();
      const was = max(abs(world.x.sub(this.uPrevCentre.x)), abs(world.y.sub(this.uPrevCentre.y))).lessThanEqual(half);
      If(was, () => {
        const c = textureLoad(prev, ivec2(ix, iy));
        const l = textureLoad(prev, ivec2(ix.add(N).sub(1).mod(N), iy)), r = textureLoad(prev, ivec2(ix.add(1).mod(N), iy));
        const d = textureLoad(prev, ivec2(ix, iy.add(N).sub(1).mod(N))), u = textureLoad(prev, ivec2(ix, iy.add(1).mod(N)));
        const id = round(c.w);
        const R = this.uRates;
        const rate = select(id.lessThan(0.5), R[0], select(id.lessThan(1.5), R[1], select(id.lessThan(2.5), R[2], select(id.lessThan(3.5), R[3], R[4]))));
        const dt = this.uDt;
        const dep = c.x.add(l.x.add(r.x).add(d.x).add(u.x).sub(c.x.mul(4)).mul(min(MAX_DIF, rate.x.mul(dt)))).toVar();
        const berm = c.y.add(l.y.add(r.y).add(d.y).add(u.y).sub(c.y.mul(4)).mul(min(MAX_DIF, rate.y.mul(dt)))).toVar();
        const sl = max(0, min(berm, dep)).mul(min(0.6, rate.z.mul(dt)));
        dep.subAssign(sl); berm.subAssign(sl);
        st.assign(vec4(
          dep.mul(exp(dt.mul(rate.w).negate())),
          berm.mul(exp(dt.mul(rate.w).mul(BERM_DECAY).negate())),
          c.z.mul(exp(dt.mul(rate.w).mul(COMP_DECAY).negate())),
          c.w,
        ));
      });
      Loop({ start: int(0), end: this.uCount, type: "int", condition: "<" }, ({ i }) => {
        const a = textureLoad(bt, ivec2(i, 0)), b = textureLoad(bt, ivec2(i, 1)), e = textureLoad(bt, ivec2(i, 2));
        const p = world.sub(a.xy).toVar();
        p.subAssign(size.mul(round(p.div(size))));
        const reach = a.z.mul(max(a.w, 1)).mul(REACH);
        If(abs(p.x).lessThan(reach).and(abs(p.y).lessThan(reach)), () => {
          const along = p.x.mul(b.x).add(p.y.mul(b.y)), across = p.x.mul(b.y).sub(p.y.mul(b.x));
          const hl = a.z.mul(max(0, a.w.sub(1)));
          const wob = float(1).add(this.uRough.mul(0.18).mul(wobN));
          const dd = length(vec2(max(0, abs(along).sub(hl)), across)).div(a.z).div(wob);
          If(dd.lessThan(REACH), () => {
            const core = float(1).sub(smoothstep(CORE_IN, CORE_OUT, dd));
            const q = dd.sub(RING_AT).mul(RING_K);
            const grain = float(1).add(this.uRough.mul(0.4).mul(grainN));
            const ring = exp(q.mul(q).negate()).mul(grain);
            const add = b.z.mul(core);
            // No rim piled inside a hollow already there (dentRule.splat).
            const open = float(1).sub(min(1, st.x.div(max(1e-4, b.z.mul(0.5)))));
            const nd = select(e.w.greaterThan(0.5), st.x.add(add), max(st.x, add));
            const nb = max(st.y.mul(float(1).sub(core)), b.w.mul(ring).mul(open));
            const nc = max(st.z, e.x.mul(core));
            const ns = select(core.greaterThan(0.05).or(ring.greaterThan(0.3)), e.y, st.w);
            st.assign(vec4(nd, nb, nc, ns));
          });
        });
      });
      return vec4(clamp(st.x, 0, this.uMaxDepth), clamp(st.y, 0, this.uMaxBerm), clamp(st.z, 0, 1), st.w);
    })();
  }

  private feel(s: DentSurface): SurfaceFeel {
    const v = this.v as unknown as Record<string, number>, n = NAMES[s];
    return { depth: v[`dent${n}Depth`], berm: v[`dent${n}Berm`], soften: v[`dent${n}Soften`], slump: v[`dent${n}Slump`], life: v[`dent${n}Life`] };
  }

  /** How hard the ground is at (x, z): 0 soft .. 1 takes no dent. */
  hardness(x: number, z: number): number {
    // The crater layer's hardness sliders when the ground has craters (src/world/craters.ts: rock, rocky sand, shallows
    // sand), else bare rock alone is hard. Its protected zones (POI pads, the road) are left out on purpose: they
    // refuse craters, but a foot or a wheel still marks the sand on them, and dents are looks only.
    const cv = (this.field.dents as unknown as { v?: { hardRock?: number; hardRockySand?: number; hardShallows?: number } } | null)?.v;
    const s = this.field.sample(x, z, this.s);
    const wr = s.wr ?? 0, ws = s.ws ?? 0, rock = s.rock ?? 0;
    const h = Math.max(wr * (cv?.hardRockySand ?? 0) + ws * (cv?.hardShallows ?? 0), rock * (cv?.hardRock ?? 1));
    return Math.min(1, Math.max(0, h));
  }

  /**
   * Press a dent at (x, z): a capsule `radius` m across, `elong` times as long as wide along `yaw` (heading: 0 is +Z),
   * `depth` m deep (on sand; other surfaces scale it), with a berm of the displaced sand round it.
   */
  stamp(x: number, z: number, radius: number, yaw: number, elong: number, depth: number, o: StampOptions = {}) {
    const surf = o.surface ?? this.surfaceAt(x, z);
    if (!surf || radius <= 0 || depth <= 0) return;
    const f = surf === "set" ? { depth: 1, berm: 1 } : this.feel(surf);
    const hard = surf === "set" ? 0 : this.hardness(x, z);
    const d = depth * f.depth * (1 - hard);
    if (d <= 1e-4) return;
    const e = Math.max(1, elong);
    this.brushes.push({
      x, z, r: radius, elong: e, sy: Math.sin(yaw), cy: Math.cos(yaw), dep: d, berm: d * (o.berm ?? 1) * f.berm * bermRatio(e),
      comp: o.comp ?? this.v.dentComp, surf: SURFACE_IDS[surf], seed: (x * 0.37 + z * 0.71) % 100, mode: o.mode === "add" ? 1 : 0,
    });
  }

  /**
   * A dent that stays (POI ruts laid down once): stamped whenever it comes into the window, never heals. `key` groups
   * them so a POI's can be dropped together (forget).
   */
  persist(key: string, x: number, z: number, radius: number, yaw: number, elong: number, depth: number, berm = 1) {
    const e = Math.max(1, elong);
    const b: Brush = { x, z, r: radius, elong: e, sy: Math.sin(yaw), cy: Math.cos(yaw), dep: depth, berm: depth * berm * bermRatio(e), comp: 0.4, surf: SURFACE_IDS.set, seed: (x * 0.37 + z * 0.71) % 100, mode: 0 };
    this.persistent.push({ b, reach: radius * e * REACH, done: false, key });
  }

  /** Drop the persistent dents under a key (a POI streamed out). */
  forget(key: string) { this.persistent = this.persistent.filter((p) => p.key !== key); }

  /** Round strikes: only every Nth leaves a dent. */
  roundDue() { return this.rounds++ % Math.max(1, Math.round(this.v.dentRoundEvery)) === 0; }

  /** How far a foot sinks into the ground at (x, z) (m, for looks; e.g. snow later): its print depth there. */
  sinkDepth(x: number, z: number): number {
    const s = this.surfaceAt(x, z);
    if (!s || s === "set") return 0;
    return this.v.dentPrint * this.feel(s).depth * (1 - this.hardness(x, z)) * this.v.dentScale;
  }

  /** Run the pass: follow the focus, relax, splat this frame's brushes. */
  update(dt: number, fx: number, fz: number) {
    const v = this.v;
    if (Math.round(v.dentRes) !== this.res || Math.max(8, v.dentCoverage) !== this.size) this.resize();
    const t = this.texel, half = this.size / 2;
    this.pcx = this.cx; this.pcz = this.cz;
    this.cx = Math.round(fx / t) * t; this.cz = Math.round(fz / t) * t;
    // Persistent dents that reach texels new to the window this frame.
    for (const p of this.persistent) {
      const inNow = Math.abs(p.b.x - this.cx) < half + p.reach && Math.abs(p.b.z - this.cz) < half + p.reach;
      if (!inNow) { p.done = false; continue; }
      const allBefore = Math.abs(p.b.x - this.pcx) + p.reach <= half && Math.abs(p.b.z - this.pcz) + p.reach <= half;
      if (!p.done || !allBefore) { this.brushes.push(p.b); p.done = true; }
    }
    // Brushes past the cap wait for the next frame.
    const list = this.carry.length ? this.carry.concat(this.brushes) : this.brushes;
    let n = 0;
    this.carry = [];
    for (const b of list) {
      if (Math.abs(b.x - this.cx) > half + b.r * b.elong * REACH || Math.abs(b.z - this.cz) > half + b.r * b.elong * REACH) continue;
      if (n >= MAX_BRUSHES) { this.carry.push(b); continue; }
      packBrush(b, this.brushData, n++, MAX_BRUSHES);
    }
    this.stats.dropped = this.carry.length;
    this.brushes = [];
    this.stats.brushes = n;
    this.brushTex.needsUpdate = true;

    this.owed += dt;
    let rdt = 0;
    if (this.owed >= v.dentRelaxStep) { rdt = this.owed; this.owed = 0; }
    for (let i = 0; i < SURFACE_COUNT; i++) {
      const name = (Object.keys(SURFACE_IDS) as DentSurface[])[i];
      const r: RelaxRates = name === "set" ? SET_RATES : relaxRates(this.feel(name), t);
      this.uRates[i].value.set(r.difDep, r.difBerm, r.slump, r.decay);
    }
    this.uCount.value = n;
    this.uDt.value = rdt;
    this.uMaxDepth.value = v.dentMaxDepth;
    this.uMaxBerm.value = v.dentMaxDepth * 0.7;
    this.uRough.value = v.dentRough;
    this.uPrevCentre.value.set(this.pcx, this.pcz);
    this.uCentre.value.set(this.cx, this.cz);

    // The state stays in targets[0] (the patch and the pass read it): the pass writes targets[1], a copy brings it
    // back. Swapping which texture the nodes read instead left WebGL 2 reading the target it drew into (a feedback
    // loop that lost the context).
    const t0 = performance.now();
    const r = this.renderer, was = r.getRenderTarget();
    r.setRenderTarget(this.targets[1]);
    this.quad.render(r);
    r.setRenderTarget(this.targets[0]);
    this.copy.render(r);
    r.setRenderTarget(was);
    this.stats.passMs = performance.now() - t0;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.brushTex.dispose();
  }
}
