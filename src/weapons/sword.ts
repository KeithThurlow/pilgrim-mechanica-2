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
import { posesFor, type P3 } from "./swordPoses";

export const SWORD_DEFAULTS = {
  swordDamage: 450,
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
  // The lunge and the legs (Keith 2026-11-01, round 9): the step's share by the walk's way against the cut's.
  swordLungeStill: 1,
  swordLungeToward: 1.15,
  swordLungeSide: 0.5,
  swordLungeAway: -0.3,
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
  swordNearTime: 0.6,
  swordFarTime: 1.4,
  swordCloseLean: 28,
  swordCloseUpright: 68,
  swordCloseOut: 62,
  swordScrub: 0,
  // Keith 2026-11-01: every swing about 30% slower, for weight.
  swordPace: 1.3,
  swordFarArc: 1.1,
  swordCloseWithin: 7.5,
  swordFullFrom: 15,
  swordTwist: 24,
  swordTwistHz: 2.4,
  swordTwistDamp: 0.5,
  swordTwistMax: 40,
  swordShoulderOut: 0.35,
  // The block (Keith 2026-11-01: "if you are facing your enemy with ... a free unused sword ... you will block swings
  // against you ... you still take damage ... reduced"): a sword at rest (or recovering) whose arm faces the cutter
  // swings up across the front and takes the cut on its blade.
  swordBlock: 1,
  swordBlockArc: 140,
  swordBlockTake: 0.22,
  swordBlockTime: 0.55,
  swordBlockStall: 0.14,
  swordBlockKnock: 0.3,
  // The parry (Keith 2026-11-01: "if both a player and the enemy swing their sword at the same time, it causes the
  // attacks to parry"): a cut landing on a mech whose own sword is driving or cutting toward the cutter meets that blade.
  // After a cut the sword can't block until this share of its return or settle (Keith 2026-11-01: bait a swing, punish
  // it), so a swing leaves an opening.
  swordBlockAfter: 0.5,
  swordBlockCool: 1.0,
  // Close and far cuts trade (Keith 2026-11-01): a close cut hits for less, recovers sooner and parries over a wider
  // window round the middle of its cut; a full sweep hits harder, recovers longer and parries only right at mid-cut. Blended by the cut's reach.
  swordNearDamage: 0.7,
  swordFarDamage: 1.4,
  swordNearRecover: 0.8,
  swordFarRecover: 1.25,
  swordParryNear: 0.12,
  swordParryFar: 0.04,
  swordParryMax: 0.3,
  swordParryMiss: 1.0,
  swordParryHit: 0.5,
  swordParry: 1,
  swordParryTake: 0.1,
  swordParryRecoil: 0.5,
  swordParryStall: 0.06,
  swordParryFlash: 1,
};
export type SwordValues = typeof SWORD_DEFAULTS;

