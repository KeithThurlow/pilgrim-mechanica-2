// Upper body: a torso that turns on the waist toward the aim point, independent of where the legs walk
// (twin-stick: WASD drives the legs, the mouse drives the torso and guns), plus two hull-mounted miniguns
// that track within a small arc, each on its own: own tracking speed, spin-up, fire cone and clock, and kick back.
// Pure simulation like the legs: no rendering.
import type { Param } from "../core/tweaks";

export const UPPER_DEFAULTS = {
  torsoTurnRate: 150,
  torsoLimit: 180,
  podYawMax: 30,
  podPitchMax: 20,
  podPitchUp: 50,
  torsoLeanMax: 12,
  torsoLeanRate: 40,
  podTrack: 12,
  spinUp: 0.8,
  spinDown: 1.4,
  spinRpm: 900,
  fireFrom: 0.65,
  fireRate: 12,
  spread: 3,
  range: 45,
  recoil: 0.03,
  recoilReturn: 9,
  recoilMax: 0.14,
  torsoKick: 0.25,
  outwardTrack: 0.55,
  spinSplit: 0.15,
  rateSplit: 0.06,
  fireCone: 4,
  gunSpacing: 1.02,
  heldTrack: 1.8,
  heldOutward: 0.9,
  runArmOut: 170,
  runArmIn: 50,
  armUpper: 1.45,
  armFore: 1.45,
  armReachFront: 0.55,
  armReachSide: 0.98,
  armStraightAt: 95,
  armDropFront: 0.9,
  armDropSide: 0.1,
  armPoleOut: 0.8,
  armPoleBack: 0.6,
  armShoulderOut: 0.35,
  armCrossIn: 0.6,
  armAlign: 0.75,
  armRollFrom: 90,
  armRollOver: 45,
  armRollWrist: 180,
  armReachBack: 0.7,
  armDropBack: 0,
  armPoleUp: 4,
  armAlignBack: 0.2,
  armRollLean: 8,
  armKickMinigun: 3,
  armKickRifle: 4,
  armKickSmg: 0.3,
  armKickOther: 2.5,
  minigunGripBack: 0.55,
  smgScale: 1.4,
  ammoPerGun: 180,
  reloadTime: 2.6,
};
export type UpperValues = typeof UPPER_DEFAULTS;

/** How far an arm has rolled over (0..1) for a gun yaw off the hull (+ to the mech's left) on that side: 0 up to
 *  armRollFrom out from ahead, 1 once armRollOver past it (Keith 2026-11-06). Looks only. */
export function armRoll(side: 1 | -1, yaw: number, v: UpperValues): number {
  const u = Math.min(1, Math.max(0, ((side * yaw * 180) / Math.PI - v.armRollFrom) / Math.max(1e-3, v.armRollOver)));
  return u * u * (3 - 2 * u);
}

