// Humanoid robots, the sim (Keith 2026-11-01: "some humanoid robots ... a nice middle ground", between the small
// scuttlers and the big walkers, on the human rig). The bandits' infantry sim (infantry.ts) run on robot numbers: a
// 3.2 m white machine that strides in, holds a firing band, never breaks or runs, and fires bursts of blue pulses.
// Each burst is telegraphed: through the last droidLockShow s of the pause before it, its red seeking laser lies on
// the target (red seeks, blue hits; Keith). Drawn by droidsDraw.ts on the Vanguard bake (the bandits' and pilot's rig),
// resolved on the battlefield by src/game/droidFight.ts.
// Ownership: host (positions, health, shots); the drawer and the laser are cosmetic.
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import { FLAG, KIND, type Register } from "../game/register";
import { InfantrySwarm, INFANTRY_DEFAULTS, DOWN, FIRING, type InfantryValues } from "./infantry";

export const DROID_DEFAULTS = {
  droidHeight: 3.2,
  droidRadius: 0.5,
  droidHp: 70,
  droidSpeed: 3.4,
  droidAccel: 3,
  droidTurn: 220,
  droidSpacing: 3,
  droidGap: 1.1,
  droidBandNear: 12,
  droidBandFar: 26,
  droidFlank: 40,
  droidFireRange: 48,
  droidSpread: 2.2,
  droidBurst: 3,
  droidRoundGap: 0.13,
  droidPause: 2.2,
  droidAim: 1.4,
  droidDamage: 5,
  droidLockShow: 0.9,
  droidDodge: 0.25,
  droidBodyLife: 10,
  droidAnimSpeed: 0.85,
};
export type DroidValues = typeof DROID_DEFAULTS;

/** The variants (Keith 2026-11-01: "humanoid robots in a few variants"; the roster in docs/robots.md): the trooper is
 *  the base values; the lancer and the brute change a few of them through their own sliders. */
export const TROOPER = 0, LANCER = 1, BRUTE = 2;
export const DROID_VARIANT_NAMES = ["trooper", "lancer", "brute"] as const;
export const DROID_VARIANT_DEFAULTS = {
  droidLancerShare: 0.2, droidBruteShare: 0.15,
  droidLancerHeight: 3.7, droidLancerHp: 55, droidLancerDamage: 26, droidLancerRange: 75, droidLancerNear: 30, droidLancerFar: 55,
  droidLancerLock: 1.6, droidLancerPause: 4.5,
  droidBruteHeight: 4.3, droidBruteHp: 200, droidBruteDamage: 3, droidBruteBurst: 8, droidBruteSpread: 6, droidBruteNear: 7, droidBruteFar: 14,
  droidBruteSpeed: 2.6,
};
export type DroidVariantValues = typeof DROID_VARIANT_DEFAULTS;
/** Every humanoid robot value: the base (the trooper) and the variants. */
export const DROID_ALL_DEFAULTS = { ...DROID_DEFAULTS, ...DROID_VARIANT_DEFAULTS };
export type DroidAllValues = typeof DROID_ALL_DEFAULTS;

