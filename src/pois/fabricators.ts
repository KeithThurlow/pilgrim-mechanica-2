// A manufacturing hub's fabricators as something to shoot (host state; Keith 2026-10-31, docs/proposal-fortresses.md):
// one target for every standing tower on the field, each a steel drum (a vertical cylinder for hits) with health.
// At zero a `fabDown` event (plain data) and it builds nothing more. No drawing here (fabricatorsDraw.ts).
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import type { Fabricator } from "./hub";

export const FAB_DEFAULTS = { fabHp: 2500, fabArmour: 4, fabRadius: 3.4 };
export type FabValues = typeof FAB_DEFAULTS & { hubFabH: number };
const G = "Manufacturing hub: fabricators";
export const FAB_PARAMS: Param[] = [
  { key: "fabHp", label: "Fabricator health", min: 100, max: 30000, step: 50, group: G },
  { key: "fabArmour", label: "Fabricator armour (flat per hit)", min: 0, max: 30, step: 0.5, group: G },
  { key: "fabRadius", label: "Fabricator hit radius (m)", min: 1, max: 8, step: 0.1, group: G },
];

export interface FabState { fab: Fabricator; poi: string; floor: number; hp: number; max: number; down: boolean }
export type FabEvent = { type: "fabHit"; id: string; poi: string; damage: number } | { type: "fabDown"; id: string; poi: string; x: number; y: number; z: number };

export class Fabricators implements Hittable {
  readonly surface: HitSurface = "metal";
  readonly material = "steel" as const;
  alive = true;
  readonly list: FabState[] = [];
  private last = -1;
  onEvent: ((e: FabEvent) => void) | null = null;

  constructor(public v: FabValues, readonly team: number) {}

  add(poi: string, fab: Fabricator, floor: number, hp?: number) {
    const s: FabState = { fab, poi, floor, hp: hp ?? this.v.fabHp, max: this.v.fabHp, down: hp !== undefined && hp <= 0 };
    this.list.push(s);
    return s;
  }

  removePoi(poi: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].poi === poi) this.list.splice(i, 1);
    this.last = -1;
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = -1, bi = -1;
    const R = this.v.fabRadius;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.down) continue;
      // Ray against a vertical cylinder (radius R, from the floor to the tower's top).
      const ox = o.x - s.fab.x, oz = o.z - s.fab.z;
      const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - R * R;
      let t: number;
      if (c <= 0) t = 0;
      else {
        if (a < 1e-9) continue;
        const disc = b * b - a * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / a;
        if (t < 0) continue;
      }
      if (t > maxDist) continue;
      const y = o.y + d.y * t;
      if (y < s.floor - 0.5 || y > s.floor + this.v.hubFabH + 0.5) continue;
      if (best < 0 || t < best) { best = t; bi = i; }
    }
    this.last = bi;
    return best;
  }

  armourOf() { return this.v.fabArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const s = this.list[this.last];
    if (s) this.hurt(s, armourHit(amount, this.v.fabArmour, pierce));
  }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    let n = 0;
    for (const s of this.list) {
      if (s.down) continue;
      const h = Math.max(0, Math.hypot(at.x - s.fab.x, at.z - s.fab.z) - this.v.fabRadius);
      const y = Math.max(0, s.floor - at.y, at.y - (s.floor + this.v.hubFabH));
      const d = Math.hypot(h, y);
      if (d > radius) continue;
      const k = (1 - 0.5 * (d / Math.max(0.01, radius))) * (o?.blast ? 1 : 0.25);
      this.hurt(s, armourHit(damage * k, this.v.fabArmour, o?.pierce));
      n++;
    }
    return n;
  }

  bars(out: BarEntry[]) {
    for (const s of this.list) if (!s.down && s.hp < s.max) out.push({ key: s, x: s.fab.x, y: s.floor + this.v.hubFabH + 2, z: s.fab.z, hp: s.hp, max: s.max, armour: this.v.fabArmour, width: 4, always: true });
  }

  hurt(s: FabState, dmg: number) {
    if (s.down || !(dmg > 0)) return;
    s.hp -= dmg;
    this.onEvent?.({ type: "fabHit", id: s.fab.id, poi: s.poi, damage: dmg });
    if (s.hp <= 0) {
      s.hp = 0; s.down = true;
      this.onEvent?.({ type: "fabDown", id: s.fab.id, poi: s.poi, x: s.fab.x, y: s.floor + this.v.hubFabH * 0.5, z: s.fab.z });
    }
  }
}