export const SWORD_GROUP = "Sword", SWORD_ARM_GROUP = "Sword arm", SWORD_BLOCK_GROUP = "Sword block";
const G = SWORD_GROUP, GA = SWORD_ARM_GROUP, GB = SWORD_BLOCK_GROUP;
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
  { key: "swordLungeStill", label: "Lunge standing still ×", min: 0, max: 1.5, step: 0.05, group: G, tip: "No WASD held: the lunge × this" },
  { key: "swordLungeToward", label: "Lunge walking into the cut ×", min: 0, max: 2, step: 0.05, group: G, tip: "Walking straight toward the aim: × this. In between the ways it blends smoothly" },
  { key: "swordLungeSide", label: "Lunge walking across the cut ×", min: 0, max: 1.5, step: 0.05, group: G, tip: "Walking square to the aim (strafing past): × this" },
  { key: "swordLungeAway", label: "Lunge backing off ×", min: -1, max: 1, step: 0.05, group: G, tip: "Walking straight away from the aim: × this. Below 0 the cut carries a small hop back instead; 0 no step at all" },
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
  { key: "swordCloseWithin", label: "Close cut within (m)", min: 2, max: 20, step: 0.5, group: GA, tip: "Aimed (the lock, else the cursor) this close: the short bent-elbow cut, the hand in near the chest" },
  { key: "swordFullFrom", label: "Full sweep from (m)", min: 3, max: 40, step: 0.5, group: GA, tip: "Aimed this far or farther: the full straight-arm sweep; in between the two blend" },
  { key: "swordNearTime", label: "Close cut: time ×", min: 0.3, max: 1.5, step: 0.01, group: GA, tip: "The close cut's drive, cut and follow-through take this × their time (quicker)" },
  { key: "swordFarTime", label: "Full sweep: time ×", min: 0.5, max: 2, step: 0.01, group: GA, tip: "The full sweep's: × their time (slower, heavier)" },
  { key: "swordCloseUpright", label: "Close cut: blade upright (°)", min: 0, max: 85, step: 1, group: GA, tip: "Close (Keith 2026-11-01, round 10): the blade comes down in front and is carried across standing up this steep (above level, before the droop), like a block, while the elbow leads it" },
  { key: "swordCloseLean", label: "Close cut: blade lean (°)", min: 0, max: 60, step: 1, group: GA, tip: "While it's carried across, the upright blade leans this far back toward where the cut came from" },
  { key: "swordPace", label: "Swing time ×", min: 0.5, max: 2.5, step: 0.01, group: GA, tip: "Every sword move (drive, cut, follow-through, return, settle) takes this × its time; above 1 slower and heavier" },
  { key: "swordScrub", label: "Scrub the swing (look)", min: 0, max: 2, step: 0.005, group: GA, tip: "Drag to hold the arm at a point of the swing and step through it: 0 off (the sword works as normal), 0 to 1 the first cut, 1 to 2 the back-cut, close or far by where you aim. No hits while scrubbing" },
  { key: "swordCloseOut", label: "Close cut: swings out to (°)", min: 0, max: 100, step: 1, group: GA, tip: "Only at the end, as the elbow and wrist straighten, the blade swings out level to this far past the aim on the far side" },
  { key: "swordFarArc", label: "Full sweep: arc ×", min: 0.8, max: 1.4, step: 0.01, group: GA, tip: "The full sweep swings round this × the arc" },
  { key: "swordTwist", label: "Waist turns with the cut (°)", min: 0, max: 60, step: 1, group: GA, tip: "The torso coils back a little in the drive, turns this far after the blade through the cut and follow-through, and back on the back-cut; 0 off. Drawn only: the guns on the hull turn back by as much, so nothing aims elsewhere" },
  { key: "swordTwistHz", label: "Waist spring (Hz)", min: 0.5, max: 8, step: 0.1, group: GA, tip: "How fast the waist follows the swing: low lags and swings on (heavy), high snaps" },
  { key: "swordTwistDamp", label: "Waist damping", min: 0.1, max: 1.5, step: 0.01, group: GA, tip: "Below 1 it overshoots and settles back (weight carrying on); 1 no overshoot" },
  { key: "swordTwistMax", label: "Waist twist at most (°)", min: 0, max: 90, step: 1, group: GA, tip: "Two swords swinging at once add up to this at most" },
  { key: "swordGuardUp", label: "At rest: hand higher (m)", min: -1, max: 1, step: 0.05, group: GA },
  { key: "swordBlock", label: "Auto block", min: 0, max: 1, step: 1, group: GB, tip: "1: a free sword (at rest or recovering, not mid-cut) facing an enemy's sword cut swings up and blocks it; 0 off" },
  { key: "swordBlockArc", label: "Blocks within (°)", min: 0, max: 360, step: 5, group: GB, tip: "The cutter must be inside this arc round where the sword arm faces (the torso's aim)" },
  { key: "swordBlockTake", label: "Damage taken through a block", min: 0, max: 1, step: 0.01, group: GB, tip: "Share of the cut's damage that still lands when it's blocked" },
  { key: "swordBlockTime", label: "Block lasts (s)", min: 0.2, max: 1.5, step: 0.01, group: GB, tip: "Up, held across the front, and back to rest; cuts landing while it's up are blocked too" },
  { key: "swordBlockStall", label: "Blocked blade stalls (s)", min: 0, max: 0.5, step: 0.01, group: GB, tip: "The cutter's blade stops on the block this long" },
  { key: "swordBlockAfter", label: "Can block again after (share of recovery)", min: 0, max: 1, step: 0.05, group: GB, tip: "After a cut, through this share of the return or settle the sword can't block: the opening a swing leaves for a punish. 0 blocks at once, 1 only back at rest" },
  { key: "swordBlockCool", label: "Block cooldown (s)", min: 0, max: 3, step: 0.05, group: GB, tip: "After a block goes up, the sword can't block again for this long (from its start): a quick second cut gets through" },
  { key: "swordNearDamage", label: "Close cut: damage ×", min: 0.2, max: 2, step: 0.05, group: GB, tip: "A close cut hits for this × the sword's damage; between close and far it blends" },
  { key: "swordFarDamage", label: "Full sweep: damage ×", min: 0.5, max: 3, step: 0.05, group: GB, tip: "A full sweep hits for this × the sword's damage" },
  { key: "swordNearRecover", label: "Close cut: recovery ×", min: 0.3, max: 2, step: 0.05, group: GB, tip: "The return or settle after a close cut takes this × its time" },
  { key: "swordFarRecover", label: "Full sweep: recovery ×", min: 0.5, max: 3, step: 0.05, group: GB, tip: "The return or settle after a full sweep takes this × its time (a longer opening)" },
  { key: "swordParryNear", label: "Close cut: parries within (s of mid-cut)", min: 0, max: 1, step: 0.01, group: GB, tip: "A close cut meets an incoming blade this long either side of the middle of its cut (× the sword's parry window): quick cuts parry easily" },
  { key: "swordParryFar", label: "Full sweep: parries within (s of mid-cut)", min: 0, max: 1, step: 0.01, group: GB, tip: "A full sweep only this close to the middle of its cut: big swings rarely parry" },
  { key: "swordParryMax", label: "Parry window at most (s)", min: 0.05, max: 1, step: 0.01, group: GB, tip: "The whole parry window, either side of mid-cut together, is never longer than this whatever the sword (human reaction is about 0.2-0.25 s)" },
  { key: "swordParryMiss", label: "Parry cooldown after a miss (s)", min: 0, max: 3, step: 0.05, group: GB, tip: "A swing whose parry window closes without meeting a blade can't parry again for this long: swinging nonstop doesn't parry everything" },
  { key: "swordParryHit", label: "Parry cooldown after a parry (s)", min: 0, max: 3, step: 0.05, group: GB, tip: "After a parry lands, the sword can't parry again for this long" },
  { key: "swordParry", label: "Parry", min: 0, max: 1, step: 1, group: GB, tip: "1: a cut landing while your own sword is driving or cutting toward the cutter meets your blade: both blades recoil; 0 off" },
  { key: "swordParryTake", label: "Damage taken through a parry", min: 0, max: 1, step: 0.01, group: GB, tip: "Share of the cut's damage that still lands when it's parried (0: none)" },
  { key: "swordParryRecoil", label: "Parry recoil (s)", min: 0.15, max: 1.5, step: 0.01, group: GB, tip: "Both blades are knocked up and back, and return to rest over this long" },
  { key: "swordParryStall", label: "Parry stall (s)", min: 0, max: 0.4, step: 0.01, group: GB, tip: "Both blades freeze at the clash this long before the recoil" },
  { key: "swordParryFlash", label: "Parry flash ×", min: 0, max: 3, step: 0.05, group: GB, tip: "Sparks, light and air bend at the clash" },
  { key: "swordBlockKnock", label: "Knock through a block ×", min: 0, max: 1, step: 0.05, group: GB, tip: "The cut's knock on a blocking mech, × this" },
];

