// Lookout towers as something to shoot (host state; Keith 2026-11-05: "a vertical container that's built up, and
// there's a bandit or two at the top that have grenades or rocket launchers or guns that shoot at you, and you can
// destroy those and keep moving forward"). Each fortress's towers (src/pois/fortress.ts `Tower`): containers stacked
// three levels high, crossed, a crew of one or two on top. A tower is a target: rounds test its stack as a box, blasts
// splash on it; at zero health it's down (towerDown): it topples, its stack drops out of the ground and its crew falls
// with it. The crew and their weapons are the glue's (src/expedition/fortresses.ts). Drawing in towersDraw.ts.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import type { Block, Tower } from "./fortress";
import { slab } from "./gates";

export const TOWER_DEFAULTS = {
  towerHp: 1800, towerArmour: 2,
  towerGrenadeRange: 50, towerGrenadeEvery: 3.2, towerGrenadeFlight: 1.6, towerGrenadeRadius: 4.5, towerGrenadeDamage: 60,
  towerRocketRange: 95, towerRocketEvery: 4.5, towerRocketSpeed: 45, towerRocketRadius: 3.5, towerRocketDamage: 110,
  towerGunRange: 70, towerCrewHurt: 2,
};
export type TowerValues = typeof TOWER_DEFAULTS;
const G = "Fortress: towers";
export const TOWER_PARAMS: Param[] = [
  { key: "towerHp", label: "Tower health", min: 100, max: 20000, step: 50, group: G, tip: "Shot down, it topples and its crew falls with it" },
  { key: "towerArmour", label: "Tower armour (flat per hit)", min: 0, max: 30, step: 0.5, group: G },
  { key: "towerCrewHurt", label: "Crew health ×", min: 0.2, max: 8, step: 0.05, group: G },
  { key: "towerGunRange", label: "Rifle crew range (m)", min: 10, max: 200, step: 1, group: G, tip: "Up high they see further" },
  { key: "towerGrenadeRange", label: "Grenadier range (m)", min: 5, max: 150, step: 1, group: G },
  { key: "towerGrenadeEvery", label: "A grenade every (s)", min: 0.3, max: 20, step: 0.1, group: G },
  { key: "towerGrenadeFlight", label: "Grenade flight (s)", min: 0.3, max: 5, step: 0.05, group: G, tip: "The landing ring shows at once: time to step out of it" },
  { key: "towerGrenadeRadius", label: "Grenade blast radius (m)", min: 0.5, max: 15, step: 0.1, group: G },
  { key: "towerGrenadeDamage", label: "Grenade damage", min: 0, max: 600, step: 1, group: G },
  { key: "towerRocketRange", label: "Rocketeer range (m)", min: 5, max: 250, step: 1, group: G },
  { key: "towerRocketEvery", label: "A rocket every (s)", min: 0.3, max: 30, step: 0.1, group: G },
  { key: "towerRocketSpeed", label: "Rocket speed (m/s)", min: 5, max: 200, step: 1, group: G, tip: "Shown where it'll land as it leaves: fast, a short time to dodge" },
  { key: "towerRocketRadius", label: "Rocket blast radius (m)", min: 0.5, max: 15, step: 0.1, group: G },
  { key: "towerRocketDamage", label: "Rocket damage", min: 0, max: 800, step: 1, group: G },
];

export type CrewKind = "gun" | "grenade" | "rocket";

export interface TowerState {
  t: Tower;
  b: Block;
  poi: string;
  floor: number;
  hp: number; max: number;
  down: boolean;
  /** Seconds since it went down (the topple, cosmetic). */
  fell: number;
  /** Which way it topples (heading). */
  fallA: number;
  /** Crew on top: swarm slots and generations, and what each carries; their weapon clocks. */
  crew: { i: number; gen: number; kind: CrewKind; clock: number }[];
}

export type TowerEvent = { type: "towerHit"; id: string; poi: string; yard: number; damage: number } | { type: "towerDown"; id: string; poi: string; yard: number; x: number; y: number; z: number };

