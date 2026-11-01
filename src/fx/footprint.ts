// Footprint shapes (Keith 2026-11-01: every leg's print in the shape of its own foot). A shape is baked once from a
// foot's triangles when its model loads: the sole is looked at from below, every point within `contact` m of the
// lowest point of the foot counts as pressing the sand, and the outline becomes a signed distance field (metres,
// negative inside) on a small square tile. The dent pass (src/fx/dents.ts, src/fx/dentRule.ts) reads the tile in
// place of its capsule: full depth more than `wall` in from the outline, the rim on it, the berm out to `spread`.
//
// Pure (no three.js): triangles in, numbers out, so headless checks can bake and splat. The tiles live in one atlas
// (MAX_SHAPES tiles of TILE x TILE floats, side by side) that the dent layer uploads when `version` changes.
//
// Foot frame: x across (+X the mech's left), z along the foot (+Z its toes), y up; the origin is the foot point on the
// ground (where the walker plants the foot, Foot.planted). Cosmetic: prints are looks only.
import { CORE_IN, CORE_OUT, RING_AT, RING_K, REACH, smoothstep } from "./dentRule";

/** Texels across one tile, and tiles in the atlas. */
export const TILE = 48, MAX_SHAPES = 32;
/** Room left round the sole in a tile (m, in the foot's own size): the berm's reach must fit. */
export const TILE_PAD = 0.45;
/** Stored distances are clamped to this (m): past it nothing is marked anyway. */
const SDF_CAP = 1;

export interface FootShape {
  key: string;
  /** Atlas tile (0..MAX_SHAPES-1); the dent brush carries index + 1 (0: the capsule). */
  index: number;
  /** Half the tile's width (m, the foot's own size): the tile spans -ext..ext on x and z. */
  ext: number;
  /** Sole size (m): across and along, and the share of the tile's cells pressing (for checks and the HUD). */
  width: number; length: number; area: number;
  /** The tile's signed distances (m), row z, column x: TILE * TILE. */
  sdf: Float32Array;
}

interface Source { tris: Float32Array; contact: number }

/** One atlas for every shape: TILE * MAX_SHAPES wide, TILE tall, one float per texel (metres, signed). */
export const footAtlas = new Float32Array(TILE * MAX_SHAPES * TILE).fill(SDF_CAP);
const shapes: FootShape[] = [];
const byKey = new Map<string, FootShape>();
const sources = new Map<string, Source>();
/** Keys that baked to nothing or found the atlas full: not tried again (footShapeOr). */
const failed = new Set<string>();
let atlasVersion = 0;
/** Bumped whenever a tile changes: the dent layer re-uploads the atlas. */
export const footAtlasVersion = () => atlasVersion;

/** The shape baked under a key (a legs look and side, "rampart:L"; "strider"), or null. */
export const footShape = (key: string): FootShape | null => byKey.get(key) ?? null;
/** The shape under a key, baking it with `bake` the first time (and never retrying a bake that came to nothing). */
export function footShapeOr(key: string, bake: () => FootShape | null): FootShape | null {
  const s = byKey.get(key);
  if (s || failed.has(key)) return s ?? null;
  return bake();
}
/** The shape in a tile (index from a brush). */
export const footShapeAt = (index: number): FootShape | null => shapes[index] ?? null;

/**
 * Bake a foot's print from its triangles (xyz per vertex, three vertices per triangle, in the foot frame above) and
 * keep it under `key`. contact: how far above the sole's lowest point still presses into the sand (m). Baking the
 * same key again (a slider, a refitted model) reuses its tile. Null when the atlas is full or nothing touches.
 */
export function bakeFootShape(key: string, tris: Float32Array, contact = 0.12): FootShape | null {
  sources.set(key, { tris, contact });
  const s = bake(key, tris, contact);
  if (!s) { if (!byKey.has(key)) failed.add(key); return null; }
  const old = byKey.get(key);
  // Variants that share a foot model share its tile.
  const twin = old ? null : shapes.find((o) => o.ext === s.ext && o.sdf.every((d, c) => d === s.sdf[c]));
  if (twin) { byKey.set(key, twin); return twin; }
  if (old) s.index = old.index;
  else if (shapes.length >= MAX_SHAPES) { failed.add(key); console.warn(`footprint: atlas full, ${key} keeps the plain print`); return null; }
  else s.index = shapes.length;
  shapes[s.index] = s;
  byKey.set(key, s);
  writeTile(s);
  return s;
}

/** Re-bake every shape for a new contact height (the Footprint contact slider). Cheap; only when it changes. */
let lastContact = -1;
export function setFootContact(contact: number) {
  if (contact === lastContact) return;
  lastContact = contact;
  for (const [key, src] of sources) if (src.contact !== contact) bakeFootShape(key, src.tris, contact);
}

function writeTile(s: FootShape) {
  const W = TILE * MAX_SHAPES;
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) footAtlas[j * W + s.index * TILE + i] = s.sdf[j * TILE + i];
  atlasVersion++;
}