export interface SwordStats { damage: number; ap: number; reach: number; arc: number; windup: number; slash: number; recover: number; cleave: number; parry?: number; heft?: number; /** Rest pose: 0 over the shoulder, 1 katana at the side, 2 buster across the shoulders, 3 short sword out low. */ stance?: number; /** Its base id: whose posed keys it swings with (src/weapons/swordPoses.ts). */ pose?: string }

/** K: knocked back off a parry (up and back, back to rest). P: the block (up across the front, held, back to rest). guard: at rest; A the first cut (outboard across to under the far shoulder); B the back-cut; R the return after A;
 *  S the settle after B. */
export type SwordClip = "guard" | "A" | "B" | "R" | "S" | "P" | "K";

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
interface Key { t: number; hand: V; fwd?: V; yaw?: number; pitch?: number; up: V; pole?: V; spine?: 1 | -1;
  /** Which posable key this is (src/weapons/swordPoses.ts), and a posed spine for a cut key (else from its yaw). */
  name?: string; upFix?: V }

// Hand places off the shoulder, left arm (the Rampart's shoulder sits 1.02 m out, 0.89 m over the waist; its torso
// spans ±1.2 m across, 1.27 m back to 1.37 m ahead, from 0.33 m under the waist to 2.3 m over it).
// Rest (Keith 2026-11-01, round 5): a right-angle triangle. The elbow low, pointing at the ground but forward; the
// forearm angled up to the fist, ahead of the shoulder at about its height; the blade on the wrist laid back over the
// shoulder toward the pack (near the triangle's long side), in line with the torso.
const GUARD: Key = { t: 0, hand: v3(0.15, -0.05, 2.0), fwd: v3(-0.06, 0.36, -0.93), up: v3(0.7, -0.6, 0.2), pole: v3(0.05, -1, 0.1) };
// Rest by sword, one entry per stance (0 shoulder, 1 Breaker, 2 buster, 3 short sword), with the return's last key
// before it (the blade brought round to where the rest picks it up). Keith 2026-11-01: back to the over-the-shoulder
// rest for every sword while the posing lab is built; each stance keeps its own entry so it can be posed apart again
// (the per-sword rests tried before are in git at 643c27b).
const PRE_REST_SHOULDER: Key = { t: 0.82, hand: v3(0.35, -0.2, 1.85), fwd: v3(0.1, 0.25, -0.96), up: v3(0.7, -0.6, 0.2), pole: v3(0.3, -1, 0.1) };
const copyKey = (k: Key): Key => ({ ...k, hand: { ...k.hand }, ...(k.fwd ? { fwd: { ...k.fwd } } : {}), up: { ...k.up }, ...(k.pole ? { pole: { ...k.pole } } : {}) });
export const STANCE_REST: Key[] = [GUARD, copyKey(GUARD), copyKey(GUARD), copyKey(GUARD)];
const PRE_REST: (Key | null)[] = [PRE_REST_SHOULDER, copyKey(PRE_REST_SHOULDER), copyKey(PRE_REST_SHOULDER), copyKey(PRE_REST_SHOULDER)];
const guardOf = (stance = 0): Key => STANCE_REST[Math.max(0, Math.min(3, Math.round(stance)))];
const DRIVE: Key = { t: 0, hand: v3(0.45, 0.95, 1.85), fwd: v3(0.85, 0.5, -0.2), up: v3(0.2, -0.3, 1), pole: v3(0.6, -0.6, 0.6) };
/** Where the elbow bends to in the cuts (left arm): out and down, a little back. */
const CUT_POLE = v3(0.9, -1, -0.5);
// The ends (Keith 2026-11-01, round 6: "more end extension poses"): A finishes low and under on the far side; B
// finishes with the arm up near straight, the blade pointing forward and a little into the sky.
const UNDER: Key = { t: 0, hand: v3(-1.95, -1.0, 1.6), fwd: v3(-0.76, -0.5, -0.45), up: v3(0.2, 0.2, -1) };
// The block (left arm): the hand up ahead of the chest, toward the middle, the blade standing up and leaning in across
// the front, its edge out toward the cut.
const BLOCK: Key = { t: 0, hand: v3(-0.2, 0.55, 1.8), fwd: v3(-0.45, 0.85, 0.25), up: v3(0, 0.1, -1), pole: v3(0.8, -1, -0.1) };
// Knocked back off a parry (left arm): the hand thrown up and in, the blade flung up and back past the shoulder.
const RECOIL: Key = { t: 0, hand: v3(0.55, 1.15, 1.35), fwd: v3(0.35, 0.88, -0.32), up: v3(0.2, -0.3, -1), pole: v3(0.8, -0.8, 0.2) };
const COCK: Key = { t: 0, hand: v3(0.56, 2.15, 1.68), fwd: v3(0.12, 0.55, 0.83), up: v3(-0.1, 0.9, -0.5) };

