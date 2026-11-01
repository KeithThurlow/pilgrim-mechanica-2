// Tier 5, Siege: a bandit fortress (Keith 2026-10-31, docs/proposal-fortresses.md; reworked after his playtest
// 2026-11-01: "bandits having found things like containers to fortify an area... standing containers up in the sand").
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
  fortOuter: 84,
  fortMiddle: 58,
  fortKeep: 24,
  fortThree: 0.6,
  fortSizeJit: 0.12,
  fortWobble: 0.09,
  fortShift: 0.12,
  fortWallH: 5,
  fortWallTop: 0.8,
  fortWallFace: 0.35,
  fortDrift: 2.2,
  fortDriftW: 6,
  fortGatesOuter: 3,
  fortGatesMiddle: 2,
  fortGatesKeep: 1,
  fortGateW: 10,
  fortGateT: 3,
  fortUpright: 0.55,
  fortCover: 5,
  fortYardSpots: 5,
  fortSpotValue: 70,
  fortSpotTime: 4,
  fortVaultValue: 900,
  fortVaultTime: 8,
  fortClutter: 70,
};
export type FortValues = typeof FORT_DEFAULTS & { fortPad: number };

const G = "Fortress: layout", W = "Fortress: walls", S = "Fortress: salvage";
export const FORT_PARAMS: Param[] = [
  { key: "fortPad", label: "Pad radius (m)", min: 40, max: 200, step: 1, group: G, tip: "The levelled ground it stands on; the walls are kept inside it", onRelease: true },
  { key: "fortOuter", label: "Outer wall radius (m)", min: 30, max: 190, step: 1, group: G, onRelease: true },
  { key: "fortMiddle", label: "Middle wall radius (m)", min: 0, max: 150, step: 1, group: G, tip: "0: never a middle ring", onRelease: true },
  { key: "fortKeep", label: "Keep wall radius (m)", min: 8, max: 80, step: 1, group: G, onRelease: true },
  { key: "fortThree", label: "Chance of three rings", min: 0, max: 1, step: 0.05, group: G, tip: "Else two: the outer wall and the keep", onRelease: true },
  { key: "fortSizeJit", label: "Ring size varies (±share)", min: 0, max: 0.3, step: 0.01, group: G, onRelease: true },
  { key: "fortWobble", label: "Ring wobble (share of radius)", min: 0, max: 0.25, step: 0.005, group: G, tip: "Lumps in each ring's line", onRelease: true },
  { key: "fortShift", label: "Inner rings off centre (share)", min: 0, max: 0.3, step: 0.01, group: G, onRelease: true },
  { key: "fortGatesOuter", label: "Gates in the outer wall, at most", min: 1, max: 6, step: 1, group: G, tip: "Each fortress rolls 1 to this", onRelease: true },
  { key: "fortGatesMiddle", label: "Gates in the middle wall, at most", min: 1, max: 6, step: 1, group: G, onRelease: true },
  { key: "fortGatesKeep", label: "Gates in the keep wall, at most", min: 1, max: 4, step: 1, group: G, onRelease: true },
  { key: "fortGateW", label: "Gate width (m)", min: 5, max: 24, step: 0.5, group: G, onRelease: true },
  { key: "fortGateT", label: "Gate thickness (m)", min: 1, max: 6, step: 0.1, group: G, tip: "The steel barricade plugging the gap while it stands", onRelease: true },
  { key: "fortCover", label: "Container stacks per yard (cover)", min: 0, max: 20, step: 1, group: G, onRelease: true },
  { key: "fortClutter", label: "Clutter in the yards", min: 0, max: 300, step: 1, group: G, onRelease: true },
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
 * A wall ring round the centre. Its line is at radius r × (1 + Σ amp·sin(k·a + phase)) for each [k, amp, phase] in
 * `wob` (k = 1 pushes it off centre); along the line a solid core of height h, flat top half-width `top`, faces
 * `face` wide, and a sand drift of height `drift` falling off over `driftW` either side.
 */
export interface Ring { r: number; h: number; top: number; face: number; gates: Gate[]; wob: number[]; drift: number; driftW: number }

/** A loose container stack in a yard (cover): a box of len × dep footprint and height h at (x, z), long side along heading a. */
export interface Block { x: number; z: number; a: number; len: number; dep: number; h: number; stack: number }

export interface Layout {
  poi: string;
  x: number; z: number;
  /** Rings from the outside in. */
  rings: Ring[];
  /** Container stacks standing loose in the yards. */
  blocks: Block[];
  /** Furthest any wall reaches from the centre (m). */
  reach: number;
}

/** A plain round ring (no wobble, no drift). */
export const roundRing = (r: number, h: number, top: number, face: number, gates: Gate[]): Ring => ({ r, h, top, face, gates, wob: [], drift: 0, driftW: 0 });

/** A ring's radius at world heading a (from the layout's centre). */
export function ringR(ring: Ring, a: number) {
  let k = 1;
  const w = ring.wob;
  for (let j = 0; j < w.length; j += 3) k += w[j + 1] * Math.sin(w[j] * a + w[j + 2]);
  return ring.r * k;
}

/** How far a ring's wall reaches either side of its line (m). */
export const ringSpan = (ring: Ring) => ring.top + ring.face + Math.max(ring.driftW, 0) * (ring.drift > 0 ? 1 : 0);

/** A ring's least and greatest radius round the circle. */
export function ringExtent(ring: Ring): [number, number] {
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 96; i++) { const R = ringR(ring, (i / 96) * Math.PI * 2); lo = Math.min(lo, R); hi = Math.max(hi, R); }
  return [lo, hi];
}

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function fortLayout(p: PoiPlacement, v: FortValues): Layout {
  const r = rng(p.seed ^ 0x5f0f7);
  const jit = (x: number) => x * (1 + (r() * 2 - 1) * v.fortSizeJit);
  const three = v.fortMiddle > v.fortKeep + 8 && v.fortMiddle < v.fortOuter - 8 && r() < v.fortThree;
  const rs = [jit(v.fortOuter)];
  if (three) rs.push(jit(v.fortMiddle));
  rs.push(Math.min(jit(v.fortKeep), v.fortOuter - 8));
  const maxN = three ? [v.fortGatesOuter, v.fortGatesMiddle, v.fortGatesKeep] : [v.fortGatesOuter, v.fortGatesKeep];
  const rings: Ring[] = [];
  const span = v.fortWallTop + v.fortWallFace + v.fortDriftW;
  let a0 = p.yaw + r() * Math.PI * 2;
  for (let k = 0; k < rs.length; k++) {
    // The line: two or three lumps, inner rings also pushed off centre.
    const wob: number[] = [];
    for (let h = 2; h <= 4; h++) wob.push(h, (v.fortWobble * (0.4 + 0.6 * r())) / (h - 1), r() * Math.PI * 2);
    if (k > 0) wob.push(1, v.fortShift * r(), r() * Math.PI * 2);
    const ring: Ring = { r: rs[k], h: v.fortWallH, top: v.fortWallTop, face: v.fortWallFace, gates: [], wob, drift: v.fortDrift, driftW: v.fortDriftW };
    // Keep it inside the pad (outer) or inside the ring outside it with a yard between; shrink the wobble till it fits.
    for (let t = 0; t < 12; t++) {
      const [lo, hi] = ringExtent(ring);
      let ok = hi + span <= v.fortPad - 2 && lo > 8;
      if (k > 0) {
        const out = rings[k - 1];
        for (let i = 0; i < 96 && ok; i++) { const a = (i / 96) * Math.PI * 2; if (ringR(out, a) - ringR(ring, a) < 2 * span + 14) ok = false; }
      }
      if (ok) break;
      for (let j = 0; j < wob.length; j += 3) wob[j + 1] *= 0.7;
      ring.r *= k === 0 ? 0.97 : 0.93;
    }
    // Gates: 1 to the most, spread round with a little jitter, the first turned away from the ring outside's.
    const n = 1 + Math.floor(r() * Math.max(1, Math.round(maxN[k])));
    if (k > 0) a0 += Math.PI / Math.max(1, rings[k - 1].gates.length) + (r() - 0.5) * 0.6;
    for (let g = 0; g < n; g++) {
      const a = a0 + ((g + (r() - 0.5) * 0.35) / n) * Math.PI * 2, R = ringR(ring, a);
      ring.gates.push({ id: `${p.id}/g${k}.${g}`, ring: k, a, x: p.x + Math.sin(a) * R, z: p.z + Math.cos(a) * R, w: v.fortGateW, t: v.fortGateT, barred: true });
    }
    rings.push(ring);
  }
  // Cover: container stacks loose in each yard, clear of the ways from gate to gate.
  const blocks: Block[] = [];
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k], next = rings[k + 1];
    const n = Math.round(v.fortCover * (k === rings.length - 1 ? 0.5 : 1));
    for (let i = 0, tries = 0; i < n && tries < 40 * n; tries++) {
      const a = r() * Math.PI * 2;
      const gates = [...ring.gates, ...(next?.gates ?? [])];
      if (gates.some((g) => Math.abs(wrapA(a - g.a)) * ringR(ring, a) < g.w / 2 + 12)) continue;
      const R1 = ringR(ring, a) - span - 6, R0 = next ? ringR(next, a) + span + 6 : 7;
      if (R1 - R0 < 4) continue;
      const d = R0 + (R1 - R0) * r();
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < 14)) continue;
      const stack = r() < 0.5 ? 1 : 2;
      blocks.push({ x, z, a: r() * Math.PI, len: BOX.long, dep: BOX.wide, h: stack * BOX.high - 0.3, stack });
      i++;
    }
  }
  let reach = 0;
  for (const ring of rings) reach = Math.max(reach, ringExtent(ring)[1] + ringSpan(ring));
  return { poi: p.id, x: p.x, z: p.z, rings, blocks, reach: reach + 1 };
}

