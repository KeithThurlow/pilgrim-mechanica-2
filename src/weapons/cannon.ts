// The breach cannon (Keith 2026-11-02: "actual cannons, not just autocannons, but cannons that fire explosive rounds").
// A hull weapon: one big shell at a time on the gun's clock (src/mech/upper.ts), flying under gravity like the
// autocannon's (src/weapons/autocannon.ts CannonShells) and leading a locked target (direct fire leads; docs/decisions.md
// 2026-11-02), and bursting as a real explosion through Battlefield.blast: the shared blast sound scaled by its radius, a
// crater, a blast wave. The target it strikes takes the shell's full damage, then everything in the blast a share.
// Pure data; src/weapons/arsenal.ts fires it. A rolled item carries its own numbers; an unrolled one runs on these.
import type { Param } from "../core/tweaks";

export const CANNON_DEFAULTS = {
  cannonRate: 0.5,
  cannonDamage: 300,
  cannonBlast: 4,
  cannonBlastShare: 0.6,
  cannonSpeed: 95,
  cannonGravity: 8,
  cannonRange: 85,
  cannonSpread: 0.3,
  cannonAp: 0.6,
  cannonMag: 6,
  cannonReload: 3.5,
  cannonLead: 1,
  cannonKick: 0.6,
  cannonShake: 0.3,
  breachLevel: 1,
};
export type CannonValues = typeof CANNON_DEFAULTS;

export const CANNON_GROUP = "Breach cannon";
const G = CANNON_GROUP;
export const CANNON_PARAMS: Param[] = [
  { key: "cannonRate", label: "Shells/s", min: 0.1, max: 4, step: 0.05, group: G },
  { key: "cannonDamage", label: "Damage (direct hit)", min: 0, max: 2000, step: 5, group: G, tip: "What the body the shell strikes takes; the blast adds its share on top" },
  { key: "cannonBlast", label: "Blast radius (m)", min: 0.5, max: 12, step: 0.1, group: G, tip: "Goes through the shared blast: crater, wave and the blast sound, which deepens and swells with the radius" },
  { key: "cannonBlastShare", label: "Blast damage share", min: 0, max: 1.5, step: 0.01, group: G, tip: "Everything in the blast takes this share of the direct damage (full at the centre, half at the edge)" },
  { key: "cannonSpeed", label: "Shell speed (m/s)", min: 20, max: 250, step: 1, group: G },
  { key: "cannonGravity", label: "Shell drop (m/s²)", min: 0, max: 30, step: 0.5, group: G },
  { key: "cannonRange", label: "Range (m)", min: 10, max: 200, step: 1, group: G, tip: "A shell that flies this far without striking anything burns out" },
  { key: "cannonSpread", label: "Spread (°)", min: 0, max: 5, step: 0.05, group: G },
  { key: "cannonAp", label: "Armour pierce", min: 0, max: 1, step: 0.01, group: G },
  { key: "cannonMag", label: "Magazine (shells)", min: 1, max: 30, step: 1, group: G },
  { key: "cannonReload", label: "Reload (s)", min: 0.2, max: 10, step: 0.1, group: G },
  { key: "cannonLead", label: "Lead on a lock (×)", min: 0, max: 1.5, step: 0.05, group: G, tip: "1 aims exactly where a locked target will be when the shell arrives" },
  { key: "cannonKick", label: "Gun kick (m)", min: 0, max: 1.5, step: 0.01, group: G },
  { key: "cannonShake", label: "Camera shake", min: 0, max: 1.5, step: 0.01, group: G },
  { key: "breachLevel", label: "Firing sound", min: 0, max: 1.5, step: 0.01, group: G },
];

/** The cannon's numbers as an item's stats name them (the base table's values). */
export function cannonNumbers(v: CannonValues) {
  return { fireRate: v.cannonRate, damage: v.cannonDamage, blast: v.cannonBlast, shellSpeed: v.cannonSpeed, range: v.cannonRange, spread: v.cannonSpread, ap: v.cannonAp, magazine: v.cannonMag, reload: v.cannonReload };
}
