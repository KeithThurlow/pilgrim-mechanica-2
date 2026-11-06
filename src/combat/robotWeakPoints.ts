// Weak points on the big walkers (Keith 2026-11-06: "make it so that the legs of the quad walkers were individually
// targetable, but also you can target the reactor at the top as well").
// - Legs: each of a big walker's four legs has its own health (robotBigLegHp × the walker's). Hits on a leg (its thigh,
//   shin or foot; blasts at its feet too) wear it down as well as counting their usual share against the body. A leg
//   shot through breaks below the knee: the walker loses robotBigLegLossHurt of its health, limps on slower
//   (robotBigLegSlow per leg gone) and leans toward the stump; with robotBigLegsToFall gone it falls, a kill, and its
//   reactor goes up as it tips (src/combat/reactorFall.ts).
// - Reactor: a glowing orb on a mast on top of the thorax, proud of the disc so a round aimed at the body's centre never
//   grazes it. A round through it counts robotBigCoreDamage times through a share of the armour, ahead of the body
//   behind it; a kill through it breaches the reactor: it goes up robotBigCoreBreach seconds later, still standing,
//   so the blast is an airburst at full height.
// Pure maths and values; the state (legHp, legLost, breach) lives in RobotSwarm, host-owned (rule 12).
import type { Param } from "../core/tweaks";

/** The reactor orb's centre above the hub and its drawn radius (× size). */
export const BIG_CORE_Y = 0.36, BIG_CORE_R = 0.1;

export const WEAK_DEFAULTS = {
  robotBigLegHp: 0.22,
  robotBigLegLossHurt: 0.08,
  robotBigLegSlow: 0.55,
  robotBigLegsToFall: 2,
  robotBigLegTilt: 7,
  robotBigLegBlast: 1,
  robotBigCoreHit: 0.75,
  robotBigCoreDamage: 2.5,
  robotBigCoreArmour: 0.35,
  robotBigCoreBreach: 0.35,
  robotBigCoreGlow: 1,
};
export type WeakValues = typeof WEAK_DEFAULTS;

export const WEAK_GROUP = "Robots: big weak points";
const G = WEAK_GROUP;
export const WEAK_PARAMS: Param[] = [
  { key: "robotBigLegHp", label: "Each leg's health (share)", min: 0.02, max: 1, step: 0.01, group: G, tip: "Keith 2026-11-06: each of a big walker's legs has this share of its health; hits on a leg (and blasts at its feet) wear it down as well as counting their share against the body" },
  { key: "robotBigLegLossHurt", label: "A lost leg hurts it (share)", min: 0, max: 0.5, step: 0.01, group: G, tip: "Of its full health, when a leg breaks" },
  { key: "robotBigLegSlow", label: "Speed per lost leg (×)", min: 0.1, max: 1, step: 0.01, group: G, tip: "It limps on: one leg gone walks at this, two at this squared" },
  { key: "robotBigLegsToFall", label: "Falls with legs gone", min: 0, max: 4, step: 1, group: G, tip: "That many legs shot through and it falls (a kill: its reactor goes up as it tips). 0: never" },
  { key: "robotBigLegTilt", label: "Lean per lost leg (°)", min: 0, max: 25, step: 0.5, group: G, tip: "The body leans toward the stump (looks)" },
  { key: "robotBigLegBlast", label: "Blasts hurt legs (×)", min: 0, max: 3, step: 0.05, group: G, tip: "An explosive's damage to each leg in its reach (full at the leg, half at the edge)" },
  { key: "robotBigCoreHit", label: "Reactor hit radius (m)", min: 0, max: 2, step: 0.05, group: G, tip: "The glowing orb on top of the thorax; 0: not a target" },
  { key: "robotBigCoreDamage", label: "Reactor hits count (×)", min: 0, max: 8, step: 0.05, group: G },
  { key: "robotBigCoreArmour", label: "Reactor armour (× the body's)", min: 0, max: 1, step: 0.01, group: G },
  { key: "robotBigCoreBreach", label: "Breached reactor goes up after (s)", min: 0, max: 3, step: 0.05, group: G, tip: "A kill through the reactor: it goes up this soon, still standing (an airburst at full height), not as it tips" },
  { key: "robotBigCoreGlow", label: "Reactor glow (×)", min: 0, max: 3, step: 0.05, group: G, tip: "The orb's light; it flickers as the walker's health runs down" },
];

/** How many legs a lost-leg mask has gone. */
export const legsLost = (mask: number) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);

/** A big walker's speed share with these legs gone. */
export const crippleK = (mask: number, v: WeakValues) => (mask ? Math.pow(Math.max(0, Math.min(1, v.robotBigLegSlow)), legsLost(mask)) : 1);

/** Distance along a unit ray to a sphere (centre c, radius r), -1 for a miss (or behind). */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const qx = ox - cx, qy = oy - cy, qz = oz - cz;
  const b = qx * dx + qy * dy + qz * dz, c = qx * qx + qy * qy + qz * qz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return Math.max(0, -b - Math.sqrt(disc));
}

/**
 * The flat way a walker with these legs gone leans and falls (unit x, z; 0, 0 with none): toward the stumps. angles:
 * its legs' angles off its heading.
 */
export function stumpWay(mask: number, heading: number, angles: readonly number[], out: { x: number; z: number }) {
  let x = 0, z = 0;
  for (let g = 0; g < angles.length; g++) if (mask & (1 << g)) { x += Math.sin(heading + angles[g]); z += Math.cos(heading + angles[g]); }
  const l = Math.hypot(x, z);
  out.x = l > 1e-6 ? x / l : 0; out.z = l > 1e-6 ? z / l : 0;
  return out;
}
