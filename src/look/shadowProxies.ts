// Shadow batching (perf, Keith 2026-11-06: "frame rate ... sitting in the 20s"; the convoy lab sent hundreds of objects
// through the renderer into the sun's shadow map a frame: every bolt, panel and gun part of every mech and vehicle).
// Every plain shadow-casting mesh (see plain()) becomes an instance of one shadow-only BatchedMesh per shadow side, on
// SHADOW_PROXY_LAYER (only the shadow cameras see it), and stops casting itself. Each frame, before drawing, every
// instance takes its mesh's world matrix and visibility, so the shadow map gets the same triangles from one object:
// one trip through the renderer instead of one per part (the WebGPU backend still issues a cheap GPU draw per part, so
// the HUD's draw count barely moves; the CPU cost is in the renderer's per-object work). The batch culls each part
// against each shadow camera as the renderer culled the meshes.
//
// The parts' castShadow keeps working for the code: reads give false (so the shadow pass skips them), writes are
// kept and switch the part's instance. A mesh that stops being plain (material, layer, mirrored) casts for itself again.
// Cosmetic only (drawing); no state anyone else reads. ?noproxy (src/core/app.ts) turns it off to compare.
import * as THREE from "three/webgpu";

/** The layer the batches live on: the shadow-casting lights' cameras see it (src/world/look.ts, nightLights.ts), the camera doesn't. */
export const SHADOW_PROXY_LAYER = 4;

/** How often the scene is scanned for new meshes (frames). */
const SCAN_EVERY = 30;
const _shadowSide = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide } as Record<number, number>;
/** Layer masks a part may sit on: the default layer, or shadow-only (the terrain's coarse shadow copies, src/world/chunks.ts
 *  SHADOW_ONLY_LAYER 3: only the shadow cameras see them, so batched they draw the same; 2026-11-07, one object instead of ~23). */
const plainLayers = (mask: number) => mask === 1 || mask === 1 << 3;
/** The batch's own layer for a part's mask: the proxy layer, or the shadow-only layer kept as it was (the sun sees it; the
 *  headlamp's shadow camera doesn't, as before). */
const batchLayer = (mask: number) => (mask === 1 ? SHADOW_PROXY_LAYER : 3);
const noop = THREE.Object3D.prototype.onBeforeShadow, noopAfter = THREE.Object3D.prototype.onAfterShadow;

interface Geo { id: number; users: number; pv: number; iv: number }
interface Part {
  mesh: THREE.Mesh;
  want: boolean;
  batch: Batch;
  inst: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  side: number;
  /** The mesh's layer mask when placed (a shadow-only part goes in a shadow-only batch). */
  mask: number;
}

/** Meshes that were plain once and then weren't: they cast for themselves from then on. */
const skip = new WeakSet<THREE.Object3D>();
const owned = new WeakMap<THREE.Mesh, Part>();

/** Whether a mesh's shadow is plain triangles a batch draws the same (no displacement, alpha, skinning...). */
function plain(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  if (!m.castShadow || owned.has(m) || skip.has(m)) return false;
  return shadowSafe(m);
}

