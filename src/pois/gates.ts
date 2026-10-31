// Fortress gates as something to shoot (host state: health and the gateDown event; Keith 2026-10-31,
// docs/proposal-fortresses.md). One target for every standing barricade on the field: a steel slab filling its gap
// (the ground under it is the wall's plug, src/pois/fortressGround.ts). Rounds test each slab as a box; blasts splash
// onto every slab in reach. At zero health the gate is down: its id goes into the walls' `down` set (the gap opens in
// the ground) and onDown fires with plain data, so the glue rebuilds the ground there, plays the blast and wakes the
// yard behind it. Pure apart from the THREE vector maths: no drawing (src/pois/gatesDraw.ts).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import type { Gate, Ring } from "./fortress";

export const GATE_DEFAULTS = { gateHp: 3000, gateArmour: 3, gateRingHp: 0.35 };
export type GateValues = typeof GATE_DEFAULTS;
const G = "Fortress: gates";
export const GATE_PARAMS: Param[] = [
  { key: "gateHp", label: "Gate health", min: 100, max: 30000, step: 50, group: G, tip: "The outer ring's barricades; 3000 is about 15 s of a level-1 mech's focused fire" },
  { key: "gateRingHp", label: "Tougher per ring inward (share)", min: 0, max: 2, step: 0.01, group: G },
  { key: "gateArmour", label: "Gate armour (flat per hit)", min: 0, max: 30, step: 0.5, group: G, tip: "Taken off every hit: small rounds do less, rockets and rails shrug it off" },
];

export interface GateState {
  gate: Gate;
  ring: Ring;
  /** The fortress's id. */
  poi: string;
  /** Floor height under the gate (the pad), m. */
  floor: number;
  hp: number; max: number;
  down: boolean;
}

export type GateEvent = { type: "gateHit"; id: string; poi: string; ring: number; damage: number } | { type: "gateDown"; id: string; poi: string; ring: number; x: number; y: number; z: number };

export class Gates implements Hittable {
  readonly surface: HitSurface = "metal";
  readonly material = "steel" as const;
  alive = true;
  readonly list: GateState[] = [];
  private last = -1;
  /** Plain-data events (multiplayer rule: what happened is data). */
  onEvent: ((e: GateEvent) => void) | null = null;

  constructor(public v: GateValues, readonly team: number) {}

  add(poi: string, gate: Gate, ring: Ring, floor: number, hpShare = 1, down = false) {
    const max = this.v.gateHp * (1 + this.v.gateRingHp * gate.ring);
    const s: GateState = { gate, ring, poi, floor, hp: max * hpShare, max, down };
    this.list.push(s);
    return s;
  }

  /** Forget a fortress's gates (it streamed out; the glue keeps what it needs). */
  removePoi(poi: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].poi === poi) this.list.splice(i, 1);
    this.last = -1;
  }

  /** The slab as a box: centre, its across-the-ring axis (u), along-the-ring axis (w) and half sizes. */
  private box(s: GateState) {
    const g = s.gate, a = g.a;
    return {
      cx: g.x, cy: s.floor + s.ring.h * 0.5, cz: g.z,
      ux: Math.sin(a), uz: Math.cos(a), wx: Math.cos(a), wz: -Math.sin(a),
      hu: g.t / 2 + 0.5, hw: g.w / 2 + 0.6, hy: s.ring.h * 0.5,
    };
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = -1, bi = -1;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.down) continue;
      const b = this.box(s);
      const t = slab(o, d, b, maxDist);
      if (t >= 0 && (best < 0 || t < best)) { best = t; bi = i; }
    }
    this.last = bi;
    return best;
  }

  armourOf() { return this.v.gateArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const s = this.list[this.last];
    if (s) this.hurt(s, armourHit(amount, this.v.gateArmour, pierce));
  }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    let n = 0;
    for (const s of this.list) {
      if (s.down) continue;
      const d = this.distTo(s, at);
      if (d > radius) continue;
      // A blast's full weight close in, half at its edge; a round's splash a token share.
      const k = (1 - 0.5 * (d / Math.max(0.01, radius))) * (o?.blast ? 1 : 0.25);
      this.hurt(s, armourHit(damage * k, this.v.gateArmour, o?.pierce));
      n++;
    }
    return n;
  }

  /** Distance from a point to a gate's slab (0 inside). */
  distTo(s: GateState, p: THREE.Vector3) {
    const b = this.box(s);
    const dx = p.x - b.cx, dy = p.y - b.cy, dz = p.z - b.cz;
    const u = Math.max(0, Math.abs(dx * b.ux + dz * b.uz) - b.hu), w = Math.max(0, Math.abs(dx * b.wx + dz * b.wz) - b.hw), y = Math.max(0, Math.abs(dy) - b.hy);
    return Math.hypot(u, w, y);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) {
    const s = this.list[this.last];
    if (!s) return out.set(0, 1, 0);
    const b = this.box(s), side = Math.sign((at.x - b.cx) * b.ux + (at.z - b.cz) * b.uz) || 1;
    return out.set(b.ux * side, 0, b.uz * side);
  }

  bars(out: BarEntry[]) {
    for (const s of this.list) if (!s.down && s.hp < s.max) out.push({ key: s, x: s.gate.x, y: s.floor + s.ring.h + 1.6, z: s.gate.z, hp: s.hp, max: s.max, armour: this.v.gateArmour, width: 4, always: true });
  }

  /** Take damage off a gate (host); at zero it's down. */
  hurt(s: GateState, dmg: number) {
    if (s.down || !(dmg > 0)) return;
    s.hp -= dmg;
    this.onEvent?.({ type: "gateHit", id: s.gate.id, poi: s.poi, ring: s.gate.ring, damage: dmg });
    if (s.hp <= 0) {
      s.hp = 0; s.down = true;
      this.onEvent?.({ type: "gateDown", id: s.gate.id, poi: s.poi, ring: s.gate.ring, x: s.gate.x, y: s.floor + s.ring.h * 0.5, z: s.gate.z });
    }
  }
}

/** Ray against a box with two horizontal axes (u, w) and y: distance or -1. */
function slab(o: THREE.Vector3, d: THREE.Vector3, b: { cx: number; cy: number; cz: number; ux: number; uz: number; wx: number; wz: number; hu: number; hw: number; hy: number }, maxDist: number) {
  const ox = o.x - b.cx, oy = o.y - b.cy, oz = o.z - b.cz;
  const axes: [number, number, number][] = [
    [ox * b.ux + oz * b.uz, d.x * b.ux + d.z * b.uz, b.hu],
    [ox * b.wx + oz * b.wz, d.x * b.wx + d.z * b.wz, b.hw],
    [oy, d.y, b.hy],
  ];
  let t0 = 0, t1 = maxDist;
  for (const [p, q, h] of axes) {
    if (Math.abs(q) < 1e-9) { if (Math.abs(p) > h) return -1; continue; }
    let a = (-h - p) / q, c = (h - p) / q;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  return t0;
}
