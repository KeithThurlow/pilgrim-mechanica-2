// What the plough throws about (cosmetic, drawing side; Math.random is fine here): sand pouring and rolling off both
// ends of the blade into the berms (clumps flung outward and falling, low rolling cloud), sand running along the
// moldboard and a dust plume over the blade, a churned strip behind it (track ruts and plough ridges as ground dents).
// All of it scales with the sand being moved right now (Plough.rate): big over a crest, a trickle across a flat.
import type { Param } from "../core/tweaks";
import { CLOUD, CLUMP } from "../fx/dust";
import type { Plough } from "./plough";
import { PLOUGH_BASE_LENGTH, PLOUGH_BASE_HALF, BLADE_AHEAD, BLADE_HEIGHT } from "./plough";

export const PLOUGH_FX_DEFAULTS = {
  ploughFullLoad: 160,
  ploughSpill: 40,
  ploughPlume: 14,
  ploughIdleDust: 0.15,
  ploughRidges: 9,
  ploughChurnEvery: 1.6,
};
export type PloughFxValues = typeof PLOUGH_FX_DEFAULTS;

export const PLOUGH_FX_PARAMS: Param[] = [
  { key: "ploughFullLoad", label: "Full load (m³/s a side)", min: 20, max: 600, step: 5, group: "Plough sand", tip: "Sand moved off one side per second that throws the most sand about; less throws proportionally less" },
  { key: "ploughSpill", label: "Spill at the tips (clumps/s)", min: 0, max: 150, step: 1, group: "Plough sand", tip: "Clumps poured and flung off each blade tip at full load" },
  { key: "ploughPlume", label: "Dust plume (puffs/s)", min: 0, max: 60, step: 0.5, group: "Plough sand", tip: "Cloud thrown up along the blade and rolling off the tips at full load" },
  { key: "ploughIdleDust", label: "Idle dust share", min: 0, max: 1, step: 0.01, group: "Plough sand", tip: "Share of the plume left when moving nothing (the blade scraping the floor)" },
  { key: "ploughRidges", label: "Plough ridges", min: 0, max: 24, step: 1, group: "Plough sand", tip: "Churned lines across the road behind the blade (ground dents, near the camera)" },
  { key: "ploughChurnEvery", label: "Churn marks every (m)", min: 0.5, max: 6, step: 0.1, group: "Plough sand", tip: "How often the ridges and track ruts are pressed" },
];

/** What the FX draw with (a Battlefield has both). */
export interface PloughFxTarget {
  dust: { emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, dens: number): void; v: { clumpLife: number; cloudLife: number; clumpDensity: number; cloudDensity: number } };
  marks: { rut(x: number, z: number, yaw: number, width: number, length: number): void; furrow(x0: number, z0: number, x1: number, z1: number, width: number, dt: number): void };
}

export class PloughFx {
  /** Particles carried over per source (fractional counts). */
  private acc = [0, 0, 0, 0, 0];

