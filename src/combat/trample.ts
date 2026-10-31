// Trample and ram, the rules (pure, no drawing; Keith 2026-10-31): the mech's body hurts what it runs into.
// - Small things (bandits on foot, scrappers) are trampled: contact damage by the closing speed (a walk nudges and
//   knocks down, the Shift run hurts, the dash and the sprint kill), and a fling along the mech's way.
// - Vehicles (and anything else heavy) are rammed: both shoved by the two masses, both hurt about equally by the
//   closing speed (Keith 2026-10-31: "BOTH the mech and the vehicle take damage, roughly equal").
// The legs set the reach and the bite (leg stats `trample` and `crush`, src/items/bases.ts; Keith 2026-10-31: "the
// size of the mech / the legs sets the trample radius"); the sliders here are the base they scale.
// Ownership: host (damage, shoves). Callers turn the results into hit events through the targets' damage().
import type { Param } from "../core/tweaks";

export const TRAMPLE_DEFAULTS = {
  /** Base reach of the mech's body from its centre (m), × the legs' `trample`. */
  trampleReach: 3,
  /** Closing speed (m/s) below which a body only nudges (the swarm's own keep-clear pushes them aside). */
  trampleDown: 2.5,
  /** Closing speed where damage starts, and where it reaches trampleDamage. */
  trampleFrom: 3,
  trampleFull: 11,
  trampleDamage: 15,
  trampleCurve: 2,
  /** Fling (m/s per m/s of closing speed) and a minimum. */
  trampleThrow: 0.7,
  trampleThrowMin: 2.5,
  /** A charge (the mech this fast on a line) is a threat the swarm can see coming (its dive rolls). */
  chargeSpeed: 9,
  chargeLook: 1.2,
  /** Rams: the mech's mass and each vehicle kind's (t), bounce, damage per m/s of closing speed past the floor. */
  ramMechMass: 40,
  ramBounce: 0.2,
  ramFrom: 2,
  ramDamage: 15,
  ramMechShare: 1,
};
export type TrampleValues = typeof TRAMPLE_DEFAULTS;

const G = "Trample";
export const TRAMPLE_PARAMS: Param[] = [
  { key: "trampleReach", label: "Body reach (m, × legs)", min: 0.5, max: 8, step: 0.05, group: G, tip: "From the mech's centre; the legs' Trample stat scales it (Stilt small, Rampart 1, Siege big)" },
  { key: "trampleDown", label: "Knocks down from (m/s)", min: 0, max: 10, step: 0.1, group: G, tip: "Closing speed under this only nudges" },
  { key: "trampleFrom", label: "Hurts from (m/s)", min: 0, max: 15, step: 0.1, group: G },
  { key: "trampleFull", label: "Full damage at (m/s)", min: 1, max: 30, step: 0.1, group: G, tip: "Walk 6, run 8.5, dash and sprint 11+" },
  { key: "trampleDamage", label: "Damage at full", min: 0, max: 100, step: 0.5, group: G, tip: "× the legs' Crush stat; a bandit has 12, a scrapper about 30. Keeps rising past full speed (to 3×)" },
  { key: "trampleCurve", label: "Damage curve (power)", min: 0.5, max: 4, step: 0.05, group: G, tip: "Above 1: a walk barely hurts, a sprint kills" },
  { key: "trampleThrow", label: "Fling (× closing speed)", min: 0, max: 2, step: 0.05, group: G },
  { key: "trampleThrowMin", label: "Fling at least (m/s)", min: 0, max: 10, step: 0.1, group: G },
  { key: "chargeSpeed", label: "A charge from (m/s)", min: 3, max: 25, step: 0.5, group: G, tip: "This fast, bandits ahead see it coming (and may dive out: Bandits: dodge)" },
  { key: "chargeLook", label: "Charge seen ahead (s)", min: 0.2, max: 3, step: 0.05, group: G, tip: "How far ahead (in seconds at its speed) the charge's line reaches" },
  { key: "ramMechMass", label: "Ram: mech mass (t)", min: 5, max: 120, step: 1, group: G },
  { key: "ramBounce", label: "Ram: bounce (0-1)", min: 0, max: 1, step: 0.01, group: G },
  { key: "ramFrom", label: "Ram: hurts from (m/s)", min: 0, max: 10, step: 0.1, group: G },
  { key: "ramDamage", label: "Ram: damage per m/s", min: 0, max: 400, step: 5, group: G, tip: "To both, past the floor (a sprint into a truck at 14 m/s: 180 each; a technical has 140, a gun truck 380, the mech 3000)" },
  { key: "ramMechShare", label: "Ram: mech's share (×)", min: 0, max: 2, step: 0.05, group: G, tip: "1: both take the same" },
];

/** Vehicle masses (t) by car kind, for rams. */
export const VEHICLE_MASS: Record<string, number> = {
  technical: 3, gunTruck: 6, sixWheeler: 10, warRig: 22, tank: 30, turretTruck: 18, partyBus: 14,
};

