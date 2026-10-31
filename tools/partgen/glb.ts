// Minimal GLB reading and writing for the part pipeline (plain Node, no three.js loaders: those need a browser to
// decode textures). Reads every triangle mesh with its node transform, UVs, vertex colours and the base colour image
// bytes; writes one vertex-coloured mesh per part plus empties (sockets). Enough for generator output and our parts.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export interface Img { w: number; h: number; rgba: Uint8Array }
export interface RawMesh {
  name: string;
  pos: Float32Array;          // world space (node transforms applied)
  uv?: Float32Array;
  col?: Float32Array;         // rgb 0..1 per vertex
  index: Uint32Array;
  image?: Img;                // base colour texture
  factor: [number, number, number];
}
export interface Glb { meshes: RawMesh[]; empties: Map<string, [number, number, number]> }

const COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function decodeImage(bytes: Uint8Array, mime: string): Img {
  if (mime === "image/png" || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
    const p = PNG.sync.read(Buffer.from(bytes));
    return { w: p.width, h: p.height, rgba: new Uint8Array(p.data) };
  }
  if (mime === "image/jpeg" || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
    const j = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
    return { w: j.width, h: j.height, rgba: j.data };
  }
  throw new Error(`partgen: texture format ${mime || "unknown"} not supported (png and jpeg are)`);
}

type M4 = number[];
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): M4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

export function readGlb(buf: Uint8Array): Glb {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("partgen: not a GLB");
  const jlen = dv.getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jlen)));
  const binStart = 20 + jlen + 8;
  const bin = buf.subarray(binStart, binStart + (jlen + 20 < buf.length ? dv.getUint32(20 + jlen, true) : 0));
  const view = (i: number) => { const bv = j.bufferViews[i]; return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength); };
  const acc = (i: number): Float32Array | Uint32Array => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
    if (a.sparse) throw new Error("partgen: sparse accessors not supported");
    const n = COMPS[a.type], raw = view(a.bufferView), off = a.byteOffset ?? 0;
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType as 5126]!;
    const stride = bv.byteStride ?? n * size, d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const isIndex = a.componentType === 5125 || ((a.componentType === 5123 || a.componentType === 5121) && n === 1 && !a.normalized);
    const out = isIndex ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
    for (let e = 0; e < a.count; e++) for (let c = 0; c < n; c++) {
      const p = off + e * stride + c * size;
      let v: number;
      switch (a.componentType) {
        case 5126: v = d.getFloat32(p, true); break;
        case 5125: v = d.getUint32(p, true); break;
        case 5123: v = d.getUint16(p, true); if (a.normalized) v /= 65535; break;
        case 5121: v = d.getUint8(p); if (a.normalized) v /= 255; break;
        case 5122: v = d.getInt16(p, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
        default: v = d.getInt8(p); if (a.normalized) v = Math.max(v / 127, -1);
      }
      out[e * n + c] = v;
    }
    return out;
  };
  const images = new Map<number, Img>();
  const image = (tex: number) => {
    const src = j.textures[tex].source;
    if (!images.has(src)) {
      const im = j.images[src];
      if (im.bufferView === undefined) throw new Error("partgen: external textures not supported (embed them in the GLB)");
      images.set(src, decodeImage(view(im.bufferView), im.mimeType ?? ""));
    }
    return images.get(src)!;
  };

  const out: Glb = { meshes: [], empties: new Map() };
  const walk = (ni: number, parent: M4) => {
    const n = j.nodes[ni], m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const prim of j.meshes[n.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const p = acc(prim.attributes.POSITION) as Float32Array, pos = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        const index = prim.indices !== undefined ? Uint32Array.from(acc(prim.indices)) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        const mesh: RawMesh = { name: n.name ?? `mesh${n.mesh}`, pos, index, factor: [1, 1, 1] };
        if (prim.attributes.TEXCOORD_0 !== undefined) mesh.uv = acc(prim.attributes.TEXCOORD_0) as Float32Array;
        if (prim.attributes.COLOR_0 !== undefined) {
          const c = acc(prim.attributes.COLOR_0) as Float32Array, k = j.accessors[prim.attributes.COLOR_0].type === "VEC4" ? 4 : 3;
          mesh.col = new Float32Array(pos.length);
          for (let i = 0, v = 0; v < pos.length; i += k, v += 3) mesh.col.set([c[i], c[i + 1], c[i + 2]], v);
        }
        const mat = prim.material !== undefined ? j.materials[prim.material] : undefined;
        const pbr = mat?.pbrMetallicRoughness;
        if (pbr?.baseColorFactor) mesh.factor = pbr.baseColorFactor.slice(0, 3);
        if (pbr?.baseColorTexture) mesh.image = image(pbr.baseColorTexture.index);
        out.meshes.push(mesh);
      }
    } else if (n.name) out.empties.set(n.name, [m[12], m[13], m[14]]);
    for (const c of n.children ?? []) walk(c, m);
  };
  const roots: number[] = j.scenes?.[j.scene ?? 0]?.nodes ?? j.nodes.map((_: unknown, i: number) => i);
  for (const r of roots) walk(r, ident());
  return out;
}