const G = "Humanoid robots", GG = "Humanoid robots: guns", GL = "Humanoid robots: lancer", GB = "Humanoid robots: brute";
export const DROID_GROUPS = [G, GG, GL, GB];
export const DROID_PARAMS: Param[] = [
  { key: "droidHeight", label: "Height (m)", min: 1.8, max: 6, step: 0.05, group: G, tip: "Drawn height; the hit cylinder is this tall too" },
  { key: "droidRadius", label: "Hit radius (m)", min: 0.2, max: 1.5, step: 0.01, group: G },
  { key: "droidHp", label: "Health", min: 5, max: 400, step: 1, group: G },
  { key: "droidSpeed", label: "Stride speed (m/s)", min: 0.5, max: 10, step: 0.1, group: G },
  { key: "droidAccel", label: "Acceleration (1/s)", min: 0.5, max: 20, step: 0.1, group: G },
  { key: "droidTurn", label: "Turn rate (°/s)", min: 30, max: 1080, step: 10, group: G },
  { key: "droidSpacing", label: "Spacing (m)", min: 0.5, max: 8, step: 0.1, group: G, tip: "Neighbours closer than this steer apart" },
  { key: "droidGap", label: "Hard body gap (m)", min: 0.3, max: 3, step: 0.05, group: G },
  { key: "droidBandNear", label: "Firing band near (m)", min: 3, max: 40, step: 0.5, group: G, tip: "Closer than this they step back while shooting" },
  { key: "droidBandFar", label: "Firing band far (m)", min: 5, max: 60, step: 0.5, group: G, tip: "Each stops somewhere between near and far" },
  { key: "droidFlank", label: "Flank fan (°)", min: 0, max: 80, step: 1, group: G },
  { key: "droidDodge", label: "Sidestep chance", min: 0, max: 1, step: 0.01, group: G, tip: "Chance to roll out of a charge or a telegraphed shot's footprint" },
  { key: "droidBodyLife", label: "Wrecks stay (s)", min: 1, max: 60, step: 0.5, group: G },
  { key: "droidAnimSpeed", label: "Play speed ×", min: 0.2, max: 2, step: 0.05, group: G, tip: "On top of matching the stride to the speed: under 1 reads heavier" },
  { key: "droidFireRange", label: "Fire range (m)", min: 5, max: 90, step: 1, group: GG },
  { key: "droidSpread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: GG },
  { key: "droidBurst", label: "Pulses per burst", min: 1, max: 10, step: 1, group: GG },
  { key: "droidRoundGap", label: "Time between pulses (s)", min: 0.03, max: 0.6, step: 0.01, group: GG },
  { key: "droidPause", label: "Pause between bursts (s)", min: 0.3, max: 8, step: 0.05, group: GG, tip: "Varied ±40% each time" },
  { key: "droidAim", label: "Aim before the first burst (s)", min: 0, max: 4, step: 0.05, group: GG },
  { key: "droidDamage", label: "Damage per pulse", min: 0, max: 40, step: 0.5, group: GG },
  { key: "droidLockShow", label: "Red laser before a burst (s)", min: 0, max: 3, step: 0.05, group: GG, tip: "The seeking laser lies on the target this long before each burst (the tell)" },
  { key: "droidLancerShare", label: "Lancers in a squad (share)", min: 0, max: 1, step: 0.01, group: GL },
  { key: "droidBruteShare", label: "Brutes in a squad (share)", min: 0, max: 1, step: 0.01, group: GB },
  { key: "droidLancerHeight", label: "Height (m)", min: 1.8, max: 6, step: 0.05, group: GL, tip: "The lancer: a tall marksman that holds far back and fires one heavy blue lance after a long red lock" },
  { key: "droidLancerHp", label: "Health", min: 5, max: 400, step: 1, group: GL },
  { key: "droidLancerDamage", label: "Lance damage", min: 0, max: 120, step: 1, group: GL },
  { key: "droidLancerRange", label: "Fire range (m)", min: 10, max: 120, step: 1, group: GL },
  { key: "droidLancerNear", label: "Firing band near (m)", min: 5, max: 80, step: 1, group: GL },
  { key: "droidLancerFar", label: "Firing band far (m)", min: 6, max: 110, step: 1, group: GL },
  { key: "droidLancerLock", label: "Red laser before a lance (s)", min: 0, max: 4, step: 0.05, group: GL },
  { key: "droidLancerPause", label: "Between lances (s)", min: 0.5, max: 12, step: 0.1, group: GL },
  { key: "droidBruteHeight", label: "Height (m)", min: 1.8, max: 7, step: 0.05, group: GB, tip: "The brute: a big slow front-liner that closes in and sprays a long wide burst" },
  { key: "droidBruteHp", label: "Health", min: 5, max: 800, step: 1, group: GB },
  { key: "droidBruteDamage", label: "Damage per pulse", min: 0, max: 30, step: 0.5, group: GB },
  { key: "droidBruteBurst", label: "Pulses per burst", min: 1, max: 20, step: 1, group: GB },
  { key: "droidBruteSpread", label: "Spread (°)", min: 0, max: 20, step: 0.1, group: GB },
  { key: "droidBruteNear", label: "Firing band near (m)", min: 3, max: 40, step: 0.5, group: GB },
  { key: "droidBruteFar", label: "Firing band far (m)", min: 4, max: 50, step: 0.5, group: GB },
  { key: "droidBruteSpeed", label: "Stride speed (m/s)", min: 0.5, max: 8, step: 0.1, group: GB },
];

/** Robot numbers for a variant: the trooper's as they are, the others with their own sliders over them. */
export function droidVariant(v: DroidAllValues, variant: number, out: DroidValues = { ...DROID_DEFAULTS }): DroidValues {
  for (const k of Object.keys(DROID_DEFAULTS) as (keyof DroidValues)[]) out[k] = v[k];
  if (variant === LANCER) {
    out.droidHeight = v.droidLancerHeight; out.droidHp = v.droidLancerHp; out.droidDamage = v.droidLancerDamage;
    out.droidFireRange = v.droidLancerRange; out.droidBandNear = v.droidLancerNear; out.droidBandFar = v.droidLancerFar;
    out.droidLockShow = v.droidLancerLock; out.droidPause = v.droidLancerPause; out.droidBurst = 1; out.droidSpread = 0.6;
    out.droidAim = Math.max(v.droidAim, v.droidLancerLock + 0.2); out.droidSpeed = v.droidSpeed * 0.85; out.droidRadius = v.droidRadius * 0.9;
  } else if (variant === BRUTE) {
    out.droidHeight = v.droidBruteHeight; out.droidHp = v.droidBruteHp; out.droidDamage = v.droidBruteDamage;
    out.droidBurst = v.droidBruteBurst; out.droidSpread = v.droidBruteSpread; out.droidRoundGap = Math.min(v.droidRoundGap, 0.08);
    out.droidBandNear = v.droidBruteNear; out.droidBandFar = v.droidBruteFar; out.droidSpeed = v.droidBruteSpeed;
    out.droidRadius = v.droidRadius * 1.5; out.droidGap = v.droidGap * 1.4; out.droidSpacing = v.droidSpacing * 1.3;
    out.droidDodge = 0; out.droidFireRange = Math.min(v.droidFireRange, 30); out.droidAnimSpeed = v.droidAnimSpeed * 0.85;
  }
  return out;
}

/** The infantry values for robot numbers (morale off: they never flee; stomps don't floor them). */
export function droidValues(d: DroidValues, out: InfantryValues = { ...INFANTRY_DEFAULTS }): InfantryValues {
  out.runSpeed = d.droidSpeed; out.banditAccel = d.droidAccel; out.banditTurn = d.droidTurn;
  out.speedJitter = 0.08; out.banditUphill = 0.8; out.downhillBoost = 0.1;
  out.flankAngle = d.droidFlank; out.bandNear = d.droidBandNear; out.bandFar = Math.max(d.droidBandNear + 1, d.droidBandFar);
  out.bandSlack = 8; out.backOff = 1.2; out.keepOut = 3;
  out.banditSpacing = d.droidSpacing; out.sepStrength = 2.5; out.bodyGap = d.droidGap;
  out.hp = d.droidHp; out.banditHeight = d.droidHeight; out.banditRadius = d.droidRadius;
  out.fireRange = d.droidFireRange; out.spreadDeg = d.droidSpread; out.burstRounds = d.droidBurst;
  out.roundInterval = d.droidRoundGap; out.burstPause = d.droidPause; out.aimTime = d.droidAim;
  out.muzzleHeight = d.droidHeight * 0.74;
  out.fearPerDeath = 0; out.dread = 0; out.banditFleeAt = 1e6;
  out.stompKill = 0; out.stompPush = 0; out.banditStompSpeed = 0;
  out.deathThrow = 1.5; out.bodyLife = d.droidBodyLife; out.sinkTime = 2.5;
  out.diveChance = d.droidDodge; out.diveSpeed = 3.5; out.diveTime = 1.1;
  return out;
}

export class DroidSwarm extends InfantrySwarm {
  /** The robot numbers; call sync() after they change (the lab does it every frame: cheap). */
  constructor(public d: DroidValues, ground: Ground, seed = 1) {
    super(droidValues(d), ground, seed);
  }

  sync(): void { droidValues(this.d, this.v); }

  /** 0..1: how close robot i is to its next burst, inside the laser's window (0: no laser). */
  lock(i: number, dist: number): number {
    if (this.state[i] !== FIRING || this.frozen[i] || this.diveT[i] > 0 || this.burstLeft[i] !== 0) return 0;
    if (dist > this.v.fireRange) return 0;
    const show = this.d.droidLockShow, left = this.fireClock[i];
    if (show <= 0 || left > show || left < 0) return 0;
    return 1 - left / show;
  }

  /** In the register as solid units (rounds stop on them, unlike bandits), centre at mid height. */
  override publish(reg: Register, team: number, ref: unknown = null): void {
    const H = this.v.banditHeight, y = H * 0.55, r = Math.max(0.8, this.v.banditRadius, H * 0.3);
    const flags = FLAG.Hittable | FLAG.Detectable;
    for (let i = 0; i < this.hi; i++) {
      if (this.state[i] >= DOWN) continue;
      reg.put(i, this.uid[i], KIND.Unit, team, this.frozen[i] ? flags | FLAG.Asleep : flags, this.px[i], this.py[i] + y, this.pz[i], r, 0, this.vx[i], this.vz[i], 0, ref);
    }
  }
}

/** The variant of a squad's k-th member (seeded by the squad: the same squad always splits the same way). */
export function squadVariant(v: DroidAllValues, k: number, seed: number): number {
  const f = (k * 0.618034 + seed) % 1;
  return f < v.droidBruteShare ? BRUTE : f < v.droidBruteShare + v.droidLancerShare ? LANCER : TROOPER;
}
