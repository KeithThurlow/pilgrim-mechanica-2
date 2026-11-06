// Where a fortress's bandit mechs stand and what each one is (pure, seeded by the layout; Keith 2026-11-06). The glue
// that puts them on the field is src/expedition/fortMechs.ts; this file stays free of models so checks can load it.
import type { Param } from "../core/tweaks";
import { RIVAL_LEVELS, type RivalLevel } from "../combat/rivalAi";
import { ringSpan, type Layout } from "../pois/fortress";
import { regionOf, solidAt } from "../pois/fortressGround";
import { rng } from "../items/generate";

export const FORT_MECH_DEFAULTS = {
  fortMechsOuter: 1, fortMechsMiddle: 1, fortFlankers: 2,
  fortMechUp: -1, fortMiddleUp: 0, fortFlankUp: -1, warlordUp: 0,
  fortMechAi: 0, fortFlankAi: 0, warlordAi: 1,
  fortMechHull: 1, warlordHull: 1.3,
  fortMechArena: 30, fortMechWake: 110,
  warlordDrops: 5, fortMechDrops: 1,
};
export type FortMechValues = typeof FORT_MECH_DEFAULTS;
const G = "Fortress: mechs", B = "Fortress: warlord";
const AI_TIP = "The duel's rival levels: 0 Recruit (slow aim, easy), 1 Veteran, 2 Ace";
const UP_TIP = "Its items roll this many levels above (or below) the mean level of yours, as the duel lab's rival";
export const FORT_MECH_PARAMS: Param[] = [
  { key: "fortMechsOuter", label: "Mechs in the outer yard", min: 0, max: 4, step: 1, group: G, onRelease: true },
  { key: "fortMechsMiddle", label: "Mechs in the middle yard", min: 0, max: 4, step: 1, group: G, tip: "Three-ring fortresses only", onRelease: true },
  { key: "fortMechUp", label: "Outer yard mechs' items vs yours", min: -10, max: 20, step: 1, group: G, tip: UP_TIP, onRelease: true },
  { key: "fortMiddleUp", label: "Middle yard mechs' items vs yours", min: -10, max: 20, step: 1, group: G, tip: UP_TIP, onRelease: true },
  { key: "fortMechAi", label: "Yard mechs' rival level", min: 0, max: 2, step: 1, group: G, tip: AI_TIP, onRelease: true },
  { key: "fortMechHull", label: "Yard mechs' hull ×", min: 0.2, max: 5, step: 0.05, group: G, tip: "On top of their level's hull share", onRelease: true },
  { key: "fortMechArena", label: "Yard mechs fight within (m of their post)", min: 8, max: 120, step: 1, group: G },
  { key: "fortMechWake", label: "They fight the mech within (m)", min: 20, max: 300, step: 5, group: G, tip: "Once their yard is alert" },
  { key: "fortMechDrops", label: "Items a yard mech or flanker drops", min: 0, max: 6, step: 1, group: G },
  { key: "warlordAi", label: "Warlord's rival level", min: 0, max: 2, step: 1, group: B, tip: AI_TIP, onRelease: true },
  { key: "warlordUp", label: "Warlord's items vs yours", min: -10, max: 20, step: 1, group: B, tip: UP_TIP, onRelease: true },
  { key: "warlordHull", label: "Warlord's hull ×", min: 0.2, max: 6, step: 0.05, group: B, tip: "On top of its level's hull share (Veteran 1.15)", onRelease: true },
  { key: "fortFlankers", label: "Flankers beside it", min: 0, max: 4, step: 1, group: B, onRelease: true },
  { key: "fortFlankUp", label: "Flankers' items vs yours", min: -10, max: 20, step: 1, group: B, tip: UP_TIP, onRelease: true },
  { key: "fortFlankAi", label: "Flankers' rival level", min: 0, max: 2, step: 1, group: B, tip: AI_TIP, onRelease: true },
  { key: "warlordDrops", label: "Items the warlord drops", min: 0, max: 10, step: 1, group: B },
];

const AI_IDS: RivalLevel[] = ["recruit", "veteran", "ace"];
const aiOf = (n: number): RivalLevel => AI_IDS[Math.max(0, Math.min(2, Math.round(n)))];

/** Paint: bandit red; the warlord darker. */
export const FORT_MECH_PAINT = 0xa8442c, WARLORD_PAINT = 0x8e2a1e;

export type FortMechRole = "yard" | "flank" | "boss";
export interface FortMechPost {
  /** Stable within the fortress: `${poi}:m${n}`. */
  id: string;
  role: FortMechRole;
  /** Its yard (0 outer; the keep is rings.length - 1). */
  yard: number;
  x: number; z: number; face: number;
  arena: { x: number; z: number; r: number };
  ai: RivalLevel;
  /** Its items' level vs the player's. */
  up: number;
  /** Its hull × on its loadout's (the level's hull share in). */
  hull: number;
  seed: number;
}