  private last: { x: number; z: number }[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  private w = { x: 0, y: 0, z: 0 };
  /** Load share now, left and right (0..1+), for the HUD. */
  load = [0, 0];

  constructor(readonly v: PloughFxValues, readonly plough: Plough, readonly fx: PloughFxTarget, readonly ground: { height(x: number, z: number): number }) {}

  private count(i: number, n: number) { this.acc[i] += n; const k = Math.floor(this.acc[i]); this.acc[i] -= k; return k; }

  update(dt: number) {
    const p = this.plough, v = this.v, d = this.fx.dust, dv = d.v;
    if (dt <= 0) return;
    const full = Math.max(1, v.ploughFullLoad);
    const hw = p.halfBlade, tipZ = PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD, lag = p.tipLag;
    const fx = p.fwd.x, fz = p.fwd.z, sp = p.speed;
    this.load = [p.rate.left / full, p.rate.right / full];
    [1, -1].forEach((sx, si) => {
      const k = Math.min(2, sx > 0 ? this.load[0] : this.load[1]);
      const lx = p.left.x * sx, lz = p.left.z * sx;
      const tip = p.toWorld(sx * hw, 0, tipZ - lag + 0.5, this.w);
      const gy = this.ground.height(tip.x, tip.z);
      // Clumps poured over the end of the blade and flung outward, falling into the berm.
      for (let i = this.count(si, v.ploughSpill * k * dt); i > 0; i--) {
        const out = 2 + Math.random() * 5 * (0.6 + k * 0.4), up = 0.5 + Math.random() * 3;
        const along = (Math.random() - 0.3) * 1.5;
        this.fx.dust.emit(CLUMP, tip.x - fx * Math.random() * 2, gy + 0.6 + Math.random() * BLADE_HEIGHT * 0.9, tip.z - fz * Math.random() * 2,
          lx * out + fx * (sp * 0.6 + along), up, lz * out + fz * (sp * 0.6 + along),
          0.25 + Math.random() * 0.5 * (0.5 + k), dv.clumpLife * (1 + Math.random() * 0.8), dv.clumpDensity);
      }
      // Sand rolling off the end: low, slow cloud spreading outward and settling on the berm.
      for (let i = this.count(2 + si, v.ploughPlume * (v.ploughIdleDust + k) * 0.5 * dt); i > 0; i--) {
        const out = 1 + Math.random() * 2.5;
        this.fx.dust.emit(CLOUD, tip.x + lx * Math.random() * 3, gy + 0.5 + Math.random() * 1.5, tip.z + lz * Math.random() * 3,
          lx * out + fx * sp * 0.5, 0.3 + Math.random() * 0.8, lz * out + fz * sp * 0.5,
          1.2 + Math.random() * 1.6 * (0.5 + k), dv.cloudLife * (1 + Math.random()), dv.cloudDensity * 0.8);
      }
    });
    // Along the blade: sand running along the moldboard toward the tips, and the plume going up over it.
    const kt = Math.min(2, (this.load[0] + this.load[1]) / 2);
    for (let i = this.count(4, v.ploughPlume * (v.ploughIdleDust + kt) * dt); i > 0; i--) {
      const sx = Math.random() < 0.5 ? 1 : -1, f = Math.random(), lxl = sx * hw * f;
      const q = p.toWorld(lxl, 0, tipZ - Math.abs(lxl) * (lag / Math.max(1, hw)) + 0.8, this.w);
      const gy = this.ground.height(q.x, q.z);
      const run = 1.5 + Math.random() * 2;
      this.fx.dust.emit(CLOUD, q.x, Math.max(gy, p.y) + BLADE_HEIGHT * (0.5 + Math.random() * 0.6), q.z,
        p.left.x * sx * run + fx * (sp + 0.5), 1 + Math.random() * 1.6, p.left.z * sx * run + fz * (sp + 0.5),
        1.4 + Math.random() * 2 * (0.4 + kt), dv.cloudLife * (1.2 + Math.random()), dv.cloudDensity * 0.7);
    }
    this.marksBehind();
  }

  /** Track ruts behind the pods and plough ridges across the road (outside the tracks), every ploughChurnEvery m. */
  private marksBehind() {
    const p = this.plough, v = this.v, hw = p.halfBlade;
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if (Number.isFinite(moved) && moved < v.ploughChurnEvery) return;
    const fresh = !Number.isFinite(moved) || moved > 20;
    this.lastX = p.x; this.lastZ = p.z;
    const z = -PLOUGH_BASE_LENGTH / 2 - 1, n = Math.max(0, Math.round(v.ploughRidges));
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      const lx = -hw + 2 + ((2 * hw - 4) * (i + 0.5)) / n;
      const w = p.toWorld(lx, 0, z, this.w), q = { x: w.x, z: w.z };
      pts.push(q);
      const a = this.last[i];
      if (!fresh && a && Math.abs(lx) > PLOUGH_BASE_HALF - 0.5) this.fx.marks.furrow(a.x, a.z, q.x, q.z, 0.9, 0);
    }
    this.last = pts;
    if (fresh) return;
    for (const sx of [1, -1]) {
      const r = p.toWorld(sx * (PLOUGH_BASE_HALF - 1.6), 0, z, this.w);
      this.fx.marks.rut(r.x, r.z, p.heading, 3.2, v.ploughChurnEvery * 1.6);
    }
  }
}
