// The kit's hardware and markings, ported from wkit.py: bolts (rows, circles), painted quads, hazard stripes,
// chevrons, stencil digits, louvres, serrations, cooling fins, plus lamps (a lens in a bezel) for the game's look.
import { Piece, decalQuad, v, type V3 } from "./piece";
import { frame, lathe, plate, prism } from "./solids";
import { octRing } from "./shapes";
import type { Section } from "../palette";

/** A hex bolt head with a washer, standing out of a face along nrm. */
export function bolt(P: Piece, pos: V3, nrm: V3, r: number, sec: Section = "detail") {
  const h = r * 0.7;
  lathe(P, pos, nrm, [[0, 0], [0, r * 1.35], [h * 0.3, r * 1.35], [h * 0.3, r], [h, r], [h, 0]], sec, { n: 6, phase: Math.PI / 6 });
}

export function boltRow(P: Piece, a: V3, b: V3, count: number, nrm: V3, r: number, sec: Section = "detail") {
  for (let i = 0; i < count; i++) bolt(P, a.clone().lerp(b, (i + 0.5) / count), nrm, r, sec);
}

export function boltCircle(P: Piece, c: V3, axis: V3, R: number, count: number, r: number, sec: Section = "detail", phase = 0) {
  const [u, vv, w] = frame(axis);
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count + phase;
    bolt(P, c.clone().addScaledVector(u, Math.cos(a) * R).addScaledVector(vv, Math.sin(a) * R), w, r, sec);
  }
}

/** A painted quad on a surface (centre c, w along u, h along v, facing u x v); skew slants it. */
export function paint(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, sec: Section, off = 0.003, skew = 0) {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  const cc = c.clone().addScaledVector(n, off);
  const pts = [[-w / 2 - skew, -h / 2], [w / 2 - skew, -h / 2], [w / 2 + skew, h / 2], [-w / 2 + skew, h / 2]].map(([a, b]) => cc.clone().addScaledVector(uu, a).addScaledVector(vv, b));
  decalQuad(P, pts, n, sec);
}

/** Diagonal hazard stripes in a w x h band (alternating sections). */
export function hazard(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, stripes: number, secA: Section = "trim", secB: Section = "dark", slant = 0.6) {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  paint(P, c, uu, vv, w, h, secB, 0.002);
  const step = w / stripes, sk = slant * h * 0.5, cc = c.clone().addScaledVector(n, 0.0035);
  for (let i = 0; i < stripes; i += 2) {
    const x = -w / 2 + step * (i + 0.5), x0 = x - step * 0.49, x1 = x + step * 0.49;
    const cl = (a: number) => Math.max(-w / 2, Math.min(w / 2, a));
    const pts = [[cl(x0 - sk), -h / 2], [cl(x1 - sk), -h / 2], [cl(x1 + sk), h / 2], [cl(x0 + sk), h / 2]].map(([a, b]) => cc.clone().addScaledVector(uu, a).addScaledVector(vv, b));
    decalQuad(P, pts, n, secA);
  }
}

/** A row of painted chevrons pointing along u. */
export function chevrons(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, count: number, sec: Section = "trim") {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  const step = w / count, cc = c.clone().addScaledVector(n, 0.003);
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + step * (i + 0.5), t = step * 0.35;
    for (const s of [1, -1]) {
      const pts = [[x - t, 0], [x + t * 0.2, (s * h) / 2], [x + t * 1.2, (s * h) / 2], [x, 0]].map(([a, b]) => cc.clone().addScaledVector(uu, a).addScaledVector(vv, b));
      decalQuad(P, pts, n, sec);
    }
  }
}

const SEGS: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", H: "bcefg" };