export const UPPER_PARAMS: Param[] = [
  { key: "torsoTurnRate", label: "Torso turn rate (°/s)", min: 30, max: 600, step: 5, group: "Torso & guns" },
  { key: "torsoLimit", label: "Torso turn limit (°)", min: 20, max: 180, step: 1, group: "Torso & guns", tip: "How far the torso can turn from the legs; 180 turns freely the shortest way (Keith 2026-10-25: kite and shoot behind you)" },
  { key: "podYawMax", label: "Gun arc (°)", min: 0, max: 60, step: 1, group: "Torso & guns", tip: "Guns swing this far on their own before the torso has to turn" },
  { key: "podPitchMax", label: "Gun pitch down (°)", min: 0, max: 45, step: 1, group: "Torso & guns", tip: "How far the guns dip; a target closer under them still gets fired on" },
  { key: "podPitchUp", label: "Gun pitch up (°)", min: 0, max: 80, step: 1, group: "Torso & guns", tip: "How far the guns raise (Keith 2026-10-26: reach a tall walker's body from close in). Past this plus the torso's lean they can't bear and don't fire" },
  { key: "torsoLeanMax", label: "Torso leans back up to (°)", min: 0, max: 30, step: 0.5, group: "Torso & guns", tip: "When the guns are at their raise limit the hull tilts back this much more" },
  { key: "torsoLeanRate", label: "Torso lean speed (°/s)", min: 1, max: 200, step: 1, group: "Torso & guns" },
  { key: "podTrack", label: "Gun tracking", min: 1, max: 40, step: 0.5, group: "Torso & guns" },
  { key: "outwardTrack", label: "Outward swing speed", min: 0.1, max: 1.5, step: 0.01, group: "Torso & guns", tip: "Share of the tracking speed an arm swings outward, away from the torso (inward is full speed; Keith 2026-10-24). When the aim sweeps sideways one arm swings in while the other swings out, so the guns turn at different speeds" },
  { key: "fireCone", label: "Fire cone (°)", min: 0.5, max: 30, step: 0.5, group: "Torso & guns", tip: "A gun fires only once it points this close to the aim" },
  { key: "gunSpacing", label: "Gun spacing (m)", min: 0, max: 3, step: 0.01, group: "Torso & guns", tip: "Each gun aims from its own shoulder, this far from the middle" },
  { key: "heldTrack", label: "Held weapons: tracking ×", min: 0.5, max: 4, step: 0.05, group: "Held weapons", tip: "Keith 2026-11-03: arms track from the shoulder much faster than hull weapons. Every held weapon's tracking (its arm's × the weapon's handling) times this" },
  { key: "heldOutward", label: "Held weapons: outward swing speed", min: 0.1, max: 1.5, step: 0.01, group: "Held weapons", tip: "As Outward swing speed, for arms: share of the tracking an arm swings outward (inward is full speed)" },
  { key: "runArmOut", label: "Sprinting: arm swings out to (°)", min: 0, max: 178, step: 1, group: "Held weapons", tip: "Keith 2026-11-03: sprinting, the hull faces the run and only the arms track. Each arm swings this far out from straight ahead (left arm to the left), off the hull's facing. Keith 2026-11-06: past side-on the elbow rolls up and the wrist turns over (Arm roll), so 170: nearly straight back (was 95)" },
  { key: "armUpper", label: "Arm pose: upper arm (m)", min: 0.4, max: 3, step: 0.01, group: "Held weapons", tip: "Keith 2026-11-03: the arm reaches from the shoulder to the gun's aim (two bones, the elbow finds itself)" },
  { key: "armFore", label: "Arm pose: forearm (m)", min: 0.4, max: 3, step: 0.01, group: "Held weapons" },
  { key: "armReachFront", label: "Arm pose: reach ahead (share)", min: 0.3, max: 1, step: 0.01, group: "Held weapons", tip: "How far out the fist is, as a share of the arm's full length, when the gun aims straight ahead (or across the chest): bent" },
  { key: "armReachSide", label: "Arm pose: reach out to the side (share)", min: 0.3, max: 1, step: 0.01, group: "Held weapons", tip: "The same at Straight at: the further back, the straighter (Keith 2026-11-03)" },
  { key: "armStraightAt", label: "Arm pose: straight at (°)", min: 10, max: 135, step: 1, group: "Held weapons", tip: "How far out from ahead the arm reaches its side reach" },
  { key: "armDropFront", label: "Arm pose: fist below the aim line, ahead (m)", min: 0, max: 2, step: 0.01, group: "Held weapons", tip: "The fist sits this far under the line from the shoulder to the target: arms a little low in front" },
  { key: "armDropSide", label: "Arm pose: fist below the aim line, to the side (m)", min: 0, max: 1, step: 0.01, group: "Held weapons", tip: "And out at the side: raised, pointing at the target" },
  { key: "armPoleOut", label: "Arm pose: elbow out", min: -1, max: 2, step: 0.05, group: "Held weapons", tip: "Which way the elbow bends: this much outward for every 1 down" },
  { key: "armShoulderOut", label: "Arm pose: shoulder out (m)", min: 0, max: 1.5, step: 0.01, group: "Held weapons", tip: "The arm's root this far out from the gun's shoulder point, as the sword arms (Keith 2026-11-04: gun arms as long as the sword's)" },
  { key: "armCrossIn", label: "Arm pose: across the chest (m)", min: 0, max: 2, step: 0.05, group: "Held weapons", tip: "Reaching across the chest, the fist comes at most this far inboard of the arm's root, held by the chest rather than out past the hull's nose (Keith 2026-11-04)" },
  { key: "armAlign", label: "Arm pose: forearm along the aim (share)", min: 0, max: 1, step: 0.01, group: "Held weapons", tip: "Keith 2026-11-04: the forearm points toward the target, in line with the gun (1: exactly along the aim, the elbow back behind the fist; 0: wherever the IK puts it)" },
  { key: "armKickMinigun", label: "Arm kick: minigun ×", min: 0, max: 10, step: 0.1, group: "Held weapons", tip: "Each shot drives the fist back along the forearm by the gun's kick (Minigun › Kick per shot) times this" },
  { key: "armKickRifle", label: "Arm kick: rifle ×", min: 0, max: 10, step: 0.1, group: "Held weapons" },
  { key: "armKickSmg", label: "Arm kick: SMG ×", min: 0, max: 10, step: 0.1, group: "Held weapons", tip: "Keith: practically none" },
  { key: "armKickOther", label: "Arm kick: other held guns ×", min: 0, max: 10, step: 0.1, group: "Held weapons", tip: "Scattergun, light rail and the rest" },
  { key: "minigunGripBack", label: "Held minigun: sits back on the forearm (m)", min: -1, max: 2, step: 0.01, group: "Held weapons", tip: "Keith 2026-11-04: its handle up by the barrels, so the gun sits further back over the forearm" },
  { key: "smgScale", label: "Held SMG: size ×", min: 0.5, max: 2.5, step: 0.01, group: "Held weapons", tip: "Keith 2026-11-04: it looked too small" },
  { key: "armPoleBack", label: "Arm pose: elbow back", min: -1, max: 2, step: 0.05, group: "Held weapons", tip: "And this much back" },
  { key: "armRollFrom", label: "Arm roll: starts at (°)", min: 45, max: 150, step: 1, group: "Held weapons", tip: "Keith 2026-11-06: aiming further back than this off straight ahead, the arm rolls over: the elbow comes up and the wrist turns the gun over, so it can track nearly straight behind" },
  { key: "armRollOver", label: "Arm roll: done over (°)", min: 5, max: 90, step: 1, group: "Held weapons", tip: "The roll eases in over this many degrees past its start" },
  { key: "armRollWrist", label: "Arm roll: wrist turn (°)", min: -180, max: 180, step: 1, group: "Held weapons", tip: "How far the gun turns over on its barrel, fully rolled (180: upside down; the sign picks which way it turns)" },
  { key: "armReachBack", label: "Arm roll: reach behind (share)", min: 0.3, max: 1, step: 0.01, group: "Held weapons", tip: "The fist's reach as a share of the arm's length, fully rolled: bent, so the elbow stands up" },
  { key: "armDropBack", label: "Arm roll: fist below the aim line (m)", min: -1, max: 1, step: 0.01, group: "Held weapons", tip: "Fully rolled; negative raises the fist above the line" },
  { key: "armPoleUp", label: "Arm roll: elbow up", min: 0, max: 8, step: 0.1, group: "Held weapons", tip: "Which way the elbow bends, fully rolled: this much up for every 1 out (Keith 2026-11-06: almost straight up)" },
  { key: "armAlignBack", label: "Arm roll: forearm along the aim (share)", min: 0, max: 1, step: 0.01, group: "Held weapons", tip: "Forearm along the aim, fully rolled (less, so the elbow can stand up)" },
  { key: "armRollLean", label: "Arm roll: hull leans over (°)", min: 0, max: 25, step: 0.5, group: "Held weapons", tip: "Keith 2026-11-06: the hull rolls this far away from a fully rolled arm, raising that shoulder, as a person leans to reach behind. Looks only" },
  { key: "runArmIn", label: "Sprinting: arm swings across to (°)", min: 0, max: 120, step: 1, group: "Held weapons", tip: "And this far across the chest (left arm to the right). Outside the two, that arm doesn't fire" },
  { key: "spinUp", label: "Spin-up (s)", min: 0.05, max: 2, step: 0.05, group: "Minigun" },
  { key: "spinDown", label: "Spin-down (s)", min: 0.1, max: 4, step: 0.05, group: "Minigun" },
  { key: "spinRpm", label: "Barrel rpm", min: 100, max: 3000, step: 10, group: "Minigun" },
  { key: "fireFrom", label: "Fires from spin", min: 0, max: 1, step: 0.01, group: "Minigun", tip: "Share of full spin before rounds come out" },
  { key: "fireRate", label: "Rounds/s per gun", min: 1, max: 60, step: 0.5, group: "Minigun" },
  { key: "spinSplit", label: "Left vs right spin-up", min: -0.6, max: 0.6, step: 0.01, group: "Minigun", tip: "Positive: the left gun spins up faster by this share" },
  { key: "rateSplit", label: "Left vs right fire rate", min: -0.3, max: 0.3, step: 0.005, group: "Minigun", tip: "The guns' clocks run this far apart, so their rounds drift in and out of step" },
  { key: "spread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: "Minigun" },
  { key: "range", label: "Range (m)", min: 5, max: 80, step: 1, group: "Minigun" },
  { key: "ammoPerGun", label: "Magazine (rounds)", min: 5, max: 2000, step: 5, group: "Magazines", tip: "A gun on these sliders fires this many rounds, then reloads (Keith 2026-10-31: magazines and reloads, no ammo to carry); a fitted gun has its own (its magazine + its side's drum). R refills both in the lab" },
  { key: "reloadTime", label: "Reload (s)", min: 0.2, max: 10, step: 0.1, group: "Magazines", tip: "A gun on these sliders reloads this long once its magazine is empty" },
  { key: "recoil", label: "Kick per shot (m)", min: 0, max: 0.2, step: 0.005, group: "Minigun" },
  { key: "recoilReturn", label: "Kick return", min: 1, max: 30, step: 0.5, group: "Minigun" },
  { key: "recoilMax", label: "Kick limit (m)", min: 0, max: 0.5, step: 0.01, group: "Minigun" },
  { key: "torsoKick", label: "Torso shake (°)", min: 0, max: 2, step: 0.01, group: "Minigun" },
];

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export interface Gun {
  /** +1 left, -1 right (the mech's sides). */
  side: 1 | -1;
  /** Aim relative to the torso, radians. */
  yaw: number;
  pitch: number;
  /** This gun's own barrel spin 0..1, and its spin angle (radians). */
  spin: number;
  spinAngle: number;
  /** Recoil push back along the barrel, metres. */
  kick: number;
  /** Pointing at the aim within its fire cone. */
  onTarget: boolean;
  /** Rounds coming out this step. */
  firing: boolean;
  /** This gun's spin-up time (s), from spinUp and the split. */
  spinUpTime: number;
  clock: number;
  /** Rounds left in this gun's magazine (the magazine's `left`). */
  ammo: number;
  /** Its magazine (src/weapons/magazine.ts): it reloads when empty. A rocket launcher on this side uses it too. */
  mag: Mag;
  /** A gun is fitted on this side (a loadout can leave a side empty: it never spins or fires). */
  enabled: boolean;
  /** This gun's own values from its item (src/items); null runs on the shared sliders. */
  stats: GunStats | null;
  /** A shoulder feed's boost (Keith 2026-10-30, src/weapons/gear.ts): the fire clock runs this many times faster (the
   *  passive and any overdrive), spin-up takes this much less of its time, the drum holds this many times the rounds. */
  rateMul: number;
  spinCut: number;
  ammoMul: number;
}

/** One gun's values when a loadout gives it its own (else the shared sliders). Damage, spread, range and pierce are
 *  read by the mech unit when it fires; the rest here. */
export interface GunStats {
  fireRate: number;
  spinUp: number;
  /** Its magazine (rounds): the weapon's own, plus its side's drum for belt-fed guns. */
  ammo: number;
  /** Reload time (s), after reload speed. */
  reload?: number;
  /** Magazine rounds per round fired (1; cost Protocols cut it) and what a shot spends (src/weapons/magazine.ts). */
  cost?: number;
  /** Energy weapons (src/weapons/energy/): energy per shot (bars; a beam's per second). 0 for the rest. */
  energy?: number;
  /** Arc (°) and tracking: podYawMax and podTrack for this gun. */
  arc: number;
  track: number;
  damage: number;
  spread: number;
  range: number;
  pierce: number;
  /** Armour pierce 0..1 (src/game/armour.ts): the share of a target's armour each round ignores. */
  ap?: number;
  /** What kind of gun (default minigun): a rail cannon charges on the trigger instead of spinning up and never fires
   *  rounds here (src/weapons/arsenal.ts fires it); an autocannon fires on this clock but its rounds are shells. */
  cls?: GunClass;
  /** The weapon item's own rolled stats for src/weapons (null: an unrolled base item, which runs on the sliders). */
  own?: Record<string, number> | null;
  /** The weapon item's base id (swords: whose posed keys it swings with, src/weapons/swordPoses.ts). */
  base?: string;
  /** Held in an arm's hand (src/items/loadout.ts), not a hull weapon: tracks faster (heldTrack) and can fire while
   *  sprinting (the mech unit frees its arm). */
  held?: boolean;
  /** Light (a hand weapon) rather than Medium (on the hull). */
  light?: boolean;
  /** Its socketed Protocols' behaviour on every round (src/game/shots.ts). */
  proto?: import("../game/shots").ShotProtocols;
  /** Round guns (src/weapons/guns.ts): rounds per shot (a shotgun's pellets; 1 else) and each round's splash at its end. */
  pellets?: number;
  splash?: number;
  splashShare?: number;
  /** Flamers (src/weapons/fire/): what each jet sets alight (s, damage/s). */
  burnTime?: number;
  burnDps?: number;
  /** Freeze rays: chill per jet and cold damage per second at full chill. */
  chill?: number;
  coldDps?: number;
}

export type GunClass = "minigun" | "rail" | "autocannon" | "rpg" | "melee" | import("../weapons/energy/energySim").EnergyClass | import("../weapons/guns").RoundGun | "cannon";
import { isRoundGun } from "../weapons/guns";
import { newMag, magFill, magResize, magReady, magStep, magTake, type Mag } from "../weapons/magazine";

/** One trigger for both guns, or one per gun (Keith 2026-10-25: left click the left side, right click the right). */
export type Trigger = boolean | readonly [boolean, boolean];
/** The trigger for gun i (0 left, 1 right). */
export const triggerOf = (t: Trigger, i: number) => (typeof t === "boolean" ? t : t[i]);

export interface Aim {
  /** Point on the ground to aim at, or null to face forward. */
  x: number; y: number; z: number;
}

const gun = (side: 1 | -1): Gun => ({
  side, yaw: 0, pitch: 0, spin: 0, spinAngle: 0, kick: 0, onTarget: false, firing: false, spinUpTime: 0.5, clock: 0, enabled: true, stats: null, rateMul: 1, spinCut: 0, ammoMul: 1,
  mag: newMag(1, 1),
  get ammo() { return this.mag.left; },
  set ammo(x: number) { this.mag.left = x; },
});

export class UpperSim {
  /** Torso yaw in world space (radians, heading convention). */
  torsoYaw = 0;
  /** The faster gun's spin 0..1 (for readouts). */
  spin = 0;
  guns: [Gun, Gun] = [gun(1), gun(-1)];
  /** Small torso jitter from firing, radians. */
  shake = 0;
  /** True while the aim point is inside the guns' reach (arc and turn limit). */
  onTarget = false;
  /** The hull tilted back (radians, + back) to raise the guns past their own limit at a target high overhead. */
  lean = 0;
  /** Set from outside: lean the hull forward this much (radians; the sprint with the weapons off), eased at the lean rate. */
  leanFwd = 0;
  /** Set from outside (the sprint, Keith 2026-11-03): these sides' held weapons track `armAim` on their own inside the
   *  sprint's shoulder arc (runArmOut / runArmIn) while the torso faces the run; only they count for onTarget. */
  freeArms: [boolean, boolean] = [false, false];
  armAim: Aim | null = null;
  armsOnly = false;

  constructor(public v: UpperValues) {}

  reset(yaw: number) { this.torsoYaw = yaw; for (const g of this.guns) { g.spin = 0; g.clock = 0; } this.resupply(); }

  /** Size both magazines from their guns (and feeds), and fill them. */
  resupply() { for (const g of this.guns) { this.sizeMag(g); magFill(g.mag); } }

  /** A gun's magazine size and reload from its stats (else the sliders) and its feed's rounds bonus; keeps what's left. */
  sizeMag(g: Gun) {
    magResize(g.mag, Math.max(1, Math.round((g.stats?.ammo ?? this.v.ammoPerGun) * g.ammoMul)), g.stats?.reload ?? this.v.reloadTime);
  }

  /**
   * legsHeading: where the legs face. shoulder: world position of the middle of the gun line. aim: target or null.
   * Each gun works on its own (Keith 2026-10-24): it aims from its own shoulder, swings inward faster than outward
   * (so the two arms turn at different speeds as the aim sweeps), spins up on its own, and only fires inside its fire cone, on its own clock. So the two
   * start, drift and stop at slightly different times, and sound like two guns rather than one.
   * Returns the sides that fired a round this step (one entry per round).
   */
  update(dt: number, legsHeading: number, shoulder: { x: number; y: number; z: number }, aim: Aim | null, triggers: Trigger): (1 | -1)[] {
    const v = this.v;
    // Torso: turn toward the aim at a capped rate, never more than the limit from the legs.
    let want = legsHeading;
    if (aim) want = Math.atan2(aim.x - shoulder.x, aim.z - shoulder.z);
    const lim = v.torsoLimit * D2R;
    // Work in the torso's angle from the legs and move only within ±limit, never across the back: a target behind
    // used to drag the torso the short way round into its limit, where it jammed with the guns pinned (seen in the
    // war band lab). Beyond the limit, aim for the nearer limit, keeping to the current side unless the other is
    // clearly nearer, so a target dead behind doesn't flip it from side to side.
    const cur = clamp(wrap(this.torsoYaw - legsHeading), -lim, lim);
    const raw = wrap(want - legsHeading);
    let rel = raw;
    if (Math.abs(raw) > lim) {
      const gapPos = Math.abs(wrap(raw - lim)), gapNeg = Math.abs(wrap(raw + lim));
      const side = cur >= 0 ? 1 : -1;
      const gapCur = side > 0 ? gapPos : gapNeg, gapOther = side > 0 ? gapNeg : gapPos;
      rel = (gapOther + 0.35 < gapCur ? -side : side) * lim;
    }
    const step = v.torsoTurnRate * D2R * dt;
    // A free waist (limit 180) turns the shortest way, across the back too: from 170° left to 170° right is 20°, not
    // 340° round the front (Keith 2026-10-26: a target a few degrees on swung the torso the long way round).
    if (lim >= Math.PI - 1e-6) this.torsoYaw = wrap(this.torsoYaw + clamp(wrap(want - this.torsoYaw), -step, step));
    else this.torsoYaw = wrap(legsHeading + cur + clamp(rel - cur, -step, step));

    const pmax = v.podPitchMax * D2R, pup = v.podPitchUp * D2R, cone = v.fireCone * D2R;
    const lx = Math.cos(this.torsoYaw), lz = -Math.sin(this.torsoYaw); // torso's left
    // Lean the hull back when the aim is higher than the guns raise (pitch is + down, so up is -pitch).
    let leanWant = 0;
    if (aim) {
      const up = Math.atan2(aim.y - shoulder.y, Math.max(1, Math.hypot(aim.x - shoulder.x, aim.z - shoulder.z)));
      leanWant = clamp(up - pup, 0, v.torsoLeanMax * D2R);
    }
    leanWant -= this.leanFwd;
    const leanStep = v.torsoLeanRate * D2R * dt;
    this.lean += clamp(leanWant - this.lean, -leanStep, leanStep);
    const spinRate = (v.spinRpm / 60) * Math.PI * 2;
    const shots: (1 | -1)[] = [];
    this.onTarget = false;
    this.spin = 0;
    const torsoAim = aim;
    for (const g of this.guns) {
      const own = g.stats, free = this.freeArms[g.side === 1 ? 0 : 1];
      aim = free ? this.armAim : torsoAim;
      const ymax = (own?.arc ?? v.podYawMax) * D2R, track = (own?.track ?? v.podTrack) * (own?.held ? v.heldTrack : 1);
      // The yaw window off the torso, as [low, high] (+ to the mech's left): the gun's arc both ways, or sprinting with a
      // free arm, the shoulder's own: further out than across the chest.
      const out = v.runArmOut * D2R, inn = v.runArmIn * D2R;
      const lo = free ? (g.side === 1 ? -inn : -out) : -ymax, hi = free ? (g.side === 1 ? out : inn) : ymax;
      // Aim from this gun's own shoulder, so the two converge on the aim point.
      const gx = shoulder.x + lx * g.side * v.gunSpacing, gz = shoulder.z + lz * g.side * v.gunSpacing;
      const yawWant = aim ? wrap(Math.atan2(aim.x - gx, aim.z - gz) - this.torsoYaw) : 0;
      const dist = aim ? Math.hypot(aim.x - gx, aim.z - gz) : 10;
      // Relative to the hull, which is leaning back by `lean`.
      const pitchWant = aim ? -Math.atan2(aim.y - shoulder.y, Math.max(1, dist)) + this.lean : 0;
      // Each arm swings inward (toward the torso) at full speed and outward slower. Yaw grows toward the mech's
      // left, so for the left arm (+1) a rising yaw is outward, and for the right arm (-1) a falling one is.
      // Outside the window, the nearer end round the circle (Keith 2026-11-06: with the arm reaching nearly straight back,
      // a target just past dead behind is near the arm's back limit, not across the chest; it mustn't swing round the front).
      const yawTo = yawWant >= lo && yawWant <= hi ? yawWant : Math.abs(wrap(yawWant - lo)) < Math.abs(wrap(yawWant - hi)) ? lo : hi;
      const outward = Math.sign(yawTo - g.yaw) === g.side;
      const kYaw = 1 - Math.exp(-track * (outward ? (own?.held ? v.heldOutward : v.outwardTrack) : 1) * dt);
      const kPitch = 1 - Math.exp(-track * dt);
      g.yaw += (yawTo - g.yaw) * kYaw;
      const pitchTo = clamp(pitchWant, -pup, pmax);
      g.pitch += (pitchTo - g.pitch) * kPitch;
      g.kick += (0 - g.kick) * (1 - Math.exp(-v.recoilReturn * dt));
      // On target: the gun has swung as close as it can go (its clamped aim), and the aim is inside its arc (else it
      // waits for the torso). Pitch only needs the gun to have reached its limit below: a target close under the guns
      // asks for more depression than they have, and they should still fire (bug 2026-10-24: they never did). Above,
      // a target higher than the guns raise (plus the lean) is out of reach: they don't fire up at it.
      const inArc = yawWant >= lo - cone && yawWant <= hi + cone;
      const reachUp = pitchWant >= -pup - cone;
      g.onTarget = g.enabled && !!aim && inArc && reachUp && Math.abs(wrap(yawTo - g.yaw)) <= cone && Math.abs(pitchTo - g.pitch) <= cone * 2;
      if (!this.armsOnly || free) this.onTarget ||= g.onTarget;

      // The magazine reloads in its own time (a rocket launcher on this side spends it in src/weapons).
      magStep(g.mag, dt);
      // A rail cannon, rocket launcher, sword or energy weapon only aims here (round guns fire on this clock): it charges, fires or swings in src/weapons.
      if (own?.cls && own.cls !== "minigun" && own.cls !== "autocannon" && own.cls !== "cannon" && !isRoundGun(own.cls)) { g.spin = 0; g.firing = false; g.clock = 0; continue; }
      const trigger = triggerOf(triggers, g.side === 1 ? 0 : 1);
      g.spinUpTime = (own?.spinUp ?? v.spinUp) * (1 - g.side * v.spinSplit) * (1 - g.spinCut);
      g.spin = trigger && g.enabled ? Math.min(1, g.spin + dt / g.spinUpTime) : Math.max(0, g.spin - dt / v.spinDown);
      g.spinAngle = (g.spinAngle + spinRate * g.spin * dt) % (Math.PI * 2);
      this.spin = Math.max(this.spin, g.spin);

      // A round gun (src/weapons/guns.ts) has no barrels to spin: its clock refills while it waits, so the first round
      // leaves on the click (a sniper's 1.7 s cycle shouldn't start after the press).
      const semi = isRoundGun(own?.cls) || own?.cls === "cannon";
      g.firing = trigger && (semi || g.spin >= v.fireFrom) && g.onTarget && magReady(g.mag);
      if (g.firing) {
        g.clock += dt * (own?.fireRate ?? v.fireRate) * g.rateMul * (semi ? 1 : (1 + g.side * v.rateSplit) * (0.6 + 0.4 * g.spin));
        // Each tick's shot takes one round × the Protocols' declared cost (Overclock, Double shot 2; magazine.ts).
        const cost = own?.cost ?? 1;
        while (g.clock >= 1 && magTake(g.mag, 1, cost)) {
          g.clock -= 1;
          g.kick = Math.min(v.recoilMax, g.kick + v.recoil);
          this.shake = Math.min(3 * D2R, this.shake + v.torsoKick * D2R);
          shots.push(g.side);
        }
      } else g.clock = semi ? Math.min(1, g.clock + dt * (own?.fireRate ?? v.fireRate) * g.rateMul) : Math.min(g.clock, 0.99);
    }
    this.shake *= Math.exp(-dt * 18);
    return shots;
  }
}