/** Room for a mech at (x, z): nothing solid within 4 m. */
function roomy(L: Layout, x: number, z: number) {
  if (solidAt(L, x, z, NONE)) return false;
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (solidAt(L, x + Math.sin(a) * 4, z + Math.cos(a) * 4, NONE)) return false; }
  return true;
}
const NONE: ReadonlySet<string> = new Set();

/** Where a fortress's mechs stand and what each is (pure, seeded by the layout's fortress). */
export function fortMechPosts(L: Layout, v: FortMechValues, seed: number): FortMechPost[] {
  const out: FortMechPost[] = [];
  const rings = L.rings, keepK = rings.length - 1, r = rng(seed ^ 0x3ec4);
  const yardHull = v.fortMechHull * RIVAL_LEVELS[aiOf(v.fortMechAi)].rivalHull;
  // Yard mechs on open street ground in their yard, spread apart.
  for (let k = 0; k < keepK; k++) {
    const n = Math.round(k === 0 ? v.fortMechsOuter : k === 1 && keepK > 1 ? v.fortMechsMiddle : 0);
    if (n <= 0) continue;
    const cand: { x: number; z: number }[] = [];
    for (const s of L.streets) for (const p of s.pts) if (regionOf(L, p.x, p.z) === k + 1 && roomy(L, p.x, p.z)) cand.push(p);
    if (!cand.length) {
      // No streets (or none roomy): round the yard's middle.
      const rm = (rings[k].r + rings[k + 1].r) / 2;
      for (let j = 0; j < 24; j++) { const a = (j / 24) * Math.PI * 2; const x = L.x + Math.sin(a) * rm, z = L.z + Math.cos(a) * rm; if (roomy(L, x, z)) cand.push({ x, z }); }
    }
    const picked: { x: number; z: number }[] = [];
    for (let m = 0; m < n && cand.length; m++) {
      let best = cand[Math.floor(r() * cand.length)];
      if (picked.length) {
        let bd = -1;
        for (const c of cand) { const d = Math.min(...picked.map((p) => Math.hypot(p.x - c.x, p.z - c.z))); if (d > bd) { bd = d; best = c; } }
      }
      picked.push(best);
      out.push({ id: `${L.poi}:m${out.length}`, role: "yard", yard: k, x: best.x, z: best.z, face: Math.atan2(L.x - best.x, L.z - best.z),
        arena: { x: best.x, z: best.z, r: v.fortMechArena }, ai: aiOf(v.fortMechAi), up: k === 0 ? v.fortMechUp : v.fortMiddleUp, hull: yardHull, seed: (seed + out.length * 7919) >>> 0 });
    }
  }
  // The keep: the warlord in front of the vault, flankers either side.
  const keep = rings[keepK], kr = Math.max(4, keep.r * 0.8 - ringSpan(keep)), yaw = r() * Math.PI * 2;
  const arena = { x: L.x, z: L.z, r: kr };
  const spot = (a: number, d: number) => {
    for (let t = d; t >= 0; t -= 1.5) { const x = L.x + Math.sin(a) * t, z = L.z + Math.cos(a) * t; if (roomy(L, x, z)) return { x, z }; }
    return { x: L.x + Math.sin(a) * d, z: L.z + Math.cos(a) * d };
  };
  const b = spot(yaw, Math.min(6, kr * 0.5));
  out.push({ id: `${L.poi}:m${out.length}`, role: "boss", yard: keepK, x: b.x, z: b.z, face: yaw, arena, ai: aiOf(v.warlordAi), up: v.warlordUp,
    hull: v.warlordHull * RIVAL_LEVELS[aiOf(v.warlordAi)].rivalHull, seed: (seed + 104729) >>> 0 });
  for (let m = 0, n = Math.round(v.fortFlankers); m < n; m++) {
    const side = m % 2 === 0 ? 1 : -1, a = yaw + side * (Math.PI / 2 + Math.floor(m / 2) * 0.6);
    const s = spot(a, kr * 0.55);
    out.push({ id: `${L.poi}:m${out.length}`, role: "flank", yard: keepK, x: s.x, z: s.z, face: yaw, arena, ai: aiOf(v.fortFlankAi), up: v.fortFlankUp,
      hull: RIVAL_LEVELS[aiOf(v.fortFlankAi)].rivalHull, seed: (seed + 15485863 * (m + 1)) >>> 0 });
  }
  return out;
}

