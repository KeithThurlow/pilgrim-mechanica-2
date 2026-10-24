// Thin a skinned character for the swarm: weld the triangle soup by position, simplify with meshoptimizer (vendored
// with three, examples/jsm/libs; edge collapse under a quadric error, colour as an attribute so colour borders hold),
// then give every kept vertex the average colour of the original vertices nearest it, so a big face still carries
// the colour of the area it covers.
import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";

export interface SoupVertex { p: [number, number, number]; c: [number, number, number, number]; skinI: number[]; skinW: number[] }

export interface Thinned {
  /** Kept vertices (welded originals). */
  verts: SoupVertex[];
  index: Uint32Array;
}

export async function thin(soup: SoupVertex[], tris: number[], targetTris: number, colourWeight = 0.5): Promise<Thinned> {
  // Weld by position (0.1 mm in source units, cm): one vertex per spot, colour averaged.
  const key = (p: number[]) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`;
  const at = new Map<string, number>(), welded: SoupVertex[] = [], sums: number[][] = [], remap = new Int32Array(soup.length);
  soup.forEach((v, i) => {
    const k = key(v.p);
    let j = at.get(k);
    if (j === undefined) { j = welded.length; at.set(k, j); welded.push({ ...v, c: [0, 0, 0, 0] }); sums.push([0, 0, 0, 0, 0]); }
    const s = sums[j]; s[0] += v.c[0]; s[1] += v.c[1]; s[2] += v.c[2]; s[3] += v.c[3]; s[4]++;
    remap[i] = j;
  });
  welded.forEach((v, j) => { const s = sums[j]; v.c = [s[0] / s[4], s[1] / s[4], s[2] / s[4], s[3] / s[4]]; });
  const idx: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = remap[tris[t]], b = remap[tris[t + 1]], c = remap[tris[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }

  await MeshoptSimplifier.ready;
  const pos = new Float32Array(welded.length * 3), attr = new Float32Array(welded.length * 3);
  welded.forEach((v, j) => { pos.set(v.p, j * 3); attr.set([v.c[0], v.c[1], v.c[2]], j * 3); });
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idx), pos, 3, attr, 3,
    [colourWeight, colourWeight, colourWeight], null, Math.min(idx.length, targetTris * 3), 1, []);

  // Compact to the vertices still used.
  const used = new Int32Array(welded.length).fill(-1), verts: SoupVertex[] = [];
  const index = new Uint32Array(simple.length);
  for (let k = 0; k < simple.length; k++) {
    const j = simple[k];
    if (used[j] < 0) { used[j] = verts.length; verts.push({ ...welded[j] }); }
    index[k] = used[j];
  }

  // Colour by area: each welded original goes to its nearest kept vertex.
  const acc = verts.map(() => [0, 0, 0, 0, 0]);
  for (const w of welded) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < verts.length; k++) {
      const p = verts[k].p, dx = p[0] - w.p[0], dy = p[1] - w.p[1], dz = p[2] - w.p[2], d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
    const a = acc[best]; a[0] += w.c[0]; a[1] += w.c[1]; a[2] += w.c[2]; a[3] += w.c[3]; a[4]++;
  }
  verts.forEach((v, k) => { const a = acc[k]; if (a[4]) v.c = [a[0] / a[4], a[1] / a[4], a[2] / a[4], a[3] / a[4]]; });
  return { verts, index };
}
