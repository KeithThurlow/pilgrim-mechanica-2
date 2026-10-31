// Part pipeline check (tools/partgen/): what must never happen to a generated part.
//   1. Lane A: a made-up splat (a box hull with a red stripe and a gun barrel, plus floaters) meshes into a closed,
//      outward-facing surface, the floaters are gone, the stripe's colour survives.
//   2. Prep: the part fits its kind's box (read from the Rampart), sits on y 0, is within its triangle budget, has
//      vertex colours, its sockets, and comes out byte-identical on a second run.
//   3. Lane B: a textured GLB (as Pixal3D / TRELLIS.2 write) turns its texture into vertex colours.
//   4. Every generated part in public/models/gen/ (index.json) passes the same rules for its kind.
// Run: npx tsx tools/partgen-check.ts
import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { readGlb, writeGlb } from "./partgen/glb";
import { loadKinds, type Kind } from "./partgen/kinds";
import { glbToMesh, prepare } from "./partgen/prep";
import { readPly, splatToMesh, writePly, SPLAT_MESH_DEFAULTS, type Mesh, type Splat } from "./partgen/splat";

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };

// Seeded random (tests only).
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Gaussians over the surface of a box (and a cylinder), as a generator would place them. */
function testSplat(): Splat {
  const P: number[] = [], C: number[] = [], A: number[] = [], S: number[] = [], R: number[] = [];
  const add = (p: number[], c: number[], s = 0.03, a = 0.9) => { P.push(...p); C.push(...c); A.push(a); S.push(s, s, s * 0.4); R.push(1, 0, 0, 0); };
  const hx = 0.8, hy = 0.5, hz = 0.6;
  for (let i = 0; i < 30000; i++) {
    const face = Math.floor(rnd() * 6), u = rnd() * 2 - 1, v = rnd() * 2 - 1;
    const p = face < 2 ? [face ? hx : -hx, u * hy, v * hz] : face < 4 ? [u * hx, face === 3 ? hy : -hy, v * hz] : [u * hx, v * hy, face === 5 ? hz : -hz];
    const red = Math.abs(p[1]) < 0.1 && face !== 2 && face !== 3;
    add(p, red ? [0.85, 0.15, 0.1] : [0.55, 0.55, 0.5]);
  }
  for (let i = 0; i < 4000; i++) { // barrel along +z
    const a = rnd() * Math.PI * 2, z = hz + rnd() * 0.5;
    add([0.1 * Math.cos(a), 0.1 * Math.sin(a), z], [0.2, 0.2, 0.2], 0.02);
  }
  for (let i = 0; i < 40; i++) add([3 + rnd(), 2 + rnd(), -3 + rnd()], [1, 1, 1], 0.05, 0.5); // floaters
  return { n: A.length, pos: new Float32Array(P), col: new Float32Array(C), alpha: new Float32Array(A), scale: new Float32Array(S), rot: new Float32Array(R) };
}

function stats(m: { pos: Float32Array; index: Uint32Array }) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of m.index) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.pos[i * 3 + c]); hi[c] = Math.max(hi[c], m.pos[i * 3 + c]); }
  let vol = 0;
  const edges = new Map<string, number>();
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]];
    const p = (i: number) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
    const [A, B, C] = [p(a), p(b), p(c)];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x < y ? `${x},${y}` : `${y},${x}`; edges.set(k, (edges.get(k) ?? 0) + 1); }
  }
  let two = 0;
  for (const n of edges.values()) if (n === 2) two++;
  return { lo, hi, vol, manifold: two / Math.max(1, edges.size), tris: m.index.length / 3 };
}

function checkPart(label: string, glb: Uint8Array, kind: Kind) {
  const g = readGlb(glb);
  const m = g.meshes.find((x) => x.name === kind.part);
  ok(!!m, `${label}: has mesh ${kind.part}`);
  if (!m) return;
  const s = stats(m);
  ok(s.tris <= kind.tris * 1.05 && s.tris >= 4, `${label}: ${s.tris} tris within budget ${kind.tris}`);
  ok(!!m.col, `${label}: vertex colours`);
  ok(Math.abs(s.lo[1]) < 1e-3, `${label}: base at y 0 (${s.lo[1].toFixed(4)})`);
  const size = [0, 1, 2].map((c) => s.hi[c] - s.lo[c]);
  const fits = size.every((v, c) => v <= kind.box[c] + 1e-3), fills = size.some((v, c) => v >= kind.box[c] * 0.98);
  ok(fits && fills, `${label}: fits its box ${kind.box.map((v) => v.toFixed(2)).join("×")} (${size.map((v) => v.toFixed(2)).join("×")})`);
  ok(s.vol > 0, `${label}: faces outward (volume ${s.vol.toFixed(3)} m³)`);
  for (const k of Object.keys(kind.sockets)) ok(g.empties.has(k), `${label}: socket ${k}`);
}

const kinds = loadKinds("public/models/rampart.glb");
console.log(`kinds from the Rampart: ${Object.values(kinds).map((k) => `${k.id} ${k.box.map((v) => v.toFixed(2)).join("×")} m`).join(", ")}`);

