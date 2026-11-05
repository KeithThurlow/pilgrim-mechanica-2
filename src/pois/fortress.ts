// Tier 5, Siege: a bandit fortress (Keith 2026-10-31, docs/proposal-fortresses.md; reworked after his playtest
// 2026-11-01: "bandits having found things like containers to fortify an area... standing containers up in the sand").
// Reworked again 2026-11-05 (Keith: "more organic looking village city like layout", after the old project's organic
// towns): streets and lanes with container shacks along them inside loosely concentric walls, on uneven ground.
// Rings of wall built from shipping containers, stood on end or stacked, bedded in a low drift of sand banked against
// both sides; each ring with a few gates (steel barricades with health until blown, then gaps); the yards between them
// are the sections: the outer yard, the inner yard and the keep at the centre with its vault. Every fortress is its
// own shape: two or three rings, each wobbling and pushed off centre, its size and gate count rolled, and container
// stacks standing loose in the yards as cover.
//
// Pure and seeded: `fortLayout` is the shape (rings, gates, cover) that both the ground (src/pois/fortressGround.ts:
// a container's footprint as a sheer plug, the drift as a gentle berm, standing gates as plugs) and the builder read;
// `buildFortress` is the POI site (sections, salvage spots, the containers). Gate health and the garrison belong to the
// glue (host).
import type { Param } from "../core/tweaks";
import { rng, type PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite, type Tone } from "./site";

export const FORT_DEFAULTS = {
  fortOuter: 118,
  fortMiddle: 74,
  fortKeep: 26,
  fortThree: 0.6,
  fortSizeJit: 0.1,
  fortWobble: 0.03,
  fortOutline: 0.1,
  fortBackStreets: 4,
  fortCompounds: 6,
  fortShift: 0.25,
  fortWallH: 5,
  fortWallTop: 0.8,
  fortWallFace: 0.35,
  fortDrift: 2.2,
  fortDriftW: 6,
  fortGatesOuter: 3,
  fortGatesKeep: 1,
  fortMidBarred: 0.5,
  fortGateW: 10,
  fortGateT: 3,
  fortUpright: 0.55,
  fortStreetW: 10,
  fortLaneW: 7,
  fortLanes: 12,
  fortLaneLen: 24,
  fortMeander: 0.6,
  fortBuildings: 220,
  fortInfill: 18,
  fortBuildGap: 2.5,
  fortTwoHigh: 0.3,
  fortCover: 3,
  fortSpawners: 3,
  fortTowers: 3,
  fortYardSpots: 5,
  fortSpotValue: 70,
  fortSpotTime: 4,
  fortVaultValue: 900,
  fortVaultTime: 8,
  fortClutter: 90,
};
export type FortValues = typeof FORT_DEFAULTS & { fortPad: number };

const G = "Fortress: layout", T = "Fortress: town", W = "Fortress: walls", S = "Fortress: salvage";
export const FORT_PARAMS: Param[] = [
  { key: "fortPad", label: "Pad radius (m)", min: 40, max: 200, step: 1, group: G, tip: "The ground it stands on; the walls are kept inside it", onRelease: true },
  { key: "fortRelief", label: "Uneven ground (m)", min: 0, max: 14, step: 0.1, group: G, tip: "The pad keeps a rise toward the keep and rolling ground instead of being level (0: flat)", onRelease: true },
  { key: "fortOuter", label: "Outer wall radius (m)", min: 30, max: 190, step: 1, group: G, onRelease: true },
  { key: "fortMiddle", label: "Middle wall radius (m)", min: 0, max: 150, step: 1, group: G, tip: "0: never a middle ring", onRelease: true },
  { key: "fortKeep", label: "Keep wall radius (m)", min: 8, max: 80, step: 1, group: G, onRelease: true },
  { key: "fortThree", label: "Chance of three rings", min: 0, max: 1, step: 0.05, group: G, tip: "Else two: the outer wall and the keep", onRelease: true },
  { key: "fortSizeJit", label: "Ring size varies (±share)", min: 0, max: 0.3, step: 0.01, group: G, onRelease: true },
  { key: "fortWobble", label: "Ring wobble (share of radius)", min: 0, max: 0.25, step: 0.005, group: G, tip: "Lumps in each ring's line", onRelease: true },
  { key: "fortOutline", label: "Wall corners in and out (share)", min: 0, max: 0.3, step: 0.005, group: G, tip: "Walls are straight runs between corners; each corner this much nearer or further", onRelease: true },
  { key: "fortShift", label: "Inner rings off centre (share)", min: 0, max: 0.4, step: 0.01, group: G, onRelease: true },
  { key: "fortGatesOuter", label: "Gates in the outer wall, at most", min: 1, max: 6, step: 1, group: G, tip: "Each fortress rolls 2 (or this, if less) to this; a street runs in from each", onRelease: true },
  { key: "fortGatesKeep", label: "Gates in the keep wall, at most", min: 1, max: 4, step: 1, group: G, tip: "Every street ends at the nearest", onRelease: true },
  { key: "fortMidBarred", label: "Middle wall gates barred (share)", min: 0, max: 1, step: 0.05, group: G, tip: "The middle wall has a gate where each street crosses it; the rest are open gaps (one is always barred)", onRelease: true },
  { key: "fortGateW", label: "Gate width (m)", min: 5, max: 24, step: 0.5, group: G, onRelease: true },
  { key: "fortGateT", label: "Gate thickness (m)", min: 1, max: 6, step: 0.1, group: G, tip: "The steel barricade plugging the gap while it stands", onRelease: true },
  { key: "fortStreetW", label: "Street width (m)", min: 6, max: 20, step: 0.5, group: T, tip: "The main streets from the gates to the keep; the mech needs about 7", onRelease: true },
  { key: "fortMeander", label: "Streets wander (share of the yard)", min: 0, max: 1, step: 0.05, group: T, onRelease: true },
  { key: "fortBackStreets", label: "Back streets per yard", min: 0, max: 10, step: 1, group: T, tip: "Forking off a main street and running on round the yard", onRelease: true },
  { key: "fortCompounds", label: "Compounds per yard", min: 0, max: 20, step: 1, group: T, tip: "Shacks round a small yard of their own, away from the streets", onRelease: true },
  { key: "fortLaneW", label: "Lane width (m)", min: 3, max: 14, step: 0.5, group: T, tip: "Side lanes off the streets", onRelease: true },
  { key: "fortLanes", label: "Side lanes, at most", min: 0, max: 40, step: 1, group: T, onRelease: true },
  { key: "fortLaneLen", label: "Lane length, at most (m)", min: 6, max: 60, step: 1, group: T, onRelease: true },
  { key: "fortBuildings", label: "Container shacks, at most", min: 0, max: 300, step: 1, group: T, tip: "Along every street and lane, doors to the street", onRelease: true },
  { key: "fortInfill", label: "Back-row shacks", min: 0, max: 80, step: 1, group: T, tip: "Set back behind the street fronts", onRelease: true },
  { key: "fortBuildGap", label: "Gap between shacks (m, mean)", min: 0.5, max: 12, step: 0.1, group: T, tip: "Alleys bandits run through", onRelease: true },
  { key: "fortTwoHigh", label: "Shacks two high (share)", min: 0, max: 1, step: 0.05, group: T, onRelease: true },
  { key: "fortSpawners", label: "Spawner shacks per yard", min: 0, max: 10, step: 1, group: T, tip: "Shacks the bandits pour out of when the fortress is alert (shoot one to shut it)", onRelease: true },
  { key: "fortTowers", label: "Lookout towers in the outer yard", min: 0, max: 12, step: 1, group: T, tip: "Stacked containers with a crew on top; one less per yard inward (the keep at least 1)", onRelease: true },
  { key: "fortCover", label: "Loose container stacks per yard", min: 0, max: 20, step: 1, group: T, onRelease: true },
  { key: "fortClutter", label: "Clutter in the yards", min: 0, max: 300, step: 1, group: T, onRelease: true },
  { key: "fortWallH", label: "Wall height (m)", min: 2.6, max: 6, step: 0.1, group: W, tip: "The containers' solid height: the lowest stack (two lying, 5.2 m) must stay above it", onRelease: true },
  { key: "fortWallTop", label: "Container footprint half-width (m)", min: 0.3, max: 1.2, step: 0.05, group: W, tip: "The solid part under each container; keep it inside the box (1.2)", onRelease: true },
  { key: "fortWallFace", label: "Container face slope width (m)", min: 0.1, max: 1, step: 0.05, group: W, onRelease: true },
  { key: "fortDrift", label: "Sand drift height (m)", min: 0, max: 4, step: 0.1, group: W, tip: "Banked against both sides of the containers", onRelease: true },
  { key: "fortDriftW", label: "Sand drift width (m)", min: 1, max: 15, step: 0.5, group: W, tip: "Keep the drift gentle (height ÷ width under 0.5) so it can be walked", onRelease: true },
  { key: "fortUpright", label: "Containers stood on end (share)", min: 0, max: 1, step: 0.05, group: W, tip: "Else stacked two high, lying along the wall", onRelease: true },
  { key: "fortYardSpots", label: "Salvage spots per yard", min: 1, max: 16, step: 1, group: S, onRelease: true },
  { key: "fortSpotValue", label: "Scrap per yard spot", min: 1, max: 400, step: 1, group: S, onRelease: true },
  { key: "fortSpotTime", label: "Yard spot strip time (s)", min: 0.5, max: 20, step: 0.1, group: S, onRelease: true },
  { key: "fortVaultValue", label: "Scrap in the vault", min: 1, max: 4000, step: 1, group: S, onRelease: true },
  { key: "fortVaultTime", label: "Vault strip time (s)", min: 1, max: 60, step: 0.5, group: S, onRelease: true },
];

