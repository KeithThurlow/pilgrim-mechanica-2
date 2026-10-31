// Lane A of the part pipeline: a Gaussian splat (the 3DGS PLY that TripoSplat and most splat tools write) to a
// vertex-coloured triangle mesh, on the CPU, no training. The splat's Gaussians are summed into an opacity field
// on a grid (each Gaussian's density, as the renderer would see it), the surface is the field's 0.5 level, met with
// surface nets (one vertex per crossed cell, quads across crossed edges: smooth, no lookup tables), and each vertex
// takes the colour the Gaussians give that spot. Floaters are dropped first (trimmed bounds) and after (small islands).
// Seeded only by its input: same splat, same mesh.

export interface Splat {
  n: number;
  pos: Float32Array;   // xyz
  col: Float32Array;   // rgb 0..1 (SH band 0)
  alpha: Float32Array; // 0..1
  scale: Float32Array; // metres (exp of the log scales)
  rot: Float32Array;   // quaternion w, x, y, z (normalised)
}

const SH_C0 = 0.28209479177387814;

/** Parse a binary little-endian 3DGS PLY (x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3; other fields skipped). */
export function readPly(buf: Uint8Array): Splat {
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 64 * 1024)));
  const end = head.indexOf("end_header\n");
  if (!head.startsWith("ply") || end < 0) throw new Error("partgen: not a PLY");
  if (!head.includes("format binary_little_endian")) throw new Error("partgen: only binary little-endian PLY is supported");
  const lines = head.slice(0, end).split("\n");
  let n = 0, inVertex = false;
  const props: { name: string; type: string }[] = [];
  for (const l of lines) {
    const w = l.trim().split(/\s+/);
    if (w[0] === "element") { inVertex = w[1] === "vertex"; if (inVertex) n = Number(w[2]); else if (props.length) break; }
    else if (w[0] === "property" && inVertex) props.push({ type: w[1], name: w[2] });
  }
  const SIZE: Record<string, number> = { float: 4, float32: 4, double: 8, uchar: 1, uint8: 1, int: 4, uint: 4, short: 2, ushort: 2 };
  let stride = 0;
  const off: Record<string, { o: number; t: string }> = {};
  for (const p of props) { off[p.name] = { o: stride, t: p.type }; stride += SIZE[p.type] ?? 4; }
  for (const k of ["x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]) {
    if (!off[k]) throw new Error(`partgen: PLY has no '${k}' (a compressed splat? export a plain 3DGS PLY)`);
  }
  const body = end + "end_header\n".length;
  const dv = new DataView(buf.buffer, buf.byteOffset + body, n * stride);
  const get = (v: number, k: string) => {
    const f = off[k], p = v * stride + f.o;
    switch (f.t) { case "double": return dv.getFloat64(p, true); case "uchar": case "uint8": return dv.getUint8(p) / 255; default: return dv.getFloat32(p, true); }
  };
  const s: Splat = { n, pos: new Float32Array(n * 3), col: new Float32Array(n * 3), alpha: new Float32Array(n), scale: new Float32Array(n * 3), rot: new Float32Array(n * 4) };
  const hasDc = !!off.f_dc_0, hasRgb = !!off.red;
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < 3; c++) {
      s.pos[v * 3 + c] = get(v, "xyz"[c]);
      s.scale[v * 3 + c] = Math.exp(get(v, `scale_${c}`));
      s.col[v * 3 + c] = hasDc ? Math.min(1, Math.max(0, 0.5 + SH_C0 * get(v, `f_dc_${c}`))) : hasRgb ? get(v, ["red", "green", "blue"][c]) : 0.7;
    }
    s.alpha[v] = 1 / (1 + Math.exp(-get(v, "opacity")));
    let w = get(v, "rot_0"), x = get(v, "rot_1"), y = get(v, "rot_2"), z = get(v, "rot_3");
    const l = Math.hypot(w, x, y, z) || 1;
    w /= l; x /= l; y /= l; z /= l;
    s.rot.set([w, x, y, z], v * 4);
  }
  return s;
}

