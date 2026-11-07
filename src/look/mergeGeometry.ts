// Merging parts into fewer meshes at load (perf, 2026-11-07: three's renderer pays ~14 µs a frame for every object it
// draws, and most of the convoy siege's camera objects were the mechs' small parts; docs/engine-options.md A.1).
// mergeParts() joins geometries that may disagree on attributes or indexing; MERGE_PARTS is the switch (?nomerge in
// the URL draws every part on its own as before, to compare). Drawing only; nothing else reads these.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ToonLook } from "./toon";

/** Merged parts on (default); ?nomerge turns it off for the page. Node checks have no location: on. */
export const MERGE_PARTS = typeof location === "undefined" || !new URLSearchParams(location.search).has("nomerge");

/**
 * One geometry from several (each already in the shared frame). Attributes some lack are filled (colour white, the
 * rest zero) so all share one layout; all indexed or none; groups dropped (one material). Null if there's nothing.
 */
export function mergeParts(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  const names = new Map<string, { itemSize: number; normalized: boolean; ctor: Float32ArrayConstructor | Uint8ArrayConstructor | Uint16ArrayConstructor | Int8ArrayConstructor | Int16ArrayConstructor | Uint32ArrayConstructor | Int32ArrayConstructor }>();
  for (const g of geos) for (const [k, a] of Object.entries(g.attributes)) {
    const b = a as THREE.BufferAttribute;
    if (!names.has(k)) names.set(k, { itemSize: b.itemSize, normalized: b.normalized, ctor: (b.array as Float32Array).constructor as Float32ArrayConstructor });
  }
  const indexed = geos.some((g) => g.index);
  const ready = geos.map((src) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) {
      const b = a as THREE.BufferAttribute;
      // Interleaved or odd attributes become plain copies.
      g.setAttribute(k, (b as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (b as unknown as THREE.InterleavedBufferAttribute).clone() as unknown as THREE.BufferAttribute : b);
    }
    const n = src.attributes.position.count;
    for (const [k, f] of names) {
      if (g.attributes[k]) continue;
      const arr = new f.ctor(n * f.itemSize);
      if (k === "color") arr.fill(f.normalized ? (f.ctor === Uint8Array ? 255 : 65535) : 1);
      g.setAttribute(k, new THREE.BufferAttribute(arr, f.itemSize, f.normalized));
    }
    if (indexed) {
      if (src.index) g.setIndex(src.index);
      else { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    }
    return g;
  });
  const out = mergeGeometries(ready, false);
  if (!out) return null;
  out.clearGroups();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const _c = new THREE.Color();

/**
 * A node's own tinted parts (code stand-ins built from boxes and cylinders, each with its own toon material) as one
 * vertex-coloured mesh, and its lit-up lenses and lamps as one more. Only direct children that are plain meshes with
 * nothing hung on them but their ink: anything moved or hidden on its own must stay a child group of its own. The
 * merged mesh's material is white, so a paint (RampartBody.paint) multiplies the parts' colours instead of replacing them.
 */
export function mergeTinted(node: THREE.Object3D, look: ToonLook) {
  if (!MERGE_PARTS) return;
  const lit: THREE.Mesh[] = [], glow: THREE.Mesh[] = [];
  for (const c of node.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.userData.ink || (m as THREE.InstancedMesh).isInstancedMesh || !m.visible) continue;
    if (m.children.some((k) => !k.userData.ink)) continue;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat) || mat.map || mat.transparent || mat.alphaTest > 0) continue;
    m.updateMatrix();
    if (m.matrix.determinant() <= 0) continue; // mirrored: its faces would turn inside out
    (m.userData.glow ? glow : lit).push(m);
  }
  for (const [list, isGlow] of [[lit, false], [glow, true]] as const) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const src = m.geometry, g = new THREE.BufferGeometry();
      g.setAttribute("position", src.attributes.position.clone());
      if (src.attributes.normal) g.setAttribute("normal", src.attributes.normal.clone());
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(m.matrix);
      const n = g.attributes.position.count, col = new Float32Array(n * 3), own = src.attributes.color;
      _c.copy((m.material as THREE.MeshStandardMaterial).color);
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r * (own ? own.getX(i) : 1);
        col[i * 3 + 1] = _c.g * (own ? own.getY(i) : 1);
        col[i * 3 + 2] = _c.b * (own ? own.getZ(i) : 1);
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    });
    const merged = mergeParts(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged);
    mesh.name = `${node.name || "parts"}:merged`;
    if (isGlow) {
      mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      mesh.userData.glow = true;
    } else look.apply(mesh);
    for (const m of list) {
      m.removeFromParent();
      if (!isGlow) look.forget(m);
      (m.material as THREE.Material).dispose();
    }
    node.add(mesh);
  }
}

/** mergeTinted on every node under (and at) root. */
export function mergeTintedTree(root: THREE.Object3D, look: ToonLook) {
  if (!MERGE_PARTS) return;
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => { if (!(o as THREE.Mesh).isMesh) nodes.push(o); });
  for (const n of nodes) mergeTinted(n, look);
}
