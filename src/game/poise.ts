// Stagger (Keith 2026-11-15: "getting hit by a sword should really stagger enemies ... we want things to kind of stagger
// under damage, including us ... a hidden stagger resistance mechanic"). Every unit keeps a hidden build of the hurt it
// took lately (it fades with poiseWindow s, so only damage close together counts). When the build passes its poise (a
// share of its full health × how heavy its kind is; per kind below), it staggers: staggerTime s (longer the further the
// build went past, up to staggerLong ×) at staggerPace speed, its attack wind-ups broken off, shoved along the hit.
// Then staggerGrace s before it can stagger again, so nothing is held in a stun lock. Swords add swordPoise × their
// damage on top (src/weapons/arsenal.ts swordSheet calls Hittable.poise), so a cut staggers anything up to an excavator.
// Pure: numbers only. Each sim keeps its own build, stun and grace (typed arrays in the swarms, so the sim worker's
// snapshots carry them; a Poise on single units). Ownership: host (part of damage). Randomness: none.
import type { Param } from "../core/tweaks";

export const POISE_DEFAULTS = {
  staggerOn: 1,
  /** The build fades with this time constant (s): hurt about this close together adds up. */
  poiseWindow: 1,
  staggerTime: 0.55,
  staggerLong: 1.8,
  staggerPace: 0.15,
  staggerGrace: 0.5,
  /** A stagger's shove fades at this rate (/s). */
  staggerShoveDrag: 5,
  /** Sword cuts count this many times their damage toward a stagger. */
  swordPoise: 2.5,
  // Poise per kind: the share of its full health it must take inside the window. Heavier kinds stand more.
  poiseScrapper: 0,
  poiseCutter: 0.3,
  poiseQuad: 0.28,
  poiseExcavator: 0.14,
  poiseBandit: 0.45,
  poiseDroid: 0.35,
  poiseCrusher: 0.12,
  poiseStrider: 0.14,
  poiseMech: 0.14,
  // Shove per kind (m/s at the start of the stagger), and the stagger's length for the heaviest (× staggerTime).
  shoveLight: 6,
  shoveCutter: 4,
  shoveQuad: 2.5,
  shoveHeavy: 1.2,
  shoveMech: 3,
  staggerHeavyTime: 0.7,
};
export type PoiseValues = typeof POISE_DEFAULTS;

const G = "Stagger", GK = "Stagger: poise per kind", GS = "Stagger: shove";
export const POISE_GROUPS = [G, GK, GS];
export const POISE_TOPIC = { id: "stagger", label: "Stagger", groups: POISE_GROUPS };

export const POISE_PARAMS: Param[] = [
  { key: "staggerOn", label: "Stagger on", min: 0, max: 1, step: 1, group: G },
  { key: "poiseWindow", label: "Hurt adds up over (s)", min: 0.1, max: 5, step: 0.05, group: G, tip: "Damage fades from the build with this time constant: a stagger needs its poise inside about this long" },
  { key: "staggerTime", label: "Stagger (s)", min: 0, max: 3, step: 0.05, group: G, tip: "How long a stagger lasts when the build just reaches the poise" },
  { key: "staggerLong", label: "Longest (× stagger)", min: 1, max: 4, step: 0.05, group: G, tip: "A build far past the poise (a sword on something light) staggers up to this much longer" },
  { key: "staggerPace", label: "Speed while staggered", min: 0, max: 1, step: 0.01, group: G, tip: "Share of its speed; no attacks start and wind-ups break off" },
  { key: "staggerGrace", label: "Grace after (s)", min: 0, max: 5, step: 0.05, group: G, tip: "No new stagger this long after one ends: no stun lock" },
  { key: "staggerShoveDrag", label: "Shove fades (/s)", min: 0.5, max: 20, step: 0.25, group: GS },
  { key: "swordPoise", label: "Sword counts (× damage)", min: 1, max: 6, step: 0.1, group: G, tip: "A sword cut adds this many times its damage to the build: it staggers reliably" },
  { key: "poiseScrapper", label: "Scrappers", min: 0, max: 2, step: 0.01, group: GK, tip: "Share of full health taken inside the window that staggers it. Scrappers are knocked down (0: never; off by default: a downed scrapper is out of reach of the rounds and bites that would kill it)" },
  { key: "poiseCutter", label: "Cutters", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseQuad", label: "Weapon quads", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseExcavator", label: "Excavators", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseBandit", label: "Bandits", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseDroid", label: "Droids", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseCrusher", label: "Crushers", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseStrider", label: "Striders", min: 0, max: 2, step: 0.01, group: GK },
  { key: "poiseMech", label: "Mechs (yours too)", min: 0, max: 2, step: 0.01, group: GK, tip: "Share of the hull: every mech, the player's, rivals' and bandits'" },
  { key: "shoveLight", label: "Light (scrappers, bandits, droids) (m/s)", min: 0, max: 20, step: 0.25, group: GS },
  { key: "shoveCutter", label: "Cutters (m/s)", min: 0, max: 20, step: 0.25, group: GS },
  { key: "shoveQuad", label: "Weapon quads (m/s)", min: 0, max: 20, step: 0.25, group: GS },
  { key: "shoveHeavy", label: "Heavy (excavators, crushers, striders) (m/s)", min: 0, max: 20, step: 0.25, group: GS },
  { key: "shoveMech", label: "Mechs (m/s)", min: 0, max: 20, step: 0.25, group: GS, tip: "Through the legs' knockback (Move › Knockback: share taken)" },
  { key: "staggerHeavyTime", label: "Heavy kinds' stagger (×)", min: 0.1, max: 2, step: 0.05, group: G, tip: "Excavators, crushers and striders stagger this share as long" },
];