/** Container sizes (m): long side, short side, height. */
export const BOX = { long: 6.06, wide: 2.44, high: 2.59 };

/** A way through a ring: a steel barricade until it's down, then a gap. */
export interface Gate {
  /** Stable id: the POI's id, the ring and the gate's number. */
  id: string;
  ring: number;
  /** World heading from the fortress's centre (0 faces +Z). */
  a: number;
  /** Centre in the world, on the ring's line. */
  x: number; z: number;
  /** Width of the gap (m) and thickness of the barricade across the ring (m). */
  w: number; t: number;
  /** Starts standing (a barricade); false: an open gap from the start. */
  barred: boolean;
}

/**
 * A wall ring round the centre. Its line is at radius r × outline(a) × (1 + Σ amp·sin(k·a + phase)) for each
 * [k, amp, phase] in `wob` (k = 1 pushes it off centre), outline(a) the `poly`: corners at headings `a` (sorted, 0..2π)
 * and radius shares `k`, joined by straight runs (none: a circle); along the line a solid core of height h, flat top half-width `top`, faces `face` wide, and a sand
 * drift of height `drift` falling off over `driftW` either side.
 */
export interface Ring { r: number; h: number; top: number; face: number; gates: Gate[]; wob: number[]; drift: number; driftW: number; poly?: { a: number[]; k: number[] } }

/**
 * A solid box in a yard: a container shack (`cols` containers side by side, `stack` high) or a loose stack. Footprint
 * len × dep, long side along heading a, at (x, z), its solid height h; `door` the heading its doors face (the street).
 * A low sand drift `drift` high banks round it over `driftW`.
 */
export interface Block {
  x: number; z: number; a: number; len: number; dep: number; h: number; stack: number;
  cols: number; door: number; drift: number; driftW: number;
  /** Which yard it stands in (0 the outer). */
  yard: number;
  kind: "shack" | "cover" | "tower";
  /** A tower's id: when it's in the walls' down set the stack is gone from the ground. */
  id?: string;
  /** The containers' door ends face the street (else their long side does). */
  endOn?: boolean;
}

/**
 * A spawner: a shack whose container doors swing open and bandits pour out (Keith 2026-11-05: "containers that
 * bandits just swarmed out of"). The door's centre on the shack's face (x, z), the heading out of it (a), its yard.
 */
/** A lookout tower: containers three levels high, crossed (Keith 2026-11-05); its block, top height (m), yard. */
export interface Tower { id: string; block: number; x: number; z: number; a: number; h: number; yard: number }

export interface Spawner { id: string; block: number; x: number; z: number; a: number; yard: number }

/** A street or lane (world points), `yard` the yard a lane runs in (-1: a main street, from a gate to the keep). */
export interface Street { pts: { x: number; z: number }[]; w: number; main: boolean; yard: number }

export interface Layout {
  poi: string;
  x: number; z: number;
  /** Rings from the outside in. */
  rings: Ring[];
  /** Shacks and loose stacks in the yards. */
  blocks: Block[];
  /** Streets from the gates to the keep and the lanes off them (nothing stands on them). */
  streets: Street[];
  /** Shacks bandits come out of. */
  spawners: Spawner[];
  /** Lookout towers. */
  towers: Tower[];
  /** Furthest any wall reaches from the centre (m). */
  reach: number;
  /** Blocks by 8 m cell (lazily built by blocksNear). */
  grid?: Map<number, number[]>;
  /** Flow fields for walking the town (fortressGround's flowStep; cosmetic cache, rebuilt on demand). */
  flow?: { downKey: string; size: number; solid: Uint8Array | null; fields: Map<number, Int32Array> };
}

/** A plain round ring (no wobble, no drift). */
export const roundRing = (r: number, h: number, top: number, face: number, gates: Gate[]): Ring => ({ r, h, top, face, gates, wob: [], drift: 0, driftW: 0 });

const TAU = Math.PI * 2;

