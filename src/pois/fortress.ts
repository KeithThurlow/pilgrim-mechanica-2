// Tier 5, Siege: a bandit fortress (Keith 2026-10-31, docs/proposal-fortresses.md). Rings of wall built from wreckage
// banked with sand round a levelled pad, each ring with a few gates (the only ways in: steel barricades with health
// until they're blown down, then gaps), and the yards between them as the sections: the outer yard, the inner yard and
// the keep at the centre with its vault. Gates on the next ring in are turned away from the ones outside, so you work
// round each yard to reach the next.
//
// Pure and seeded: `fortLayout` is the shape (rings, gates) that both the ground (src/pois/fortressGround.ts: the walls
// as berms, standing gates as plugs) and the builder read; `buildFortress` is the POI site (sections, salvage spots,
// the wreckage on the walls and the clutter in the yards). Gate health and the garrison belong to the glue (host).
import type { Param } from "../core/tweaks";
import { rng, type PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite, type Tone } from "./site";

export const FORT_DEFAULTS = {
  fortOuter: 95,
  fortMiddle: 58,
  fortKeep: 24,
  fortWallH: 7,
  fortWallTop: 3,
  fortWallFace: 2.5,
  fortGatesOuter: 2,
  fortGatesMiddle: 1,
  fortGatesKeep: 1,
  fortGateW: 10,
  fortGateT: 3,
  fortDress: 5,
  fortYardSpots: 5,
  fortSpotValue: 45,
  fortSpotTime: 4,
  fortVaultValue: 420,
  fortVaultTime: 10,
  fortClutter: 70,
};
export type FortValues = typeof FORT_DEFAULTS & { fortPad: number };

const G = "Fortress: layout", S = "Fortress: salvage";
export const FORT_PARAMS: Param[] = [
  { key: "fortPad", label: "Pad radius (m)", min: 40, max: 200, step: 1, group: G, tip: "The levelled ground it stands on; keep it past the outer wall", onRelease: true },
  { key: "fortOuter", label: "Outer wall radius (m)", min: 30, max: 190, step: 1, group: G, onRelease: true },
  { key: "fortMiddle", label: "Middle wall radius (m)", min: 0, max: 150, step: 1, group: G, tip: "0: no middle ring (two sections)", onRelease: true },
  { key: "fortKeep", label: "Keep wall radius (m)", min: 8, max: 80, step: 1, group: G, onRelease: true },
  { key: "fortWallH", label: "Wall height (m)", min: 2, max: 16, step: 0.1, group: G, tip: "Sand and wreckage; the faces are too steep for the mech to walk up", onRelease: true },
  { key: "fortWallTop", label: "Wall top half-width (m)", min: 0.5, max: 8, step: 0.1, group: G, onRelease: true },
  { key: "fortWallFace", label: "Wall face width (m)", min: 0.8, max: 8, step: 0.1, group: G, tip: "How far the face runs from the top to the yard floor: smaller is steeper", onRelease: true },
  { key: "fortGatesOuter", label: "Gates in the outer wall", min: 1, max: 6, step: 1, group: G, onRelease: true },
  { key: "fortGatesMiddle", label: "Gates in the middle wall", min: 1, max: 6, step: 1, group: G, onRelease: true },
  { key: "fortGatesKeep", label: "Gates in the keep wall", min: 1, max: 4, step: 1, group: G, onRelease: true },
  { key: "fortGateW", label: "Gate width (m)", min: 5, max: 24, step: 0.5, group: G, onRelease: true },
  { key: "fortGateT", label: "Gate thickness (m)", min: 1, max: 6, step: 0.1, group: G, tip: "The steel barricade plugging the gap while it stands", onRelease: true },
  { key: "fortDress", label: "Wreckage along the walls every (m)", min: 2, max: 20, step: 0.5, group: G, onRelease: true },
  { key: "fortClutter", label: "Clutter in the yards", min: 0, max: 300, step: 1, group: G, onRelease: true },
  { key: "fortYardSpots", label: "Salvage spots per yard", min: 1, max: 16, step: 1, group: S, onRelease: true },
  { key: "fortSpotValue", label: "Scrap per yard spot", min: 1, max: 400, step: 1, group: S, onRelease: true },
  { key: "fortSpotTime", label: "Yard spot strip time (s)", min: 0.5, max: 20, step: 0.1, group: S, onRelease: true },
  { key: "fortVaultValue", label: "Scrap in the vault", min: 1, max: 4000, step: 1, group: S, onRelease: true },
  { key: "fortVaultTime", label: "Vault strip time (s)", min: 1, max: 60, step: 0.5, group: S, onRelease: true },
];

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

