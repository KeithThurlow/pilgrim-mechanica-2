// Burning pools (Keith 2026-11-05: the napalm launcher, and the flamers' stream where it splashes on the sand). A pool is
// a disc of burning gel on the ground: every pool tick, everything of another team standing in it takes fire damage
// (× Damage types, armour-ignoring) and is set alight (src/game/burn.ts), so what walks out burns on. Pools that land on
// a burning one top it up (poolMerge) instead of stacking. Bodies are found with one sheet across the pool (the same
// search as the sunder beam's, src/game/sheetFire.ts), kept to those inside the disc.
// Ownership: host (damage, the pools' list); ids are stable (rule 12). Randomness: none (the flames are cosmetic).
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";
import type { Burns } from "./burn";
import { matterOf, typeMul, type DamageTypeValues } from "./damageType";
import { sheetHits } from "./sheetFire";
import type { Sheet, SheetHit } from "./sheet";
import type { Register } from "./register";

export interface Pool {
  id: number;
  team: number;
  x: number; y: number; z: number;
  r: number;
  /** Seconds left, how long it burns in all (the draw fades it), damage per second, the burn it sets. */
  left: number;
  life: number;
  dps: number;
  burnTime: number;
  burnDps: number;
  /** Time to the next tick; bodies in it at the last tick (the checks and the draw read it). */
  acc: number;
  inside: number;
  /** A napalm pool (big, long) or a stream splash (small, short): the draw makes napalm thicker and smokier. */
  napalm: boolean;
}

export interface PoolValues { poolTick: number; poolMax: number; poolMerge: number }
const FALLBACK: PoolValues = { poolTick: 0.25, poolMax: 64, poolMerge: 0.6 };

interface Ground { height(x: number, z: number): number }

const UP = new THREE.Vector3(0, 1, 0);

export class FirePools {
  readonly list: Pool[] = [];
  /** Damage dealt by pools, ticks run, pools made (per run; the checks read them). */
  total = 0;
  made = 0;
  private serial = 1;
  private buf: SheetHit<Hittable>[] = [];
  private at = new THREE.Vector3();
  private ro = new THREE.Vector3();
  private rd = new THREE.Vector3();
  private seen = new Set<string>();

  constructor(private ground: Ground, private targets: readonly Hittable[], private burns: Burns, private v: Partial<PoolValues & DamageTypeValues> = FALLBACK,
    private register: Register | null = null) {}

  /** A pool at (x, z): burns r m round for `time` s at `dps`, setting what's in it alight (burnTime s at burnDps). */
  add(team: number, x: number, z: number, r: number, time: number, dps: number, burnTime: number, burnDps: number, napalm = true): Pool | null {
    if (!(r > 0) || !(time > 0)) return null;
    const merge = this.v.poolMerge ?? FALLBACK.poolMerge;
    for (const p of this.list) {
      if (p.team !== team || p.napalm !== napalm) continue;
      if (Math.hypot(p.x - x, p.z - z) < merge * Math.max(p.r, r)) {
        p.left = Math.max(p.left, time); p.life = Math.max(p.life, p.left); p.r = Math.max(p.r, r);
        p.dps = Math.max(p.dps, dps); p.burnTime = Math.max(p.burnTime, burnTime); p.burnDps = Math.max(p.burnDps, burnDps);
        return p;
      }
    }
    const p: Pool = { id: this.serial++, team, x, y: this.ground.height(x, z), z, r, left: time, life: time, dps, burnTime, burnDps, acc: 0, inside: 0, napalm };
    this.made++;
    const max = Math.max(1, Math.floor(this.v.poolMax ?? FALLBACK.poolMax));
    if (this.list.length >= max) {
      // Full: the one nearest its end makes room.
      let k = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i].left < this.list[k].left) k = i;
      this.list[k] = p;
    } else this.list.push(p);
    return p;
  }

  step(dt: number) {
    const tick = Math.max(0.02, this.v.poolTick ?? FALLBACK.poolTick);
    let keep = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      p.left -= dt; p.acc -= dt;
      while (p.acc <= 0 && p.left > -dt) { p.acc += tick; this.burn(p, tick); }
      if (p.left > 0) this.list[keep++] = p;
    }
    this.list.length = keep;
  }

  /** One tick of a pool: everything of another team inside takes its share and is set alight. */
  private burn(p: Pool, tick: number) {
    const g = this.ground, R = p.r;
    const sheet: Sheet = { ox: p.x - R, oz: p.z, dx: 1, dz: 0, from: 0, len: 2 * R, half: R, under: 1,
      top: (t) => g.height(p.x - R + t, p.z) + 2.4, line: (t) => g.height(p.x - R + t, p.z) + 1, ground: (x, z) => g.height(x, z) };
    const found = sheetHits(this.targets, p.team, sheet, null, this.buf, this.register);
    this.seen.clear();
    p.inside = 0;
    for (const h of found) {
      const dx = h.x - p.x, dz = h.z - p.z;
      if (dx * dx + dz * dz > (R + 0.4) * (R + 0.4)) continue;
      const t = h.target;
      // One share per body and part (a fan of rays can find the same one twice).
      const tag = `${this.targets.indexOf(t)}:${h.key}`;
      if (this.seen.has(tag)) continue;
      this.seen.add(tag);
      if (!t.alive) continue;
      if (h.ray) { this.ro.set(h.ray.ox, h.ray.oy, h.ray.oz); this.rd.set(h.ray.dx, h.ray.dy, h.ray.dz); t.hitRay(this.ro, this.rd, h.ray.dist + 1e-3); }
      else t.pick?.(h.key);
      const dmg = p.dps * tick * typeMul("fire", matterOf(t), this.v);
      if (dmg > 0) { t.damage(dmg, this.at.set(h.x, h.y, h.z), UP); this.total += dmg; }
      this.burns.ignite(t, h.key, p.burnTime, p.burnDps, h.x, h.y, h.z);
      p.inside++;
    }
  }
}