/** Blocky seven-segment stencil numerals, read left to right along u, up along v, facing u x v. */
export function stencilDigits(P: Piece, c: V3, u: V3, w2: V3, h: number, text: string, sec: Section = "trim") {
  const uu = u.clone().normalize(), vv = w2.clone().normalize();
  const w = h * 0.55, t = h * 0.16;
  const pos: Record<string, [number, number, number, number]> = {
    a: [0, h / 2 - t / 2, w, t], g: [0, 0, w, t], d: [0, -h / 2 + t / 2, w, t],
    f: [-w / 2 + t / 2, h / 4, t, h / 2 - t * 0.4], b: [w / 2 - t / 2, h / 4, t, h / 2 - t * 0.4],
    e: [-w / 2 + t / 2, -h / 4, t, h / 2 - t * 0.4], c: [w / 2 - t / 2, -h / 4, t, h / 2 - t * 0.4],
  };
  let x = -(text.length - 1) * w * 0.65;
  for (const ch of text) {
    for (const s of SEGS[ch] ?? "") {
      const [dx, dy, sw, sh] = pos[s];
      paint(P, c.clone().addScaledVector(uu, x + dx).addScaledVector(vv, dy), uu, vv, sw * 0.9, sh * 0.9, sec, 0.0035);
    }
    x += w * 1.3;
  }
}

/** Angled slats in a recessed frame (exhaust and cooling vents). */
export function louvres(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, count: number, sec: Section = "dark", backSec: Section = "dark", tilt = 0.55) {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  const depth = h * 0.12;
  plate(P, c, uu, vv, w, h, depth * 0.5, backSec, { ch: Math.min(w, h) * 0.08, bevel: 0 });
  const pitch = h / count;
  for (let i = 0; i < count; i++) {
    const p = c.clone().addScaledVector(vv, -h / 2 + (i + 0.5) * pitch).addScaledVector(n, depth * 0.6);
    const nn = n.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(vv, -Math.sin(tilt)).normalize();
    prism(P, p.clone().addScaledVector(uu, -w * 0.46), p.clone().addScaledVector(uu, w * 0.46), octRing(pitch * 0.5, pitch * 0.08, pitch * 0.03), sec, nn);
  }
}

/** Raised ridges across a face (grip texture, slide serrations). */
export function serrations(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, count: number, depth: number, sec: Section) {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  const pitch = w / count;
  for (let i = 0; i < count; i++) {
    const p = c.clone().addScaledVector(uu, -w / 2 + (i + 0.5) * pitch);
    prism(P, p.clone().addScaledVector(vv, -h / 2), p.clone().addScaledVector(vv, h / 2), [[-pitch * 0.32, 0], [pitch * 0.32, 0], [pitch * 0.12, depth], [-pitch * 0.12, depth]], sec, n);
  }
}

/** Cooling fins turned round a can or barrel. */
export function heatRings(P: Piece, c: V3, axis: V3, rIn: number, rOut: number, count: number, length: number, sec: Section = "mechanical", n = 12) {
  const pitch = length / count;
  const prof: [number, number][] = [[0, 0], [0, rIn]];
  for (let i = 0; i < count; i++) {
    const t0 = i * pitch;
    prof.push([t0 + pitch * 0.2, rIn], [t0 + pitch * 0.28, rOut], [t0 + pitch * 0.62, rOut], [t0 + pitch * 0.7, rIn]);
  }
  prof.push([length, rIn], [length, 0]);
  lathe(P, c, axis, prof, sec, { n });
}

/** A lamp: a dark bezel ring with a glowing lens (section "lighting") facing along nrm. */
export function lamp(P: Piece, pos: V3, nrm: V3, r: number, lens: Section = "lighting", bezel: Section = "dark") {
  lathe(P, pos, nrm, [[0, 0], [0, r * 1.45], [r * 0.5, r * 1.45], [r * 0.6, r * 1.2], [r * 0.45, r * 1.05], [r * 0.45, 0]], bezel, { n: 8, phase: Math.PI / 8 });
  lathe(P, pos.clone().addScaledVector(nrm.clone().normalize(), r * 0.42), nrm, [[0, 0], [0, r], [r * 0.25, r * 0.8], [r * 0.35, 0]], lens, { n: 8, phase: Math.PI / 8 });
}

/** A strip light: a glowing bar in a dark channel lying on a face (centre c, w along u, facing u x v). */
export function lightStrip(P: Piece, c: V3, u: V3, w2: V3, w: number, h: number, lens: Section = "lighting") {
  const uu = u.clone().normalize(), vv = w2.clone().normalize(), n = uu.clone().cross(vv);
  plate(P, c, uu, vv, w + h * 0.8, h * 1.8, h * 0.35, "dark", { bevel: 0 });
  plate(P, c.clone().addScaledVector(n, h * 0.3), uu, vv, w, h, h * 0.25, lens, { bevel: h * 0.1 });
}

export { v };