// The close cut (Keith 2026-11-01, round 10: "start with the elbow, bring it across, elbow extends and straightens, and
// the sword stays kind of close to perpendicular in front of the hull ... at the end of that, then swings out"): the
// blade comes down from the shoulder to stand up in front of the hull like a block (swordCloseUpright, leaning back
// swordCloseLean), and the elbow leads it across, out ahead of the hand, the blade carried rather than swung. Only in
// the last of the cut does the arm straighten and the wrist let the blade swing out level, swordCloseOut past the aim
// on the far side. The back-cut is the same the other way, rising: the elbow leads back across, then it swings out and
// up into the cock. Each key's hand, blade, elbow and timing blend from these (span 0) to the full sweep's (span 1). A
// yaw here is in degrees off the aim (+ outboard); `at` the key's share through the cut; pole where the elbow points.
type Near = { hand: V; fwd?: V; yaw?: number; pitch?: number; at?: number; pole?: V; up?: V };
const NEAR_DRIVE: Near = { hand: v3(0.45, 0.85, 1.05), pole: v3(1, 0.1, 0.4) };
// How each sword enters its cut, by stance: null takes the shared drive (DRIVE, NEAR_DRIVE). Keith 2026-11-01: every
// sword back on the shared one for now (the buster's high heave and the short sword's low snap are in git at 643c27b).
const DRIVE_BY: (Key | null)[] = [null, null, null, null];
const NEAR_DRIVE_BY: (Near | null)[] = [null, null, null, null];
const nearA = (v: SwordValues): [Near, Near, Near] => [
  { hand: v3(0.6, 0.45, 1.45), yaw: v.swordCloseLean, pitch: v.swordCloseUpright, pole: v3(-0.7, -0.5, 0.6) },
  { hand: v3(-0.35, 0.1, 1.7), yaw: v.swordCloseLean * 0.55, pitch: v.swordCloseUpright - 6, at: 0.66, pole: v3(-1, -0.45, 0.35) },
  { hand: v3(-1.5, -0.3, 1.65), yaw: -v.swordCloseOut, pitch: 4, pole: v3(0.2, -1, -0.2) },
];
const nearB = (v: SwordValues): [Near, Near, Near] => [
  { hand: v3(-1.2, -0.2, 1.55), yaw: -v.swordCloseLean, pitch: v.swordCloseUpright, pole: v3(0.9, -0.5, 0.5) },
  { hand: v3(0.15, 0.25, 1.75), yaw: -v.swordCloseLean * 0.55, pitch: v.swordCloseUpright - 4, at: 0.66, pole: v3(1, -0.45, 0.35) },
  { hand: v3(0.85, 0.75, 1.6), yaw: v.swordCloseOut * 0.85, pitch: 22, pole: v3(0.6, -1, 0) },
];
const NEAR_UNDER: Near = { hand: v3(-1.4, -0.6, 1.5), fwd: v3(-0.85, -0.3, 0.42) };
const NEAR_COCK: Near = { hand: v3(0.55, 1.2, 1.45), fwd: v3(0.25, 0.45, 0.86) };

