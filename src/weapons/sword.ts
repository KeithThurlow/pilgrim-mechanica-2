// The mech's sword (Keith 2026-11-01: "a big chonky sword ... wield it with a mech and cleave through things"): a held
// weapon in an arm (`sword-light`, src/items/bases.ts), on that side's mouse button.
//
// The swing (Keith 2026-11-01, after a Mixamo one-hand sword combo): at rest the sword lies back over the shoulder
// toward the pack, the fist up in front of the shoulder and the elbow pointing ahead along the torso. A click: the
// elbow drives forward and up, then the wrist snaps round and the blade cuts across the front, from outboard to the far side, finishing low under the other shoulder (clip A). Click
// again (or hold) and it cuts back the other way, rising, ending cocked high over its own shoulder (clip B), from where
// the next A follows on. It's heavy (Keith 2026-11-01, round 4): the time through each move eases in from a stop,
// runs fastest through the cut and eases out to a stop at the far side, so a reversal takes its time. No follow-up: after A the elbow drops and the wrist and forearm swing round past the waist
// and back up to the shoulder (clip R); after B it settles back to rest (clip S).
//
// Each clip is a few keys of the hand (relative to the shoulder, for the left arm; the right mirrors) and the blade's
// axes; poses between keys are smoothed. Only the cut part of A and B hits: the blade is a vertical sheet from the
// hand out to `swordReach` (src/game/sheet.ts), sampled through the stretch of time it swept; every body it crosses is
// hit once per cut until the cut's cleave budget (m of steel equivalent, the penetration costs) is spent. The first
// body it bites stalls the blade for `swordHitch` s (and, for the local player, the whole fight for `swordStop` s:
// src/game/hitStop.ts). The keys keep the blade clear of the Rampart's torso (tools/sword-check.ts).
//
// Pure: timing, keys and poses. The arsenal (src/weapons/arsenal.ts) turns the cut into hits, sound, sparks and shake,
// and the body (src/mech/rampart.ts holdPose) reaches a two-bone arm to the pose's hand.
// Ownership: player (the swing is the player's command; its hits are host-decided when networked, like any shot).
import type { Param } from "../core/tweaks";
import type { PenMaterial, SheetHit } from "../game/sheet";

export const SWORD_DEFAULTS = {
  swordDamage: 900,
  swordAp: 0.5,
  swordReach: 4.7,
  swordArc: 210,
  swordWindup: 0.22,
  swordSlash: 0.22,
  swordRecover: 0.42,
  swordFollow: 0.5,
  swordComboAt: 0.7,
  swordBlend: 0.08,
  swordCleave: 4,
  swordHeight: 5,
  swordHalf: 0.5,
  swordKnock: 9,
  swordLunge: 14,
  swordLungeNear: 5,
  swordLungeFar: 16,
  swordHitch: 0.06,
  swordStop: 0.07,
  swordStopScale: 0.08,
  swordShake: 0.55,
  swordLength: 1,
  swordTrail: 1,
  swordSwishLife: 0.14,
  swordSwishInner: 0.35,
  swordSwishAfter: 0.08,
  swordSwishBend: 0.12,
  swordSwishAirSize: 1.6,
  swordSwishAirStep: 0.9,
  swordLevel: 0.7,
  // The arm and the pose (Keith 2026-11-01: "the arms to actually animate"). Hull-frame metres.
  swordUpperArm: 1.45,
  swordForearm: 1.45,
  swordDroop: 14,
  swordSnap: 2.1,
  swordEaseIn: 1.6,
  swordEaseOut: 0.9,
  swordGuardUp: 0,
  // The waist's follow-through (Keith 2026-11-01, round 7): the torso turns with the cut and carries on past.
  // Close or far (Keith 2026-11-01, round 7): aimed close the cut comes from the elbow, bent, quicker and narrower,
  // reaching full extension only at its end; aimed far (with the lunge) the full straight-arm sweep, slower. Between
  // the lunge's near and far distances it blends.
  swordNearTime: 0.7,
  swordFarTime: 1.15,
  swordNearBend: 0.66,
  swordNearArc: 0.75,
  swordTwist: 24,
  swordTwistHz: 2.4,
  swordTwistDamp: 0.5,
  swordTwistMax: 40,
  swordShoulderOut: 0.35,
};
export type SwordValues = typeof SWORD_DEFAULTS;

