// A reactor going up (Keith 2026-11-06: "when the big tall walkers explode, it kind of turns into a bit of an airburst
// type scenario, with cool shockwave pouring out from around it, and looking kind of like a nova"). Pure list of live
// novas; cosmetic (Math.random is fine). Each one is: a white-hot flash at the hull, a fireball shell swelling out to
// the blast's edge, a thin shockwave ring racing out flat from the hull's height past the blast, and a ring of dust
// rolling out along the ground under it. Drawing: novaDraw.ts.
import type { Param } from "../core/tweaks";
import { NovaDebris, NOVA_DEBRIS_DEFAULTS, NOVA_DEBRIS_PARAMS } from "./novaDebris";

export const NOVA_DEFAULTS = {
  novaOn: 1,
  novaLife: 1.3,
  novaFlash: 0.35,
  novaShell: 0.85,
  novaRing: 1.8,
  novaRingSharp: 14,
  novaGround: 1.1,
  novaBright: 1.6,
  novaLight: 2.2,
  ...NOVA_DEBRIS_DEFAULTS,
};
export type NovaValues = typeof NOVA_DEFAULTS;

const G = "Reactor nova";
export const NOVA_GROUPS = [G];
export const NOVA_PARAMS: Param[] = [
  { key: "novaOn", label: "Nova on", min: 0, max: 1, step: 1, group: G, tip: "Keith 2026-11-06: big walkers', weapon quads' and striders' reactors going up. Each kind's own Nova look slider scales it" },
  { key: "novaLife", label: "Lasts (s)", min: 0.3, max: 4, step: 0.05, group: G },
  { key: "novaFlash", label: "Flash size (× blast radius)", min: 0, max: 1.5, step: 0.01, group: G, tip: "The white-hot ball at the hull, over in a few tenths" },
  { key: "novaShell", label: "Fireball shell (× blast radius)", min: 0, max: 2, step: 0.01, group: G, tip: "A glowing shell swelling out, brightest at its edge" },
  { key: "novaRing", label: "Shockwave ring (× blast radius)", min: 0, max: 4, step: 0.05, group: G, tip: "The flat ring racing out from the hull's height, past the blast's reach" },
  { key: "novaRingSharp", label: "Ring sharpness", min: 1, max: 40, step: 0.5, group: G, tip: "Higher: a thinner, crisper ring edge" },
  { key: "novaGround", label: "Ground ring (× blast radius)", min: 0, max: 3, step: 0.05, group: G, tip: "A ring of light rolling out over the sand under it" },
  { key: "novaBright", label: "Brightness", min: 0, max: 4, step: 0.05, group: G },
  { key: "novaLight", label: "Light on the ground (×)", min: 0, max: 6, step: 0.05, group: G, tip: "The flash of light it throws (at night most of all)" },
  ...NOVA_DEBRIS_PARAMS,
];

export interface Nova {
  x: number; y: number; z: number;
  /** The ground under it, the blast radius (m), its size × and age (s). */
  gy: number; R: number; k: number; age: number;
  /** Its time runs at this rate (1 / the kind's slow-down, Keith 2026-11-06: the tall walkers' slower, more epic). */
  rate: number;
}

export class Novas {
  readonly list: Nova[] = [];
  /** The hull shattering: plates and sparks thrown out (src/fx/novaDebris.ts). */
  readonly debris: NovaDebris;
  constructor(public v: NovaValues) { this.debris = new NovaDebris(v); }

  /**
   * A reactor going up at (x, y, z) over ground at gy, blast radius R, look × k. At most 8 live: the oldest go.
   * slow: its time stretched by this (1: as tuned); shatter: the hull's plates and sparks thrown out (×; 0 none).
   */
  post(x: number, y: number, z: number, gy: number, R: number, k: number, slow = 1, shatter = 0) {
    if (!(this.v.novaOn > 0.5) || !(k > 0) || !(R > 0)) return;
    if (this.list.length >= 8) this.list.shift();
    const s = Math.max(0.2, slow);
    this.list.push({ x, y, z, gy, R, k, age: 0, rate: 1 / s });
    if (shatter > 0) this.debris.emit(x, y, z, R, k * shatter, s);
  }

  /** The life of a nova of look × k. */
  life(n: Nova) { return Math.max(0.2, this.v.novaLife * (0.7 + 0.3 * Math.min(2, n.k))); }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      if ((n.age += dt * n.rate) >= this.life(n)) this.list.splice(i, 1);
    }
  }
}