/** The bake: the sole from below, its outline as signed distances. */
function bake(key: string, tris: Float32Array, contact: number): FootShape | null {
  const nt = Math.floor(tris.length / 9);
  if (!nt) return null;
  let minY = Infinity;
  for (let v = 1; v < nt * 9; v += 3) minY = Math.min(minY, tris[v]);
  const top = minY + Math.max(0.005, contact);
  // The tile: square round the origin, out to the farthest point of any triangle reaching down into the contact band.
  let far = 0;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    if (Math.min(tris[o + 1], tris[o + 4], tris[o + 7]) > top) continue;
    for (let k = 0; k < 3; k++) far = Math.max(far, Math.abs(tris[o + k * 3]), Math.abs(tris[o + k * 3 + 2]));
  }
  if (far <= 0) return null;
  const ext = far + TILE_PAD, cell = (2 * ext) / TILE;
  // Lowest point of the foot over each texel's centre (a height map from below).
  const low = new Float32Array(TILE * TILE).fill(Infinity);
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ay = tris[o + 1], by = tris[o + 4], cy = tris[o + 7];
    if (Math.min(ay, by, cy) > top) continue;
    const ax = tris[o], az = tris[o + 2], bx = tris[o + 3], bz = tris[o + 5], cx = tris[o + 6], cz = tris[o + 8];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-10) continue; // edge-on from below: a wall
    const toI = (x: number) => (x + ext) / cell - 0.5;
    const i0 = Math.max(0, Math.floor(toI(Math.min(ax, bx, cx)))), i1 = Math.min(TILE - 1, Math.ceil(toI(Math.max(ax, bx, cx))));
    const j0 = Math.max(0, Math.floor(toI(Math.min(az, bz, cz)))), j1 = Math.min(TILE - 1, Math.ceil(toI(Math.max(az, bz, cz))));
    for (let j = j0; j <= j1; j++) {
      const pz = -ext + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = -ext + (i + 0.5) * cell;
        const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
        const w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        const y = w1 * ay + w2 * by + w3 * cy, c = j * TILE + i;
        if (y < low[c]) low[c] = y;
      }
    }
  }
  const inside = new Uint8Array(TILE * TILE);
  let n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
    if (low[j * TILE + i] > top) continue;
    inside[j * TILE + i] = 1; n++;
    const px = -ext + (i + 0.5) * cell, pz = -ext + (j + 0.5) * cell;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
  }
  if (!n) return null;
  // Signed distance (brute force over the boundary texels: a few thousand per tile, once at load). The outline sits
  // half a texel past the last texel in, so the distance is to the nearest texel of the other kind less half a cell.
  const edgeIn: number[] = [], edgeOut: number[] = [];
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
    const c = j * TILE + i, me = inside[c];
    const diff = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < TILE && jj < TILE && inside[jj * TILE + ii] !== me;
    if (diff(i - 1, j) || diff(i + 1, j) || diff(i, j - 1) || diff(i, j + 1)) (me ? edgeIn : edgeOut).push(i, j);
  }
  const sdf = new Float32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
    const c = j * TILE + i, me = inside[c], other = me ? edgeOut : edgeIn;
    let best = Infinity;
    for (let k = 0; k < other.length; k += 2) {
      const dx = other[k] - i, dz = other[k + 1] - j, d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    // With nothing of the other kind (a sole filling the tile), as far as it gets.
    const d = Number.isFinite(best) ? Math.max(0, Math.sqrt(best) - 0.5) * cell : SDF_CAP;
    sdf[c] = Math.max(-SDF_CAP, Math.min(SDF_CAP, me ? -d : d));
  }
  return { key, index: -1, ext, width: x1 - x0 + cell, length: z1 - z0 + cell, area: n * cell * cell, sdf };
}

/** The shape's signed distance (m, the foot's own size) at (x across, z along) in the foot frame: bilinear. */
export function footSdf(s: FootShape, x: number, z: number): number {
  const u = ((x / s.ext) * 0.5 + 0.5) * TILE - 0.5, v = ((z / s.ext) * 0.5 + 0.5) * TILE - 0.5;
  const i = Math.min(TILE - 2, Math.max(0, Math.floor(u))), j = Math.min(TILE - 2, Math.max(0, Math.floor(v)));
  const fu = Math.min(1, Math.max(0, u - i)), fv = Math.min(1, Math.max(0, v - j));
  const a = s.sdf[j * TILE + i], b = s.sdf[j * TILE + i + 1], c = s.sdf[(j + 1) * TILE + i], d = s.sdf[(j + 1) * TILE + i + 1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/** A signed distance as the dent rule's distance (1 on the outline): `wall` m inward to full depth, `spread` m outward. */
export const shapeDist = (sdf: number, wall: number, spread: number) => Math.max(0, 1 + sdf / (sdf < 0 ? wall : spread));

/** Ring height per metre of depth that keeps the mass for this shape (the capsule's bermRatio, for a shaped print). */
const ratios = new Map<string, number>();
export function shapeBermRatio(s: FootShape, wall: number, spread: number): number {
  const k = `${s.key}|${s.index}|${atlasVersion}|${wall}|${spread}`;
  let r = ratios.get(k);
  if (r === undefined) {
    let core = 0, ring = 0;
    for (let c = 0; c < s.sdf.length; c++) {
      const d = shapeDist(s.sdf[c], wall, spread);
      core += 1 - smoothstep(CORE_IN, CORE_OUT, d);
      if (d < REACH) { const q = (d - RING_AT) * RING_K; ring += Math.exp(-q * q); }
    }
    r = ring > 0 ? core / ring : 0;
    if (ratios.size > 64) ratios.clear();
    ratios.set(k, r);
  }
  return r;
}

/** Bake a round pad of radius r (m) under `key` (a foot with no model to sample: a peg, a drum). */
export function bakeDiscFoot(key: string, r: number, segs = 20, contact = 0.05): FootShape | null {
  const tris = new Float32Array(segs * 9);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, o = i * 9;
    tris.set([0, 0, 0, Math.sin(a0) * r, 0, Math.cos(a0) * r, Math.sin(a1) * r, 0, Math.cos(a1) * r], o);
  }
  return bakeFootShape(key, tris, contact);
}