export class Towers implements Hittable {
  readonly surface: HitSurface = "metal";
  readonly material = "steel" as const;
  alive = true;
  readonly list: TowerState[] = [];
  private last = -1;
  onEvent: ((e: TowerEvent) => void) | null = null;

  constructor(public v: TowerValues, readonly team: number) {}

  add(poi: string, t: Tower, b: Block, floor: number, hp?: number) {
    const max = this.v.towerHp, h = hp ?? max;
    const s: TowerState = { t, b, poi, floor, hp: h, max, down: h <= 0, fell: h <= 0 ? 99 : 0, fallA: t.a + Math.PI / 2, crew: [] };
    this.list.push(s);
    return s;
  }

  removePoi(poi: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].poi === poi) this.list.splice(i, 1);
    this.last = -1;
  }

  step(dt: number) { for (const s of this.list) if (s.down) s.fell += dt; }

  private box(s: TowerState) {
    const b = s.b, a = b.a, h = s.t.h;
    return { cx: b.x, cy: s.floor + h / 2, cz: b.z, ux: Math.sin(a), uz: Math.cos(a), wx: Math.cos(a), wz: -Math.sin(a), hu: b.len / 2 + 0.2, hw: b.dep / 2 + 0.2, hy: h / 2 };
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = -1, bi = -1;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.down) continue;
      const t = slab(o, d, this.box(s), maxDist);
      if (t >= 0 && (best < 0 || t < best)) { best = t; bi = i; }
    }
    this.last = bi;
    return best;
  }

  armourOf() { return this.v.towerArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const s = this.list[this.last];
    if (s) this.hurt(s, armourHit(amount, this.v.towerArmour, pierce));
  }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    let n = 0;
    for (const s of this.list) {
      if (s.down) continue;
      const b = this.box(s), dx = at.x - b.cx, dy = at.y - b.cy, dz = at.z - b.cz;
      const d = Math.hypot(Math.max(0, Math.abs(dx * b.ux + dz * b.uz) - b.hu), Math.max(0, Math.abs(dx * b.wx + dz * b.wz) - b.hw), Math.max(0, Math.abs(dy) - b.hy));
      if (d > radius) continue;
      this.hurt(s, armourHit(damage * (1 - 0.5 * (d / Math.max(0.01, radius))) * (o?.blast ? 1 : 0.25), this.v.towerArmour, o?.pierce));
      n++;
    }
    return n;
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) {
    const s = this.list[this.last];
    if (!s) return out.set(0, 1, 0);
    const b = this.box(s), du = (at.x - b.cx) * b.ux + (at.z - b.cz) * b.uz, dw = (at.x - b.cx) * b.wx + (at.z - b.cz) * b.wz;
    if (Math.abs(du) / b.hu > Math.abs(dw) / b.hw) return out.set(b.ux * Math.sign(du), 0, b.uz * Math.sign(du));
    return out.set(b.wx * Math.sign(dw), 0, b.wz * Math.sign(dw));
  }

  bars(out: BarEntry[]) {
    for (const s of this.list) if (!s.down && s.hp < s.max) out.push({ key: s, x: s.b.x, y: s.floor + s.t.h + 2.6, z: s.b.z, hp: s.hp, max: s.max, armour: this.v.towerArmour, width: 3, always: true });
  }

  hurt(s: TowerState, dmg: number) {
    if (s.down || !(dmg > 0)) return;
    s.hp -= dmg;
    this.onEvent?.({ type: "towerHit", id: s.t.id, poi: s.poi, yard: s.t.yard, damage: dmg });
    if (s.hp <= 0) {
      s.hp = 0; s.down = true; s.fell = 0;
      this.onEvent?.({ type: "towerDown", id: s.t.id, poi: s.poi, yard: s.t.yard, x: s.b.x, y: s.floor + s.t.h * 0.5, z: s.b.z });
    }
  }
}
