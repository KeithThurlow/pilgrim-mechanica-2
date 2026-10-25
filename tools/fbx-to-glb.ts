// Convert FBX exports (from the old project's Blender kit) to GLB for the web, keeping node names and empties
// (joint markers, weapon sockets), vertex colours and the mesh layout. Run:
//   npx tsx tools/fbx-to-glb.ts <in.fbx> <out.glb> [<in.fbx> <out.glb> ...]
// Meshes with several material slots (the weapon kit's Paint_<section> slots) keep them: the triangles are sorted
// so each slot is one run (one glTF primitive per slot, not one per face group), named after the slot. UVs are
// dropped (the kit's UVs only point at a palette cell; the slot names say the same) and vertices are welded.
// Long term the Blender scripts should export GLB directly; this bridges the existing assets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// GLTFExporter reads its output Blob with FileReader, which Node lacks.
(globalThis as unknown as { FileReader: unknown }).FileReader = class {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) {
    b.arrayBuffer().then((r) => { this.result = "data:application/octet-stream;base64," + Buffer.from(r).toString("base64"); this.onloadend?.(); });
  }
};

/** Sort a multi-slot geometry so each material slot is one contiguous group; returns the slot order kept. */
function sortBySlot(g: THREE.BufferGeometry, slots: number) {
  const src = g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]);
  const idx = src.index!.array;
  const runs: number[][] = Array.from({ length: slots }, () => []);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  for (const gr of groups) for (let i = gr.start; i < gr.start + gr.count; i++) runs[gr.materialIndex ?? 0].push(idx[i]);
  const out: number[] = [];
  g.clearGroups();
  const used: number[] = [];
  for (let s = 0; s < slots; s++) {
    if (!runs[s].length) continue;
    g.addGroup(out.length, runs[s].length, used.length);
    used.push(s);
    for (const v of runs[s]) out.push(v);
  }
  g.setIndex(out);
  return used;
}

export async function convertFbx(src: string, dst: string) {
  const buf = readFileSync(src);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  let meshes = 0, tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    let g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    // Plain standard materials; the game applies its own look. Keep vertex colours (the painted "Color" layer).
    const mk = (old: THREE.Material) => new THREE.MeshStandardMaterial({ name: old.name, color: 0xffffff, vertexColors: !!g.attributes.color, roughness: 0.8 });
    if (Array.isArray(m.material) && m.material.length > 1) {
      g.deleteAttribute("uv");
      g = mergeVertices(g, 1e-5);
      const old = m.material;
      const used = sortBySlot(g, old.length);
      m.geometry = g;
      m.material = used.map((s) => mk(old[s]));
    } else {
      m.material = mk(Array.isArray(m.material) ? m.material[0] : m.material);
    }
  });
  const glb = await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer;
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, Buffer.from(glb));
  console.log(`${src} -> ${dst}: ${meshes} meshes, ${Math.round(tris)} tris, ${(glb.byteLength / 1024).toFixed(0)} KB`);
  return { meshes, tris: Math.round(tris), bytes: glb.byteLength };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length % 2) throw new Error("usage: tsx tools/fbx-to-glb.ts <in.fbx> <out.glb> ...");
  for (let i = 0; i < args.length; i += 2) await convertFbx(args[i], args[i + 1]);
}