// 1. Lane A
const t0 = performance.now();
const splat = readPly(writePly(testSplat()));
const mesh = splatToMesh(splat, { ...SPLAT_MESH_DEFAULTS, resolution: 96 });
const ms = performance.now() - t0;
const sa = stats(mesh);
console.log(`lane A: ${splat.n} Gaussians → ${sa.tris} tris in ${ms.toFixed(0)} ms`);
ok(sa.manifold > 0.99, `lane A: closed surface (${(sa.manifold * 100).toFixed(2)}% of edges shared by two triangles)`);
ok(sa.vol > 0, `lane A: faces outward (volume ${sa.vol.toFixed(3)} m³, box 0.96)`);
ok(sa.hi[0] < 1.2 && sa.hi[1] < 1.2, `lane A: floaters dropped (max ${sa.hi.map((v) => v.toFixed(2)).join(", ")})`);
ok(sa.hi[2] > 0.95, `lane A: barrel kept (front at z ${sa.hi[2].toFixed(2)})`);
let reds = 0;
for (let v = 0; v < mesh.col.length / 3; v++) if (mesh.col[v * 3] > 0.6 && mesh.col[v * 3 + 1] < 0.35) reds++;
ok(reds > 20, `lane A: the red stripe survives (${reds} red vertices)`);

// 2. Prep
const run = async (m: Mesh, k: Kind) => {
  const p = await prepare(m, k, { front: "+z", up: "+y" });
  return writeGlb([p.part], p.sockets, { kind: k.id });
};
const a1 = await run(mesh, kinds.hull), a2 = await run(mesh, kinds.hull);
checkPart("hull from lane A", a1, kinds.hull);
ok(a1.length === a2.length && a1.every((b, i) => b === a2[i]), "prep: same input, same bytes");
checkPart("shoulder from lane A", await run(mesh, kinds.shoulder), kinds.shoulder);

// 3. Lane B: a textured cube, left half red, right half blue in the texture.
function texturedCube(): Uint8Array {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([220, 30, 20, 255, 20, 40, 220, 255]);
  const img = PNG.sync.write(png);
  const P: number[] = [], U: number[] = [], I: number[] = [];
  const faces: [number[], number[], number[]][] = [ // origin, u axis, v axis (outward = u × v)
    [[1, -1, -1], [0, 0, 2], [0, 2, 0]], [[-1, -1, 1], [0, 0, -2], [0, 2, 0]], [[-1, 1, -1], [2, 0, 0], [0, 0, 2]],
    [[-1, -1, 1], [2, 0, 0], [0, 0, -2]], [[-1, -1, 1], [2, 0, 0], [0, 2, 0]], [[1, -1, -1], [-2, 0, 0], [0, 2, 0]],
  ];
  faces.forEach(([o, u, v], f) => {
    const b = P.length / 3;
    for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { P.push(o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t); U.push(f < 3 ? 0.25 : 0.75, 0.5); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const pos = new Uint8Array(new Float32Array(P).buffer), uv = new Uint8Array(new Float32Array(U).buffer), idx = new Uint8Array(new Uint32Array(I).buffer);
  const parts = [pos, uv, idx, img];
  const views: object[] = [];
  let off = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += Math.ceil(p.length / 4) * 4; }
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "geometry_0", mesh: 0, scale: [0.5, 0.5, 0.5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ bufferView: 3, mimeType: "image/png" }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: "VEC3" }, { bufferView: 1, componentType: 5126, count: U.length / 2, type: "VEC2" },
      { bufferView: 2, componentType: 5125, count: I.length, type: "SCALAR" },
    ],
    bufferViews: views, buffers: [{ byteLength: off }],
  }).padEnd(0));
  const jl = Math.ceil(json.length / 4) * 4, out = new Uint8Array(12 + 8 + jl + 8 + off), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jl); out.set(json, 20);
  dv.setUint32(20 + jl, off, true); dv.setUint32(24 + jl, 0x004e4942, true);
  let o = 28 + jl;
  for (const p of parts) { out.set(p, o); o += Math.ceil(p.length / 4) * 4; }
  return out;
}
// (The fixture winds its faces inward on purpose: prep must turn it the right way out.)
const cube = glbToMesh(readGlb(texturedCube()));
let red = 0, blue = 0;
for (let v = 0; v < cube.col.length / 3; v++) { if (cube.col[v * 3] > 0.7) red++; if (cube.col[v * 3 + 2] > 0.7) blue++; }
ok(red === 12 && blue === 12, `lane B: texture to vertex colours (${red} red, ${blue} blue of 24)`);
ok(Math.abs(stats(cube).hi[0] - 0.5) < 1e-6, "lane B: node transform applied");
checkPart("wreck from lane B", await run(cube, kinds.wreck), kinds.wreck);

// 4. Generated parts on disk.
const indexPath = "public/models/gen/index.json";
if (existsSync(indexPath)) {
  const list = JSON.parse(readFileSync(indexPath, "utf8")) as { id: string; kind: string }[];
  for (const e of list) {
    const k = kinds[e.kind];
    ok(!!k, `${e.id}: known kind ${e.kind}`);
    if (k) checkPart(e.id, new Uint8Array(readFileSync(`public/models/gen/${e.id}.glb`)), k);
  }
  console.log(`${list.length} generated parts checked`);
} else console.log("no generated parts yet (public/models/gen/index.json)");

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log("partgen-check: all ok");