/** Write a splat as a 3DGS PLY (used by the check to make test splats). */
export function writePly(s: Splat): Uint8Array {
  const names = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${s.n}\n${names.map((k) => `property float ${k}\n`).join("")}end_header\n`;
  const hb = new TextEncoder().encode(head), out = new Uint8Array(hb.length + s.n * names.length * 4);
  out.set(hb);
  const dv = new DataView(out.buffer, hb.length);
  let o = 0;
  const f = (v: number) => { dv.setFloat32(o, v, true); o += 4; };
  for (let v = 0; v < s.n; v++) {
    f(s.pos[v * 3]); f(s.pos[v * 3 + 1]); f(s.pos[v * 3 + 2]);
    for (let c = 0; c < 3; c++) f((s.col[v * 3 + c] - 0.5) / SH_C0);
    const a = Math.min(0.9999, Math.max(1e-4, s.alpha[v]));
    f(Math.log(a / (1 - a)));
    for (let c = 0; c < 3; c++) f(Math.log(s.scale[v * 3 + c]));
    for (let c = 0; c < 4; c++) f(s.rot[v * 4 + c]);
  }
  return out;
}

export const SPLAT_MESH_DEFAULTS = {
  resolution: 160,  // cells along the longest side
  iso: 0.5,         // opacity level that is the surface
  minAlpha: 0.05,   // Gaussians fainter than this are ignored
  trim: 0.005,      // fraction of centres cut from each end of each axis when finding the bounds (floaters)
  reach: 3,         // sigmas a Gaussian reaches
  island: 0.05,     // islands smaller than this fraction of the biggest are dropped
};
export type SplatMeshValues = typeof SPLAT_MESH_DEFAULTS;

export interface Mesh { pos: Float32Array; col: Float32Array; index: Uint32Array }

export function splatToMesh(s: Splat, o: SplatMeshValues = SPLAT_MESH_DEFAULTS): Mesh {
  // Bounds from trimmed centres of the Gaussians that count.
  const keep: number[] = [];
  for (let i = 0; i < s.n; i++) if (s.alpha[i] >= o.minAlpha) keep.push(i);
  if (!keep.length) throw new Error("partgen: splat has no Gaussians above minAlpha");
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const v = keep.map((i) => s.pos[i * 3 + c]).sort((a, b) => a - b);
    const k = Math.floor(v.length * o.trim);
    lo[c] = v[k]; hi[c] = v[v.length - 1 - k];
  }
  const inside = keep.filter((i) => [0, 1, 2].every((c) => s.pos[i * 3 + c] >= lo[c] && s.pos[i * 3 + c] <= hi[c]));
  let pad = 0;
  for (const i of inside) pad = Math.max(pad, Math.min(Math.max(s.scale[i * 3], s.scale[i * 3 + 1], s.scale[i * 3 + 2]) * o.reach, (hi[0] - lo[0]) * 0.05));
  for (let c = 0; c < 3; c++) { lo[c] -= pad * 1.5; hi[c] += pad * 1.5; }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const h = span / o.resolution;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const N = nx * ny * nz;
  const dens = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);

  // Sum each Gaussian's density over the cells it reaches: alpha * exp(-d'Σ⁻¹d / 2).
  for (const i of inside) {
    const [w, x, y, z] = [s.rot[i * 4], s.rot[i * 4 + 1], s.rot[i * 4 + 2], s.rot[i * 4 + 3]];
    const R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    // Floor the scales at half a cell, so flat Gaussians still land in the grid.
    const inv = [0, 1, 2].map((c) => 1 / Math.max(s.scale[i * 3 + c], h * 0.5) ** 2);
    // Σ⁻¹ = R diag(inv) Rᵀ
    const S = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] = R[r * 3] * inv[0] * R[c * 3] + R[r * 3 + 1] * inv[1] * R[c * 3 + 1] + R[r * 3 + 2] * inv[2] * R[c * 3 + 2];
    const ext = o.reach * Math.max(s.scale[i * 3], s.scale[i * 3 + 1], s.scale[i * 3 + 2], h * 0.5);
    const px = s.pos[i * 3], py = s.pos[i * 3 + 1], pz = s.pos[i * 3 + 2], a = s.alpha[i];
    const x0 = Math.max(0, Math.floor((px - ext - lo[0]) / h)), x1 = Math.min(nx - 1, Math.ceil((px + ext - lo[0]) / h));
    const y0 = Math.max(0, Math.floor((py - ext - lo[1]) / h)), y1 = Math.min(ny - 1, Math.ceil((py + ext - lo[1]) / h));
    const z0 = Math.max(0, Math.floor((pz - ext - lo[2]) / h)), z1 = Math.min(nz - 1, Math.ceil((pz + ext - lo[2]) / h));
    const r0 = s.col[i * 3], g0 = s.col[i * 3 + 1], b0 = s.col[i * 3 + 2];
    const cut = o.reach * o.reach;
    for (let gz = z0; gz <= z1; gz++) {
      const dz = lo[2] + gz * h - pz;
      for (let gy = y0; gy <= y1; gy++) {
        const dy = lo[1] + gy * h - py;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = lo[0] + gx * h - px;
          const q = dx * (S[0] * dx + S[1] * dy + S[2] * dz) + dy * (S[3] * dx + S[4] * dy + S[5] * dz) + dz * (S[6] * dx + S[7] * dy + S[8] * dz);
          if (q > cut) continue;
          const d = a * Math.exp(-0.5 * q), k = (gz * ny + gy) * nx + gx;
          dens[k] += d; cr[k] += d * r0; cg[k] += d * g0; cb[k] += d * b0;
        }
      }
    }
  }
  // Opacity, as light through the stack would see it: 1 - exp(-density).
  const f = new Float32Array(N);
  for (let k = 0; k < N; k++) f[k] = 1 - Math.exp(-dens[k]);

  // Surface nets: a vertex in each cell whose corners straddle the level, at the mean of its edges' crossings.
  const cells = (nx - 1) * (ny - 1) * (nz - 1);
  const vid = new Int32Array(cells).fill(-1);
  const P: number[] = [], C: number[] = [];
  const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = (c: number) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const v = new Array(8);
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corner(c); v[c] = f[at(x + a, y + b, z + d)]; if (v[c] > o.iso) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [e0, e1] of EDGES) {
      if (((mask >> e0) & 1) === ((mask >> e1) & 1)) continue;
      const t = (o.iso - v[e0]) / (v[e1] - v[e0]), A = corner(e0), B = corner(e1);
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; m++;
    }
    const gx = x + sx / m, gy = y + sy / m, gz = z + sz / m;
    vid[(z * (ny - 1) + y) * (nx - 1) + x] = P.length / 3;
    P.push(lo[0] + gx * h, lo[1] + gy * h, lo[2] + gz * h);
    // Colour: density-weighted mean over the cell's corners (the Gaussians' colour at this spot).
    let wr = 0, wg = 0, wb = 0, wd = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corner(c), k = at(x + a, y + b, z + d); wr += cr[k]; wg += cg[k]; wb += cb[k]; wd += dens[k]; }
    C.push(wd > 0 ? wr / wd : 0.5, wd > 0 ? wg / wd : 0.5, wd > 0 ? wb / wd : 0.5);
  }
  // Quads across each crossed grid edge, between the four cells round it; wound so the outside faces out.
  const I: number[] = [];
  const cell = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx - 1 || y >= ny - 1 || z >= nz - 1) ? -1 : vid[(z * (ny - 1) + y) * (nx - 1) + x];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d);
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const in0 = f[at(x, y, z)] > o.iso;
    if (x + 1 < nx && in0 !== f[at(x + 1, y, z)] > o.iso) quad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), !in0);
    if (y + 1 < ny && in0 !== f[at(x, y + 1, z)] > o.iso) quad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), !in0);
    if (z + 1 < nz && in0 !== f[at(x, y, z + 1)] > o.iso) quad(cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z), !in0);
  }
  return dropIslands({ pos: new Float32Array(P), col: new Float32Array(C), index: new Uint32Array(I) }, o.island);
}

/** Keep only connected pieces with at least `frac` of the biggest piece's triangles (floaters, specks). */
export function dropIslands(m: Mesh, frac: number): Mesh {
  const nv = m.pos.length / 3, parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < m.index.length; t += 3) {
    const a = find(m.index[t]), b = find(m.index[t + 1]), c = find(m.index[t + 2]);
    parent[b] = a; parent[c] = a;
  }
  const tris = new Map<number, number>();
  for (let t = 0; t < m.index.length; t += 3) { const r = find(m.index[t]); tris.set(r, (tris.get(r) ?? 0) + 1); }
  const big = Math.max(0, ...tris.values());
  const I: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) if ((tris.get(find(m.index[t])) ?? 0) >= big * frac) I.push(m.index[t], m.index[t + 1], m.index[t + 2]);
  return { ...m, index: new Uint32Array(I) };
}
