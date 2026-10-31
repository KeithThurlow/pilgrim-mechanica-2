// The back half of the part pipeline, shared by both lanes: a raw generated mesh (lane A's splat mesh, or lane B's
// textured GLB) becomes a game part. Orient (the generator's front and up to the game's +Z and +Y), fit into the
// kind's box (uniform scale, centred, base at y 0), weld and simplify to the kind's triangle budget with
// meshoptimizer (colour kept as an attribute), colours into vertex colours (textures dropped: the toon look reads
// vertex colour), smooth normals, then the kind's sockets as empties. Pure: same input, same part.
import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";
import { sample, type Glb, type OutPart } from "./glb";
import type { Kind, V3 } from "./kinds";
import type { Mesh } from "./splat";

export type Axis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
export interface PrepOptions {
  front: Axis;   // the source's front, turned to +Z
  up: Axis;      // the source's up, turned to +Y
  tris?: number; // override the kind's budget
}

/** Flatten a GLB's meshes into one coloured mesh (texture or vertex colour times the material's factor). */
export function glbToMesh(g: Glb): Mesh {
  const P: number[] = [], C: number[] = [], I: number[] = [];
  const rgb = [0, 0, 0];
  for (const m of g.meshes) {
    const base = P.length / 3, n = m.pos.length / 3;
    for (let v = 0; v < n; v++) {
      P.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      if (m.image && m.uv) sample(m.image, m.uv[v * 2], m.uv[v * 2 + 1], rgb);
      else if (m.col) { rgb[0] = m.col[v * 3]; rgb[1] = m.col[v * 3 + 1]; rgb[2] = m.col[v * 3 + 2]; }
      else rgb.fill(1);
      C.push(rgb[0] * m.factor[0], rgb[1] * m.factor[1], rgb[2] * m.factor[2]);
    }
    for (const i of m.index) I.push(base + i);
  }
  return { pos: new Float32Array(P), col: new Float32Array(C), index: new Uint32Array(I) };
}

const AXES: Record<Axis, V3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };

/** Rows of the rotation that takes the source's front to +Z and up to +Y. */
function basis(front: Axis, up: Axis): V3[] {
  const f = AXES[front], u = AXES[up];
  if (f.some((c, i) => c !== 0 && u[i] !== 0)) throw new Error(`partgen: front ${front} and up ${up} are the same axis`);
  const x: V3 = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]]; // up × front = +X (left)
  return [x, u, f];
}

/** Weld vertices that share a position (generators often write split vertices), averaging their colour. */
function weld(m: Mesh, eps: number): Mesh {
  const key = new Map<string, number>(), remap = new Uint32Array(m.pos.length / 3);
  const P: number[] = [], C: number[] = [], cnt: number[] = [];
  for (let v = 0; v < m.pos.length / 3; v++) {
    const k = `${Math.round(m.pos[v * 3] / eps)},${Math.round(m.pos[v * 3 + 1] / eps)},${Math.round(m.pos[v * 3 + 2] / eps)}`;
    let i = key.get(k);
    if (i === undefined) { i = P.length / 3; key.set(k, i); P.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); C.push(0, 0, 0); cnt.push(0); }
    C[i * 3] += m.col[v * 3]; C[i * 3 + 1] += m.col[v * 3 + 1]; C[i * 3 + 2] += m.col[v * 3 + 2]; cnt[i]++;
    remap[v] = i;
  }
  for (let i = 0; i < cnt.length; i++) for (let c = 0; c < 3; c++) C[i * 3 + c] /= cnt[i];
  const I: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const a = remap[m.index[t]], b = remap[m.index[t + 1]], c = remap[m.index[t + 2]];
    if (a !== b && b !== c && a !== c) I.push(a, b, c);
  }
  return { pos: new Float32Array(P), col: new Float32Array(C), index: new Uint32Array(I) };
}

function normals(pos: Float32Array, index: Uint32Array) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

export interface Prepared { part: OutPart; sockets: [string, V3][]; size: V3; scale: number; trisIn: number }

export async function prepare(src: Mesh, kind: Kind, o: PrepOptions): Promise<Prepared> {
  if (!src.index.length) throw new Error("partgen: empty mesh");
  // Orient.
  const B = basis(o.front, o.up), n = src.pos.length / 3, pos = new Float32Array(src.pos.length);
  for (let v = 0; v < n; v++) for (let r = 0; r < 3; r++) pos[v * 3 + r] = B[r][0] * src.pos[v * 3] + B[r][1] * src.pos[v * 3 + 1] + B[r][2] * src.pos[v * 3 + 2];
  // Fit: uniform scale into the box, centred in x and z, base at y 0.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of src.index) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[t * 3 + c]); hi[c] = Math.max(hi[c], pos[t * 3 + c]); }
  const scale = Math.min(...[0, 1, 2].map((c) => kind.box[c] / Math.max(1e-6, hi[c] - lo[c])));
  const mid = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  for (let v = 0; v < n; v++) for (let c = 0; c < 3; c++) pos[v * 3 + c] = (pos[v * 3 + c] - mid[c]) * scale;
  const size = [0, 1, 2].map((c) => (hi[c] - lo[c]) * scale) as V3;

  // Weld at a millimetre, then simplify to budget keeping colour.
  const w = weld({ pos, col: src.col, index: src.index }, 1e-3);
  const trisIn = w.index.length / 3, budget = o.tris ?? kind.tris;
  await MeshoptSimplifier.ready;
  let index = w.index;
  if (trisIn > budget) {
    const target = budget * 3;
    const span = Math.max(...size);
    // Colour weight: a full colour step counts like 2% of the part's size.
    [index] = MeshoptSimplifier.simplifyWithAttributes(w.index, w.pos, 3, w.col, 3, [span * 0.02, span * 0.02, span * 0.02], null, target, 1, []);
    if (index.length > target * 1.05) [index] = MeshoptSimplifier.simplifySloppy(index, w.pos, 3, null, target, 1);
  }
  // Compact to the vertices still used.
  const used = new Int32Array(w.pos.length / 3).fill(-1), P: number[] = [], C: number[] = [];
  const I = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    if (used[v] < 0) { used[v] = P.length / 3; P.push(w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]); C.push(w.col[v * 3], w.col[v * 3 + 1], w.col[v * 3 + 2]); }
    I[i] = used[v];
  }
  const fp = new Float32Array(P);
  // Inside out (some exporters wind clockwise)? Flip, so the outline shell and back-face culling work.
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += fp[a] * (fp[b + 1] * fp[c + 2] - fp[b + 2] * fp[c + 1]) - fp[a + 1] * (fp[b] * fp[c + 2] - fp[b + 2] * fp[c]) + fp[a + 2] * (fp[b] * fp[c + 1] - fp[b + 1] * fp[c]);
  }
  if (vol < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  const part: OutPart = { name: kind.part, pos: fp, nrm: normals(fp, I), col: new Float32Array(C), index: I, material: kind.material };
  // Sockets at fractions of the fitted box (x 0 = right side, -X).
  const sockets = Object.entries(kind.sockets).map(([name, f]) =>
    [name, [(f[0] - 0.5) * size[0], f[1] * size[1], (f[2] - 0.5) * size[2]] as V3] as [string, V3]);
  return { part, sockets, size, scale, trisIn };
}
