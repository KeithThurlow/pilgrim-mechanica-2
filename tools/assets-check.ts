// Asset contract check (docs/asset-pipeline.md, docs/asset-list.md): what a built model or picture must never be.
// Fitted parts (public/models/parts/<base id>.glb, from tools/blender/parts/):
// - the file is a GLB for a real item base of the right kind, with its sidecar, and the sidecar's numbers match it;
// - triangles within the kind's budget (pack 2,000, arm 1,500, sensor 1,000, waist 1,000);
// - draw cost: one `Body` mesh, at most one `Glow`, one mesh more per moving node; one material each, named
//   `Paint_plating` / `Paint_lighting`; every mesh carries vertex colours (COLOR_0) and normals;
// - the kind's sockets are there (a pack: `Mount`, `Top`), and it fits the kind's envelope round its origin;
// - not black and not blown out: the mean vertex colour of the body (linear) sits between 0.03 and 0.9.
// Inventory pictures (public/icons/<base id>.png, from `npm run icons`): each is a PNG for a real base and listed in
// src/ui/iconList.ts, and every listed base has its file.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { BASE_BY_ID } from "../src/items/bases";
import { ICON_IDS } from "../src/ui/iconList";

let fails = 0;
const fail = (m: string) => { fails++; console.log("FAIL " + m); };
const verbose = process.argv.includes("--verbose");

const RULES: Record<string, { tris: number; sockets: string[]; half: [number, number, number] }> = {
  pack: { tris: 2000, sockets: ["Mount", "Top"], half: [0.95, 0.8, 0.85] },
  arm: { tris: 1500, sockets: ["Shoulder", "Grip_R"], half: [1.2, 2.2, 1.6] },
  sensor: { tris: 1000, sockets: [], half: [1.2, 1.6, 1.2] },
  waist: { tris: 1000, sockets: ["Mount"], half: [0.9, 0.9, 0.9] },
};

