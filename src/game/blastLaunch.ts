// Blast launch (Keith 2026-11-16: "explosions ... not making humanoids fly, robots fly. Not in the way that I'd like").
// An explosive's blast throws what it catches away from its centre and up: a kill flies as a ragdoll, a light unit that
// lives is knocked flat (bandits, droids: slid along the sand; scrappers: flung through the air), and the blast counts
// extra toward a stagger (src/game/poise.ts), shoved the blast's way. How hard: blastFling (out) and blastUp (up) at the
// centre for a light unit, falling to blastEdge × at the edge, × the unit's weight (heavier kinds fly less), × the
// blast's size (a 4 m blast is ×1, a small one less, a big one more, square root, clamped).
// Pure: numbers only. The swarms' splash (RobotTarget, InfantryTarget) works out the kick and hands it to the swarm's
// blastHit, which the sim worker's views forward like damage. Ownership: host (the throw is part of damage); the ragdoll
// it becomes is cosmetic (its extra tumble, blastTumble, is a Death physics value: src/physics/deaths.ts). Randomness: none here (the swarms' kills add their own seeded scatter).
import type { Param } from "../core/tweaks";

export const BLAST_LAUNCH_DEFAULTS = {
  blastLaunchOn: 1,
  /** Outward throw at the centre for a light unit (m/s). */
  blastFling: 9,
  /** Upward throw at the centre for a light unit (m/s). */
  blastUp: 11,
  /** Share of the throw left at the blast's edge. */
  blastEdge: 0.3,
  /** The blast radius that throws ×1 (m); the size factor is √(radius / this), clamped to blastSizeMin..blastSizeMax. */
  blastSizeRef: 4,
  blastSizeMin: 0.5,
  blastSizeMax: 1.6,
  // Weight per kind: × the throw.
  blastWeightLight: 1,
  blastWeightCutter: 0.55,
  blastWeightQuad: 0.35,
  blastWeightBig: 0.1,
  /** A light unit that lives is knocked down with this share of the throw (0: blasts only throw kills). */
  blastKnock: 0.55,
  /** ... when that share is at least this (m/s): the edge of a small blast doesn't knock a crowd flat. */
  blastKnockMin: 2.5,
  /** A blast's damage counts this many times toward a stagger (1: as any hit). */
  blastPoise: 1.6,
};
export type BlastLaunchValues = typeof BLAST_LAUNCH_DEFAULTS;

const G = "Blast launch";
export const BLAST_LAUNCH_GROUPS = [G];

export const BLAST_LAUNCH_PARAMS: Param[] = [
  { key: "blastLaunchOn", label: "Blasts throw bodies", min: 0, max: 1, step: 1, group: G, tip: "Off: blast kills fall as any other kill" },
  { key: "blastFling", label: "Out, at the centre (m/s)", min: 0, max: 30, step: 0.5, group: G, tip: "Away from the blast, for a light unit (bandits, droids, scrappers) killed at its centre" },
  { key: "blastUp", label: "Up, at the centre (m/s)", min: 0, max: 30, step: 0.5, group: G, tip: "10 m/s is about 5 m up (the body's lowest part)" },
  { key: "blastEdge", label: "Left at the edge (share)", min: 0, max: 1, step: 0.01, group: G, tip: "The throw falls off from the centre to this share at the blast's edge" },
  { key: "blastSizeRef", label: "Blast that throws ×1 (radius m)", min: 1, max: 15, step: 0.25, group: G, tip: "Bigger blasts throw harder (square root of radius / this), smaller ones less" },
  { key: "blastSizeMin", label: "Smallest size factor", min: 0, max: 1, step: 0.05, group: G },
  { key: "blastSizeMax", label: "Biggest size factor", min: 1, max: 4, step: 0.05, group: G },
  { key: "blastWeightLight", label: "Light (bandits, droids, scrappers) ×", min: 0, max: 2, step: 0.05, group: G },
  { key: "blastWeightCutter", label: "Cutters ×", min: 0, max: 2, step: 0.05, group: G },
  { key: "blastWeightQuad", label: "Weapon quads ×", min: 0, max: 2, step: 0.05, group: G },
  { key: "blastWeightBig", label: "Excavators ×", min: 0, max: 2, step: 0.05, group: G, tip: "Their reactor going up throws their wreck anyway (Death physics)" },
  { key: "blastKnock", label: "Survivors knocked (share)", min: 0, max: 1, step: 0.01, group: G, tip: "A light unit the blast doesn't kill is knocked down with this share of the throw: bandits and droids slide, scrappers fly. 0: only kills fly" },
  { key: "blastKnockMin", label: "Knock from (m/s)", min: 0, max: 15, step: 0.25, group: G, tip: "Survivors are knocked only when their share of the throw is at least this" },
  { key: "blastPoise", label: "Blasts stagger (× damage)", min: 1, max: 6, step: 0.1, group: G, tip: "A blast's damage counts this many times toward a stagger (Stagger topic), shoved away from the blast" },
];

/** A blast's throw on one unit: out and up (m/s), 0 0 when off. */
export interface Kick { out: number; up: number }

/**
 * The throw on a unit `d` m (its nearest part) from a blast of `radius`, of this weight (× the throw).
 * Linear from 1 at the centre to blastEdge at the edge; nothing past the edge.
 */
export function blastKick(d: number, radius: number, weight: number, v: BlastLaunchValues, out: Kick): Kick {
  out.out = 0; out.up = 0;
  if (!(v.blastLaunchOn > 0.5) || !(radius > 0) || !(weight > 0) || d > radius) return out;
  const t = Math.max(0, d) / radius, fall = 1 - (1 - v.blastEdge) * t;
  const size = Math.min(v.blastSizeMax, Math.max(v.blastSizeMin, Math.sqrt(radius / Math.max(0.1, v.blastSizeRef))));
  const k = fall * size * weight;
  out.out = v.blastFling * k; out.up = v.blastUp * k;
  return out;
}

/** The survivor's knock (m/s out, up): blastKnock × the kick, or 0 0 under blastKnockMin. */
export function knockOf(k: Kick, v: BlastLaunchValues, out: Kick): Kick {
  const s = v.blastKnock, o = k.out * s, u = k.up * s;
  if (!(s > 0) || Math.hypot(o, u) < v.blastKnockMin) { out.out = 0; out.up = 0; return out; }
  out.out = o; out.up = u;
  return out;
}
