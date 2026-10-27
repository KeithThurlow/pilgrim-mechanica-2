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
  fireRate: 16,
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
  ammoPerGun: 1200,
};
export type UpperValues = typeof UPPER_DEFAULTS;

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
  { key: "spinUp", label: "Spin-up (s)", min: 0.05, max: 2, step: 0.05, group: "Minigun" },
  { key: "spinDown", label: "Spin-down (s)", min: 0.1, max: 4, step: 0.05, group: "Minigun" },
  { key: "spinRpm", label: "Barrel rpm", min: 100, max: 3000, step: 10, group: "Minigun" },
  { key: "fireFrom", label: "Fires from spin", min: 0, max: 1, step: 0.01, group: "Minigun", tip: "Share of full spin before rounds come out" },
  { key: "fireRate", label: "Rounds/s per gun", min: 1, max: 60, step: 0.5, group: "Minigun" },
  { key: "spinSplit", label: "Left vs right spin-up", min: -0.6, max: 0.6, step: 0.01, group: "Minigun", tip: "Positive: the left gun spins up faster by this share" },
  { key: "rateSplit", label: "Left vs right fire rate", min: -0.3, max: 0.3, step: 0.005, group: "Minigun", tip: "The guns' clocks run this far apart, so their rounds drift in and out of step" },
  { key: "spread", label: "Spread (°)", min: 0, max: 15, step: 0.1, group: "Minigun" },
  { key: "range", label: "Range (m)", min: 5, max: 80, step: 1, group: "Minigun" },
  { key: "ammoPerGun", label: "Rounds per gun", min: 50, max: 10000, step: 50, group: "Minigun", tip: "What each gun's drum holds when you head out (Keith 2026-10-24: limited ammo per trip); R resupplies in the lab" },
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
  /** Rounds left in this gun's drum. */
  ammo: number;
  /** A gun is fitted on this side (a loadout can leave a side empty: it never spins or fires). */
  enabled: boolean;
  /** This gun's own values from its item (src/items); null runs on the shared sliders. */
  stats: GunStats | null;
}

/** One gun's values when a loadout gives it its own (else the shared sliders). Damage, spread, range and pierce are
 *  read by the mech unit when it fires; the rest here. */
export interface GunStats {
  fireRate: number;
  spinUp: number;
  ammo: number;
  /** Arc (°) and tracking: podYawMax and podTrack for this gun. */
  arc: number;
  track: number;
  damage: number;
  spread: number;
  range: number;
  pierce: number;
  /** What kind of gun (default minigun): a rail cannon charges on the trigger instead of spinning up and never fires
   *  rounds here (src/weapons/arsenal.ts fires it); an autocannon fires on this clock but its rounds are shells. */
  cls?: GunClass;
  /** The weapon item's own rolled stats for src/weapons (null: an unrolled base item, which runs on the sliders). */
  own?: Record<string, number> | null;
  /** Light (a hand weapon) rather than Medium (on the hull). */
  light?: boolean;
  /** Its socketed Protocols' behaviour on every round (src/game/shots.ts). */
  proto?: import("../game/shots").ShotProtocols;
}

export type GunClass = "minigun" | "rail" | "autocannon" | "rpg";

/** One trigger for both guns, or one per gun (Keith 2026-10-25: left click the left side, right click the right). */
export type Trigger = boolean | readonly [boolean, boolean];
/** The trigger for gun i (0 left, 1 right). */
export const triggerOf = (t: Trigger, i: number) => (typeof t === "boolean" ? t : t[i]);

export interface Aim {
  /** Point on the ground to aim at, or null to face forward. */
  x: number; y: number; z: number;
}

