// The kit's solids, ported from wkit.py: lofts of 2D sections along +Z, hollow collars, plates, lathes (stepped
// turned parts), prisms, sweeps along paths, tubes and ribbed hoses. Nothing is a plain box or cylinder.
import { Piece, prim, v, type V3, type PrimOpts } from "./piece";
import { octRing, type Ring2 } from "./shapes";
import type { Section } from "../palette";

/** (u, v, w): w along axis, u = up x w, v = w x u (with up +Y and axis +Z: u = +X, v = +Y). */
export function frame(axis: V3, up: V3 = v(0, 1, 0)): [V3, V3, V3] {
  const w = axis.clone().normalize();
  let u = up.clone().cross(w);
  if (u.lengthSq() < 1e-8) u = Math.abs(w.x) < 0.9 ? v(1, 0, 0).cross(w) : v(0, 1, 0).cross(w);
  u.normalize();
  return [u, w.clone().cross(u), w];
}

export type Station = [z: number, ring: Ring2, dy?: number];

/** Loft along +Z: stations [z, ring (x, y), dy]. x0 offsets sideways; wobble: seeded uneven facets. */
export function loftZ(P: Piece, stations: Station[], sec: Section, o: PrimOpts & { x0?: number; y0?: number; wobble?: number } = {}) {
  const rings = stations.map(([z, ring, dy = 0]) => ring.map(([x, y]) => {
    const k = o.wobble ? 1 + P.rng.range(-o.wobble, o.wobble) : 1;
    return v(x * k + (o.x0 ?? 0), y * k + dy + (o.y0 ?? 0), z);
  }));
  prim(P, rings, sec, o);
}

/** A hollow frame along +Z (armoured lips, bezels): outer and inner rings (same count) from z0 to z1. */
export function collarZ(P: Piece, outer: Ring2, inner: Ring2, z0: number, z1: number, sec: Section, x0 = 0, y0 = 0) {
  const R = (z: number, r: Ring2) => r.map(([x, y]) => v(x + x0, y + y0, z));
  prim(P, [R(z0, outer), R(z1, outer), R(z1, inner), R(z0, inner)], sec, { closed: true, caps: false });
}

/** A plate: ring (in u, v) extruded t along n from c; bevel insets the outer face (a chamfered top). */
export function extrude(P: Piece, ring: Ring2, c: V3, u: V3, w: V3, n: V3, t: number, sec: Section, bevel = 0, secs?: Section[]) {
  const at = (a: number, b: number, d: number) => c.clone().addScaledVector(u, a).addScaledVector(w, b).addScaledVector(n, d);
  const rings = [ring.map(([a, b]) => at(a, b, 0))];
  if (bevel > 0) {
    const cx = ring.reduce((s, [a]) => s + a, 0) / ring.length, cy = ring.reduce((s, [, b]) => s + b, 0) / ring.length;
    const inset = ring.map(([a, b]) => { const L = Math.hypot(a - cx, b - cy) || 1e-6, s = Math.max(0, (L - bevel) / L); return [cx + (a - cx) * s, cy + (b - cy) * s] as [number, number]; });
    rings.push(ring.map(([a, b]) => at(a, b, t - bevel)));
    rings.push(inset.map(([a, b]) => at(a, b, t)));
  } else rings.push(ring.map(([a, b]) => at(a, b, t)));
  prim(P, rings, sec, { secs });
}

/** A chamfered armour plate on a surface (centre c, w along u, h along v, outward normal u x v). */
export function plate(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, t: number, sec: Section, o: { ch?: number; bevel?: number; batter?: number } = {}) {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  const ring = octRing(w / 2, h / 2, o.ch ?? Math.min(w, h) * 0.18, o.batter ?? 0);
  extrude(P, ring, c, uu, vv, n, t, sec, o.bevel ?? t * 0.45);
}

/** A turned part: prof [t, r] along axis from c (t may step back for bores). secs: section per profile gap;
 * squash scales the second radius (ovals); ring: the profile is a closed loop (a hollow band). */
export function lathe(P: Piece, c: V3, axis: V3, prof: [number, number][], sec: Section, o: { n?: number; secs?: Section[]; phase?: number; up?: V3; squash?: number; ring?: boolean; tone?: number } = {}) {
  const [u, vv, w] = frame(axis, o.up);
  const n = o.n ?? 12, sq = o.squash ?? 1, ph = o.phase ?? 0;
  const rings = prof.map(([t, r]) => Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n + ph;
    return c.clone().addScaledVector(w, t).addScaledVector(u, Math.cos(a) * r).addScaledVector(vv, Math.sin(a) * r * sq);
  }));
  prim(P, rings, sec, { secs: o.secs, tone: o.tone, closed: o.ring, caps: !o.ring });
}

/** A straight prism from a to b with a 2D section (u right, v up); ringB tapers it. */
export function prism(P: Piece, a: V3, b: V3, ring: Ring2, sec: Section, up: V3 = v(0, 1, 0), ringB?: Ring2) {
  const [u, vv] = frame(b.clone().sub(a), up);
  const R = (c: V3, r: Ring2) => r.map(([x, y]) => c.clone().addScaledVector(u, x).addScaledVector(vv, y));
  prim(P, [R(a, ring), R(b, ringB ?? ring)], sec);
}

// ---- paths and sweeps