/** A wall ring round the centre: a berm of height h, flat top half-width `top`, faces `face` wide. */
export interface Ring { r: number; h: number; top: number; face: number; gates: Gate[] }

export interface Layout {
  poi: string;
  x: number; z: number;
  /** Rings from the outside in. */
  rings: Ring[];
  /** Furthest any wall reaches from the centre (m). */
  reach: number;
}

/** The rings that are on (a middle radius of 0 drops the middle ring), outside in. */
function radii(v: FortValues) {
  const out = [v.fortOuter];
  if (v.fortMiddle > v.fortKeep + 8 && v.fortMiddle < v.fortOuter - 8) out.push(v.fortMiddle);
  out.push(Math.min(v.fortKeep, v.fortOuter - 8));
  return out;
}

export function fortLayout(p: PoiPlacement, v: FortValues): Layout {
  const r = rng(p.seed ^ 0x5f0f7);
  const rs = radii(v);
  const counts = rs.length === 3 ? [v.fortGatesOuter, v.fortGatesMiddle, v.fortGatesKeep] : [v.fortGatesOuter, v.fortGatesKeep];
  const rings: Ring[] = [];
  // Each ring's gates evenly spaced, the first turned half a spacing (and a little) away from the ring outside's.
  let a0 = p.yaw + r() * Math.PI * 2;
  for (let k = 0; k < rs.length; k++) {
    const n = Math.max(1, Math.round(counts[k]));
    if (k > 0) a0 += Math.PI / Math.max(1, Math.round(counts[k - 1])) + (r() - 0.5) * 0.5;
    const gates: Gate[] = [];
    for (let g = 0; g < n; g++) {
      const a = a0 + (g / n) * Math.PI * 2;
      gates.push({ id: `${p.id}/g${k}.${g}`, ring: k, a, x: p.x + Math.sin(a) * rs[k], z: p.z + Math.cos(a) * rs[k], w: v.fortGateW, t: v.fortGateT, barred: true });
    }
    rings.push({ r: rs[k], h: v.fortWallH * (1 + 0.08 * k), top: v.fortWallTop, face: v.fortWallFace, gates });
  }
  return { poi: p.id, x: p.x, z: p.z, rings, reach: rs[0] + v.fortWallTop + v.fortWallFace };
}

const WALL_TONES: Tone[] = ["steel", "rust", "hull", "dark", "rust", "olive"];
const YARD_NAMES = ["outer yard", "inner yard", "keep"];
const YARD_LABELS = ["crate stack", "fuel cell", "parts cage", "engine block", "weapon rack", "salvage pile"];

/** Is world heading a within (half arc length `half` m + margin) of a gate on a ring of radius R? */
function nearGate(ring: Ring, a: number, margin: number) {
  for (const g of ring.gates) {
    const d = Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * ring.r;
    if (d < g.w / 2 + margin) return true;
  }
  return false;
}