/** A ring's radius at world heading a (from the layout's centre). */
export function ringR(ring: Ring, a: number) {
  let k = 1;
  const w = ring.wob;
  for (let j = 0; j < w.length; j += 3) k += w[j + 1] * Math.sin(w[j] * a + w[j + 2]);
  const P = ring.poly;
  if (P && P.a.length > 2) {
    // The straight run between the corners either side of a: where the ray from the centre meets it.
    const n = P.a.length, w = ((a % TAU) + TAU) % TAU;
    let i = n - 1;
    for (let j = 0; j < n; j++) if (P.a[j] <= w) i = j;
    const j = (i + 1) % n;
    const ax = Math.sin(P.a[i]) * P.k[i], az = Math.cos(P.a[i]) * P.k[i], ex = Math.sin(P.a[j]) * P.k[j] - ax, ez = Math.cos(P.a[j]) * P.k[j] - az;
    const dx = Math.sin(a), dz = Math.cos(a), den = dx * ez - dz * ex;
    k *= Math.abs(den) > 1e-9 ? (ax * ez - az * ex) / den : P.k[i];
  }
  return ring.r * k;
}

/** How far a ring's wall reaches either side of its line (m). */
export const ringSpan = (ring: Ring) => ring.top + ring.face + Math.max(ring.driftW, 0) * (ring.drift > 0 ? 1 : 0);

/** A ring's least and greatest radius round the circle. */
export function ringExtent(ring: Ring): [number, number] {
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 96; i++) { const R = ringR(ring, (i / 96) * TAU); lo = Math.min(lo, R); hi = Math.max(hi, R); }
  return [lo, hi];
}

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Distance from (x, z) to the segment a-b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Distance from (x, z) to a street's centre line. */
export function streetDist(s: Street, x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i + 1 < s.pts.length; i++) best = Math.min(best, segDist(x, z, s.pts[i].x, s.pts[i].z, s.pts[i + 1].x, s.pts[i + 1].z));
  return best;
}

/** A block's four corners (world). */
function corners(b: { x: number; z: number; a: number; len: number; dep: number }, grow = 0): [number, number][] {
  const ux = Math.sin(b.a), uz = Math.cos(b.a), wx = Math.cos(b.a), wz = -Math.sin(b.a);
  const hl = b.len / 2 + grow, hd = b.dep / 2 + grow;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [b.x + ux * hl * s + wx * hd * t, b.z + uz * hl * s + wz * hd * t]);
}