/** Clip keys at shares of its length, its cut window (shares) when it has one, and its arc (°). span: 0 the close
 *  cut .. 1 the full sweep. */
function clipKeys(c: SwordClip, st: SwordStats, v: SwordValues, span = 1): { len: number; keys: Key[]; cut: [number, number] | null; arc: number } {
  const k = Math.max(0, Math.min(1, span)), mix = (a: number, b: number) => a + (b - a) * k;
  const tk = mix(v.swordNearTime, v.swordFarTime) * v.swordPace, w = st.windup * tk, s = st.slash * tk, f = v.swordFollow * tk * Math.max(0.4, Math.min(2.5, st.windup / Math.max(0.01, v.swordWindup)));
  const arc = st.arc * v.swordFarArc;
  // A key between its close and full forms. A cut key's yaw (half-arcs in the full form) comes out in degrees.
  const at = (key: Key, n: Near, t: number): Key => {
    const out: Key = {
      ...key, t, hand: lerpV(n.hand, key.hand, k), fwd: key.fwd && n.fwd ? norm(lerpV(n.fwd, key.fwd, k)) : key.fwd,
      yaw: key.yaw === undefined ? undefined : mix(n.yaw ?? key.yaw * (arc / 2), key.yaw * (arc / 2)),
      pitch: key.pitch === undefined ? undefined : mix(n.pitch ?? key.pitch, key.pitch),
      pole: n.pole ? norm(lerpV(n.pole, key.pole ?? CUT_POLE, k)) : key.pole,
    };
    // A posed spine (the pose lab): blended between the two forms, the unposed one's spine as the code makes it.
    if (key.yaw !== undefined) {
      if (key.upFix || n.up) {
        const far = key.upFix ?? keyAxes({ ...key, yaw: key.yaw * (arc / 2) }, v).up;
        const near = n.up ?? keyAxes({ ...key, upFix: undefined, yaw: n.yaw ?? key.yaw * (arc / 2), pitch: n.pitch ?? key.pitch }, v).up;
        out.upFix = norm(lerpV(near, far, k));
      }
    } else if (n.up) out.up = norm(lerpV(n.up, key.up, k));
    return out;
  };
  // A cut key's share through the cut, close to full.
  const thru = (n: Near, full: number) => mix(n.at ?? full, full);
  // Posed keys (the pose lab, src/weapons/swordPoses.ts): a key's far (or only) form, and a cut key's close form.
  const P = posesFor(st.pose);
  const vec = (q?: P3): V | undefined => (q ? v3(q[0], q[1], q[2]) : undefined);
  // A posed blade's way as a cut key's yaw across the aim and pitch (°, before the droop), so the cut still turns.
  const yawPitch = (f: V) => { const q = norm(f); return { yaw: Math.atan2(q.x, q.z) / D2R, pitch: Math.asin(Math.max(-1, Math.min(1, q.y))) / D2R + v.swordDroop }; };
  const ovK = (name: string, key: Key): Key => {
    const o = P[name], out: Key = { ...key, name };
    if (!o) return out;
    if (o.hand) out.hand = vec(o.hand)!;
    if (o.pole) out.pole = vec(o.pole);
    if (key.yaw !== undefined) {
      if (o.fwd) { const yp = yawPitch(vec(o.fwd)!); out.yaw = yp.yaw / Math.max(1e-3, arc / 2); out.pitch = yp.pitch; }
      if (o.up) out.upFix = vec(o.up);
    } else {
      if (o.fwd) out.fwd = vec(o.fwd);
      if (o.up) out.up = vec(o.up)!;
    }
    return out;
  };
  const ovN = (name: string, n: Near, cutKey: boolean): Near => {
    const o = P[`${name}:close`];
    if (!o) return n;
    const out: Near = { ...n };
    if (o.hand) out.hand = vec(o.hand)!;
    if (o.pole) out.pole = vec(o.pole);
    if (o.up) out.up = vec(o.up);
    if (o.fwd) { if (cutKey) { const yp = yawPitch(vec(o.fwd)!); out.yaw = yp.yaw; out.pitch = yp.pitch; } else out.fwd = vec(o.fwd); }
    return out;
  };
  /** A cut key, posed in both forms. */
  const cutAt = (name: string, key: Key, n: Near, t: (n: Near) => number) => { const nn = ovN(name, n, true); return at(ovK(name, key), nn, t(nn)); };
  const NA = nearA(v), NB = nearB(v);
  const under = at(ovK("under", UNDER), ovN("under", NEAR_UNDER, false), 0), cock = at(ovK("cock", COCK), ovN("cock", NEAR_COCK, false), 0);
  const si = Math.max(0, Math.min(3, Math.round(st.stance ?? 0)));
  const G0 = ovK("rest", guardOf(st.stance)), g = { ...G0, hand: { ...G0.hand, y: G0.hand.y + v.swordGuardUp } };
  switch (c) {
    case "guard": return { arc, len: 1, keys: [{ ...g, t: 0 }, { ...g, t: 1 }], cut: null };
    case "A": {
      const len = w + s + f;
      return {
        arc, len, cut: [w / len, (w + s) / len], keys: [
          { ...g, t: 0 },
          at(ovK("drive", DRIVE_BY[si] ?? DRIVE), ovN("drive", NEAR_DRIVE_BY[si] ?? NEAR_DRIVE, false), (w * 0.7) / len),
          // The cut: the arm near straight (the blade at its fullest reach), the hand dipping low across the front and
          // on under the body to the far side, the blade from out along its own side to across the far one, its edge
          // leading (the spine faces back the way it came). Close: all of it in near the chest.
          cutAt("aStart", { t: 0, hand: v3(1.37, 0.37, 2.48), yaw: 1, pitch: 4, up: v3(1, 0, -0.4), spine: 1 }, NA[0], () => w / len),
          cutAt("aMid", { t: 0, hand: v3(-0.3, -0.56, 2.79), yaw: 0, pitch: -4, up: v3(1, 0, -0.4), spine: 1 }, NA[1], (n) => (w + s * thru(n, 0.5)) / len),
          cutAt("aEnd", { t: 0, hand: v3(-1.95, -1.08, 1.79), yaw: -1, pitch: -6, up: v3(1, 0.2, 0.4), spine: 1 }, NA[2], () => (w + s) / len),
          { ...under, t: 1 },
        ],
      };
    }
    case "B": {
      const r = w * 0.45, len = r + s + f * 0.8;
      return {
        arc, len, cut: [r / len, (r + s) / len], keys: [
          { ...under, t: 0 },
          // Rising back across at full reach, on up into the high extension.
          cutAt("bStart", { t: 0, hand: v3(-1.92, -0.97, 1.78), yaw: -1, pitch: -4, up: v3(-1, 0, -0.4), spine: -1 }, NB[0], () => r / len),
          cutAt("bMid", { t: 0, hand: v3(-0.36, 0.21, 2.83), yaw: 0, pitch: 6, up: v3(-1, 0, -0.4), spine: -1 }, NB[1], (n) => (r + s * thru(n, 0.5)) / len),
          cutAt("bEnd", { t: 0, hand: v3(1.22, 1.32, 2.13), yaw: 1, pitch: 18, up: v3(-1, 0.2, 0.4), spine: -1 }, NB[2], () => (r + s) / len),
          { ...cock, t: 1 },
        ],
      };
    }
    case "R": {
      // The return's last key before rest (a stance without one gets it only when it's posed: from the rest itself).
      const preRest = (): Key[] => { const b = PRE_REST[si]; return b || P.preRest ? [{ ...ovK("preRest", b ?? { ...G0, t: 0.82 }), t: 0.82 }] : []; };
      // The elbow drops and the wrist and forearm swing the blade round past the waist (point down ahead, then back
      // along its own hip), and up to the shoulder.
      const len = st.recover * 1.6 * v.swordPace * mix(v.swordNearRecover, v.swordFarRecover);
      return {
        arc, len, cut: null, keys: [
          { ...under, t: 0 },
          { t: 0.28, hand: v3(-1.0, -0.9, 2.0), fwd: v3(-0.2, -0.85, 0.5), up: v3(0, 0.4, 1) },
          { t: 0.58, hand: v3(0.55, -0.85, 1.45), fwd: v3(0.45, -0.55, -0.7), up: v3(0.3, 0.6, -0.5) },
          ...preRest(),
          { ...g, t: 1 },
        ],
      };
    }
    case "K": {
      const len = v.swordParryRecoil;
      const rc = ovK("recoil", RECOIL);
      return { arc, len, cut: null, keys: [{ ...rc, t: 0 }, { ...rc, name: undefined, hand: { ...rc.hand, y: rc.hand.y + 0.1 }, t: 0.25 }, { ...g, t: 1 }] };
    }
    case "P": {
      const len = v.swordBlockTime, blk = ovK("block", BLOCK);
      return { arc, len, cut: null, keys: [{ ...g, t: 0 }, { t: 0.13, hand: v3(0.35, 0.35, 1.95), fwd: v3(0.35, 0.93, 0.1), up: v3(0, 0, -1), pole: v3(0.6, -1, 0) }, { ...blk, t: 0.28 }, { ...blk, name: undefined, hand: { ...blk.hand, z: blk.hand.z - 0.1 }, t: 0.62 }, { t: 0.8, hand: v3(0.35, 0.3, 1.9), fwd: v3(0.4, 0.9, -0.15), up: v3(0, 0, -1), pole: v3(0.5, -1, 0.05) }, { ...g, t: 1 }] };
    }
    case "S": {
      const len = st.recover * v.swordPace * mix(v.swordNearRecover, v.swordFarRecover);
      return { arc, len, cut: null, keys: [{ ...cock, t: 0 }, { ...g, t: 1 }] };
    }
  }
}