const BOX_TONES: Tone[] = ["rust", "olive", "steel", "rust", "dark", "hazard", "hull", "olive"];
const YARD_NAMES = ["outer yard", "inner yard", "keep"];
const YARD_LABELS = ["crate stack", "fuel cell", "parts cage", "engine block", "weapon rack", "salvage pile"];

/** Is world heading a within margin (m) of the edge of a gate's gap on this ring? */
function nearGate(ring: Ring, a: number, margin: number) {
  const R = ringR(ring, a);
  return ring.gates.some((g) => Math.abs(wrapA(a - g.a)) * R < g.w / 2 + margin);
}

/** Heading of the ring's line at heading a (the tangent, for laying containers along it). */
function along(ring: Ring, a: number) {
  const e = 1e-3, R = ringR(ring, a), dR = (ringR(ring, a + e) - ringR(ring, a - e)) / (2 * e);
  const tx = Math.cos(a) * R + Math.sin(a) * dR, tz = -Math.sin(a) * R + Math.cos(a) * dR;
  return Math.atan2(tx, tz);
}

export function buildFortress(p: PoiPlacement, v: FortValues): PoiSite {
  const b = new SiteBuilder(p);
  const L = fortLayout(p, v);
  const rings = L.rings;
  // World (x, z) to the builder's local frame.
  const ca = Math.cos(p.yaw), sa = Math.sin(p.yaw);
  const loc = (x: number, z: number): [number, number] => { const dx = x - p.x, dz = z - p.z; return [dx * ca - dz * sa, dx * sa + dz * ca]; };
  const atA = (a: number, d: number) => loc(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d);
  // A prop's y is from the ground under its centre; on a wall's line that ground is the container plug (h).
  const box = (x: number, z: number, cy: number, size: [number, number, number], tone: Tone, yaw: number, pitch = 0, roll = 0) => {
    const [lx, lz] = loc(x, z);
    b.prop("box", lx, lz, cy, size, tone, yaw - p.yaw, pitch, roll);
    // The doors' end: a darker plate.
    if (size[2] > 4) b.prop("box", lx + Math.sin(yaw - p.yaw) * (size[2] / 2 + 0.02), lz + Math.cos(yaw - p.yaw) * (size[2] / 2 + 0.02), cy, [size[0] * 0.96, size[1] * 0.94, 0.06], "dark", yaw - p.yaw, pitch, roll);
  };

  // The walls: containers along every ring's line, stood on end or stacked two high lying along it, leaving the gates.
  for (const ring of rings) {
    let a = 0;
    const end = Math.PI * 2;
    while (a < end) {
      const R = ringR(ring, a);
      const upright = b.r() < v.fortUpright;
      const len = upright ? BOX.wide : BOX.long;
      const mid = a + (len / 2) / R;
      if (nearGate(ring, mid, len / 2 + 0.2)) { a += 0.6 / R; continue; }
      const Rm = ringR(ring, mid), x = p.x + Math.sin(mid) * Rm, z = p.z + Math.cos(mid) * Rm, yaw = along(ring, mid);
      const tone = b.one(BOX_TONES);
      if (upright) {
        // On end, sunk a little, leaning a touch; some a little taller (sunk less).
        const sink = b.range(0.2, 0.8);
        box(x, z, BOX.long / 2 - sink - ring.h, [BOX.high, BOX.long, BOX.wide], tone, yaw + Math.PI / 2 + b.jit(0.08), b.jit(0.05), b.jit(0.05));
      } else {
        box(x, z, BOX.high / 2 - 0.15 - ring.h, [BOX.wide, BOX.high, BOX.long], tone, yaw + b.jit(0.03));
        box(x + b.jit(0.15), z + b.jit(0.15), BOX.high * 1.5 - 0.15 - ring.h, [BOX.wide, BOX.high, BOX.long], b.one(BOX_TONES), yaw + b.jit(0.08), 0, b.jit(0.02));
        // A third on top now and then, set back: a lookout.
        if (b.r() < 0.12) box(x, z, BOX.high * 2.5 - 0.15 - ring.h, [BOX.wide, BOX.high, BOX.long * 0.5], b.one(BOX_TONES), yaw + b.jit(0.3));
      }
      // Spikes and a scrap flag now and then: a fortress skyline.
      if (b.r() < 0.08) { const [lx, lz] = loc(x, z); b.prop("rib", lx, lz, 3 - ring.h + 3.5, [0.3, 0.3, b.range(3, 5)], "dark", yaw - p.yaw, Math.PI / 2 - b.jit(0.2), 0); }
      a += (len + 0.06) / R;
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
  // Cover: the loose stacks in the yards.
  for (const k of L.blocks) {
    for (let j = 0; j < k.stack; j++) box(k.x + b.jit(0.1), k.z + b.jit(0.1), BOX.high * (j + 0.5) - 0.15 - k.h, [k.dep, BOX.high, k.len], b.one(BOX_TONES), k.a + b.jit(0.1));
  }
  const clearOf = (x: number, z: number, m: number) => !L.blocks.some((k) => Math.hypot(k.x - x, k.z - z) < k.len / 2 + m);

  // The yards: the band between each ring and the next one in (the keep: inside the last ring).
  const span = (k: number) => ringSpan(rings[k]);
  const yardOut = (k: number, a: number) => ringR(rings[k], a) - span(k) - 3;
  const yardIn = (k: number, a: number) => (k < rings.length - 1 ? ringR(rings[k + 1], a) + span(k + 1) + 3 : 0);
  const yardPoint = (k: number, a: number, f: number) => yardIn(k, a) + (yardOut(k, a) - yardIn(k, a)) * f;
  for (let k = 0; k < rings.length; k++) {
    const keep = k === rings.length - 1;
    const sec = b.section(keep ? YARD_NAMES[2] : YARD_NAMES[Math.min(k, 1)]);
    if (keep) {
      // The vault: a hull section dug in at the centre, the big strip.
      b.prop("arc", 0, 0, 0.6, [9, 0.5, 7], "hull", b.r() * 6.28, 0, 0);
      b.prop("box", 0, 0, 0.9, [3.4, 1.8, 2.6], "hazard", b.r() * 6.28, 0, 0);
      b.spot(sec, 0, 0, 1.2, v.fortVaultValue, v.fortVaultTime, "vault");
      for (let i = 0; i < 2; i++) {
        const a = b.r() * 6.28, [lx, lz] = atA(a, Math.max(3, yardOut(k, a) * b.range(0.45, 0.75)));
        b.prop("box", lx, lz, 0.4, [b.range(1.4, 2), b.range(0.8, 1.2), b.range(1.2, 1.8)], "olive", b.r() * 6.28, 0, 0);
        b.spot(sec, lx, lz, 0.8, v.fortSpotValue * 1.5, v.fortSpotTime, b.one(YARD_LABELS));
      }
      continue;
    }
    const n = Math.max(1, Math.round(v.fortYardSpots));
    const as = b.r() * 6.28;
    for (let i = 0; i < n; i++) {
      let a = 0, d = 0;
      for (let t = 0; t < 10; t++) {
        a = as + (i / n) * Math.PI * 2 + b.jit(0.25); d = yardPoint(k, a, b.range(0.25, 0.75));
        if (clearOf(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, 5)) break;
      }
      const [lx, lz] = atA(a, d);
      b.prop("box", lx, lz, 0.4, [b.range(1.2, 2.2), b.range(0.6, 1.4), b.range(1, 2)], b.one(["steel", "olive", "rust"] as const), b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      if (b.r() < 0.5) b.prop("cloth", lx + b.jit(2), lz + b.jit(2), 1.4, [b.range(3, 5), 0.05, b.range(3, 4)], "cloth", b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      b.spot(sec, lx, lz, 0.8, v.fortSpotValue * b.range(0.8, 1.25) * (1 + 0.4 * k), v.fortSpotTime * b.range(0.85, 1.2), b.one(YARD_LABELS));
    }
    // Clutter and fire scars across the yard.
    const nc = Math.round(v.fortClutter / rings.length);
    for (let i = 0; i < nc; i++) {
      const a = b.r() * 6.28, d = yardPoint(k, a, b.r());
      const [lx, lz] = atA(a, d), s = b.range(0.5, 1.4), q = b.r(), tone = b.one(["steel", "rust", "dark", "olive"] as const);
      if (q < 0.5) b.prop("box", lx, lz, -0.1 * s, [s * b.range(0.6, 1.6), s * b.range(0.15, 0.5), s * b.range(0.5, 1.4)], tone, b.r() * 6.28, b.jit(0.5), b.jit(0.5));
      else if (q < 0.8) b.prop("box", lx, lz, 0.05, [s * b.range(1.2, 2.6), 0.08, s * b.range(0.8, 1.8)], tone, b.r() * 6.28, b.jit(0.25), b.jit(0.25));
      else b.prop("cyl", lx, lz, 0.4, [0.5, 1.2, 0.5], "rust", b.r() * 6.28, 0, 0);
    }
    for (let i = 0; i < 2; i++) {
      const a = b.r() * 6.28, [lx, lz] = atA(a, yardPoint(k, a, b.r()));
      b.prop("disc", lx, lz, 0, [b.range(2, 4), 0, b.range(2, 4)], "scorch", b.r() * 6.28);
    }
  }
  return b.done();
}