/** Damage from a closing speed (m/s), × the legs' crush. */
export function trampleHurt(closing: number, v: TrampleValues, crush = 1): number {
  if (closing <= v.trampleFrom) return 0;
  const k = Math.min(3, (closing - v.trampleFrom) / Math.max(0.1, v.trampleFull - v.trampleFrom));
  return v.trampleDamage * crush * Math.pow(k, v.trampleCurve);
}

/** How hard a trampled body is flung (m/s). */
export const trampleFling = (closing: number, v: TrampleValues) => Math.max(v.trampleThrowMin, closing * v.trampleThrow);

/** The mech's body as the trample sees it: centre, velocity over the ground, reach and bite. */
export interface MechBody { x: number; z: number; vx: number; vz: number; reach: number; crush: number }

/** One trample or ram hit, plain data (rule 12): who (kind + stable id), how hard, where, whether it died. */
export interface TrampleHit { kind: "bandit" | "robot" | "vehicle"; id: number | string; damage: number; closing: number; killed: boolean; x: number; z: number }

/**
 * Closing speed of the mech on a thing at (px, pz) moving (ovx, ovz): the part of their relative velocity along the
 * line from the mech to it (0 when moving apart; it gates contact), and the whole relative speed (rel: what hurts, so a
 * glancing sprint still kills).
 */
export function closingSpeed(b: MechBody, px: number, pz: number, ovx: number, ovz: number): { closing: number; rel: number; nx: number; nz: number; d: number } {
  const dx = px - b.x, dz = pz - b.z, d = Math.hypot(dx, dz);
  const sp = Math.hypot(b.vx, b.vz);
  const nx = d > 1e-5 ? dx / d : sp > 1e-5 ? b.vx / sp : 1, nz = d > 1e-5 ? dz / d : sp > 1e-5 ? b.vz / sp : 0;
  const closing = Math.max(0, (b.vx - ovx) * nx + (b.vz - ovz) * nz);
  return { closing, rel: closing > 0 ? Math.hypot(b.vx - ovx, b.vz - ovz) : 0, nx, nz, d };
}

/**
 * A ram between the mech (mass mm) and a body (mass mo) closing at `closing` along n: the velocity change each
 * takes (inelastic with a bounce) and the damage each takes.
 */
export function ram(closing: number, mo: number, v: TrampleValues): { dvMech: number; dvOther: number; damage: number; mechDamage: number } {
  const mm = v.ramMechMass, j = (1 + v.ramBounce) * closing;
  const dvOther = j * mm / (mm + mo), dvMech = j * mo / (mm + mo);
  const damage = Math.max(0, closing - v.ramFrom) * v.ramDamage;
  return { dvMech, dvOther, damage, mechDamage: damage * v.ramMechShare };
}

/** A threat on the ground the swarm can dive out of (the shape of rivalAi's Threat, kept here so infantry needs no duel code). */
export interface GroundThreat {
  id: number;
  kind: "ring" | "line";
  /** Ring centre, or the line's far end. */
  x: number; z: number;
  /** Line start. */
  ax?: number; az?: number;
  /** Ring radius, or the line's half width. */
  r: number;
  /** Seconds until it lands. */
  t: number;
}

/** The charging mech as a line threat (null when it isn't charging). id: bumps each new charge. */
export function chargeThreat(b: MechBody, id: number, v: TrampleValues): GroundThreat | null {
  const sp = Math.hypot(b.vx, b.vz);
  if (sp < v.chargeSpeed) return null;
  const L = sp * v.chargeLook;
  return { id, kind: "line", ax: b.x, az: b.z, x: b.x + (b.vx / sp) * L, z: b.z + (b.vz / sp) * L, r: b.reach, t: 0 };
}

/** Seeded 0..1 from a bandit's id and a threat's id (a decision per bandit per threat, the same every time it's asked). */
export function pairChance(seed: number, uid: number, threat: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(uid, 0xc2b2ae35) ^ Math.imul(threat + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Where (px, pz) stands against a threat: inside or not, how far to its nearest edge (m) and the flat way out.
 * Lines: out sideways from the axis (the side it stands on); rings: out from the centre.
 */
export function threatOut(t: GroundThreat, px: number, pz: number, margin: number): { inside: boolean; edge: number; ox: number; oz: number } {
  if (t.kind === "ring") {
    const dx = px - t.x, dz = pz - t.z, d = Math.hypot(dx, dz), R = t.r + margin;
    return { inside: d < R, edge: R - d, ox: d > 1e-4 ? dx / d : 1, oz: d > 1e-4 ? dz / d : 0 };
  }
  const ax = t.ax ?? t.x, az = t.az ?? t.z, lx = t.x - ax, lz = t.z - az, L = Math.hypot(lx, lz) || 1e-6;
  const ux = lx / L, uz = lz / L;
  const rx = px - ax, rz = pz - az, along = rx * ux + rz * uz;
  if (along < -margin || along > L + margin) return { inside: false, edge: 0, ox: 0, oz: 0 };
  const side = rx * uz - rz * ux; // + : right of the line (looking along it)
  const R = t.r + margin, s = side >= 0 ? 1 : -1;
  return { inside: Math.abs(side) < R, edge: R - Math.abs(side), ox: uz * s, oz: -ux * s };
}
