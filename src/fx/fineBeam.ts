// A robot beam drawn fine (Keith 2026-11-02: "finer particle beams and brightness around them rather than super wide
// beams"): a thin white-hot core in a soft glow (src/fx/beamStrand.ts), wavering and flickering, wisps spiralling along
// it in puffs, and where it strikes the sand a melt flash (white point, orange bloom, a glow on the sand) throwing molten
// spatter (src/fx/meltSparks.ts). Shared by the robot swarm's beams (src/combat/robotBeamDraw.ts) and the striders'
// (src/combat/striderFx.ts); the look's sliders are the robots' "Look: …" ones (Robots: beam), read off whatever
// values object the caller has, with these defaults when it has none. Cosmetic.
import * as THREE from "three/webgpu";
import { BeamStrand, type StrandShape } from "./beamStrand";
import type { MeltSparks } from "./meltSparks";
import { glowMaterial } from "../weapons/ribbon";

export const MELT = 0xffc890, MELT_HALO = 0xff7a20;
const WISPS = 3;

/** A beam's line: emitter (ex..) to strike (x1..). */
export interface FineLine { ex: number; ey: number; ez: number; x1: number; y1: number; z1: number }
interface Ground { height(x: number, z: number): number }
type Values = { readonly [k: string]: number | undefined };

const POOL_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let poolTex: THREE.DataTexture | null = null;
/** A flat soft disc on the sand (the melt's glow round the strike). */
function poolMaterial() {
  if (!poolTex) {
    const N = 64, data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = Math.min(1, Math.hypot((i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1));
      const c = Math.round(255 * Math.min(1, Math.exp(-(r * r) / 0.04) * 0.9 + 0.35 * Math.pow(1 - r, 2.5)));
      data.set([c, c, c, 255], (j * N + i) * 4);
    }
    poolTex = new THREE.DataTexture(data, N, N);
    poolTex.magFilter = poolTex.minFilter = THREE.LinearFilter;
    poolTex.needsUpdate = true;
  }
  const m = glowMaterial(MELT, true);
  m.map = poolTex;
  return m;
}

export class FineBeam {
  readonly group = new THREE.Group();
  private sGlow: BeamStrand; private sCore: BeamStrand; private wisps: BeamStrand[];
  private hit: THREE.Mesh; private hitHalo: THREE.Mesh; private hitPool: THREE.Mesh;
  private sparkAcc = 0;
  private time = 0;
  /** The beam being laid now, for the strand shapes. */
  private cur = { L: 1, w: 1, seed: 0, waver: 0, flick: 0, wisp: 0, j: 0 };

