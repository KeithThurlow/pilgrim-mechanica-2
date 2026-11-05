// Chill (Keith 2026-11-05: "an endothermic weapon, like a freeze ray ... that slowed enemies down and slowly froze
// them"). The freeze ray's cold rounds (src/weapons/fire/: the Frost thrower and the Cryo projector) chill what they
// hit: chill 0..1 per target and part, added per hit, ebbing at chillDecay a second. A chilled unit slows (its pace:
// 1 − chillSlow × chill; the swarms read it, Hittable.slow), takes cold damage (coldDps × chill, × Damage types), and
// at full chill freezes solid for freezeTime s (pace 0: no walking, no attacking), then thaws to thawTo with a short
// grace before it can freeze again. Fire thaws (src/game/burn.ts calls thaw); cold on hot metal is a thermal shock:
// shockDamage × its heat at once, and the heat is gone.
// Pure of drawing: the draws read chillsOf / frozen for the frost tint. Ownership: host (damage, pace).
// Randomness: none.
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";
import { matterOf, typeMul, type DamageTypeValues } from "./damageType";

export const CHILL_DEFAULTS = {
  chillDecay: 0.22,
  chillSlow: 0.65,
  freezeTime: 2.5,
  thawTo: 0.45,
  freezeGrace: 1.2,
  chillTick: 0.25,
  chillMax: 192,
  shockDamage: 120,
};
export type ChillValues = typeof CHILL_DEFAULTS;

export interface Chilled {
  target: Hittable;
  key: number;
  chill: number;
  /** Cold damage per second at full chill (the strongest that hit it). */
  dps: number;
  /** Seconds left frozen (0: not), grace before it can freeze again. */
  frozen: number;
  grace: number;
  acc: number;
  x: number; y: number; z: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Chills {
  readonly list: Chilled[] = [];
  total = 0;
  freezes = 0;
  shocks = 0;
  private at = new THREE.Vector3();
  private chills = new Map<Hittable, Map<number, number>>();
  /** Hot metal's heat at this target and part, and a call to cool it (src/game/burn.ts; the battlefield wires them). */
  heatAt: ((t: Hittable, key: number) => number) | null = null;
  quench: ((t: Hittable, key: number) => void) | null = null;
  /** Called the moment something freezes solid (the battlefield: the crack, the burst of frost). */
  onFreeze: ((c: Chilled) => void) | null = null;

  constructor(private v: Partial<ChillValues & DamageTypeValues> = CHILL_DEFAULTS) {}
  private n<K extends keyof ChillValues>(k: K): number { return this.v[k] ?? CHILL_DEFAULTS[k]; }

  /** A cold hit: `amount` chill and the weapon's cold dps at full chill. */
  hit(target: Hittable, key: number, amount: number, dps: number, x: number, y: number, z: number) {
    if (!(amount > 0) || !target.alive) return;
    // Thermal shock: cold on hot metal cracks it.
    const heat = this.heatAt?.(target, key) ?? 0;
    if (heat > 0.25) {
      if (key >= 0) target.pick?.(key);
      const d = this.n("shockDamage") * heat;
      target.damage(d, this.at.set(x, y, z), UP);
      this.total += d; this.shocks++;
      this.quench?.(target, key);
    }
    let c = this.list.find((e) => e.target === target && e.key === key);
    if (!c) {
      if (this.list.length >= Math.max(1, Math.floor(this.n("chillMax")))) {
        let k = 0;
        for (let i = 1; i < this.list.length; i++) if (this.list[i].chill < this.list[k].chill) k = i;
        if (this.list[k].frozen > 0 || this.list[k].chill > amount) return;
        this.release(this.list[k]);
        this.list.splice(k, 1);
      }
      c = { target, key, chill: 0, dps, frozen: 0, grace: 0, acc: 0, x, y, z };
      this.list.push(c);
    }
    c.dps = Math.max(c.dps, dps); c.x = x; c.y = y; c.z = z;
    if (c.frozen > 0) return;
    c.chill = Math.min(1, c.chill + amount);
    if (c.chill >= 1 && c.grace <= 0) { c.frozen = this.n("freezeTime"); this.freezes++; this.onFreeze?.(c); }
  }

  /** Fire on it: it thaws (no longer frozen, half its chill gone). */
  thaw(target: Hittable, key: number) {
    for (const c of this.list) if (c.target === target && (c.key === key || key < 0)) { if (c.frozen > 0) { c.frozen = 0; c.grace = this.n("freezeGrace"); } c.chill *= 0.5; }
  }

  step(dt: number) {
    const decay = this.n("chillDecay"), slow = this.n("chillSlow"), tick = Math.max(0.02, this.n("chillTick"));
    this.chills.clear();
    let keep = 0;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (!c.target.alive) continue;
      if (c.frozen > 0) {
        c.frozen -= dt;
        if (c.frozen <= 0) { c.frozen = 0; c.chill = this.n("thawTo"); c.grace = this.n("freezeGrace"); }
      } else { c.chill = Math.max(0, c.chill - decay * dt); c.grace = Math.max(0, c.grace - dt); }
      // Cold damage while chilled.
      c.acc += dt;
      const mul = typeMul("cold", matterOf(c.target), this.v);
      while (c.acc >= tick && c.target.alive) {
        c.acc -= tick;
        const d = c.dps * (c.frozen > 0 ? 1 : c.chill) * tick * mul;
        if (d <= 0) continue;
        if (c.key >= 0) c.target.pick?.(c.key);
        c.target.damage(d, this.at.set(c.x, c.y, c.z), UP);
        this.total += d;
      }
      const pace = c.frozen > 0 ? 0 : 1 - slow * c.chill;
      if (c.chill > 0.01 || c.frozen > 0) {
        c.target.slow?.(c.key, pace);
        this.list[keep++] = c;
        let m = this.chills.get(c.target);
        if (!m) { m = new Map(); this.chills.set(c.target, m); }
        const u = c.target.unitOf ? c.target.unitOf(c.key) : c.key;
        const k = c.frozen > 0 ? 2 : c.chill;
        if ((m.get(u) ?? 0) < k) m.set(u, k);
      } else this.release(c);
    }
    this.list.length = keep;
  }

  private release(c: Chilled) { if (c.target.alive) c.target.slow?.(c.key, 1); }

  /** A target's unit chill: 0..1, 2 when frozen solid. */
  chillOf(target: Hittable, unit = -1): number {
    const m = this.chills.get(target);
    if (!m) return 0;
    if (unit >= 0) return m.get(unit) ?? 0;
    let h = 0;
    for (const x of m.values()) if (x > h) h = x;
    return h;
  }
  chillsOf(target: Hittable): ReadonlyMap<number, number> | null { return this.chills.get(target) ?? null; }
  frozen(target: Hittable) { return this.list.some((c) => c.target === target && c.frozen > 0); }
}
