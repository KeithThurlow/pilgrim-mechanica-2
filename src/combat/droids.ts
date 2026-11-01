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

const G = "Humanoid robots", GG = "Humanoid robots: guns";
export const DROID_GROUPS = [G, GG];
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
];

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