/** Fade for a step: the build is multiplied by this. */
export function poiseFade(dt: number, v: PoiseValues): number {
  return Math.exp(-dt / Math.max(0.05, v.poiseWindow));
}

/** The stagger a build starts (s; 0 none): past its poise, not staggered now and out of grace. */
export function staggerFor(build: number, poise: number, stun: number, grace: number, v: PoiseValues): number {
  if (!(v.staggerOn > 0.5) || !(poise > 0) || stun > 0 || grace > 0 || build < poise) return 0;
  return Math.max(1e-3, v.staggerTime * Math.min(Math.max(1, v.staggerLong), build / poise));
}

/** The arrays a swarm keeps per unit (its own fields, so the sim worker's snapshot carries them). */
export interface PoiseCols { build: Float32Array; stun: Float32Array; grace: Float32Array }

/** Hurt onto unit i; returns the stagger it started (s; 0 none). The build empties when it staggers. */
export function poiseHitAt(c: PoiseCols, i: number, amount: number, poise: number, v: PoiseValues, timeK = 1): number {
  // Nothing builds while staggered (else a long stream re-staggers it the moment the grace ends).
  if (!(amount > 0) || c.stun[i] > 0) return 0;
  c.build[i] += amount;
  const t = staggerFor(c.build[i], poise, c.stun[i], c.grace[i], v) * timeK;
  if (t > 0) { c.stun[i] = t; c.build[i] = 0; }
  return t;
}

/** A step for unit i: the build fades, the stagger runs out into its grace. */
export function poiseTickAt(c: PoiseCols, i: number, dt: number, fade: number, v: PoiseValues) {
  if (c.build[i] > 0) c.build[i] = c.build[i] * fade < 0.01 ? 0 : c.build[i] * fade;
  if (c.stun[i] > 0) {
    c.stun[i] -= dt;
    if (c.stun[i] <= 0) { c.stun[i] = 0; c.grace[i] = v.staggerGrace; }
  } else if (c.grace[i] > 0) c.grace[i] = Math.max(0, c.grace[i] - dt);
}

export function clearPoiseAt(c: PoiseCols, i: number) { c.build[i] = 0; c.stun[i] = 0; c.grace[i] = 0; }

/** One unit's poise (a mech, a crusher, a strider). */
export class Poise implements PoiseCols {
  readonly build = new Float32Array(1);
  readonly stun = new Float32Array(1);
  readonly grace = new Float32Array(1);
  /** Staggers started. */
  count = 0;
  hit(amount: number, poise: number, v: PoiseValues, timeK = 1): number {
    const t = poiseHitAt(this, 0, amount, poise, v, timeK);
    if (t > 0) this.count++;
    return t;
  }
  tick(dt: number, v: PoiseValues) { poiseTickAt(this, 0, dt, poiseFade(dt, v), v); }
  clear() { clearPoiseAt(this, 0); }
  get staggered(): boolean { return this.stun[0] > 0; }
  get left(): number { return this.stun[0]; }
}
