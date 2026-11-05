// Spawner shacks as something to shoot (host state; Keith 2026-11-05: "containers that you know, bandits just swarmed
// out of"). Each fortress's spawners (src/pois/fortress.ts `Spawner`): a shack whose doors swing open and bandits
// pour out while the fortress is alert. They're targets: rounds test the whole shack as a box, blasts splash onto it;
// at zero health it's down (a spawnerDown event), the doors blown off and nobody comes out of it again. Pouring is
// the glue's (src/expedition/fortresses.ts): it sets `want`; `step` opens the doors, then `onPour` hands back one
// bandit at a time at the door. Pure apart from the THREE vector maths; drawing in spawnersDraw.ts.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import { BOX, type Block, type Spawner } from "./fortress";
import { slab } from "./gates";

export const SPAWNER_DEFAULTS = { spawnerHp: 1400, spawnerArmour: 2, spawnerOpen: 0.8, spawnerEvery: 0.28, spawnerShut: 2.5 };
export type SpawnerValues = typeof SPAWNER_DEFAULTS;
const G = "Fortress: spawners";
export const SPAWNER_PARAMS: Param[] = [
  { key: "spawnerHp", label: "Spawner shack health", min: 100, max: 20000, step: 50, group: G, tip: "Shot down, nobody comes out of it again" },
  { key: "spawnerArmour", label: "Spawner armour (flat per hit)", min: 0, max: 30, step: 0.5, group: G },
  { key: "spawnerOpen", label: "Doors take (s) to open", min: 0.1, max: 4, step: 0.05, group: G, tip: "The tell: the doors swing open and the lamp flashes before they pour out" },
  { key: "spawnerEvery", label: "One out every (s)", min: 0.05, max: 2, step: 0.01, group: G },
  { key: "spawnerShut", label: "Doors shut after (s)", min: 0.2, max: 10, step: 0.1, group: G },
];

export interface SpawnerState {
  sp: Spawner;
  b: Block;
  poi: string;
  /** Floor under the shack (m). */
  floor: number;
  hp: number; max: number;
  down: boolean;
  /** Doors 0 shut .. 1 open (cosmetic, but the pour waits for it). */
  open: number;
  /** Bandits still to come out of it. */
  want: number;
  clock: number;
  /** Seconds since the last one came out. */
  idle: number;
}

export type SpawnerEvent = { type: "spawnerHit"; id: string; poi: string; yard: number; damage: number } | { type: "spawnerDown"; id: string; poi: string; yard: number; x: number; y: number; z: number };

export class Spawners implements Hittable {
  readonly surface: HitSurface = "metal";
  readonly material = "steel" as const;
  alive = true;
  readonly list: SpawnerState[] = [];
  private last = -1;
  onEvent: ((e: SpawnerEvent) => void) | null = null;
  /** One bandit to put at (x, z), running out along heading a (the glue spawns it). */
  onPour: ((s: SpawnerState, x: number, z: number, a: number) => void) | null = null;

  constructor(public v: SpawnerValues, readonly team: number) {}

  add(poi: string, sp: Spawner, b: Block, floor: number, hp?: number) {
    const max = this.v.spawnerHp;
    const s: SpawnerState = { sp, b, poi, floor, hp: hp ?? max, max, down: (hp ?? max) <= 0, open: 0, want: 0, clock: 0, idle: 99 };
    this.list.push(s);
    return s;
  }

  removePoi(poi: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].poi === poi) this.list.splice(i, 1);
    this.last = -1;
  }

  /** Doors and pouring. */
  step(dt: number) {
    const v = this.v;
    for (const s of this.list) {
      if (s.down) { s.want = 0; s.open = Math.max(0, s.open - dt); continue; }
      s.idle += dt;
      if (s.want > 0) {
        s.open = Math.min(1, s.open + dt / Math.max(0.05, v.spawnerOpen));
        if (s.open >= 1 && (s.clock -= dt) <= 0) {
          s.clock = v.spawnerEvery * (0.7 + 0.6 * ((s.want * 0.618) % 1));
          s.want--; s.idle = 0;
          // Out of the doorway, a little either side of its middle.
          const side = (((s.want * 0.381) % 1) - 0.5) * BOX.wide * 0.6, out = 0.9;
          const ox = Math.sin(s.sp.a), oz = Math.cos(s.sp.a);
          this.onPour?.(s, s.sp.x + ox * out + oz * side, s.sp.z + oz * out - ox * side, s.sp.a);
        }
      } else if (s.idle > v.spawnerShut) s.open = Math.max(0, s.open - dt / Math.max(0.05, v.spawnerOpen));
    }
  }

  private box(s: SpawnerState) {
    const b = s.b, a = b.a, h = b.stack * BOX.high;
    return { cx: b.x, cy: s.floor + h / 2, cz: b.z, ux: Math.sin(a), uz: Math.cos(a), wx: Math.cos(a), wz: -Math.sin(a), hu: b.len / 2 + 0.1, hw: b.dep / 2 + 0.1, hy: h / 2 };
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

  armourOf() { return this.v.spawnerArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const s = this.list[this.last];
    if (s) this.hurt(s, armourHit(amount, this.v.spawnerArmour, pierce));
  }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    let n = 0;
    for (const s of this.list) {
      if (s.down) continue;
      const b = this.box(s), dx = at.x - b.cx, dy = at.y - b.cy, dz = at.z - b.cz;
      const d = Math.hypot(Math.max(0, Math.abs(dx * b.ux + dz * b.uz) - b.hu), Math.max(0, Math.abs(dx * b.wx + dz * b.wz) - b.hw), Math.max(0, Math.abs(dy) - b.hy));
      if (d > radius) continue;
      this.hurt(s, armourHit(damage * (1 - 0.5 * (d / Math.max(0.01, radius))) * (o?.blast ? 1 : 0.25), this.v.spawnerArmour, o?.pierce));
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
    for (const s of this.list) if (!s.down && s.hp < s.max) out.push({ key: s, x: s.b.x, y: s.floor + s.b.stack * BOX.high + 1.2, z: s.b.z, hp: s.hp, max: s.max, armour: this.v.spawnerArmour, width: 3, always: true });
  }

  hurt(s: SpawnerState, dmg: number) {
    if (s.down || !(dmg > 0)) return;
    s.hp -= dmg;
    this.onEvent?.({ type: "spawnerHit", id: s.sp.id, poi: s.poi, yard: s.sp.yard, damage: dmg });
    if (s.hp <= 0) {
      s.hp = 0; s.down = true; s.want = 0;
      this.onEvent?.({ type: "spawnerDown", id: s.sp.id, poi: s.poi, yard: s.sp.yard, x: s.sp.x, y: s.floor + BOX.high * 0.5, z: s.sp.z });
    }
  }
}
