// What the convoy leaves behind on the sand (Keith 2026-10-24): ruts behind every track and wheel line, and dust
// kicked up where tracks and wheels leave the sand, drifting off on the wind. Uses the shared dust (DustSim.wheel,
// which scales by the ground under it: sand, gravel, dirt, concrete) and ground dents (GroundMarks.rut).
// Cost: one accumulator per platform for the ruts (a rut per line every convoyRutEvery metres) and one per dust
// source (fractional puffs carried over), so nothing is laid per frame per wheel. The escorts use car().
import type { Param } from "../core/tweaks";
import type { Surface } from "../fx/dust";
import type { CarSim } from "../vehicles/car";
import type { Platform } from "./platform";
import { trackPods, type TrackValues } from "./tracks";

export const TRAIL_DEFAULTS = {
  convoyRutEvery: 2.5,
  convoyTrackDust: 2.5,
  convoyWheelDust: 0.8,
  convoyTrackSlip: 0.15,
  escortDust: 1,
};
export type TrailValues = typeof TRAIL_DEFAULTS;

export const TRAIL_PARAMS: Param[] = [
  { key: "convoyRutEvery", label: "Rut every (m)", min: 0.8, max: 8, step: 0.1, group: "Convoy trail", tip: "A rut mark per track or wheel line this often (more = cheaper, gappier). They heal with the dents (Ground dents: surfaces)" },
  { key: "convoyTrackDust", label: "Track dust ×", min: 0, max: 8, step: 0.05, group: "Convoy trail", tip: "Dust thrown up where each track leaves the sand, times a wheel's" },
  { key: "convoyWheelDust", label: "Platform wheel dust ×", min: 0, max: 4, step: 0.05, group: "Convoy trail" },
  { key: "convoyTrackSlip", label: "Track churn", min: 0, max: 1, step: 0.01, group: "Convoy trail", tip: "How much the tracks churn the sand (more clumps and dust, like a sliding wheel)" },
  { key: "escortDust", label: "Escort dust ×", min: 0, max: 4, step: 0.05, group: "Convoy trail" },
];

/** What the trail draws with: the dust sim and the ground marks (a Battlefield has both). */
export interface TrailFx {
  dust: {
    wheel(x: number, y: number, z: number, vx: number, vz: number, metres: number, slip: number, acc: number): number;
    surfaceAt: (x: number, z: number) => Surface;
  };
  marks: { rut(x: number, z: number, yaw: number, width: number, length: number): void };
}

/** A line on the ground behind a platform: local x, the z where it leaves the sand, rut width, dust weight. */
interface Line { x: number; z: number; w: number; dust: number; tracked: boolean }

/** Platform wheels (local x off the side, z share of the length): match platformBody's wheels. */
export const WHEEL_X_IN = 0.7, WHEEL_Z = [0.36, 0, -0.36], WHEEL_W = 0.9;

/** Each rut is this much longer than the spacing, so the faded ends overlap into a continuous track. */
const RUT_OVERLAP = 1.6;

const ground = (f: { height(x: number, z: number): number }, x: number, z: number) => f.height(x, z);

export class ConvoyTrail {
  /** Ruts laid and dust calls made (for the HUD and check). */
  ruts = 0;
  private rutAcc = new Map<Platform, number>();
  private last = new Map<Platform, number>();
  private dustAcc = new Map<object, number[]>();
  private carRut = new Map<object, number>();
  private w = { x: 0, y: 0, z: 0 };

  constructor(readonly v: TrailValues & TrackValues, readonly fx: TrailFx, readonly field: { height(x: number, z: number): number }) {}

  /** Where each platform touches the sand, rearmost first per line. */
  private lines(p: Platform): Line[] {
    const out: Line[] = [];
    if (p.spec.tracked) {
      // Each pod throws dust off its rear end; the ruts come from the last pod on each side (it runs over the others').
      for (const pod of trackPods(p.spec, this.v)) out.push({ x: pod.x, z: pod.z1, w: pod.w * 0.85, dust: this.v.convoyTrackDust, tracked: true });
    } else {
      for (const sx of [1, -1]) for (const zs of WHEEL_Z) out.push({ x: sx * (p.spec.width / 2 - WHEEL_X_IN), z: zs * p.spec.length, w: WHEEL_W, dust: this.v.convoyWheelDust, tracked: false });
    }
    return out;
  }

  update(platforms: Platform[]) {
    const v = this.v;
    for (const p of platforms) {
      const was = this.last.get(p) ?? p.travelled;
      const moved = Math.max(0, p.travelled - was);
      this.last.set(p, p.travelled);
      if (moved <= 0 || moved > 5) continue;
      const lines = this.lines(p);
      let acc = this.dustAcc.get(p);
      if (!acc || acc.length !== lines.length) { acc = new Array(lines.length).fill(0); this.dustAcc.set(p, acc); }
      const slip = p.spec.tracked ? v.convoyTrackSlip : 0;
      lines.forEach((l, i) => {
        if (l.dust <= 0) return;
        // Across the track's width: a different spot each time, so a wide track doesn't throw one thin plume.
        const jx = l.tracked ? (Math.random() - 0.5) * l.w : 0;
        const w = p.toWorld(l.x + jx, 0, l.z, this.w);
        acc![i] = this.fx.dust.wheel(w.x, ground(this.field, w.x, w.z), w.z, p.vel.x, p.vel.z, moved * l.dust, slip, acc![i]);
      });
      let r = (this.rutAcc.get(p) ?? 0) + moved;
      if (r >= v.convoyRutEvery) {
        r = 0;
        // One rut per line: the rearmost pod or wheel on each side.
        const rear = new Map<number, Line>();
        for (const l of lines) { const k = Math.round(l.x * 10); const q = rear.get(k); if (!q || l.z < q.z) rear.set(k, l); }
        for (const l of rear.values()) {
          const w = p.toWorld(l.x, 0, l.z, this.w);
          if (this.fx.dust.surfaceAt(w.x, w.z) === "concrete") continue;
          this.fx.marks.rut(w.x, w.z, p.heading, l.w, v.convoyRutEvery * RUT_OVERLAP);
          this.ruts++;
        }
      }
      this.rutAcc.set(p, r);
    }
  }

  /** A vehicle's wheels: dust from each grounded wheel, ruts from the rear ones. */
  car(key: object, s: CarSim, moved: number, width: number) {
    if (moved <= 0 || moved > 5 || Math.abs(s.speed) < 0.5) return;
    let acc = this.dustAcc.get(key);
    if (!acc || acc.length !== s.wheels.length) { acc = new Array(s.wheels.length).fill(0); this.dustAcc.set(key, acc); }
    s.wheels.forEach((w, i) => {
      if (w.grounded) acc![i] = this.fx.dust.wheel(w.pos.x, w.pos.y, w.pos.z, s.vel.x, s.vel.z, moved * this.v.escortDust, w.slip, acc![i]);
    });
    let r = (this.carRut.get(key) ?? 0) + moved;
    if (r >= this.v.convoyRutEvery) {
      r = 0;
      for (const i of s.rearWheels()) {
        const w = s.wheels[i];
        if (!w.grounded || this.fx.dust.surfaceAt(w.pos.x, w.pos.z) === "concrete") continue;
        this.fx.marks.rut(w.pos.x, w.pos.z, s.heading, width, this.v.convoyRutEvery * RUT_OVERLAP);
        this.ruts++;
      }
    }
    this.carRut.set(key, r);
  }
}