/** The material and geometry part of plain(), checked again whenever a part's material or geometry changes. */
function shadowSafe(m: THREE.Mesh): boolean {
  if (m.onBeforeShadow !== noop || m.onAfterShadow !== noopAfter || !plainLayers(m.layers.mask) || !m.frustumCulled) return false;
  const mat = m.material as THREE.Material & { positionNode?: unknown; alphaMap?: unknown; displacementMap?: unknown; castShadowNode?: unknown; castShadowPositionNode?: unknown; maskNode?: unknown; wireframe?: boolean };
  if (!mat || Array.isArray(mat) || mat.alphaTest > 0 || mat.alphaMap || mat.displacementMap || mat.positionNode || mat.castShadowNode || mat.castShadowPositionNode || mat.maskNode || mat.wireframe) return false;
  const g = m.geometry, p = g?.attributes.position as THREE.BufferAttribute | undefined;
  if (!p || (p as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(p.array instanceof Float32Array) || p.itemSize !== 3 || p.normalized) return false;
  if (g.morphAttributes.position || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false; // groups only matter with a material list
  if (g.index && (g.index as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return false;
  return true;
}

function shadowSideOf(mat: THREE.Material) {
  return mat.shadowSide !== null && mat.shadowSide !== undefined ? mat.shadowSide : _shadowSide[mat.side];
}

/** A position-only copy of a part's geometry, indexed (a batch's geometries all are or all aren't). */
function slim(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  const p = g.attributes.position as THREE.BufferAttribute;
  out.setAttribute("position", p);
  if (g.index) out.setIndex(g.index);
  else {
    const n = p.count, idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

const posVersion = (g: THREE.BufferGeometry) => (g.attributes.position as THREE.BufferAttribute).version;

/** One BatchedMesh for every part whose shadow pass draws `side`. Its sizes are fixed: the renderer keeps the
 *  first matrix texture it sees, so a full batch is replaced by a bigger one (ShadowProxies.place), never resized. */
class Batch {
  mesh: THREE.BatchedMesh;
  geos = new Map<THREE.BufferGeometry, Geo>();

  constructor(readonly side: number, readonly layer: number, scene: THREE.Scene, readonly maxInst: number, readonly maxVert: number, readonly maxIdx: number) {
    // The shadow pass draws `_shadowSide[material.side]`; give the batch the side that comes back to `side`.
    const back = side === THREE.FrontSide ? THREE.BackSide : side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: back });
    this.mesh = new THREE.BatchedMesh(maxInst, maxVert, maxIdx, mat);
    this.mesh.name = "shadow batch";
    this.mesh.layers.set(layer);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // culled per part instead
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /** An instance of a geometry (added if it's new), or -1 when the batch is full. */
  place(g: THREE.BufferGeometry): number {
    if (this.mesh.instanceCount >= this.maxInst) return -1;
    let e = this.geos.get(g);
    if (!e) {
      const s = slim(g), nv = s.attributes.position.count, ni = s.index!.count;
      const fits = () => this.mesh.unusedVertexCount >= nv && this.mesh.unusedIndexCount >= ni;
      if (!fits()) { this.mesh.optimize(); if (!fits()) return -1; }
      e = { id: this.mesh.addGeometry(s), users: 0, pv: posVersion(g), iv: g.index ? g.index.version : 0 };
      this.geos.set(g, e);
    }
    e.users++;
    const inst = this.mesh.addInstance(e.id);
    this.mesh.setVisibleAt(inst, false);
    return inst;
  }

  remove(inst: number, g: THREE.BufferGeometry) {
    this.mesh.deleteInstance(inst);
    const e = this.geos.get(g);
    if (!e || --e.users > 0) return;
    this.mesh.deleteGeometry(e.id);
    this.geos.delete(g);
  }

  /** A geometry's triangles changed in place: copy them again (false: bigger than its slot). */
  refresh(g: THREE.BufferGeometry, e: Geo) {
    const s = slim(g), r = this.mesh.getGeometryRangeAt(e.id)!;
    e.pv = posVersion(g); e.iv = g.index ? g.index.version : 0;
    if (s.attributes.position.count > r.reservedVertexCount || s.index!.count > r.reservedIndexCount) return false;
    this.mesh.setGeometryAt(e.id, s);
    return true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class ShadowProxies {
  private parts: Part[] = [];
  private batches = new Map<number, Batch>();
  private frame = 0;
  readonly stats = { parts: 0, shown: 0, batches: 0, released: 0 };
  /** For probes (window.__shadowBatches): true draws every part's shadow itself again, the batches hidden. */
  bypass = false;

  /** Once a frame, just before rendering: brings the scene's world matrices up to date and copies them into the
   *  batches. The caller can render with scene.matrixWorldAutoUpdate off (they're already current). */
  update(scene: THREE.Scene) {
    this.frame++;
    scene.updateMatrixWorld();
    for (const b of this.batches.values()) b.mesh.visible = !this.bypass;
    if (this.frame % SCAN_EVERY === 1 || this.frame < 12) this.scan(scene); // every frame at first, while the lab loads
    let shown = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i], m = p.mesh;
      // Shown: its own and every ancestor's visible, and attached to the scene.
      let vis = p.want && m.visible, c: THREE.Object3D | null = m, root: THREE.Object3D = m;
      while (vis && c) { if (!c.visible) vis = false; root = c; c = c.parent; }
      if (vis && root !== scene) { this.release(i, false); continue; }
      const mat = m.material as THREE.Material;
      if (m.geometry !== p.geometry || mat !== p.material || m.layers.mask !== p.mask) {
        if (!shadowSafe(m)) { this.release(i, true); continue; }
        this.rehome(p, mat, scene);
      } else if (shadowSideOf(mat) !== p.side) this.rehome(p, mat, scene);
      const g = p.geometry, e = p.batch.geos.get(g)!;
      if (e.pv !== posVersion(g) || (g.index && e.iv !== g.index.version)) {
        if (!p.batch.refresh(g, e)) { this.release(i, false); continue; }
      }
      vis = vis && mat.visible;
      if (vis) {
        const el = m.matrixWorld.elements;
        // A mirrored part flips its triangles; a batch can't do that per part, so it casts for itself.
        const det = el[0] * (el[5] * el[10] - el[6] * el[9]) - el[4] * (el[1] * el[10] - el[2] * el[9]) + el[8] * (el[1] * el[6] - el[2] * el[5]);
        if (det < 0) { this.release(i, true); continue; }
        p.batch.mesh.setMatrixAt(p.inst, m.matrixWorld);
        shown++;
      }
      if (p.batch.mesh.getVisibleAt(p.inst) !== vis) p.batch.mesh.setVisibleAt(p.inst, vis);
    }
    this.stats.parts = this.parts.length;
    this.stats.shown = shown;
    this.stats.batches = this.batches.size;
  }

  private scan(scene: THREE.Scene) {
    scene.traverse((o) => { if (o.parent && plain(o)) this.add(o, scene); });
  }

  /** Puts a part in its side's batch, replacing the batch with one twice the size when it's full. */
  private place(p: Part, scene: THREE.Scene) {
    const key = p.side * 8 + batchLayer(p.mask);
    let b = this.batches.get(key);
    if (!b) { b = new Batch(p.side, batchLayer(p.mask), scene, 1024, 1 << 18, 3 << 18); this.batches.set(key, b); }
    p.batch = b;
    p.inst = b.place(p.geometry);
    if (p.inst >= 0) return;
    const nv = (p.geometry.attributes.position as THREE.BufferAttribute).count * 2;
    const big = new Batch(p.side, b.layer, scene, b.maxInst * 2, Math.max(b.maxVert * 2, b.maxVert + nv), Math.max(b.maxIdx * 2, b.maxIdx + nv * 3));
    b.dispose();
    this.batches.set(key, big);
    for (const q of this.parts) if (q.batch === b) { q.batch = big; q.inst = big.place(q.geometry); }
    p.batch = big;
    p.inst = big.place(p.geometry);
  }

  private add(mesh: THREE.Mesh, scene: THREE.Scene) {
    const mat = mesh.material as THREE.Material, side = shadowSideOf(mat);
    const p = { mesh, want: true, inst: -1, geometry: mesh.geometry, material: mat, side, mask: mesh.layers.mask } as Part;
    this.place(p, scene);
    owned.set(mesh, p);
    // castShadow reads false for the renderer; the code's own value is kept in `want`.
    Object.defineProperty(mesh, "castShadow", { configurable: true, get: () => this.bypass && p.want, set: (v: boolean) => { p.want = v; } });
    this.parts.push(p);
  }

  /** The part's geometry, material or shadow side changed: move it to the right batch and geometry. */
  private rehome(p: Part, mat: THREE.Material, scene: THREE.Scene) {
    p.batch.remove(p.inst, p.geometry);
    p.side = shadowSideOf(mat);
    p.geometry = p.mesh.geometry;
    p.material = mat;
    p.mask = p.mesh.layers.mask;
    this.place(p, scene);
  }

  /** Hand a part back to its mesh (`forever`: it doesn't come back at the next scan). */
  private release(i: number, forever: boolean) {
    const p = this.parts[i];
    p.batch.remove(p.inst, p.geometry);
    delete (p.mesh as { castShadow?: boolean }).castShadow;
    p.mesh.castShadow = p.want;
    owned.delete(p.mesh);
    if (forever) skip.add(p.mesh);
    this.parts[i] = this.parts[this.parts.length - 1];
    this.parts.pop();
    this.stats.released++;
  }
}
