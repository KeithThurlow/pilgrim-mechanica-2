// Convert FBX exports (from the old project's Blender kit) to GLB for the web, keeping node names and empties
// (joint markers), vertex colours and the mesh layout. Run:
//   npx tsx tools/fbx-to-glb.ts <in.fbx> <out.glb> [<in.fbx> <out.glb> ...]
// Long term the Blender scripts should export GLB directly; this bridges the existing assets.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter reads its output Blob with FileReader, which Node lacks.
(globalThis as unknown as { FileReader: unknown }).FileReader = class {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) {
    b.arrayBuffer().then((r) => { this.result = "data:application/octet-stream;base64," + Buffer.from(r).toString("base64"); this.onloadend?.(); });
  }
};

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) throw new Error("usage: tsx tools/fbx-to-glb.ts <in.fbx> <out.glb> ...");
for (let i = 0; i < args.length; i += 2) {
  const [src, dst] = [args[i], args[i + 1]];
  const buf = readFileSync(src);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  let meshes = 0, tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    // Plain standard materials; the game applies its own look. Keep vertex colours (the painted "Color" layer).
    const old = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshPhongMaterial;
    m.material = new THREE.MeshStandardMaterial({ name: old.name, color: 0xffffff, vertexColors: !!g.attributes.color, roughness: 0.8 });
  });
  const glb = await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer;
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, Buffer.from(glb));
  console.log(`${src} -> ${dst}: ${meshes} meshes, ${Math.round(tris)} tris, ${(glb.byteLength / 1024).toFixed(0)} KB`);
}