interface Gltf {
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: { name?: string }[];
  accessors: { count: number; componentType: number; type: string; normalized?: boolean; bufferView: number; byteOffset?: number; min?: number[]; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

function readGlb(path: string): { json: Gltf; bin: Buffer } | null {
  const f = readFileSync(path);
  if (f.length < 20 || f.toString("latin1", 0, 4) !== "glTF") return null;
  const n = f.readUInt32LE(12);
  const json = JSON.parse(f.toString("utf8", 20, 20 + n)) as Gltf;
  const at = 20 + n;
  return { json, bin: f.subarray(at + 8, at + 8 + f.readUInt32LE(at)) };
}

/** Mean of a colour accessor's rgb, 0..1 (floats, or normalised bytes or shorts). */
function meanColour(g: Gltf, bin: Buffer, acc: number): number {
  const a = g.accessors[acc], v = g.bufferViews[a.bufferView], comps = a.type === "VEC4" ? 4 : 3;
  const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 1;
  const stride = v.byteStride ?? comps * size, base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  let s = 0;
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) {
    const o = base + i * stride + k * size;
    s += size === 4 ? bin.readFloatLE(o) : size === 2 ? bin.readUInt16LE(o) / 65535 : bin.readUInt8(o) / 255;
  }
  return s / (a.count * 3);
}

const found: [string, string][] = [];
for (const dir of ["public/models/parts", "public/models/sensors"]) {
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".glb") && !/-lod\d\.glb$/.test(f)) found.push([dir, f]);
}
const files = found;
for (const [partsDir, file] of found) {
  const id = file.slice(0, -4), base = BASE_BY_ID[id], tag = `${partsDir.split("/").pop()}/${file}`;
  if (!base) { fail(`${tag}: no item base "${id}"`); continue; }
  const rule = RULES[base.kind];
  if (!rule) { fail(`${tag}: kind ${base.kind} has no part rules yet (add them here with its budget)`); continue; }
  const glb = readGlb(`${partsDir}/${file}`);
  if (!glb) { fail(`${tag}: not a GLB`); continue; }
  const { json: g, bin } = glb;
  const side = existsSync(`${partsDir}/${id}.json`) ? JSON.parse(readFileSync(`${partsDir}/${id}.json`, "utf8")) as { kind: string; tris: number; moving: Record<string, unknown>; sockets: Record<string, number[]> } : null;
  if (!side) fail(`${tag}: no sidecar ${id}.json`);
  let tris = 0, meshNodes = 0;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const names = new Set(g.nodes.map((n) => n.name ?? ""));
  for (const n of g.nodes) {
    if (n.mesh === undefined) continue;
    meshNodes++;
    const m = g.meshes[n.mesh];
    if (m.primitives.length !== 1) fail(`${tag}: mesh ${n.name} has ${m.primitives.length} materials (one each)`);
    for (const p of m.primitives) {
      const mat = g.materials?.[p.material ?? -1]?.name ?? "(none)";
      if (!/^Paint_[a-z]+$/.test(mat)) fail(`${tag}: mesh ${n.name} material "${mat}" (Paint_<section>)`);
      if (n.name === "Glow" && mat !== "Paint_lighting") fail(`${tag}: Glow must be Paint_lighting, is ${mat}`);
      if (p.attributes.COLOR_0 === undefined) fail(`${tag}: mesh ${n.name} has no vertex colours`);
      if (p.attributes.NORMAL === undefined) fail(`${tag}: mesh ${n.name} has no normals`);
      const pos = g.accessors[p.attributes.POSITION];
      tris += (p.indices !== undefined ? g.accessors[p.indices].count : pos.count) / 3;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos.min?.[k] ?? 0); hi[k] = Math.max(hi[k], pos.max?.[k] ?? 0); }
      if (n.name === "Body" && p.attributes.COLOR_0 !== undefined) {
        const mean = meanColour(g, bin, p.attributes.COLOR_0);
        if (!(mean > 0.03 && mean < 0.9)) fail(`${tag}: body's mean colour ${mean.toFixed(3)} (black or blown out)`);
      }
    }
  }
  const moving = side ? Object.keys(side.moving ?? {}).length : 0;
  if (!names.has("Body")) fail(`${tag}: no Body mesh`);
  if (meshNodes > 2 + 2 * moving) fail(`${tag}: ${meshNodes} meshes (Body, Glow and a body and a glow per moving node: ${2 + 2 * moving} at most)`);
  if (tris > rule.tris) fail(`${tag}: ${tris} tris, budget ${rule.tris}`);
  for (const s of rule.sockets) if (!names.has(s)) fail(`${tag}: no ${s} socket`);
  for (let k = 0; k < 3; k++) if (Math.max(Math.abs(lo[k]), Math.abs(hi[k])) > rule.half[k]) fail(`${tag}: reaches ${Math.max(Math.abs(lo[k]), Math.abs(hi[k])).toFixed(2)} m on ${"xyz"[k]} (envelope ${rule.half[k]})`);
  if (side) {
    if (side.kind !== base.kind) fail(`${tag}: sidecar kind ${side.kind}, base kind ${base.kind}`);
    if (side.tris !== tris) fail(`${tag}: sidecar says ${side.tris} tris, the GLB has ${tris} (rebuild it)`);
  }
  if (verbose) console.log(`  ${id}: ${tris} tris / ${rule.tris}, ${meshNodes} meshes`);
}

// ---- Inventory pictures
const iconDir = "public/icons";
const pics = existsSync(iconDir) ? readdirSync(iconDir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)) : [];
for (const id of pics) {
  if (!BASE_BY_ID[id]) fail(`icons/${id}.png: no item base "${id}"`);
  if (!ICON_IDS.has(id)) fail(`icons/${id}.png isn't in src/ui/iconList.ts (run npm run icons)`);
  const f = readFileSync(`${iconDir}/${id}.png`);
  if (f.readUInt32BE(0) !== 0x89504e47) fail(`icons/${id}.png: not a PNG`);
  else if (f.readUInt32BE(16) < 32 || f.readUInt32BE(20) < 32) fail(`icons/${id}.png: ${f.readUInt32BE(16)}×${f.readUInt32BE(20)} px`);
}
for (const id of ICON_IDS) if (!pics.includes(id)) fail(`src/ui/iconList.ts lists ${id} but public/icons/${id}.png is missing`);

console.log(fails ? `assets-check: ${fails} failure(s)` : `assets-check: ${files.length} parts, ${pics.length} pictures ok`);
process.exit(fails ? 1 : 0);