/** Bilinear sample of an image at uv (glTF: v down from the top). Returns rgb 0..1. */
export function sample(img: Img, u: number, v: number, out: number[]) {
  const x = (((u % 1) + 1) % 1) * img.w - 0.5, y = (((v % 1) + 1) % 1) * img.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx: number, yy: number, c: number) => {
    xx = Math.min(img.w - 1, Math.max(0, xx)); yy = Math.min(img.h - 1, Math.max(0, yy));
    return img.rgba[(yy * img.w + xx) * 4 + c] / 255;
  };
  for (let c = 0; c < 3; c++) {
    out[c] = (px(x0, y0, c) * (1 - fx) + px(x0 + 1, y0, c) * fx) * (1 - fy) + (px(x0, y0 + 1, c) * (1 - fx) + px(x0 + 1, y0 + 1, c) * fx) * fy;
  }
  return out;
}

export interface OutPart { name: string; pos: Float32Array; nrm: Float32Array; col: Float32Array; index: Uint32Array; material: string }

/** Write parts (vertex colours as normalised bytes, no textures) and empties into a GLB. */
export function writeGlb(parts: OutPart[], empties: [string, [number, number, number]][], extras: Record<string, unknown> = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let len = 0;
  const bufferViews: object[] = [], accessors: object[] = [];
  const push = (data: Uint8Array, target?: number) => {
    const pad = (4 - (len % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); len += pad; }
    bufferViews.push({ buffer: 0, byteOffset: len, byteLength: data.byteLength, ...(target ? { target } : {}) });
    chunks.push(data); len += data.byteLength;
    return bufferViews.length - 1;
  };
  const meshes: object[] = [], materials: object[] = [], nodes: object[] = [];
  const matIndex = new Map<string, number>();
  for (const p of parts) {
    const n = p.pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i++) { min[i % 3] = Math.min(min[i % 3], p.pos[i]); max[i % 3] = Math.max(max[i % 3], p.pos[i]); }
    const col = new Uint8Array(n * 4);
    for (let v = 0; v < n; v++) {
      for (let c = 0; c < 3; c++) col[v * 4 + c] = Math.round(Math.min(1, Math.max(0, p.col[v * 3 + c])) * 255);
      col[v * 4 + 3] = 255;
    }
    const a0 = accessors.length;
    accessors.push({ bufferView: push(new Uint8Array(p.pos.buffer.slice(0)), 34962), componentType: 5126, count: n, type: "VEC3", min, max });
    accessors.push({ bufferView: push(new Uint8Array(p.nrm.buffer.slice(0)), 34962), componentType: 5126, count: n, type: "VEC3" });
    accessors.push({ bufferView: push(col, 34962), componentType: 5121, normalized: true, count: n, type: "VEC4" });
    accessors.push({ bufferView: push(new Uint8Array(p.index.buffer.slice(0)), 34963), componentType: 5125, count: p.index.length, type: "SCALAR" });
    if (!matIndex.has(p.material)) {
      matIndex.set(p.material, materials.length);
      materials.push({ name: p.material, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.7 } });
    }
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: a0, NORMAL: a0 + 1, COLOR_0: a0 + 2 }, indices: a0 + 3, material: matIndex.get(p.material) }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
  }
  for (const [name, t] of empties) nodes.push({ name, translation: t });
  const json = {
    asset: { version: "2.0", generator: "pilgrim-mechanica-2 tools/partgen", extras },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: len + ((4 - (len % 4)) % 4) }],
  };
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jb.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(jb.length + jpad).fill(0x20); t.set(jb); jb = t; }
  const binLen = len + ((4 - (len % 4)) % 4);
  const out = new Uint8Array(12 + 8 + jb.length + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  const b0 = 20 + jb.length;
  dv.setUint32(b0, binLen, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  let o = b0 + 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