/**
 * The lunge's share from the legs (Keith 2026-11-01, round 9): move the WASD way (world, length 0..1 or more), ax, az
 * the aim's way (unit). Still: swordLungeStill. Moving, by the dot c of the two ways: c = 1 swordLungeToward, 0
 * swordLungeSide, −1 swordLungeAway (linear toward, on c² away, so a side click while backing off keeps a step
 * and only backing near straight off gets the hop back), blended in by how hard the legs are pushed. Below 0: step back.
 */
export function lungeIntent(move: { x: number; z: number } | undefined, ax: number, az: number, v: SwordValues): number {
  const m = move ? Math.min(1, Math.hypot(move.x, move.z)) : 0;
  if (m < 1e-3) return v.swordLungeStill;
  const l = Math.hypot(move!.x, move!.z), c = (move!.x * ax + move!.z * az) / l;
  const f = c >= 0 ? v.swordLungeSide + (v.swordLungeToward - v.swordLungeSide) * c : v.swordLungeSide + (v.swordLungeAway - v.swordLungeSide) * c * c;
  return v.swordLungeStill + (f - v.swordLungeStill) * m;
}

/** A cut's damage at its reach (span: 0 close .. 1 far): close cuts lighter, full sweeps heavier. */
export function cutDamage(st: SwordStats, v: SwordValues, span: number) {
  const k = Math.max(0, Math.min(1, span));
  return st.damage * (v.swordNearDamage + (v.swordFarDamage - v.swordNearDamage) * k);
}