export const SWORD_GROUP = "Sword", SWORD_ARM_GROUP = "Sword arm";
const G = SWORD_GROUP, GA = SWORD_ARM_GROUP;
export const SWORD_PARAMS: Param[] = [
  { key: "swordDamage", label: "Damage per hit", min: 0, max: 3000, step: 5, group: G, tip: "Every body the blade crosses in one cut takes this (a rolled sword carries its own)" },
  { key: "swordAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: G },
  { key: "swordReach", label: "Reach from the hand (m)", min: 2, max: 14, step: 0.1, group: G, tip: "The blade's sheet runs from the hand out to this; the model's blade is drawn to match" },
  { key: "swordArc", label: "Cut arc (°)", min: 30, max: 270, step: 1, group: G, tip: "How far the blade turns through a cut, centred on the aim" },
  { key: "swordWindup", label: "Drive (s)", min: 0.02, max: 1, step: 0.01, group: G, tip: "From rest: the elbow drives forward and up before the cut (the back-cut's lead-in takes about half)" },
  { key: "swordSlash", label: "Cut (s)", min: 0.04, max: 0.6, step: 0.01, group: G, tip: "The cut itself: the only time it hits" },
  { key: "swordFollow", label: "Follow-through (s)", min: 0.02, max: 0.6, step: 0.01, group: G, tip: "After the cut, on to under the far shoulder (or up over its own)" },
  { key: "swordRecover", label: "Return to rest (s)", min: 0.05, max: 1.5, step: 0.01, group: G, tip: "No follow-up: after the first cut the arm drops past the waist and back up over the shoulder in 1.6 × this" },
  { key: "swordComboAt", label: "Next cut from (share of follow-through)", min: 0, max: 1, step: 0.01, group: G, tip: "Clicked or held, the next cut (the other way) starts this far into the follow-through" },
  { key: "swordBlend", label: "Blend into a new move (s)", min: 0, max: 0.4, step: 0.01, group: G },
  { key: "swordCleave", label: "Cleave budget (m)", min: 0, max: 30, step: 0.1, group: G, tip: "Each body costs its chord × its density (Penetration group), like a rail slug: once spent, the rest of the cut passes over them" },
  { key: "swordHeight", label: "Blade reaches up (m)", min: 1, max: 16, step: 0.1, group: G, tip: "The sheet's top over the ground: higher reaches big walkers' bodies" },
  { key: "swordHalf", label: "Blade half-width (m)", min: 0, max: 2, step: 0.05, group: G },
  { key: "swordKnock", label: "Knockback (m/s)", min: 0, max: 40, step: 0.5, group: G, tip: "Light bodies are thrown along the cut" },
  { key: "swordLunge", label: "Lunge (m/s)", min: 0, max: 40, step: 0.5, group: G, tip: "The mech steps into the cut at up to this speed toward the aim, through the end of the drive and the cut" },
  { key: "swordLungeNear", label: "No lunge within (m)", min: 0, max: 30, step: 0.5, group: G, tip: "Aiming (the lock, else the cursor) this close: no lunge, so you can kite in close" },
  { key: "swordLungeFar", label: "Full lunge from (m)", min: 1, max: 60, step: 0.5, group: G, tip: "Aiming this far or farther: the full lunge; in between it grows with the distance" },
  { key: "swordHitch", label: "Blade stalls on a hit (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The cut freezes this long on its first body" },
  { key: "swordStop", label: "Hit stop (s)", min: 0, max: 0.3, step: 0.005, group: G, tip: "The whole fight slows this long on the first body (the player's own cuts only)" },
  { key: "swordStopScale", label: "Hit stop speed", min: 0, max: 1, step: 0.01, group: G, tip: "How fast time runs during the hit stop (0 frozen, 1 off)" },
  { key: "swordShake", label: "Camera shake on a hit", min: 0, max: 2, step: 0.01, group: G },
  { key: "swordLength", label: "Blade drawn × reach", min: 0.3, max: 1.5, step: 0.01, group: G, tip: "The model's blade length as a share of the reach" },
  { key: "swordTrail", label: "Swish brightness", min: 0, max: 3, step: 0.05, group: G, tip: "The light ribbon the blade sweeps (0 off)" },
  { key: "swordSwishLife", label: "Swish length (s)", min: 0.02, max: 0.5, step: 0.01, group: G, tip: "How much of the arc behind the blade it covers, in time" },
  { key: "swordSwishInner", label: "Swish from (share of the blade)", min: 0, max: 0.95, step: 0.01, group: G, tip: "The ribbon runs from this far up the blade to the tip" },
  { key: "swordSwishAfter", label: "Swish after the cut (s)", min: 0, max: 0.4, step: 0.01, group: G, tip: "It keeps sweeping into the follow-through this long" },
  { key: "swordSwishBend", label: "Swish air bend (m)", min: 0, max: 0.6, step: 0.005, group: G, tip: "Heat-haze bends along the arc (blast-wave shimmer puffs); 0 off" },
  { key: "swordSwishAirSize", label: "Swish air puff size (m)", min: 0.2, max: 5, step: 0.05, group: G },
  { key: "swordSwishAirStep", label: "Swish air puff every (m)", min: 0.2, max: 4, step: 0.05, group: G, tip: "Spacing along the arc the blade's outer half travels (more puffs cost more)" },
  { key: "swordLevel", label: "Sound level", min: 0, max: 1.5, step: 0.01, group: G },
  { key: "swordUpperArm", label: "Upper arm (m)", min: 0.5, max: 3, step: 0.05, group: GA },
  { key: "swordForearm", label: "Forearm (m)", min: 0.5, max: 3, step: 0.05, group: GA },
  { key: "swordDroop", label: "Blade tipped down in the cut (°)", min: -30, max: 60, step: 1, group: GA, tip: "So the tip sweeps low through small enemies" },
  { key: "swordSnap", label: "Wrist snap", min: 1, max: 3, step: 0.05, group: GA, tip: "The blade's speed in the middle of the cut against its average (the wrist snapping round): 1 even, higher whips more of the turn into the middle" },
  { key: "swordEaseIn", label: "Speed arriving at the cut", min: 0.5, max: 3, step: 0.05, group: GA, tip: "Against the average: high bursts into the cut out of a short drive (Keith: impact); low builds slowly" },
  { key: "swordEaseOut", label: "Speed leaving the cut", min: 0.3, max: 3, step: 0.05, group: GA, tip: "Against the average: low hands more of the speed to a long, slowing follow-through (weight); high carries on fast and stops late" },
  { key: "swordShoulderOut", label: "Arm mounted out from the hull (m)", min: 0, max: 1, step: 0.01, group: GA, tip: "A sword arm's shoulder sits this much further out, to make room for the blade" },
  { key: "swordNearTime", label: "Close cut: time ×", min: 0.3, max: 1.5, step: 0.01, group: GA, tip: "Aimed within the lunge's no-lunge distance: the drive, cut and follow-through take this × their time (quicker)" },
  { key: "swordFarTime", label: "Far cut: time ×", min: 0.5, max: 2, step: 0.01, group: GA, tip: "Aimed at the full-lunge distance or farther: × their time (the big sweep, slower)" },
  { key: "swordNearBend", label: "Close cut: hand reach ×", min: 0.4, max: 1, step: 0.01, group: GA, tip: "How far out the hand goes through a close cut (elbow bent), as a share of the full sweep's; it still reaches full out at the cut's end" },
  { key: "swordNearArc", label: "Close cut: arc ×", min: 0.3, max: 1, step: 0.01, group: GA, tip: "A close cut turns the blade through this share of the arc (drawn across, not swept)" },
  { key: "swordTwist", label: "Waist turns with the cut (°)", min: 0, max: 60, step: 1, group: GA, tip: "The torso coils back a little in the drive, turns this far after the blade through the cut and follow-through, and back on the back-cut; 0 off. Drawn only: the guns on the hull turn back by as much, so nothing aims elsewhere" },
  { key: "swordTwistHz", label: "Waist spring (Hz)", min: 0.5, max: 8, step: 0.1, group: GA, tip: "How fast the waist follows the swing: low lags and swings on (heavy), high snaps" },
  { key: "swordTwistDamp", label: "Waist damping", min: 0.1, max: 1.5, step: 0.01, group: GA, tip: "Below 1 it overshoots and settles back (weight carrying on); 1 no overshoot" },
  { key: "swordTwistMax", label: "Waist twist at most (°)", min: 0, max: 90, step: 1, group: GA, tip: "Two swords swinging at once add up to this at most" },
  { key: "swordGuardUp", label: "At rest: hand higher (m)", min: -1, max: 1, step: 0.05, group: GA },
];

export interface SwordStats { damage: number; ap: number; reach: number; arc: number; windup: number; slash: number; recover: number; cleave: number }

/** guard: at rest; A the first cut (outboard across to under the far shoulder); B the back-cut; R the return after A;
 *  S the settle after B. */
export type SwordClip = "guard" | "A" | "B" | "R" | "S";

type V = { x: number; y: number; z: number };
/** A held sword's pose in the hull's frame: where the hand is, the way the blade points, the way its spine faces (the
 *  edge faces the other way). */
export interface SwordPose { hand: V; fwd: V; up: V; pole: V }

const D2R = Math.PI / 180;
const v3 = (x: number, y: number, z: number): V => ({ x, y, z });
const norm = (v: V): V => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const lerpV = (a: V, b: V, k: number): V => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
/** `up` made square to `fwd` (any square vector when they're parallel). */
const square = (fwd: V, up: V): V => {
  const d = up.x * fwd.x + up.y * fwd.y + up.z * fwd.z;
  const r = { x: up.x - fwd.x * d, y: up.y - fwd.y * d, z: up.z - fwd.z * d };
  if (Math.hypot(r.x, r.y, r.z) < 1e-4) return square(fwd, Math.abs(fwd.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
  return norm(r);
};
const smooth = (x: number) => x * x * (3 - 2 * x);
/** Cubic Hermite through (a, a) and (b, b) with slopes ma, mb, at x in [a, b]. */
const herm = (x: number, a: number, b: number, ma: number, mb: number) => {
  const h = b - a, u = (x - a) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * h * ma + (-2 * u3 + 3 * u2) * b + (u3 - u2) * h * mb;
};
/**
 * The weight (Keith 2026-11-01: "ease into the swing and ease out of it"): time through a move (share x) to the share
 * the keys are read at. It starts and ends at a stop, meets the cut's start at `easeIn` and its end at `easeOut` × the average speed and peaks at
 * `snap` × in the cut's middle; the cut's ends stay where they are, so the hits keep their times.
 */
export function moveWarp(x: number, cut: [number, number] | null, easeIn: number, easeOut: number, snap: number): number {
  if (x <= 0 || x >= 1) return Math.max(0, Math.min(1, x));
  if (!cut) return smooth(x);
  const [c0, c1] = cut, cm = (c0 + c1) / 2;
  const ei = Math.min(3, easeIn), eo = Math.min(3, easeOut), s = Math.min(3, snap);
  if (x < c0) return herm(x, 0, c0, 0, ei);
  if (x < cm) return herm(x, c0, cm, ei, s);
  if (x < c1) return herm(x, cm, c1, s, eo);
  return herm(x, c1, 1, eo, 0);
}

/**
 * A key: the hand off the shoulder (left arm: +x outboard), the blade's way (a vector, or a yaw in half-arcs: +1 out
 * along the outboard side of the aim, −1 across to the far side, with a pitch in degrees on top of the droop), and a
 * hint for the spine.
 */
interface Key { t: number; hand: V; fwd?: V; yaw?: number; pitch?: number; up: V; pole?: V }

// Hand places off the shoulder, left arm (the Rampart's shoulder sits 1.02 m out, 0.89 m over the waist; its torso
// spans ±1.2 m across, 1.27 m back to 1.37 m ahead, from 0.33 m under the waist to 2.3 m over it).
// Rest (Keith 2026-11-01, round 5): a right-angle triangle. The elbow low, pointing at the ground but forward; the
// forearm angled up to the fist, ahead of the shoulder at about its height; the blade on the wrist laid back over the
// shoulder toward the pack (near the triangle's long side), in line with the torso.
const GUARD: Key = { t: 0, hand: v3(0.15, -0.05, 2.0), fwd: v3(-0.06, 0.36, -0.93), up: v3(0.7, -0.6, 0.2), pole: v3(0.05, -1, 0.1) };
const DRIVE: Key = { t: 0, hand: v3(0.45, 0.95, 1.85), fwd: v3(0.85, 0.5, -0.2), up: v3(0.2, -0.3, 1), pole: v3(0.6, -0.6, 0.6) };
/** Where the elbow bends to in the cuts (left arm): out and down, a little back. */
const CUT_POLE = v3(0.9, -1, -0.5);
// The ends (Keith 2026-11-01, round 6: "more end extension poses"): A finishes low and under on the far side; B
// finishes with the arm up near straight, the blade pointing forward and a little into the sky.
const UNDER: Key = { t: 0, hand: v3(-1.95, -1.0, 1.6), fwd: v3(-0.8, -0.5, -0.35), up: v3(0.2, 0.2, -1) };
const COCK: Key = { t: 0, hand: v3(0.56, 2.15, 1.68), fwd: v3(0.15, 0.4, 0.9), up: v3(-0.1, 0.9, -0.4) };

/** Clip keys at shares of its length, and its cut window (shares) when it has one. */
function clipKeys(c: SwordClip, st: SwordStats, v: SwordValues, span = 1): { len: number; keys: Key[]; cut: [number, number] | null; arc: number } {
  const k = Math.max(0, Math.min(1, span)), mix = (a: number, b: number) => a + (b - a) * k;
  const tk = mix(v.swordNearTime, v.swordFarTime), w = st.windup * tk, s = st.slash * tk, f = v.swordFollow * tk;
  // How far out the hand goes (close: bent at the elbow, full out only by the cut's end).
  const b = mix(v.swordNearBend, 1), bm = (b + 1) / 2;
  const out = (h: V, q: number) => v3(h.x * q, h.y * q, h.z * q);
  const arc = st.arc * mix(v.swordNearArc, 1);
  return { arc, ...keysOf() };
  function keysOf(): { len: number; keys: Key[]; cut: [number, number] | null } {
  const g = { ...GUARD, hand: { ...GUARD.hand, y: GUARD.hand.y + v.swordGuardUp } };
  switch (c) {
    case "guard": return { len: 1, keys: [{ ...g, t: 0 }, { ...g, t: 1 }], cut: null };
    case "A": {
      const len = w + s + f;
      return {
        len, cut: [w / len, (w + s) / len], keys: [
          { ...g, t: 0 },
          { ...DRIVE, t: (w * 0.7) / len },
          // The cut: the arm near straight (the blade at its fullest reach), the hand dipping low across the front and
          // on under the body to the far side, the blade from out along its own side to across the far one, its edge
          // leading (the spine faces back the way it came).
          { t: w / len, hand: out(v3(1.37, 0.37, 2.48), b), yaw: 1, pitch: 4, up: v3(1, 0, -0.4) },
          { t: (w + s * 0.5) / len, hand: out(v3(-0.3, -0.56, 2.79), bm), yaw: 0, pitch: -4, up: v3(1, 0, -0.4) },
          { t: (w + s) / len, hand: v3(-1.95, -1.08, 1.79), yaw: -1, pitch: -6, up: v3(1, 0.2, 0.4) },
          { ...UNDER, t: 1 },
        ],
      };
    }
    case "B": {
      const r = w * 0.45, len = r + s + f * 0.8;
      return {
        len, cut: [r / len, (r + s) / len], keys: [
          { ...UNDER, t: 0 },
          // Rising back across at full reach, on up into the high extension.
          { t: r / len, hand: out(v3(-1.92, -0.97, 1.78), bm), yaw: -1, pitch: -4, up: v3(-1, 0, -0.4) },
          { t: (r + s * 0.5) / len, hand: out(v3(-0.36, 0.21, 2.83), b), yaw: 0, pitch: 6, up: v3(-1, 0, -0.4) },
          { t: (r + s) / len, hand: v3(1.22, 1.32, 2.13), yaw: 1, pitch: 18, up: v3(-1, 0.2, 0.4) },
          { ...COCK, t: 1 },
        ],
      };
    }
    case "R": {
      // The elbow drops and the wrist and forearm swing the blade round past the waist (point down ahead, then back
      // along its own hip), and up to the shoulder.
      const len = st.recover * 1.6;
      return {
        len, cut: null, keys: [
          { ...UNDER, t: 0 },
          { t: 0.28, hand: v3(-1.0, -0.9, 2.0), fwd: v3(-0.2, -0.85, 0.5), up: v3(0, 0.4, 1) },
          { t: 0.58, hand: v3(0.55, -0.85, 1.45), fwd: v3(0.45, -0.55, -0.7), up: v3(0.3, 0.6, -0.5) },
          { t: 0.82, hand: v3(0.35, -0.2, 1.85), fwd: v3(0.1, 0.25, -0.96), up: v3(0.7, -0.6, 0.2), pole: v3(0.3, -1, 0.1) },
          { ...g, t: 1 },
        ],
      };
    }
    case "S": {
      const len = st.recover;
      return { len, cut: null, keys: [{ ...COCK, t: 0 }, { ...g, t: 1 }] };
    }
  }
  }
}

/** A clip's length (s) at a reach (span: 0 close .. 1 far). */
export function clipLength(c: SwordClip, st: SwordStats, v: SwordValues, span = 1) { return clipKeys(c, st, v, span).len; }
/** A clip's cut window (s) at a reach, or null. */
export function clipCut(c: SwordClip, st: SwordStats, v: SwordValues, span = 1): [number, number] | null {
  const k = clipKeys(c, st, v, span);
  return k.cut ? [k.cut[0] * k.len, k.cut[1] * k.len] : null;
}

/** A key's blade axes (left arm): a vector, or a yaw across the aim with a pitch under the droop. */
function keyAxes(k: Key, arc: number, v: SwordValues): { fwd: V; up: V } {
  let fwd: V;
  if (k.fwd) fwd = norm(k.fwd);
  else {
    const yaw = (k.yaw ?? 0) * (arc / 2) * D2R, p = ((k.pitch ?? 0) - v.swordDroop) * D2R;
    fwd = v3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
  }
  return { fwd, up: square(fwd, norm(k.up)) };
}

/**
 * The pose of a clip at time t (s) (pure; hull frame, +x the mech's left, +z ahead). The hand runs a smooth curve
 * through the keys (Catmull-Rom); the blade's axes blend key to key, and inside the cut its turn is whipped toward the
 * middle (the wrist snap). The right arm mirrors the left; the aim's yaw off the hull turns it all about the hull's
 * vertical.
 */
export function clipPose(c: SwordClip, t: number, side: 1 | -1, shoulder: V, aimYaw: number, st: SwordStats, v: SwordValues, span = 1): SwordPose {
  const { len, keys, cut, arc } = clipKeys(c, st, v, span);
  let x = Math.max(0, Math.min(1, t / Math.max(1e-3, len)));
  // The weight and the wrist snap: from a stop, fastest mid-cut, to a stop.
  if (c !== "guard") x = moveWarp(x, cut, v.swordEaseIn, v.swordEaseOut, v.swordSnap);
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const k = b.t > a.t ? Math.max(0, Math.min(1, (x - a.t) / (b.t - a.t))) : 1;
  const p0 = (keys[i - 1] ?? a).hand, p1 = a.hand, p2 = b.hand, p3 = (keys[i + 2] ?? b).hand;
  const cr = (q0: number, q1: number, q2: number, q3: number) => 0.5 * (2 * q1 + (-q0 + q2) * k + (2 * q0 - 5 * q1 + 4 * q2 - q3) * k * k + (-q0 + 3 * q1 - 3 * q2 + q3) * k * k * k);
  const hand = v3(cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y), cr(p0.z, p1.z, p2.z, p3.z));
  // Never past the arm's reach (the curve can overshoot a key a touch).
  const hd = Math.hypot(hand.x, hand.y, hand.z), most = (v.swordUpperArm + v.swordForearm) * 0.995;
  if (hd > most) { hand.x *= most / hd; hand.y *= most / hd; hand.z *= most / hd; }
  const A = keyAxes(a, arc, v), B = keyAxes(b, arc, v);
  // Inside the cut the yaw is turned (not blended straight), so a wide arc stays a sweep.
  let fwd: V;
  if (a.yaw !== undefined && b.yaw !== undefined) fwd = keyAxes({ ...a, yaw: a.yaw + (b.yaw - a.yaw) * k, pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * k }, arc, v).fwd;
  else fwd = norm(lerpV(A.fwd, B.fwd, smooth(k)));
  const up = square(fwd, lerpV(A.up, B.up, k));
  const pole = norm(lerpV(a.pole ?? CUT_POLE, b.pole ?? CUT_POLE, smooth(k)));
  // Off the shoulder, mirrored for the right arm, turned by the aim about the hull's vertical.
  const m = (q: V): V => v3(q.x * side, q.y, q.z);
  const turn = (q: V): V => v3(q.x * Math.cos(aimYaw) + q.z * Math.sin(aimYaw), q.y, -q.x * Math.sin(aimYaw) + q.z * Math.cos(aimYaw));
  const h = m(hand);
  return { hand: turn(v3(shoulder.x + h.x, shoulder.y + h.y, shoulder.z + h.z)), fwd: turn(m(fwd)), up: turn(m(up)), pole: turn(m(pole)) };
}

/** Blend two poses (hand straight, axes renormalised). */
export function blendPose(a: SwordPose, b: SwordPose, k: number): SwordPose {
  const fwd = norm(lerpV(a.fwd, b.fwd, k));
  return { hand: lerpV(a.hand, b.hand, k), fwd, up: square(fwd, lerpV(a.up, b.up, k)), pole: norm(lerpV(a.pole, b.pole, k)) };
}

/**
 * Where the waist wants to be (pure; in shares of swordTwist, + toward the arm's own side): it coils back a little in the
 * drive, turns after the blade across to the far side through the cut and holds there through the follow-through
 * (A); the back-cut brings it back past the middle to its own side (B); the returns settle it to 0. The arsenal runs a
 * spring toward this, which is the lag and the swing on past.
 */
export function twistTarget(c: SwordClip, t: number, st: SwordStats, v: SwordValues, span = 1): number {
  if (c === "guard") return 0;
  const { len, cut } = clipKeys(c, st, v, span);
  const x = Math.max(0, Math.min(1, t / Math.max(1e-3, len)));
  const lerp = (a: number, b: number, k: number) => a + (b - a) * smooth(Math.max(0, Math.min(1, k)));
  if (c === "R") return lerp(-1, 0, x);
  if (c === "S") return lerp(0.6, 0, x);
  const [c0, c1] = cut!;
  if (c === "A") return x < c0 ? lerp(0, 0.3, x / c0) : lerp(0.3, -1, (x - c0) / (c1 - c0));
  return x < c0 ? -1 : lerp(-1, 0.6, (x - c0) / (c1 - c0));
}

/** One step of a damped spring (x, v) toward a target: frequency hz, damping ratio z (pure). */
export function springStep(x: number, vel: number, target: number, hz: number, z: number, dt: number): [number, number] {
  const w = 2 * Math.PI * hz;
  const a = w * w * (target - x) - 2 * z * w * vel;
  const v2 = vel + a * dt;
  return [x + v2 * dt, v2];
}

/** A stretch of a cut swept this step: the clip and its times from, to (s). */
export interface Sweep { clip: SwordClip; from: number; to: number }

/** One arm's sword: which move, how far in, what the trigger asked for. `side`: 1 left, -1 right. */
export class SwordSim {
  clip: SwordClip = "guard";
  t = 0;
  /** Cuts started (the arsenal clears its per-cut hit list when this changes). */
  swings = 0;
  /** Seconds the blade is stalled in a body. */
  hitch = 0;
  /** A cut began this step (the whoosh). */
  started = false;
  /** In a cut's window now. */
  cutting = false;
  /** The lunge's share now, 0..1: the end of the drive and the cut of A, the cut of B. */
  lungeK = 0;
  /** The move it came from and when, and how long ago it switched (the blend). */
  prev: SwordClip = "guard";
  prevT = 0;
  /** This cut's reach (0 close .. 1 far: the bent-elbow draw cut or the full sweep), set as each cut starts; the
   *  move it came from's. */
  span = 1;
  prevSpan = 1;
  since = 99;
  /** A click during a move: the next cut follows as soon as it may. */
  private queued = false;
  private nextSpan = 1;
  private wasHeld = false;

  constructor(readonly side: 1 | -1) {}

  /** Stall the blade (a body bit it). */
  bite(seconds: number) { this.hitch = Math.max(this.hitch, seconds); }

  /** Let go of everything (weapons cold): back at rest, no move. */
  stop() { this.clip = this.prev = "guard"; this.t = this.prevT = 0; this.since = 99; this.hitch = 0; this.queued = false; this.cutting = false; this.lungeK = 0; }

  private go(c: SwordClip, t: number) {
    this.prev = this.clip; this.prevT = this.t; this.prevSpan = this.span; this.since = 0;
    this.clip = c; this.t = t;
    if (c === "A" || c === "B") this.span = this.nextSpan;
    if (c === "A" || c === "B") this.swings++;
  }

  /** Where an A picked up from the cock starts: 0.7 of its (scaled) drive. */
  private driveAt(st: SwordStats, v: SwordValues) { const w = clipCut("A", st, v, this.nextSpan); return w ? w[0] * 0.7 : 0; }

  /** The cut window of the current move in seconds, or null. */
  cutWindow(st: SwordStats, v: SwordValues): [number, number] | null {
    return clipCut(this.clip, st, v, this.span);
  }
  /** The current move's length (s). */
  length(st: SwordStats, v: SwordValues) { return clipKeys(this.clip, st, v, this.span).len; }

  /** Step on the trigger. Returns the stretch of a cut swept this step (inside the cut window), or null. */
  update(dt: number, held: boolean, st: SwordStats, v: SwordValues, span = 1): Sweep | null {
    this.started = false;
    this.nextSpan = Math.max(0, Math.min(1, span));
    if (held && !this.wasHeld) this.queued = true;
    this.wasHeld = held;
    const want = this.queued || held;
    if (this.hitch > 0) {
      const h = Math.min(this.hitch, dt);
      this.hitch -= h; dt -= h;
      if (dt <= 0) return null;
    }
    this.since += dt;
    // Moves: rest → A; A → B (clicked again) or R; B → A (on from the cock) or S; R and S → A from wherever they are.
    const len = this.length(st, v), win = this.cutWindow(st, v);
    const comboFrom = win ? win[1] + (len - win[1]) * v.swordComboAt : len;
    if (this.clip === "guard" && want) { this.queued = false; this.go("A", 0); }
    else if ((this.clip === "A" || this.clip === "B") && want && this.t >= comboFrom) {
      this.queued = false;
      if (this.clip === "A") this.go("B", 0);
      else this.go("A", this.driveAt(st, v));
    } else if ((this.clip === "R" || this.clip === "S") && want) { this.queued = false; this.go("A", 0); }
    const t0 = this.t;
    this.t += dt;
    const L = this.length(st, v), w = this.cutWindow(st, v);
    let sweep: Sweep | null = null;
    this.cutting = !!w && this.t > w[0] && t0 < w[1];
    if (w && this.cutting) {
      if (t0 <= w[0]) this.started = true;
      sweep = { clip: this.clip, from: Math.max(t0, w[0]), to: Math.min(this.t, w[1]) };
    }
    // The lunge: A from halfway through the drive to the end of the cut; B through its cut.
    if (this.clip === "A" && w) this.lungeK = this.t > w[0] * 0.5 && this.t < w[1] ? Math.sin(Math.PI * Math.min(1, (this.t - w[0] * 0.5) / (w[1] - w[0] * 0.5))) : 0;
    else if (this.clip === "B" && w) this.lungeK = this.cutting ? 0.6 : 0;
    else this.lungeK = 0;
    if (this.t >= L) {
      const over = this.t - L;
      if (this.clip === "A") { if (want) { this.queued = false; this.go("B", over); } else this.go("R", over); }
      else if (this.clip === "B") { if (want) { this.queued = false; this.go("A", this.driveAt(st, v)); } else this.go("S", over); }
      else if (this.clip === "R" || this.clip === "S") this.go("guard", 0);
      else this.t = 0;
    }
    return sweep;
  }

  /** The pose now (blending out of the last move for swordBlend s). */
  pose(shoulder: V, aimYaw: number, st: SwordStats, v: SwordValues): SwordPose {
    const cur = clipPose(this.clip, this.t, this.side, shoulder, aimYaw, st, v, this.span);
    if (this.since >= v.swordBlend || v.swordBlend <= 0) return cur;
    const was = clipPose(this.prev, this.prevT, this.side, shoulder, aimYaw, st, v, this.prevSpan);
    return blendPose(was, cur, smooth(this.since / v.swordBlend));
  }
}

/** Times to sample across a swept stretch of a cut, at most `step` s apart. */
export function sweepTimes(s: Sweep, step = 1 / 240): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(s.to - s.from) / step));
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(s.from + ((s.to - s.from) * i) / n);
  return out;
}