export function buildFortress(p: PoiPlacement, v: FortValues): PoiSite {
  const b = new SiteBuilder(p);
  const L = fortLayout(p, v);
  const rings = L.rings;
  // Local heading of a world heading (SiteBuilder's frame: local heading + yaw = world heading).
  const at = (a: number, d: number): [number, number] => [Math.sin(a - p.yaw) * d, Math.cos(a - p.yaw) * d];

  // Wreckage along every wall's top, leaving the gates clear: containers, hull plates and beams laid along the ring.
  for (const ring of rings) {
    const step = Math.max(2, v.fortDress), n = Math.max(6, Math.floor((Math.PI * 2 * ring.r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.jit(0.3 / n);
      if (nearGate(ring, a, 1.5)) continue;
      const d = ring.r + b.jit(ring.top * 0.5);
      const [lx, lz] = at(a, d);
      const along = a - p.yaw + Math.PI / 2; // local yaw facing along the ring
      const k = b.r(), tone = b.one(WALL_TONES);
      if (k < 0.4) b.prop("box", lx, lz, ring.h - 0.9, [b.range(2.2, 2.6), b.range(2.2, 2.8), b.range(5, 7)], tone, along + b.jit(0.15), b.jit(0.08), b.jit(0.12));
      else if (k < 0.7) b.prop("arc", lx, lz, ring.h - 1.2, [b.range(4, 6), 0.3, b.range(3, 5)], tone, along + Math.PI / 2 + b.jit(0.2), b.jit(0.3), b.jit(0.2));
      else if (k < 0.88) b.prop("rib", lx, lz, ring.h - 0.2, [0.4, 0.6, b.range(4, 7)], "dark", along + b.jit(0.3), b.jit(0.2), b.jit(0.3));
      else b.prop("cyl", lx, lz, ring.h - 0.6, [1.1, b.range(4, 6), 1.1], tone, along, Math.PI / 2, 0);
      // A spike or post now and then: a fortress skyline.
      if (b.r() < 0.18) b.prop("rib", lx, lz, ring.h + 1.5, [0.3, 0.3, b.range(3, 5)], "dark", along, Math.PI / 2 - b.jit(0.2), 0);
    }
    // Gateposts: a tall steel column each side of every gate.
    for (const g of ring.gates) for (const s of [-1, 1]) {
      const a = g.a + (s * (g.w / 2 + 1.2)) / ring.r;
      const [lx, lz] = at(a, ring.r);
      b.prop("box", lx, lz, ring.h * 0.5, [1.6, ring.h + 3, 1.6], "dark", a - p.yaw, 0, 0);
    }
  }

  // The yards: the band between each ring and the next one in (the keep: inside the last ring).
  const wallOut = (k: number) => rings[k].r - rings[k].top - rings[k].face - 3;
  const wallIn = (k: number) => rings[k].r + rings[k].top + rings[k].face + 3;
  for (let k = 0; k < rings.length; k++) {
    const keep = k === rings.length - 1;
    const sec = b.section(keep ? YARD_NAMES[2] : YARD_NAMES[Math.min(k, 1)]);
    const r1 = wallOut(k), r0 = keep ? 0 : wallIn(k + 1);
    if (keep) {
      // The vault: a hull section dug in at the centre, the big strip.
      b.prop("arc", 0, 0, 0.6, [9, 0.5, 7], "hull", b.r() * 6.28, 0, 0);
      b.prop("box", 0, 0, 0.9, [3.4, 1.8, 2.6], "hazard", b.r() * 6.28, 0, 0);
      b.spot(sec, 0, 0, 1.2, v.fortVaultValue, v.fortVaultTime, "vault");
      for (let i = 0; i < 2; i++) {
        const a = b.r() * 6.28, d = Math.max(3, r1 * b.range(0.45, 0.75));
        const [lx, lz] = at(a, d);
        b.prop("box", lx, lz, 0.4, [b.range(1.4, 2), b.range(0.8, 1.2), b.range(1.2, 1.8)], "olive", b.r() * 6.28, 0, 0);
        b.spot(sec, lx, lz, 0.8, v.fortSpotValue * 1.5, v.fortSpotTime, b.one(YARD_LABELS));
      }
      continue;
    }
    const n = Math.max(1, Math.round(v.fortYardSpots));
    const as = b.r() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = as + (i / n) * Math.PI * 2 + b.jit(0.25), d = r0 + (r1 - r0) * b.range(0.25, 0.75);
      const [lx, lz] = at(a, d);
      b.prop("box", lx, lz, 0.4, [b.range(1.2, 2.2), b.range(0.6, 1.4), b.range(1, 2)], b.one(["steel", "olive", "rust"] as const), b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      if (b.r() < 0.5) b.prop("cloth", lx + b.jit(2), lz + b.jit(2), 1.4, [b.range(3, 5), 0.05, b.range(3, 4)], "cloth", b.r() * 6.28, b.jit(0.2), b.jit(0.2));
      b.spot(sec, lx, lz, 0.8, v.fortSpotValue * b.range(0.8, 1.25) * (1 + 0.4 * k), v.fortSpotTime * b.range(0.85, 1.2), b.one(YARD_LABELS));
    }
    // Clutter and fire scars across the yard, a share by its area.
    const area = r1 * r1 - r0 * r0, total = rings.reduce((s, _r, j) => s + Math.max(0, wallOut(j) ** 2 - (j < rings.length - 1 ? wallIn(j + 1) ** 2 : 0)), 0);
    const nc = Math.round(v.fortClutter * (total > 0 ? area / total : 0));
    if (nc > 0 && r1 > r0) b.debris(nc, r0, r1, ["steel", "rust", "dark", "olive"]);
    for (let i = 0; i < 2; i++) {
      const a = b.r() * 6.28, [lx, lz] = at(a, r0 + (r1 - r0) * b.r());
      b.prop("disc", lx, lz, 0, [b.range(2, 4), 0, b.range(2, 4)], "scorch", b.r() * 6.28);
    }
  }
  return b.done();
}