/** A clip's length (s) at a reach (span: 0 close .. 1 far). */
export function clipLength(c: SwordClip, st: SwordStats, v: SwordValues, span = 1) { return clipKeys(c, st, v, span).len; }
/** A clip's cut window (s) at a reach, or null. */
export function clipCut(c: SwordClip, st: SwordStats, v: SwordValues, span = 1): [number, number] | null {
  const k = clipKeys(c, st, v, span);
  return k.cut ? [k.cut[0] * k.len, k.cut[1] * k.len] : null;
}

/**
 * When a posable key (src/weapons/swordPoses.ts) is reached in its clip (s), at a reach (span); null if the clip has
 * no such key. The keys sit in the eased time (moveWarp), so this finds the real time that eases to the key.
 */
export function keyTime(c: SwordClip, name: string, st: SwordStats, v: SwordValues, span = 1): number | null {
  const { len, keys, cut } = clipKeys(c, st, v, span);
  const key = keys.find((q) => q.name === name);
  if (!key) return null;
  if (c === "guard") return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (moveWarp(m, cut, v.swordEaseIn, v.swordEaseOut, v.swordSnap) < key.t) lo = m; else hi = m; }
  return ((lo + hi) / 2) * len;
}

/** A key's blade axes (left arm): a vector, or a yaw across the aim with a pitch under the droop. */
function keyAxes(k: Key, v: SwordValues): { fwd: V; up: V } {
  let fwd: V;
  if (k.fwd) fwd = norm(k.fwd);
  else {
    const yaw = (k.yaw ?? 0) * D2R, p = ((k.pitch ?? 0) - v.swordDroop) * D2R;
    fwd = v3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
  }
  if (k.upFix) return { fwd, up: square(fwd, norm(k.upFix)) };
  // A cut key's spine faces back the way the blade came (+1: it travels toward −yaw, the first cut; −1 the back-cut),
  // square to the blade in the ground plane, so the edge leads however wide the arc (with the hint's lift on top).
  if (k.yaw !== undefined && k.spine) {
    const yaw = k.yaw * D2R;
    return { fwd, up: square(fwd, norm(v3(k.spine * Math.cos(yaw), k.up.y, -k.spine * Math.sin(yaw)))) };
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
  const { len, keys, cut } = clipKeys(c, st, v, span);
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
  const A = keyAxes(a, v), B = keyAxes(b, v);
  // Inside the cut the yaw is turned (not blended straight), so a wide arc stays a sweep.
  let fwd: V;
  if (a.yaw !== undefined && b.yaw !== undefined) fwd = keyAxes({ ...a, yaw: a.yaw + (b.yaw - a.yaw) * k, pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * k }, v).fwd;
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
  if (c === "guard" || c === "P" || c === "K") return 0;
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

  /** Free to block: at rest or recovering, not in a cut (Keith 2026-11-01). */
  get free() { return this.clip === "guard" || ((this.clip === "R" || this.clip === "S") && this.t >= this.lenNow * this.blockAfter); }
  private lenNow = 1;
  private blockAfter = 0;
  /** Up in a block now (cuts landing are blocked). */
  get blocking() { return this.clip === "P" && this.t < 0.75 * this.blockLen; }
  private blockLen = 0.55;
  /** Swing up to block (when free), or keep the block that's up. True when it blocks. */
  block(v: SwordValues): boolean {
    if (this.blocking) return true;
    if (!this.free || this.blockCool > 0) return false;
    this.blockCool = v.swordBlockCool;
    this.blockLen = v.swordBlockTime; this.queued = false; this.lungeK = 0; this.cutting = false;
    this.go("P", 0);
    return true;
  }

  /** Swinging at something now (driving in or cutting): a cut landing meets this blade (the parry). */
  get swinging() { return this.parryOpen; }
  private parryOpen = false;
  /** Seconds before it may block again, and parry again (Keith 2026-11-01: not every cut parried or blocked). */
  blockCool = 0;
  parryCool = 0;
  /** This sword parried a cut: knocked back like the cutter, and its parry cools for `swordParryHit`. */
  parried(v: SwordValues) { this.recoil(v); this.parryCool = v.swordParryHit; }
  /** Knocked back off a parry: the cut is over, the blade flung up and back, then to rest. */
  recoil(v: SwordValues) {
    this.parryOpen = false; this.queued = false; this.lungeK = 0; this.cutting = false;
    this.go("K", 0);
    this.hitch = Math.max(this.hitch, v.swordParryStall);
  }

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
    this.blockCool = Math.max(0, this.blockCool - dt);
    this.parryCool = Math.max(0, this.parryCool - dt);
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
    } else if ((this.clip === "R" || this.clip === "S" || this.clip === "P" || (this.clip === "K" && this.t > v.swordParryRecoil * 0.5)) && want) { this.queued = false; this.go("A", 0); }
    const t0 = this.t;
    this.t += dt;
    const L = this.length(st, v), w = this.cutWindow(st, v);
    // The parry window: around the cut, wider for a close cut and a light sword (st.parry), never longer than
    // swordParryMax in all; a window that closes without a parry cools the parry for swordParryMiss.
    const wasOpen = this.parryOpen;
    if ((this.clip === "A" || this.clip === "B") && w && this.parryCool <= 0) {
      const k = this.span, pk = st.parry ?? 1;
      const half = Math.min(v.swordParryMax / 2, (v.swordParryNear + (v.swordParryFar - v.swordParryNear) * k) * pk);
      this.parryOpen = Math.abs(this.t - (w[0] + w[1]) / 2) <= half;
    } else this.parryOpen = false;
    if (wasOpen && !this.parryOpen) this.parryCool = Math.max(this.parryCool, v.swordParryMiss);
    this.lenNow = L; this.blockAfter = v.swordBlockAfter;
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
      else if (this.clip === "R" || this.clip === "S" || this.clip === "P" || this.clip === "K") this.go("guard", 0);
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