/** Two boxes overlap (separating axes), each grown by `grow`. */
function overlaps(a: Block, b: Block, grow: number) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.len, a.dep) + Math.hypot(b.len, b.dep)) / 2 + 2 * grow) return false;
  const ca = corners(a, grow), cb = corners(b, grow);
  for (const q of [a, b]) for (const ax of [[Math.sin(q.a), Math.cos(q.a)], [Math.cos(q.a), -Math.sin(q.a)]]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const d = x * ax[0] + z * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, z] of cb) { const d = x * ax[0] + z * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

const CELL = 8;
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/** The blocks whose footprint or drift could reach (x, z) (an 8 m grid, built the first time it's asked). */
export function blocksNear(L: Layout, x: number, z: number): readonly number[] {
  if (!L.grid) {
    const g = new Map<number, number[]>();
    L.blocks.forEach((b, n) => {
      const R = Math.hypot(b.len, b.dep) / 2 + b.driftW + 0.5;
      for (let j = Math.floor((b.z - R) / CELL); j <= Math.floor((b.z + R) / CELL); j++)
        for (let i = Math.floor((b.x - R) / CELL); i <= Math.floor((b.x + R) / CELL); i++) {
          const k = cellKey(i, j);
          let l = g.get(k);
          if (!l) g.set(k, (l = []));
          l.push(n);
        }
    });
    L.grid = g;
  }
  return L.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NONE;
}
const NONE: number[] = [];

/**
 * The layout (Keith 2026-11-05: "a slightly more organic looking village city like layout", the old project's organic
 * towns: streets first, buildings along them, a broken outline round it all). Loosely concentric still: an outer wall
 * on a ragged outline, a middle wall now and then, the keep pushed off centre. A main street runs in from every outer
 * gate, wandering round its yard and across the middle wall (a gate where it crosses, barred or an open gap) to the
 * nearest keep gate; lanes fork off the streets; container shacks stand along every street and lane with their doors
 * to it, a back row behind, and a few loose stacks.
 */
export function fortLayout(p: PoiPlacement, v: FortValues): Layout {
  const r = rng(p.seed ^ 0x5f0f7);
  const range = (a: number, b: number) => a + (b - a) * r();
  const jit = (x: number) => x * (1 + (r() * 2 - 1) * v.fortSizeJit);
  const three = v.fortMiddle > v.fortKeep + 8 && v.fortMiddle < v.fortOuter - 8 && r() < v.fortThree;
  const rs = [jit(v.fortOuter)];
  if (three) rs.push(jit(v.fortMiddle));
  rs.push(Math.min(jit(v.fortKeep), v.fortOuter - 8));
  const rings: Ring[] = [];
  const span = v.fortWallTop + v.fortWallFace + v.fortDriftW;
  for (let k = 0; k < rs.length; k++) {
    const wob: number[] = [];
    for (let h = 3; h <= 5; h++) wob.push(h, (v.fortWobble * (0.4 + 0.6 * r())) / (h - 1), r() * TAU);
    if (k > 0) wob.push(1, v.fortShift * r(), r() * TAU);
    const ring: Ring = { r: rs[k], h: v.fortWallH, top: v.fortWallTop, face: v.fortWallFace, gates: [], wob, drift: v.fortDrift, driftW: v.fortDriftW };
    // Straight runs of containers between corners (bandits build walls, not circles): the outer wall 8 to 11 sides,
    // the middle 6 to 9, the keep 5 to 7, each corner's distance rolled.
    {
      const n = k === 0 ? 8 + Math.floor(r() * 4) : k < rs.length - 1 ? 6 + Math.floor(r() * 4) : 5 + Math.floor(r() * 3);
      const a0 = r() * TAU, ang: number[] = [], ks: number[] = [];
      for (let i = 0; i < n; i++) { ang.push(((a0 + ((i + (r() - 0.5) * 0.5) / n) * TAU) % TAU + TAU) % TAU); ks.push(1 + (r() * 2 - 1) * v.fortOutline); }
      const order = ang.map((_, i) => i).sort((i, j) => ang[i] - ang[j]);
      // A polygon's sides fall inside its corners: lift it so its mean radius is still r.
      const tmp: Ring = { ...ring, wob: [], poly: { a: order.map((i) => ang[i]), k: order.map((i) => ks[i]) } };
      let m = 0;
      for (let i = 0; i < 96; i++) m += ringR(tmp, (i / 96) * TAU) / ring.r;
      ring.poly = { a: tmp.poly!.a, k: tmp.poly!.k.map((x) => x / (m / 96)) };
    }
    // Keep it inside the pad (outer) or inside the ring outside it with a yard between; shrink the wobble till it fits.
    for (let t = 0; t < 14; t++) {
      const [lo, hi] = ringExtent(ring);
      let ok = hi + span <= v.fortPad - 2 && lo > 8;
      if (k > 0) {
        const out = rings[k - 1];
        for (let i = 0; i < 96 && ok; i++) { const a = (i / 96) * TAU; if (ringR(out, a) - ringR(ring, a) < 2 * span + 14) ok = false; }
      }
      if (ok) break;
      for (let j = 0; j < wob.length; j += 3) wob[j + 1] *= 0.7;
      if (ring.poly) ring.poly.k = ring.poly.k.map((x) => 1 + (x - 1) * 0.8);
      ring.r *= k === 0 ? 0.97 : 0.93;
    }
    rings.push(ring);
  }
  const last = rings.length - 1, outer = rings[0], keep = rings[last];
  // Gates: the outer wall's 1 to the most, spread round; the keep's turned away from them.
  const gate = (k: number, n: number, a: number, barred: boolean): Gate => {
    const R = ringR(rings[k], a);
    return { id: `${p.id}/g${k}.${n}`, ring: k, a, x: p.x + Math.sin(a) * R, z: p.z + Math.cos(a) * R, w: v.fortGateW, t: v.fortGateT, barred };
  };
  const a0 = p.yaw + r() * TAU;
  const mo = Math.max(1, Math.round(v.fortGatesOuter)), nOut = Math.min(mo, 2) + Math.floor(r() * Math.max(1, mo - 1));
  for (let g = 0; g < nOut; g++) outer.gates.push(gate(0, g, a0 + ((g + (r() - 0.5) * 0.35) / nOut) * TAU, true));
  const nKeep = 1 + Math.floor(r() * Math.max(1, Math.round(v.fortGatesKeep)));
  const k0 = a0 + Math.PI / nOut + (r() - 0.5) * 0.8;
  for (let g = 0; g < nKeep; g++) keep.gates.push(gate(last, g, k0 + ((g + (r() - 0.5) * 0.3) / nKeep) * TAU, true));

  // The yards' floors at heading a: from the next ring in (plus its wall) out to this ring's wall, m metres clear.
  const yOut = (k: number, a: number, m: number) => ringR(rings[k], a) - ringSpan(rings[k]) - m;
  const yIn = (k: number, a: number, m: number) => (k < last ? ringR(rings[k + 1], a) + ringSpan(rings[k + 1]) + m : 0);
  const at = (a: number, d: number) => ({ x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d });
  const polar = (x: number, z: number) => ({ d: Math.hypot(x - p.x, z - p.z), a: Math.atan2(x - p.x, z - p.z) });
  /** The yard (x, z) is in, m metres clear of its walls, or -1. */
  const yardAt = (x: number, z: number, m: number) => {
    const { d, a } = polar(x, z);
    for (let k = 0; k <= last; k++) if (d < yOut(k, a, m) && d > yIn(k, a, m) + (k === last ? 0 : 0)) return k;
    return -1;
  };

  // Main streets: in from each outer gate, round the yard (wandering across it), across the middle wall where it
  // crosses, round the inner yard, to the nearest keep gate.
  const streets: Street[] = [];
  const sw = v.fortStreetW;
  const crossAt: number[] = [];
  for (const g of outer.gates) {
    let kg = keep.gates[0];
    for (const q of keep.gates) if (Math.abs(wrapA(q.a - g.a)) < Math.abs(wrapA(kg.a - g.a))) kg = q;
    const da = wrapA(kg.a - g.a);
    // Where it crosses the middle wall: part way round, onto a gate already there if one is near.
    let ac = g.a + da * range(0.3, 0.7);
    if (three) {
      const near = crossAt.find((c) => Math.abs(wrapA(c - ac)) * ringR(rings[1], ac) < v.fortGateW + 10);
      if (near !== undefined) ac = near; else crossAt.push(ac);
    }
    const pts: { x: number; z: number }[] = [at(g.a, ringR(outer, g.a) + ringSpan(outer) + 8)];
    const legs: [number, number, number][] = three ? [[0, g.a, ac], [1, ac, kg.a]] : [[0, g.a, kg.a]];
    for (const [k, sa, ea] of legs) {
      const mid = (a: number) => (yOut(k, a, 0) + yIn(k, a, 0)) / 2;
      const roomAt = (a: number) => Math.max(0, (yOut(k, a, 0) - yIn(k, a, 0)) / 2 - sw / 2 - 2);
      const dA = wrapA(ea - sa), len = Math.abs(dA) * mid(sa);
      const steps = Math.max(2, Math.ceil(len / 9));
      let off = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, a = sa + dA * t;
        off = Math.max(-1, Math.min(1, off + (r() * 2 - 1) * 0.55));
        const env = Math.sin(Math.PI * t);
        pts.push(at(a, mid(a) + off * env * roomAt(a) * v.fortMeander));
      }
    }
    pts.push(at(kg.a, ringR(keep, kg.a) - ringSpan(keep) - 5));
    streets.push({ pts, w: sw, main: true, yard: -1 });
  }
  // The middle wall's gates: where the streets cross; one barred at least, the rest barred by chance or open gaps.
  if (three) crossAt.forEach((a, n) => rings[1].gates.push(gate(1, n, a, n === 0 || r() < v.fortMidBarred)));
  const gates = rings.flatMap((g) => g.gates);
  const clearOfStreetsP = (x: number, z: number, w: number, m: number) => streets.every((s) => streetDist(s, x, z) > s.w / 2 + w / 2 + m);
  const nearGateM = (x: number, z: number, m: number) => gates.some((g) => Math.hypot(g.x - x, g.z - z) < g.w / 2 + m);

  // Back streets: forking off a main street in a yard and running on round it (either way), wandering across it,
  // until they near another street or a gate; they fill the yards the main streets leave empty.
  const bw = (sw + v.fortLaneW) / 2;
  const mains = streets.slice();
  for (let k = 0; k < last; k++) {
    for (let n = 0, tries = 0; n < v.fortBackStreets && tries < v.fortBackStreets * 12; tries++) {
      const par = mains[Math.floor(r() * mains.length)];
      const i = Math.floor(r() * (par.pts.length - 1)), A = par.pts[i], B = par.pts[i + 1], f = r();
      const s0 = { x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f };
      if (yardAt(s0.x, s0.z, bw / 2 + 2) !== k) continue;
      const { a: sa, d: sd } = polar(s0.x, s0.z), dirA = r() < 0.5 ? -1 : 1;
      const pts = [s0];
      let d = sd, a = sa, len = 0;
      const want = range(35, 140);
      while (len < want) {
        const lo = yIn(k, a, bw / 2 + 3), hi = yOut(k, a, bw / 2 + 3);
        const da = (dirA * 8) / Math.max(8, d);
        const nd = Math.max(lo, Math.min(hi, d + (r() * 2 - 1) * 4 * v.fortMeander + (lo + hi - 2 * d) * 0.08));
        const q = at(a + da, nd);
        const away = Math.hypot(q.x - s0.x, q.z - s0.z) > par.w / 2 + bw / 2 + 8;
        if (away && (!clearOfStreetsP(q.x, q.z, bw, 7) || nearGateM(q.x, q.z, 9))) break;
        if (yardAt(q.x, q.z, bw / 2 + 1) !== k) break;
        len += Math.hypot(q.x - pts[pts.length - 1].x, q.z - pts[pts.length - 1].z);
        pts.push(q); a += da; d = nd;
      }
      if (len < 22) continue;
      streets.push({ pts, w: bw, main: false, yard: k });
      n++;
    }
  }

  // Lanes: forking off the streets' yard stretches (now and then off another lane) at a slant, bending once, kept a
  // shack's depth off every other street so both sides can be built.
  const lw = v.fortLaneW;
  const clearOfStreets = (x: number, z: number, w: number, skip: Street | null, m: number) => streets.every((s) => s === skip || streetDist(s, x, z) > s.w / 2 + w / 2 + m);
  const lanes: Street[] = [];
  for (let tries = 0; tries < v.fortLanes * 14 && lanes.length < v.fortLanes; tries++) {
    const parent = lanes.length && r() < 0.35 ? lanes[Math.floor(r() * lanes.length)] : streets[Math.floor(r() * streets.length)];
    if (!parent || parent.pts.length < 3) continue;
    const i = 1 + Math.floor(r() * (parent.pts.length - 3));
    const A = parent.pts[i], B = parent.pts[i + 1];
    const k = yardAt((A.x + B.x) / 2, (A.z + B.z) / 2, 2);
    if (k < 0 || k === last) continue;
    const sl = Math.hypot(B.x - A.x, B.z - A.z);
    if (sl < 3) continue;
    const dir = Math.atan2(B.x - A.x, B.z - A.z), f = range(0.25, 0.75);
    const s0 = { x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f };
    const turn = range(0.8, 1.6) * (r() < 0.5 ? -1 : 1), bend = range(-0.45, 0.45), a1 = dir + turn;
    for (let len = range(8, v.fortLaneLen); len >= 6; len *= 0.7) {
      const b0 = len > 11 ? 0.6 : 1;
      const m = { x: s0.x + Math.sin(a1) * len * b0, z: s0.z + Math.cos(a1) * len * b0 };
      const e = b0 < 1 ? { x: m.x + Math.sin(a1 + bend) * len * (1 - b0), z: m.z + Math.cos(a1 + bend) * len * (1 - b0) } : m;
      const pts = b0 < 1 ? [s0, m, e] : [s0, e];
      let ok = true;
      for (let q = 0; q + 1 < pts.length && ok; q++) {
        const sx = pts[q].x, sz = pts[q].z, L = Math.hypot(pts[q + 1].x - sx, pts[q + 1].z - sz);
        for (let t = 0; t <= L && ok; t += 1.5) {
          const x = sx + ((pts[q + 1].x - sx) * t) / L, z = sz + ((pts[q + 1].z - sz) * t) / L;
          const far = Math.hypot(x - s0.x, z - s0.z) > parent.w / 2 + 1;
          if (far && yardAt(x, z, lw / 2 + 1.5) !== k) ok = false;
          else if (far && !clearOfStreets(x, z, lw, parent, 6.5)) ok = false;
          else if (far && Math.hypot(x - s0.x, z - s0.z) > parent.w + 6 && !clearOfStreets(x, z, lw, null, 6.5)) ok = false;
          else if (nearGateM(x, z, 8)) ok = false;
        }
      }
      if (!ok) continue;
      const lane: Street = { pts, w: lw, main: false, yard: k };
      lanes.push(lane); streets.push(lane);
      break;
    }
  }

  // Shacks: along every street and lane, both sides, doors to it; then a back row; then loose stacks.
  const blocks: Block[] = [];
  const keepArena = Math.max(6, (ringR(keep, 0) - ringSpan(keep)) * 0.55);
  const fits = (b: Block) => {
    const pts = [...corners(b), [b.x, b.z] as [number, number]];
    for (const [x, z] of pts) if (yardAt(x, z, 1) !== b.yard) return false;
    if (b.yard === last && Math.hypot(b.x - p.x, b.z - p.z) < keepArena + Math.hypot(b.len, b.dep) / 2) return false;
    // Off the streets: corners, edge middles and the centre.
    const cs = corners(b, 0.6);
    const probe = [...cs, ...cs.map(([x, z], i) => [(x + cs[(i + 1) % 4][0]) / 2, (z + cs[(i + 1) % 4][1]) / 2] as [number, number]), [b.x, b.z] as [number, number]];
    for (const [x, z] of probe) if (!clearOfStreets(x, z, 0, null, 0.8) || nearGateM(x, z, 6)) return false;
    return !blocks.some((o) => overlaps(o, b, 0.5));
  };
  const shack = (yard: number, cx: number, cz: number, face: number, cols: number, across: boolean): Block => {
    const stack = r() < v.fortTwoHigh ? 2 : 1;
    // across: the containers' long sides run away from the street (their door ends to it); else along it.
    const a = across ? face + Math.PI : face + Math.PI / 2;
    return { x: cx, z: cz, a: a + range(-0.08, 0.08), len: BOX.long, dep: cols * BOX.wide, h: stack * BOX.high - 0.6, stack, cols, door: face, drift: 0.6, driftW: 2, yard, kind: "shack", endOn: across };
  };
  const maxB = Math.round(v.fortBuildings);
  const inAny = (x: number, z: number, m: number) => blocks.some((b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(b.len, b.dep) / 2 + m);
  for (const st of streets) {
    for (let i = 0; i + 1 < st.pts.length && blocks.length < maxB; i++) {
      const A = st.pts[i], B = st.pts[i + 1], L = Math.hypot(B.x - A.x, B.z - A.z);
      if (L < 1) continue;
      const dx = (B.x - A.x) / L, dz = (B.z - A.z) / L;
      for (const sgn of [1, -1]) {
        const ox = dz * sgn, oz = -dx * sgn, face = Math.atan2(-ox, -oz);
        for (let t = 0; t < L && blocks.length < maxB;) {
          const across = r() < 0.65, cols = across ? 1 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
          const alongLen = across ? cols * BOX.wide : BOX.long, depth = across ? BOX.long : cols * BOX.wide;
          const back = st.w / 2 + range(1.2, 2.4) + depth / 2;
          const cx = A.x + dx * (t + alongLen / 2) + ox * back, cz = A.z + dz * (t + alongLen / 2) + oz * back;
          const k = yardAt(cx, cz, 1);
          if (k < 0) { t += 1.5; continue; }
          const b = shack(k, cx, cz, face, cols, across);
          if (!fits(b)) { t += 1.5; continue; }
          blocks.push(b);
          t += alongLen + range(0.5, 2 * v.fortBuildGap) + (r() < 0.12 ? range(5, 10) : 0);
        }
      }
    }
  }
  // The back row: set back 9-16 m behind a street, facing it.
  for (let n = 0, tries = 0; n < v.fortInfill && tries < v.fortInfill * 40 && blocks.length < maxB + v.fortInfill; tries++) {
    const st = streets[Math.floor(r() * streets.length)];
    const i = Math.floor(r() * (st.pts.length - 1)), A = st.pts[i], B = st.pts[i + 1], L = Math.hypot(B.x - A.x, B.z - A.z);
    if (L < 2) continue;
    const f = r(), sgn = r() < 0.5 ? 1 : -1, dx = (B.x - A.x) / L, dz = (B.z - A.z) / L, ox = dz * sgn, oz = -dx * sgn;
    const off = st.w / 2 + range(9, 16), cx = A.x + (B.x - A.x) * f + ox * off, cz = A.z + (B.z - A.z) * f + oz * off;
    const k = yardAt(cx, cz, 1);
    if (k < 0) continue;
    const b = shack(k, cx, cz, Math.atan2(-ox, -oz) + range(-0.3, 0.3), 1 + Math.floor(r() * 2), r() < 0.6);
    if (!fits(b)) continue;
    blocks.push(b); n++;
  }
  // Compounds: three to five shacks round a little court of their own, where the streets left the yard empty.
  for (let k = 0; k < last; k++) {
    for (let n = 0, tries = 0; n < v.fortCompounds && tries < v.fortCompounds * 30; tries++) {
      const a = r() * TAU, d0 = yIn(k, a, 9), d1 = yOut(k, a, 9);
      if (d1 - d0 < 1) continue;
      const c = at(a, d0 + (d1 - d0) * r());
      if (!clearOfStreetsP(c.x, c.z, 0, 9) || inAny(c.x, c.z, 7)) continue;
      const m = 3 + Math.floor(r() * 3), turn = r() * TAU, rad = range(5.5, 8);
      let put = 0;
      for (let q = 0; q < m; q++) {
        const fa = turn + (q / m) * TAU + range(-0.25, 0.25), x = c.x + Math.sin(fa) * rad, z = c.z + Math.cos(fa) * rad;
        const b = shack(k, x, z, fa + Math.PI, 1 + Math.floor(r() * 2), r() < 0.6);
        if (fits(b)) { blocks.push(b); put++; }
      }
      if (put >= 2) n++;
    }
  }
  // Lookout towers: by the gates first (inside, overlooking the way in), then anywhere open; spread apart.
  const towers: Tower[] = [];
  for (let k = 0; k <= last; k++) {
    const want = Math.max(k === last ? 1 : 0, Math.round(v.fortTowers) - k);
    const near = gates.filter((g) => g.ring === k || g.ring === k + 1);
    for (let n = 0, tries = 0; n < want && tries < 60 * want; tries++) {
      let c: { x: number; z: number };
      if (near.length && tries < 30 * want) {
        const g = near[Math.floor(r() * near.length)], side = g.ring === k ? -1 : 1, R = ringR(rings[g.ring], g.a) + side * (ringSpan(rings[g.ring]) + range(5, 14));
        c = at(g.a + ((r() < 0.5 ? -1 : 1) * range(g.w / 2 + 6, g.w / 2 + 16)) / Math.max(10, R), R);
      } else { const a = r() * TAU, d0 = yIn(k, a, 4), d1 = yOut(k, a, 4); if (d1 - d0 < 2) continue; c = at(a, d0 + (d1 - d0) * r()); }
      if (towers.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 30)) continue;
      const a = r() * Math.PI, id = `${p.id}/t${towers.length}`;
      const b: Block = { x: c.x, z: c.z, a, len: BOX.long, dep: 2 * BOX.wide, h: 3 * BOX.high - 0.3, stack: 3, cols: 2, door: 0, drift: 0.8, driftW: 2.5, yard: k, kind: "tower", id };
      if (yardAt(c.x, c.z, 4) !== k || !fits(b)) continue;
      blocks.push(b);
      towers.push({ id, block: blocks.length - 1, x: c.x, z: c.z, a, h: b.h, yard: k });
      n++;
    }
  }
  // Loose stacks: cover out in the open.
  for (let k = 0; k <= last; k++) {
    const want = Math.round(v.fortCover * (k === last ? 0.5 : 1));
    for (let n = 0, tries = 0; n < want && tries < 40 * want; tries++) {
      const a = r() * TAU, d0 = yIn(k, a, 4), d1 = yOut(k, a, 4);
      if (d1 - d0 < 3) continue;
      const c = at(a, d0 + (d1 - d0) * r());
      const stack = r() < 0.5 ? 1 : 2;
      const b: Block = { x: c.x, z: c.z, a: r() * Math.PI, len: BOX.long, dep: BOX.wide, h: stack * BOX.high - 0.3, stack, cols: 1, door: 0, drift: 0.9, driftW: 3, yard: k, kind: "cover" };
      if (!fits(b)) continue;
      blocks.push(b); n++;
    }
  }
  // Spawners: door-end shacks by the streets, spread round each yard (not the keep), the doors of the middle container.
  const spawners: Spawner[] = [];
  for (let k = 0; k < last; k++) {
    const cand = blocks.map((_, n) => n).filter((n) => {
      const b = blocks[n];
      return b.yard === k && b.kind === "shack" && b.endOn && b.cols % 2 === 1 && streets.some((st) => streetDist(st, b.x + Math.sin(b.door) * (b.len / 2 + 3), b.z + Math.cos(b.door) * (b.len / 2 + 3)) < st.w / 2 + 1);
    });
    for (let t = 0; t < 40 && spawners.filter((q) => q.yard === k).length < v.fortSpawners && cand.length; t++) {
      const n = cand.splice(Math.floor(r() * cand.length), 1)[0], b = blocks[n];
      const x = b.x + Math.sin(b.door) * (b.len / 2), z = b.z + Math.cos(b.door) * (b.len / 2);
      if (spawners.some((q) => Math.hypot(q.x - x, q.z - z) < 28)) continue;
      spawners.push({ id: `${p.id}/s${spawners.length}`, block: n, x, z, a: b.door, yard: k });
    }
  }
  let reach = 0;
  for (const ring of rings) reach = Math.max(reach, ringExtent(ring)[1] + ringSpan(ring));
  return { poi: p.id, x: p.x, z: p.z, rings, blocks, streets, spawners, towers, reach: reach + 1 };
}

