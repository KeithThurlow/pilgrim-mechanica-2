// Burning (Keith 2026-10-30: the incendiary feed's ignited rounds, src/weapons/gear.ts; 2026-11-05: the flamers and the
// napalm launcher, src/weapons/fire/). A burn sets what it hits alight: for a few seconds the target takes damage over
// time, through the same Hittable adapter the hit used (pick the part, then damage), so it works on robots, infantry,
// vehicles and a rival mech alike. A new ignition on the same target and part renews the time (and keeps the stronger
// burn); a target that dies stops burning. Burn damage is fire damage (src/game/damageType.ts): × fire vs flesh on
// people, × fire vs metal on machines.
//
// Heat (Keith 2026-11-05: "metal ... could heat up"): metal that burns heats up, heatRise a second (0..1), and cools at
// heatCool once the flames are out. Hot metal cooks: heat² × heatDps a second on top of the burn, still while it cools,
// so a robot hosed for a few seconds glows and keeps taking damage after you stop. Flesh doesn't heat. The draw reads
// heatOf(target, unit) for the glow (robots, mechs). Pure of drawing: the battlefield draws flames and smoke.
// Ownership: host state (damage, heat). Randomness: none here (the flames are cosmetic).
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";
import { matterOf, typeMul, type DamageTypeValues } from "./damageType";

export interface BurnValues { burnTick: number; burnMax: number; heatRise: number; heatCool: number; heatDps: number }
export const BURN_FALLBACK: BurnValues = { burnTick: 0.25, burnMax: 192, heatRise: 0.4, heatCool: 0.15, heatDps: 50 };

/** One target on fire (or hot metal cooling). */
export interface Burning {
  target: Hittable;
  /** The part or unit the hit struck (the adapter's key; -1 none). */
  key: number;
  /** Seconds of burning left (0: out, only cooling), damage per second, time since the last tick. */
  left: number;
  dps: number;
  acc: number;
  /** Metal's heat 0..1 (always 0 on flesh). */
  heat: number;
  metal: boolean;
  /** Where it burns (the last ignition; the flames are drawn here). */
  x: number; y: number; z: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Burns {
  readonly list: Burning[] = [];
  /** Damage applied (burn and heat), ignitions (per run; the checks read them). */
  total = 0;
  heatTotal = 0;
  ignitions = 0;
  private at = new THREE.Vector3();
  /** Heat by target and unit, rebuilt each step (the draw's glow). */
  private heats = new Map<Hittable, Map<number, number>>();

  constructor(private v: Partial<BurnValues & DamageTypeValues> = BURN_FALLBACK) {}

  private get tick() { return Math.max(0.02, this.v.burnTick ?? BURN_FALLBACK.burnTick); }
  private get max() { return Math.max(1, Math.floor(this.v.burnMax ?? BURN_FALLBACK.burnMax)); }

  /** Set a target alight at a point (renews it if it already burns there). */
  ignite(target: Hittable, key: number, time: number, dps: number, x: number, y: number, z: number) {
    if (!(time > 0) || !(dps > 0)) return;
    this.ignitions++;
    this.onIgnite?.(target, key);
    for (const b of this.list) {
      if (b.target === target && b.key === key) { b.left = Math.max(b.left, time); b.dps = b.left > 0 && b.dps > 0 ? Math.max(b.dps, dps) : dps; b.x = x; b.y = y; b.z = z; return; }
    }
    const b: Burning = { target, key, left: time, dps, acc: 0, heat: 0, metal: matterOf(target) === "metal", x, y, z };
    if (this.list.length < this.max) { this.list.push(b); return; }
    // Full: a cooling one (least heat), else the one with least time left, makes room (unless it's the longer).
    let k = 0;
    const worth = (e: Burning) => (e.left > 0 ? 100 + e.left : e.heat);
    for (let i = 1; i < this.list.length; i++) if (worth(this.list[i]) < worth(this.list[k])) k = i;
    if (worth(this.list[k]) < 100 + time) this.list[k] = b;
  }

  /** Burn for dt: damage on each tick, heat up or cool, drop the burnt out (and cold) and the dead. */
  step(dt: number) {
    const tick = this.tick, v = this.v;
    const rise = v.heatRise ?? BURN_FALLBACK.heatRise, cool = v.heatCool ?? BURN_FALLBACK.heatCool, hdps = v.heatDps ?? BURN_FALLBACK.heatDps;
    this.heats.clear();
    let keep = 0;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!b.target.alive) continue;
      const lit = b.left > 0;
      b.left = Math.max(0, b.left - dt); b.acc += dt;
      if (b.metal) b.heat = lit ? Math.min(1, b.heat + rise * dt) : Math.max(0, b.heat - cool * dt);
      const mul = typeMul("fire", matterOf(b.target), v);
      while (b.acc >= tick && b.target.alive) {
        b.acc -= tick;
        const burn = lit ? b.dps * tick * mul : 0, cook = b.metal ? b.heat * b.heat * hdps * tick : 0;
        if (burn + cook <= 0) continue;
        if (b.key >= 0) b.target.pick?.(b.key);
        b.target.damage(burn + cook, this.at.set(b.x, b.y, b.z), UP);
        this.total += burn + cook; this.heatTotal += cook;
      }
      if ((b.left > 0 || b.heat > 0.01) && b.target.alive) {
        this.list[keep++] = b;
        if (b.heat > 0) {
          let m = this.heats.get(b.target);
          if (!m) { m = new Map(); this.heats.set(b.target, m); }
          const u = b.target.unitOf ? b.target.unitOf(b.key) : b.key;
          if ((m.get(u) ?? 0) < b.heat) m.set(u, b.heat);
        }
      }
    }
    this.list.length = keep;
  }

  /** Heat at one target and part (the freeze ray's thermal shock reads it), and cooling it at once. */
  heatAtKey(target: Hittable, key: number): number { let h = 0; for (const b of this.list) if (b.target === target && (b.key === key || key < 0) && b.heat > h) h = b.heat; return h; }
  quench(target: Hittable, key: number) { for (const b of this.list) if (b.target === target && (b.key === key || key < 0)) { b.heat = 0; b.left = 0; } }
  /** Called on every ignition (the chill system thaws what fire touches). */
  onIgnite: ((target: Hittable, key: number) => void) | null = null;

  /** Is this target burning (any part)? */
  burning(target: Hittable) { return this.list.some((b) => b.target === target && b.left > 0); }

  /** How hot this target's unit is (0..1; the hottest of its parts). Unit -1: the hottest of any. */
  heatOf(target: Hittable, unit = -1): number {
    const m = this.heats.get(target);
    if (!m) return 0;
    if (unit >= 0) return m.get(unit) ?? 0;
    let h = 0;
    for (const x of m.values()) if (x > h) h = x;
    return h;
  }

  /** Every hot unit of a target (unit -> heat), or null: the swarms' draws tint by it. */
  heatsOf(target: Hittable): ReadonlyMap<number, number> | null { return this.heats.get(target) ?? null; }
}