export function roundPath(pts: V3[], bend = 0.15, seg = 4): V3[] {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const d0 = p0.clone().sub(p1), d2 = p2.clone().sub(p1);
    const r = Math.min(bend, d0.length() * 0.45, d2.length() * 0.45);
    if (r < 1e-4) { out.push(p1.clone()); continue; }
    const a = p1.clone().addScaledVector(d0.normalize(), r), b = p1.clone().addScaledVector(d2.normalize(), r);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      out.push(a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(p1, 2 * (1 - t) * t).addScaledVector(b, t * t));
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

export function bezier(p0: V3, p1: V3, p2: V3, p3: V3, seg = 12): V3[] {
  return Array.from({ length: seg + 1 }, (_, i) => {
    const t = i / seg;
    return p0.clone().multiplyScalar((1 - t) ** 3).addScaledVector(p1, 3 * (1 - t) ** 2 * t).addScaledVector(p2, 3 * (1 - t) * t * t).addScaledVector(p3, t ** 3);
  });
}

/** Evenly spaced points along a polyline. */
export function resample(path: V3[], step: number): V3[] {
  const out = [path[0].clone()];
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], d = a.distanceTo(b);
    let t = step - carry;
    while (t <= d) { out.push(a.clone().lerp(b, t / d)); t += step; }
    carry = d - (t - step);
  }
  if (out[out.length - 1].distanceTo(path[path.length - 1]) > step * 0.3) out.push(path[path.length - 1].clone());
  return out;
}

function frames(path: V3[], up: V3): [V3, V3][] {
  const tans = path.map((_, i) => { const d = path[Math.min(i + 1, path.length - 1)].clone().sub(path[Math.max(i - 1, 0)]); return d.lengthSq() > 1e-12 ? d.normalize() : v(0, 0, 1); });
  let u = up.clone().cross(tans[0]);
  if (u.lengthSq() < 1e-6) u = v(1, 0, 0).cross(tans[0]);
  u.normalize();
  return tans.map((t) => {
    u = u.clone().addScaledVector(t, -u.dot(t));
    if (u.lengthSq() < 1e-10) u = Math.abs(t.x) < 0.9 ? v(1, 0, 0).cross(t) : v(0, 1, 0).cross(t);
    u.normalize();
    return [u, t.clone().cross(u)];
  });
}

/** A 2D section swept along a path with parallel-transported frames; scale(i) -> [ku, kv] per point. */
export function sweep(P: Piece, path: V3[], ring: Ring2, sec: Section, o: { up?: V3; scale?: (i: number) => [number, number]; secs?: Section[] } = {}) {
  const fr = frames(path, o.up ?? v(0, 1, 0));
  const rings = path.map((c, i) => {
    const [u, vv] = fr[i], [ku, kv] = o.scale ? o.scale(i) : [1, 1];
    return ring.map(([x, y]) => c.clone().addScaledVector(u, x * ku).addScaledVector(vv, y * kv));
  });
  prim(P, rings, sec, { secs: o.secs });
}

export function tube(P: Piece, path: V3[], r: number, sec: Section, o: { n?: number; bend?: number; rEnd?: number } = {}) {
  const p = roundPath(path, o.bend ?? 0.1);
  const n = o.n ?? 8, m = Math.max(1, p.length - 1);
  const ring: Ring2 = Array.from({ length: n }, (_, k) => [Math.cos((2 * Math.PI * k) / n) * r, Math.sin((2 * Math.PI * k) / n) * r]);
  sweep(P, p, ring, sec, { scale: o.rEnd ? (i) => { const k = 1 + ((o.rEnd! / r) - 1) * i / m; return [k, k]; } : undefined });
}

/** A flexible armoured hose: a swept tube whose radius steps up at every rib. */
export function ribbedHose(P: Piece, path: V3[], r: number, pitch: number, sec: Section, ribSec?: Section, n = 10, rib = 0.18) {
  const pts = resample(path, pitch / 4);
  const ring: Ring2 = Array.from({ length: n }, (_, k) => [Math.cos((2 * Math.PI * (k + 0.5)) / n) * r, Math.sin((2 * Math.PI * (k + 0.5)) / n) * r]);
  const ks = pts.map((_, i) => (i % 4 === 1 || i % 4 === 2 ? 1 + rib : 1));
  const secs = pts.slice(1).map((_, i) => (i % 4 === 1 ? ribSec ?? sec : sec));
  sweep(P, pts, ring, sec, { scale: (i) => [ks[i], ks[i]], secs });
}

/** A bundle of cables from a to b sagging by drop, with ties. */
export function cableLoom(P: Piece, a: V3, b: V3, drop: V3, r: number, count = 3, sec: Section = "dark", tieSec: Section = "mechanical") {
  const spread = r * 2.4;
  const [u, vv] = frame(b.clone().sub(a));
  const mid = (t: number) => a.clone().lerp(b, t).add(drop);
  for (let k = 0; k < count; k++) {
    const ang = (2 * Math.PI * k) / count;
    const off = u.clone().multiplyScalar(Math.cos(ang) * spread * 0.5).addScaledVector(vv, Math.sin(ang) * spread * 0.5);
    tube(P, bezier(a.clone().add(off), mid(0.33).add(off), mid(0.66).add(off), b.clone().add(off), 10), r, sec, { n: 6, bend: 0 });
  }
  const path = bezier(a, mid(0.33), mid(0.66), b, 20);
  for (const t of [1 / 3, 2 / 3]) lathe(P, path[Math.round(t * 20)], b.clone().sub(a), [[-r * 1.2, 0], [-r * 1.2, spread * 0.5 + r * 1.6], [r * 1.2, spread * 0.5 + r * 1.6], [r * 1.2, 0]], tieSec, { n: 8 });
}