const BOX_TONES: Tone[] = ["rust", "olive", "steel", "rust", "dark", "hazard", "hull", "olive"];
const YARD_NAMES = ["outer yard", "inner yard", "keep"];
const YARD_LABELS = ["crate stack", "fuel cell", "parts cage", "engine block", "weapon rack", "salvage pile"];

/** Is world heading a within margin (m) of the edge of a gate's gap on this ring? */
function nearGate(ring: Ring, a: number, margin: number) {
  const R = ringR(ring, a);
  return ring.gates.some((g) => Math.abs(wrapA(a - g.a)) * R < g.w / 2 + margin);
}

/** Metres of wall line per radian of heading at a. */
function runK(ring: Ring, a: number) {
  const e = 1e-3, R = ringR(ring, a), dR = (ringR(ring, a + e) - ringR(ring, a - e)) / (2 * e);
  return Math.max(1, Math.hypot(R, dR));
}

/** Heading of the ring's line at heading a (the tangent, for laying containers along it). */
function along(ring: Ring, a: number) {
  const e = 1e-3, R = ringR(ring, a), dR = (ringR(ring, a + e) - ringR(ring, a - e)) / (2 * e);
  const tx = Math.cos(a) * R + Math.sin(a) * dR, tz = -Math.sin(a) * R + Math.cos(a) * dR;
  return Math.atan2(tx, tz);
}