/**
 * The rule for one sheet of the blade: of its hits (any order), the ones this cut still cuts, nearest the hand
 * first. A body (target and unit key) is cut once per cut; each cut pays its chord × density out of the cut's
 * cleave budget, and once that's spent nothing more is cut (the body that spends it is still cut).
 */
export function swordCuts<T>(hits: SheetHit<T>[], seen: Map<T, Set<number>>, budget: { left: number }, density: (m: PenMaterial) => number): SheetHit<T>[] {
  const out: SheetHit<T>[] = [];
  hits.sort((a, b) => a.along - b.along);
  for (const h of hits) {
    if (budget.left <= 0) break;
    let s = seen.get(h.target);
    if (!s) { s = new Set(); seen.set(h.target, s); }
    if (s.has(h.key)) continue;
    s.add(h.key);
    budget.left -= h.chord * density(h.material);
    out.push(h);
  }
  return out;
}

/**
 * Two-bone reach (pure): the elbow for a shoulder, a hand and the bones' lengths, bent toward `pole`. The hand is pulled
 * in to the arm's reach when it's farther; returns the hand used too.
 */
export function armIk(s: V, h: V, upper: number, fore: number, pole: V): { elbow: V; hand: V } {
  const dx = h.x - s.x, dy = h.y - s.y, dz = h.z - s.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-6;
  const u = { x: dx / dist, y: dy / dist, z: dz / dist };
  const d = Math.max(Math.abs(upper - fore) + 1e-3, Math.min(upper + fore - 1e-3, dist));
  const hand = { x: s.x + u.x * d, y: s.y + u.y * d, z: s.z + u.z * d };
  const x = (upper * upper - fore * fore + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, upper * upper - x * x));
  const q = square(u, pole);
  return { elbow: { x: s.x + u.x * x + q.x * hgt, y: s.y + u.y * x + q.y * hgt, z: s.z + u.z * x + q.z * hgt }, hand };
}