  constructor(private sparks: MeltSparks, private ground: Ground, glow: number, core: number, wisp = 0x8cd0ff) {
    this.sGlow = new BeamStrand(40, glow, 0.3); this.sCore = new BeamStrand(40, core, 0.2);
    this.wisps = Array.from({ length: WISPS }, () => new BeamStrand(56, wisp, 0.3));
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(0xfff4e0, true));
    this.hitHalo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(MELT_HALO, true));
    this.hitPool = new THREE.Mesh(POOL_GEO, poolMaterial());
    for (const o of [this.hit, this.hitHalo, this.hitPool]) { o.frustumCulled = false; o.renderOrder = 7; o.visible = false; }
    this.hitPool.renderOrder = 4;
    this.group.add(this.sGlow.mesh, this.sCore.mesh, ...this.wisps.map((w) => w.mesh), this.hitPool, this.hitHalo, this.hit);
  }

  private shapeCore: StrandShape = (t, o) => {
    const c = this.cur, T = this.time, x = t * c.L, env = Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.05)));
    o.a = c.waver * env * (0.6 * Math.sin(x * 0.45 + T * 17 + c.seed) + 0.4 * Math.sin(x * 1.1 - T * 31 + c.seed * 2));
    o.b = c.waver * env * (0.6 * Math.sin(x * 0.5 - T * 13 + c.seed * 3) + 0.4 * Math.sin(x * 0.95 + T * 37));
    // Flicker runs down it in pulses, the emitter end steadier.
    o.k = 1 - c.flick * 0.6 * (0.5 + 0.5 * Math.sin(x * 0.7 - T * 70 + c.seed)) * Math.min(1, t * 3);
  };
  private shapeGlow: StrandShape = (t, o) => {
    this.shapeCore(t, o);
    o.a *= 0.7; o.b *= 0.7;
    o.k = 1 - this.cur.flick * 0.35 * (0.5 + 0.5 * Math.sin(t * this.cur.L * 0.3 - this.time * 25 + this.cur.seed));
  };
  private shapeWisp: StrandShape = (t, o) => {
    const c = this.cur, T = this.time, j = c.j, x = t * c.L, dir = j & 1 ? 1 : -1;
    const r = c.w * (0.18 + 0.12 * Math.sin(T * 3 + j * 2 + x * 0.2)) * Math.min(1, t * 6);
    const ph = dir * x * (0.5 + 0.15 * j) - T * (6 + 2.5 * j) + j * 2.1 + c.seed;
    o.a = r * Math.cos(ph); o.b = r * Math.sin(ph);
    // Broken into drifting puffs.
    const puff = Math.max(0, Math.sin(x * (0.35 + 0.1 * j) - T * (9 + 3 * j) + j * 4 + c.seed));
    o.k = c.wisp * puff * puff * puff * Math.min(1, t * 4) * Math.min(1, (1 - t) * 8 + 0.3);
  };

  /**
   * Draw it at `time` for beam `id` along b: a soft glow round a thin core `w` (the beam's width) wide, brightness a
   * (0..1), the melt flash at the strike by power p (0..1); dt for the spatter; v the look's sliders.
   */
  draw(time: number, id: number, b: FineLine, v: Values, w: number, a: number, p: number, dt: number, wisps = true) {
    this.time = time;
    const c = this.cur;
    const L = Math.hypot(b.x1 - b.ex, b.y1 - b.ey, b.z1 - b.ez);
    const fl = v.robotBeamFlicker ?? 0.4, wob = 1 - fl * 0.25 * (0.5 + 0.5 * Math.sin(time * 53 + id * 1.7)) * (0.5 + 0.5 * Math.sin(time * 19 + id));
    c.L = L; c.w = w; c.seed = ((id * 0.618) % 1) * 20; c.waver = (v.robotBeamWaver ?? 0.07) * Math.min(1, w * 2.5); c.flick = fl; c.wisp = (v.robotBeamWisps ?? 0.7) * a;
    const coreW = Math.max(0.03, w * (v.robotBeamCoreW ?? 0.3)), haloW = Math.max(0.1, w * (v.robotBeamHaloW ?? 1.6));
    this.sCore.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, coreW, this.shapeCore);
    this.sCore.mat.opacity = Math.min(1, a * wob);
    this.sGlow.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, haloW, this.shapeGlow);
    this.sGlow.mat.opacity = (v.robotBeamHaloK ?? 0.45) * a * wob;
    for (let j = 0; j < WISPS; j++) {
      const m = this.wisps[j];
      if (!wisps || c.wisp <= 0.01) { m.mesh.visible = false; continue; }
      c.j = j;
      m.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, Math.max(0.04, w * 0.14), this.shapeWisp);
      m.mat.opacity = 0.8;
    }
    // The melt flash: white-hot at the point, an orange bloom, the sand glowing round it; spatter thrown up.
    const H = (v.robotBeamHit ?? 1.4) * p * a, fk = 0.75 + 0.25 * Math.sin(time * 47 + id) * Math.sin(time * 29);
    const show = H > 0.03;
    this.hit.visible = this.hitHalo.visible = this.hitPool.visible = show;
    if (!show) return;
    const gy = this.ground.height(b.x1, b.z1);
    this.hit.position.set(b.x1, Math.max(b.y1, gy) + 0.1, b.z1); this.hit.scale.setScalar(H * 0.45 * fk);
    this.hitHalo.position.copy(this.hit.position); this.hitHalo.scale.setScalar(H * 1.1 * fk);
    (this.hit.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.6 + 0.4 * p);
    (this.hitHalo.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * p;
    this.hitPool.position.set(b.x1, gy + 0.12, b.z1); this.hitPool.scale.set(H * 1.6, 1, H * 1.6);
    (this.hitPool.material as THREE.MeshBasicMaterial).opacity = 0.7 * fk;
    this.sparkAcc += (v.robotBeamSparks ?? 90) * p * a * dt;
    const n = Math.floor(this.sparkAcc);
    if (n > 0) {
      this.sparkAcc -= n;
      const fx = b.x1 - b.ex, fz = b.z1 - b.ez, fh = Math.hypot(fx, fz) || 1;
      this.sparks.emit(n, b.x1, gy, b.z1, 3 + 4 * p, fx / fh, fz / fh);
    }
  }

  hide() {
    this.sGlow.mesh.visible = this.sCore.mesh.visible = this.hit.visible = this.hitHalo.visible = this.hitPool.visible = false;
    for (const w of this.wisps) w.mesh.visible = false;
  }
}