/** Is (x, z) on or within m of a block's footprint? */
export function inBlock(L: Layout, x: number, z: number, m: number) {
  for (const n of blocksNear(L, x, z)) {
    const b = L.blocks[n], bx = x - b.x, bz = z - b.z, ca = Math.cos(b.a), sa = Math.sin(b.a);
    if (Math.abs(bx * sa + bz * ca) < b.len / 2 + m && Math.abs(bx * ca - bz * sa) < b.dep / 2 + m) return true;
  }
  return false;
}

export function buildFortress(p: PoiPlacement, v: FortValues): PoiSite {
  const b = new SiteBuilder(p);
  const L = fortLayout(p, v);
  const rings = L.rings;
  // World (x, z) to the builder's local frame.
  const ca = Math.cos(p.yaw), sa = Math.sin(p.yaw);
  const loc = (x: number, z: number): [number, number] => { const dx = x - p.x, dz = z - p.z; return [dx * ca - dz * sa, dx * sa + dz * ca]; };
  // A prop's y is from the ground under its centre; on a wall's line that ground is the container plug (h).
  const box = (x: number, z: number, cy: number, size: [number, number, number], tone: Tone, yaw: number, pitch = 0, roll = 0, door = 1) => {
    const [lx, lz] = loc(x, z);
    b.prop("box", lx, lz, cy, size, tone, yaw - p.yaw, pitch, roll);
    // The doors' end: a darker plate (door 1: at +z of the box, -1: at -z, 0: none).
    if (size[2] > 4 && door) b.prop("box", lx + door * Math.sin(yaw - p.yaw) * (size[2] / 2 + 0.02), lz + door * Math.cos(yaw - p.yaw) * (size[2] / 2 + 0.02), cy, [size[0] * 0.96, size[1] * 0.94, 0.06], "dark", yaw - p.yaw, pitch, roll);
  };

  // The walls: containers along every ring's line, stood on end or stacked two high lying along it, leaving the gates.
  for (const ring of rings) {
    let a = 0;
    const end = Math.PI * 2;
    while (a < end) {
      const upright = b.r() < v.fortUpright;
      const len = upright ? BOX.wide : BOX.long;
      const mid = a + (len / 2) / runK(ring, a);
      if (nearGate(ring, mid, len / 2 + 0.2)) { a += 0.6 / runK(ring, a); continue; }
      const Rm = ringR(ring, mid), x = p.x + Math.sin(mid) * Rm, z = p.z + Math.cos(mid) * Rm, yaw = along(ring, mid);
      const tone = b.one(BOX_TONES);
      if (upright) {
        // On end, sunk a little, leaning a touch; some a little taller (sunk less).
        const sink = b.range(0.2, 0.8);
        box(x, z, BOX.long / 2 - sink - ring.h, [BOX.high, BOX.long, BOX.wide], tone, yaw + Math.PI / 2 + b.jit(0.08), b.jit(0.05), b.jit(0.05));
      } else {
        box(x, z, BOX.high / 2 - 0.15 - ring.h, [BOX.wide, BOX.high, BOX.long], tone, yaw + b.jit(0.03));
        box(x + b.jit(0.15), z + b.jit(0.15), BOX.high * 1.5 - 0.15 - ring.h, [BOX.wide, BOX.high, BOX.long], b.one(BOX_TONES), yaw + b.jit(0.08), 0, b.jit(0.02));
      }
      // Spikes and a scrap flag now and then: a fortress skyline.
      if (b.r() < 0.08) { const [lx, lz] = loc(x, z); b.prop("rib", lx, lz, 3 - ring.h + 3.5, [0.3, 0.3, b.range(3, 5)], "dark", yaw - p.yaw, Math.PI / 2 - b.jit(0.2), 0); }
      a += (len + 0.06) / runK(ring, a);
    }
    // Gateposts: a dark container on end each side of every gate.
    for (const g of ring.gates) {
      const R = ringR(ring, g.a), yaw = along(ring, g.a);
      for (const s of [-1, 1]) {
        const a2 = g.a + (s * (g.w / 2 + BOX.wide / 2)) / R, R2 = ringR(ring, a2);
        box(p.x + Math.sin(a2) * R2, p.z + Math.cos(a2) * R2, BOX.long / 2 - 0.2 - ring.h, [BOX.high, BOX.long, BOX.wide], "dark", yaw + Math.PI / 2);
      }
    }
  }
  // The shacks and stacks: containers side by side (cols) and stacked, door ends or a door plate to the street, an
  // awning or a lean-to sheet now and then, a barrel by the door.
  for (const k of L.blocks) {
    if (k.kind === "tower") continue; // drawn live (src/pois/towersDraw.ts): they topple
    const ux = Math.sin(k.a), uz = Math.cos(k.a), wx = Math.cos(k.a), wz = -Math.sin(k.a);
    // Does the door face +u (the long axis' far end), or the side (the street runs along the long side)?
    const fu = Math.sin(k.door) * ux + Math.cos(k.door) * uz, endOn = Math.abs(fu) > 0.7;
    const tone = b.one(BOX_TONES);
    for (let j = 0; j < k.stack; j++) {
      const n = j > 0 && k.cols > 1 && b.r() < 0.4 ? k.cols - 1 : k.cols;
      for (let c = 0; c < n; c++) {
        const off = (c - (k.cols - 1) / 2) * BOX.wide;
        const t = k.kind === "shack" && b.r() < 0.6 ? tone : b.one(BOX_TONES);
        box(k.x + wx * off + b.jit(0.08), k.z + wz * off + b.jit(0.08), BOX.high * (j + 0.5) - 0.15 - k.h, [BOX.wide, BOX.high, BOX.long], t, k.a + b.jit(0.04), 0, 0, endOn && j === 0 ? Math.sign(fu) : 0);
      }
    }
    if (k.kind !== "shack") continue;
    const dx = Math.sin(k.door), dz = Math.cos(k.door);
    const depth = endOn ? k.len : k.dep, width = endOn ? k.dep : k.len;
    if (!endOn) {
      // Door plates cut in the long side facing the street.
      for (let c = 0; c < Math.min(2, k.cols); c++) {
        const [lx, lz] = loc(k.x + dx * (depth / 2 + 0.02) + ux * b.jit(1.5), k.z + dz * (depth / 2 + 0.02) + uz * b.jit(1.5));
        b.prop("box", lx, lz, BOX.high / 2 - 0.2 - k.h, [1.4, 2.1, 0.06], "dark", k.door - p.yaw, 0, 0);
      }
    }
    if (b.r() < 0.45) {
      // An awning out over the street side.
      const [lx, lz] = loc(k.x + dx * (depth / 2 + 1.1), k.z + dz * (depth / 2 + 1.1));
      b.prop("cloth", lx, lz, BOX.high + 0.1 - k.h + 0.6, [width * 0.9, 0.05, 2.4], "cloth", k.door - p.yaw, -0.25, b.jit(0.08));
    }
    if (b.r() < 0.35) {
      const [lx, lz] = loc(k.x + dx * (depth / 2 + 0.8) + ux * b.jit(width / 2), k.z + dz * (depth / 2 + 0.8) + uz * b.jit(width / 2));
      b.prop("cyl", lx, lz, 0.45, [0.32, 0.9, 0.32], b.one(["rust", "olive", "hazard"] as const), 0, 0, 0);
    }
    if (k.stack > 1 && b.r() < 0.25) { const [lx, lz] = loc(k.x, k.z); b.prop("rib", lx, lz, BOX.high * 2 + 1.5 - k.h, [0.15, 0.15, b.range(2.5, 4)], "dark", 0, Math.PI / 2, 0); }
  }

  const clear = (x: number, z: number, m: number) => !inBlock(L, x, z, m);
  // A point by a street in yard k: on its edge, off the shacks.
  const yardOf = (x: number, z: number) => {
    const d = Math.hypot(x - p.x, z - p.z), a = Math.atan2(x - p.x, z - p.z);
    let n = 0;
    for (const ring of rings) if (d < ringR(ring, a) - ringSpan(ring) - 1) n++; else break;
    // n rings enclose it (clear of their walls); it's in yard n - 1 if it's also clear of the next one in.
    if (n === 0) return -1;
    const k = n - 1, next = rings[k + 1];
    if (next && d < ringR(next, a) + ringSpan(next) + 1) return -1;
    return k;
  };
  const byStreet = (k: number, edge: [number, number]): [number, number] | null => {
    for (let t = 0; t < 60; t++) {
      const st = b.one(L.streets);
      const i = Math.floor(b.r() * (st.pts.length - 1)), A = st.pts[i], B = st.pts[i + 1], f = b.r();
      const Lg = Math.hypot(B.x - A.x, B.z - A.z) || 1, s = b.r() < 0.5 ? 1 : -1;
      const off = st.w / 2 * b.range(edge[0], edge[1]);
      const x = A.x + (B.x - A.x) * f + ((B.z - A.z) / Lg) * s * off, z = A.z + (B.z - A.z) * f - ((B.x - A.x) / Lg) * s * off;
      if (yardOf(x, z) === k && clear(x, z, 1.5)) return [x, z];
    }
    return null;
  };

  for (let k = 0; k < rings.length; k++) {
    const keep = k === rings.length - 1;
    const sec = b.section(keep ? YARD_NAMES[2] : YARD_NAMES[Math.min(k, 1)]);
    if (keep) {
      // The vault: a hull section dug in at the centre, the big strip; the warlord's yard round it.
      const [cx, cz] = loc(p.x, p.z);
      b.prop("arc", cx, cz, 0.6, [9, 0.5, 7], "hull", b.r() * 6.28, 0, 0);
      b.prop("box", cx, cz, 0.9, [3.4, 1.8, 2.6], "hazard", b.r() * 6.28, 0, 0);
      b.spot(sec, cx, cz, 1.2, v.fortVaultValue, v.fortVaultTime, "vault");
      for (let i = 0; i < 2; i++) {
        const a = b.r() * 6.28, R = (ringR(rings[k], a) - ringSpan(rings[k])) * b.range(0.35, 0.6);
        const x = p.x + Math.sin(a) * R, z = p.z + Math.cos(a) * R;
        if (!clear(x, z, 1)) continue;
        const [lx, lz] = loc(x, z);
        b.prop("box", lx, lz, 0.4, [b.range(1.4, 2), b.range(0.8, 1.2), b.range(1.2, 1.8)], "olive", b.r() * 6.28, 0, 0);
        b.spot(sec, lx, lz, 0.8, v.fortSpotValue * 1.5, v.fortSpotTime, b.one(YARD_LABELS));
      }
      continue;
    }
    // Salvage piled by the street fronts.
    const n = Math.max(1, Math.round(v.fortYardSpots));
    for (let i = 0; i < n; i++) {
      const q = byStreet(k, [0.55, 0.9]);
      if (!q) continue;
      const [lx, lz] = loc(q[0], q[1]);
      b.prop("box", lx, lz, 0.4, [b.range(1.2, 2.2), b.range(0.6, 1.4), b.range(1, 2)], b.one(["steel", "olive", "rust"] as const), b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      if (b.r() < 0.5) b.prop("cloth", lx + b.jit(2), lz + b.jit(2), 1.4, [b.range(3, 5), 0.05, b.range(3, 4)], "cloth", b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      b.spot(sec, lx, lz, 0.8, v.fortSpotValue * b.range(0.8, 1.25) * (1 + 0.4 * k), v.fortSpotTime * b.range(0.85, 1.2), b.one(YARD_LABELS));
    }
    // Clutter along the streets and round the back, fire scars.
    const nc = Math.round(v.fortClutter / rings.length);
    for (let i = 0; i < nc; i++) {
      const q = byStreet(k, [0.3, 2.2]);
      if (!q) continue;
      const [lx, lz] = loc(q[0], q[1]), s = b.range(0.5, 1.4), w = b.r(), tone = b.one(["steel", "rust", "dark", "olive"] as const);
      if (w < 0.45) b.prop("box", lx, lz, -0.1 * s, [s * b.range(0.6, 1.6), s * b.range(0.15, 0.5), s * b.range(0.5, 1.4)], tone, b.r() * 6.28, b.jit(0.5), b.jit(0.5));
      else if (w < 0.75) b.prop("box", lx, lz, 0.05, [s * b.range(1.2, 2.6), 0.08, s * b.range(0.8, 1.8)], tone, b.r() * 6.28, b.jit(0.25), b.jit(0.25));
      else b.prop("cyl", lx, lz, 0.4, [0.5, 1.2, 0.5], "rust", b.r() * 6.28, 0, 0);
    }
    for (let i = 0; i < 3; i++) {
      const q = byStreet(k, [0, 0.6]);
      if (!q) continue;
      const [lx, lz] = loc(q[0], q[1]);
      b.prop("disc", lx, lz, 0, [b.range(2, 4), 0, b.range(2, 4)], "scorch", b.r() * 6.28);
    }
  }
  return b.done();
}
