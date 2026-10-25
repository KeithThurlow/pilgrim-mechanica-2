// The weapon kit's mesh builder, ported from the old project's Blender kit (tools/blender/weapons/wkit.py there):
// every solid is a run of rings joined by quads, each face carries its paint section, a tone (slight per-part
// value jitter) and a heat weight (how much a barrel glows after firing). emit() bakes the wear (underside shade,
// grime, dust on top faces) into vertex colours and keeps hard edges at creases and section borders, giving the
// same geometry layout the converted GLBs load into (src/weapons/parts.ts): position, normal, color (wear
// multiplier), section, heat.
// Frame: this repo's, +Z forward (the muzzle), +Y up, +X left seen from behind; 1 unit = 1 m.
import * as THREE from "three/webgpu";
import { SECTION, type Section } from "../palette";
import { noise3 } from "./noise";

export const SHARP_DEG = 38;

export type V3 = THREE.Vector3;
export const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Deterministic random numbers for greebles. */
export class Rng {
  constructor(private s: number) { this.s = (s * 2654435761) >>> 0 || 1; }
  next() { let t = (this.s = (this.s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
}

/** One mesh: a static body or a moving part with its origin at its pivot. Geometry is added in model space. */
export class Piece {
  pos: number[] = [];
  sec: number[] = [];
  tone: number[] = [];
  heat: number[] = [];
  decal: boolean[] = [];
  rng: Rng;
  /** Heat weight for geometry added from now on, by position (barrels set this; 0 = never glows). */
  heatAt: (p: V3) => number = () => 0;
  constructor(public name: string, public pivot: V3 = v(), public seed = 1) { this.rng = new Rng(seed + name.length * 17); }
  get tris() { return this.sec.length; }
  empty() { return this.sec.length === 0; }

  tri(a: V3, b: V3, c: V3, sec: Section, tone = 1, decal = false) {
    const ab = b.clone().sub(a), ac = c.clone().sub(a);
    if (ab.cross(ac).lengthSq() < 1e-14) return;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.sec.push(SECTION[sec]);
    this.tone.push(tone);
    this.decal.push(decal);
    this.heat.push(this.heatAt(a), this.heatAt(b), this.heatAt(c));
  }
}

/** Signed volume of triangles from index t0 on (positive = outward winding for a closed surface). */
function volume(P: Piece, t0: number) {
  let s = 0;
  const p = P.pos;
  for (let t = t0; t < P.sec.length; t++) {
    const i = t * 9;
    s += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return s;
}

function flipFrom(P: Piece, t0: number) {
  const p = P.pos, h = P.heat;
  for (let t = t0; t < P.sec.length; t++) {
    const i = t * 9;
    for (let k = 0; k < 3; k++) { const a = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = a; }
    const j = t * 3, a = h[j + 1]; h[j + 1] = h[j + 2]; h[j + 2] = a;
  }
}

/** Triangulate a planar ring (any simple polygon) as a cap. */
function cap(P: Piece, ring: V3[], sec: Section, tone: number) {
  if (ring.length < 3) return;
  // Newell normal and a basis on the ring's plane.
  const n = v();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (n.lengthSq() < 1e-16) return;
  n.normalize();
  const u = Math.abs(n.x) < 0.9 ? v(1, 0, 0) : v(0, 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const w = n.clone().cross(u);
  const pts = ring.map((p) => new THREE.Vector2(p.dot(u), p.dot(w)));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  for (const [a, b, c] of tris) P.tri(ring[a], ring[b], ring[c], sec, tone);
}

export interface PrimOpts {
  closed?: boolean;
  caps?: boolean;
  /** Section per ring gap (paints bands); the first and last also paint the caps. */
  secs?: Section[];
  tone?: number;
  jitter?: number;
}

/** A solid from rings (same point count): quads between consecutive rings, capped ends, wound outward. */
export function prim(P: Piece, rings: V3[][], sec: Section, o: PrimOpts = {}) {
  const t0 = P.sec.length;
  const tone = o.tone ?? 1 - P.rng.range(0, o.jitter ?? 0.035);
  const n = rings[0].length;
  const gaps = rings.length - (o.closed ? 0 : 1);
  for (let i = 0; i < gaps; i++) {
    const A = rings[i], B = rings[(i + 1) % rings.length];
    const s = o.secs ? o.secs[Math.min(i, o.secs.length - 1)] : sec;
    for (let j = 0; j < n; j++) {
      const a = A[j], b = A[(j + 1) % n], c = B[(j + 1) % n], d = B[j];
      P.tri(a, b, c, s, tone);
      P.tri(a, c, d, s, tone);
    }
  }
  if ((o.caps ?? true) && !o.closed) {
    cap(P, rings[0], o.secs ? o.secs[0] : sec, tone);
    cap(P, rings[rings.length - 1], o.secs ? o.secs[o.secs.length - 1] : sec, tone);
  }
  if (volume(P, t0) < 0) flipFrom(P, t0);
}

/** A painted quad (marking) lying on a surface: no thickness, drawn just off it, no ink line. */
export function decalQuad(P: Piece, pts: V3[], n: V3, sec: Section) {
  const a = pts[0], b = pts[1], c = pts[2];
  const fn = b.clone().sub(a).cross(c.clone().sub(a));
  const ordered = fn.dot(n) >= 0 ? pts : [...pts].reverse();
  for (let i = 1; i < ordered.length - 1; i++) P.tri(ordered[0], ordered[i], ordered[i + 1], sec, 1, true);
}

export interface EmitOpts {
  /** Characteristic size (m): the grime noise scales with it so every size wears alike. */
  k: number;
  wear?: number;
  seed?: number;
}

/** Bake wear, smooth soft edges, move to the pivot: the geometry a weapon part draws with. */
export function emit(P: Piece, o: EmitOpts): THREE.BufferGeometry {
  const nt = P.sec.length, p = P.pos;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const i = t * 9;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    fn[t * 3] = x; fn[t * 3 + 1] = y; fn[t * 3 + 2] = z;
  }
  // Corners sharing a position (and section) smooth together when their faces meet at under SHARP_DEG.
  const key = (i: number) => `${Math.round(p[i] * 1e4)},${Math.round(p[i + 1] * 1e4)},${Math.round(p[i + 2] * 1e4)}`;
  const at = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
    const k = key(t * 9 + c * 3) + "|" + P.sec[t];
    let l = at.get(k);
    if (!l) at.set(k, (l = []));
    l.push(t);
  }
  const cosSharp = Math.cos((SHARP_DEG * Math.PI) / 180);
  const normal = new Float32Array(nt * 9), color = new Float32Array(nt * 9), section = new Float32Array(nt * 3), heat = new Float32Array(nt * 3);
  const wear = o.wear ?? 1, k = Math.max(o.k, 1e-3), seed = (o.seed ?? P.seed) * 1.7;
  for (let t = 0; t < nt; t++) {
    const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
    const sec = P.sec[t], glow = sec === SECTION.lighting || sec === SECTION.visor;
    for (let c = 0; c < 3; c++) {
      const vi = t * 9 + c * 3;
      let nx = 0, ny = 0, nz = 0;
      if (P.decal[t]) { nx = fx; ny = fy; nz = fz; } else {
        for (const o2 of at.get(key(vi) + "|" + sec)!) {
          const gx = fn[o2 * 3], gy = fn[o2 * 3 + 1], gz = fn[o2 * 3 + 2];
          if (gx * fx + gy * fy + gz * fz >= cosSharp) { nx += gx; ny += gy; nz += gz; }
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      normal[vi] = nx / l; normal[vi + 1] = ny / l; normal[vi + 2] = nz / l;
      // Wear: the kit's bake (underside shade, low-frequency grime, warm dust on upward faces).
      let r = 1, g = 1, b = 1;
      if (!glow && !P.decal[t]) {
        const px = p[vi] / k, py = p[vi + 1] / k, pz = p[vi + 2] / k;
        const under = fy >= 0 ? 1 : 1 + 0.22 * fy;
        const n1 = noise3(px * 2.2 + seed, py * 2.2 + 3.1, pz * 2.2 - seed) * 0.5 + 0.5;
        const n2 = noise3(px * 7 - seed, py * 7 + 7.7, pz * 7 + 1.3) * 0.5 + 0.5;
        const m = P.tone[t] * under * (1 - wear * (0.1 * n1 + 0.05 * n2));
        const d = wear * Math.max(0, fy) * (0.3 + 0.7 * n1);
        r = m * (1 - d * 0); g = m * (1 - d * 0.035); b = m * (1 - d * 0.1);
      }
      color[vi] = r; color[vi + 1] = g; color[vi + 2] = b;
      section[t * 3 + c] = sec;
      heat[t * 3 + c] = P.heat[t * 3 + c];
    }
  }
  const pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { pos[i] = p[i] - P.pivot.x; pos[i + 1] = p[i + 1] - P.pivot.y; pos[i + 2] = p[i + 2] - P.pivot.z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  g.setAttribute("color", new THREE.BufferAttribute(color, 3));
  g.setAttribute("section", new THREE.BufferAttribute(section, 1));
  g.setAttribute("heat", new THREE.BufferAttribute(heat, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
