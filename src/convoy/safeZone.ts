// The convoy's safe zone (Keith 2026-11-01: "enemies kind of semi-avoid the Convoy"). Pure: no Three.js.
//
// A band zoneRadius wide round the train's footprints (each car's rectangle). Anything hostile inside it is steered out
// (src/game/keepOut.ts): its inward motion cut by the weight and a push outward, the weight rising from 0 at the edge to
// zoneAvoid halfway in. zoneAvoid below 1 is the "semi": a determined chase still gets some way in, where the turrets,
// escorts and guardians (src/convoy/guard.ts) kill it. The convoy's guns reach past the band (defenceRange).
// Ownership: host (it moves enemies). Rebuilt from the platforms each frame, so it follows the train through turns.
import type { Param } from "../core/tweaks";
import type { KeepOut } from "../game/keepOut";

export const SAFE_DEFAULTS = {
  zoneOn: 1,
  zoneRadius: 60,
  zoneAvoid: 0.75,
  zonePush: 5,
};
export type SafeValues = typeof SAFE_DEFAULTS;

const G = "Safe zone";
export const SAFE_PARAMS: Param[] = [
  { key: "zoneOn", label: "Enemies avoid the convoy", min: 0, max: 1, step: 1, group: G },
  { key: "zoneRadius", label: "Zone width (m)", min: 10, max: 200, step: 1, group: G, tip: "How far out from the cars' sides enemies start steering away" },
  { key: "zoneAvoid", label: "Avoid strength", min: 0, max: 1, step: 0.05, group: G, tip: "0: they ignore the convoy; 1: they never come in. Between, a hard chase still gets part way in (reached halfway into the zone)" },
  { key: "zonePush", label: "Push out (m/s)", min: 0, max: 15, step: 0.5, group: G, tip: "Outward speed added at full strength, on top of losing their inward motion" },
];
export const SAFE_GROUPS = [G];

/** What the zone reads off a car: its middle, heading and footprint. */
export interface ZoneCar { x: number; z: number; heading: number; spec: { length: number; width: number } }

export class SafeZone implements KeepOut {
  private cars: { x: number; z: number; fx: number; fz: number; hl: number; hw: number }[] = [];
  /** A circle round the whole train, for the quick out. */
  private cx = 0; private cz = 0; private cr = 0;

  constructor(public v: SafeValues) {}

  get push() { return this.v.zonePush; }
  get on() { return this.v.zoneOn >= 0.5 && this.v.zoneAvoid > 0 && this.v.zoneRadius > 0; }

  /** Follow the train (once a frame). */
  update(cars: readonly ZoneCar[]) {
    while (this.cars.length < cars.length) this.cars.push({ x: 0, z: 0, fx: 0, fz: 1, hl: 0, hw: 0 });
    this.cars.length = cars.length;
    let sx = 0, sz = 0;
    cars.forEach((p, i) => {
      const c = this.cars[i];
      c.x = p.x; c.z = p.z; c.fx = Math.sin(p.heading); c.fz = Math.cos(p.heading); c.hl = p.spec.length / 2; c.hw = p.spec.width / 2;
      sx += p.x; sz += p.z;
    });
    const n = Math.max(1, cars.length);
    this.cx = sx / n; this.cz = sz / n;
    let r = 0;
    for (const c of this.cars) r = Math.max(r, Math.hypot(c.x - this.cx, c.z - this.cz) + c.hl + c.hw);
    this.cr = r;
  }

  /** Distance (m) from the nearest car's footprint (0 on or inside one), and the outward unit from it. */
  dist(x: number, z: number, out?: { x: number; z: number }): number {
    let best = Infinity, ox = 0, oz = 1;
    for (const c of this.cars) {
      const dx = x - c.x, dz = z - c.z;
      const a = dx * c.fx + dz * c.fz, s = dx * c.fz - dz * c.fx; // along, across (+ left: +X is left at heading 0)
      const ea = Math.max(0, Math.abs(a) - c.hl), es = Math.max(0, Math.abs(s) - c.hw);
      const d = Math.hypot(ea, es);
      if (d >= best) continue;
      best = d;
      if (d > 1e-4) {
        const ka = (ea / d) * Math.sign(a), ks = (es / d) * Math.sign(s);
        ox = c.fx * ka + c.fz * ks; oz = c.fz * ka - c.fx * ks;
      } else {
        const k = s >= 0 ? 1 : -1; // inside: straight out the nearer side
        ox = c.fz * k; oz = -c.fx * k;
      }
    }
    if (out) { out.x = ox; out.z = oz; }
    return best;
  }

  /** Inside the band at all? */
  inside(x: number, z: number) { return this.dist(x, z) < this.v.zoneRadius; }

  weight(x: number, z: number, out: { x: number; z: number }): number {
    if (!this.on || !this.cars.length) return 0;
    const R = this.v.zoneRadius;
    if (Math.hypot(x - this.cx, z - this.cz) > this.cr + R) return 0;
    const d = this.dist(x, z, out);
    if (d >= R) return 0;
    return this.v.zoneAvoid * Math.min(1, (1 - d / R) * 2);
  }
}