const gun = (side: 1 | -1): Gun => ({ side, yaw: 0, pitch: 0, spin: 0, spinAngle: 0, kick: 0, onTarget: false, firing: false, spinUpTime: 0.5, clock: 0, ammo: 0, enabled: true, stats: null });

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

  constructor(public v: UpperValues) {}

  reset(yaw: number) { this.torsoYaw = yaw; for (const g of this.guns) { g.spin = 0; g.clock = 0; } this.resupply(); }

  /** Fill both drums. */
  resupply() { for (const g of this.guns) g.ammo = g.stats?.ammo ?? this.v.ammoPerGun; }

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
    for (const g of this.guns) {
      const own = g.stats;
      const ymax = (own?.arc ?? v.podYawMax) * D2R, track = own?.track ?? v.podTrack;
      // Aim from this gun's own shoulder, so the two converge on the aim point.
      const gx = shoulder.x + lx * g.side * v.gunSpacing, gz = shoulder.z + lz * g.side * v.gunSpacing;
      const yawWant = aim ? wrap(Math.atan2(aim.x - gx, aim.z - gz) - this.torsoYaw) : 0;
      const dist = aim ? Math.hypot(aim.x - gx, aim.z - gz) : 10;
      // Relative to the hull, which is leaning back by `lean`.
      const pitchWant = aim ? -Math.atan2(aim.y - shoulder.y, Math.max(1, dist)) + this.lean : 0;
      // Each arm swings inward (toward the torso) at full speed and outward slower. Yaw grows toward the mech's
      // left, so for the left arm (+1) a rising yaw is outward, and for the right arm (-1) a falling one is.
      const yawTo = clamp(yawWant, -ymax, ymax);
      const outward = Math.sign(yawTo - g.yaw) === g.side;
      const kYaw = 1 - Math.exp(-track * (outward ? v.outwardTrack : 1) * dt);
      const kPitch = 1 - Math.exp(-track * dt);
      g.yaw += (yawTo - g.yaw) * kYaw;
      const pitchTo = clamp(pitchWant, -pup, pmax);
      g.pitch += (pitchTo - g.pitch) * kPitch;
      g.kick += (0 - g.kick) * (1 - Math.exp(-v.recoilReturn * dt));
      // On target: the gun has swung as close as it can go (its clamped aim), and the aim is inside its arc (else it
      // waits for the torso). Pitch only needs the gun to have reached its limit below: a target close under the guns
      // asks for more depression than they have, and they should still fire (bug 2026-10-24: they never did). Above,
      // a target higher than the guns raise (plus the lean) is out of reach: they don't fire up at it.
      const inArc = Math.abs(yawWant) <= ymax + cone;
      const reachUp = pitchWant >= -pup - cone;
      g.onTarget = g.enabled && !!aim && inArc && reachUp && Math.abs(wrap(yawTo - g.yaw)) <= cone && Math.abs(pitchTo - g.pitch) <= cone * 2;
      this.onTarget ||= g.onTarget;

      // A rail cannon or rocket launcher only aims here: it charges and fires in src/weapons.
      if (own?.cls === "rail" || own?.cls === "rpg") { g.spin = 0; g.firing = false; g.clock = 0; continue; }
      const trigger = triggerOf(triggers, g.side === 1 ? 0 : 1);
      g.spinUpTime = (own?.spinUp ?? v.spinUp) * (1 - g.side * v.spinSplit);
      g.spin = trigger && g.enabled ? Math.min(1, g.spin + dt / g.spinUpTime) : Math.max(0, g.spin - dt / v.spinDown);
      g.spinAngle = (g.spinAngle + spinRate * g.spin * dt) % (Math.PI * 2);
      this.spin = Math.max(this.spin, g.spin);

      g.firing = trigger && g.spin >= v.fireFrom && g.onTarget && g.ammo > 0;
      if (g.firing) {
        g.clock += dt * (own?.fireRate ?? v.fireRate) * (1 + g.side * v.rateSplit) * (0.6 + 0.4 * g.spin);
        while (g.clock >= 1 && g.ammo > 0) {
          g.clock -= 1;
          g.ammo--;
          g.kick = Math.min(v.recoilMax, g.kick + v.recoil);
          this.shake = Math.min(3 * D2R, this.shake + v.torsoKick * D2R);
          shots.push(g.side);
        }
      } else g.clock = Math.min(g.clock, 0.99);
    }
    this.shake *= Math.exp(-dt * 18);
    return shots;
  }
}
