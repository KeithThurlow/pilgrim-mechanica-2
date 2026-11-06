// Main-pass batching (perf, Keith 2026-11-06: 144 fps wanted in fights near the convoy; the renderer's per-object
// work was about a third of the frame). Plain meshes that share one Material object (a weapon model's parts, an
// escort's hull plates...) are drawn through one BatchedMesh per (material, receiveShadow, vertex layout), on
// MAIN_BATCH_LAYER, which only the game camera sees. Each part stays in the scene as it was (raycasts, the hold-V
// selector, shadow cameras and any other camera see it as before); only the game camera's layer test skips it.
// Each frame, before drawing, every instance takes its mesh's world matrix and visibility, so the camera gets the
// same triangles with the same material: one trip through the renderer instead of one per part.
//
// Left alone (drawn as before): instanced, skinned, sprite and line objects; transparent, alpha-tested, displaced or
// wireframe materials and ones with a positionNode (the ink outlines) or other per-object nodes; meshes with an
// onBeforeRender (weapon models animate from one), a draw range, morphs, or a layer other than 0; mirrored or
// sheared parts (a batch can't flip triangles or fix normals per part); and big or changing geometry (terrain).
// Cosmetic only (drawing); no state anyone else reads. ?nobatch (src/core/app.ts) turns it off to compare.
import * as THREE from "three/webgpu";

/** The layer the batches live on: the game camera enables it (src/core/app.ts); shadow cameras don't. */
export const MAIN_BATCH_LAYER = 5;

/** How often the scene is scanned for new meshes (frames). */
const SCAN_EVERY = 30;
/** Geometry bigger than this stays its own mesh (copying it into a batch costs more than it saves). */
const MAX_VERTS = 20000;
/** A material needs at least this many parts in the scene before it gets a batch (one part gains nothing). */
const MIN_GROUP = 2;
/** Geometry whose triangles changed this many times is left alone from then on. */
const MAX_REFRESH = 3;
const noopBefore = THREE.Object3D.prototype.onBeforeRender;
const layersTest = THREE.Layers.prototype.test;

interface Geo { id: number; users: number; versions: number[]; refreshed: number }
interface Part {
  mesh: THREE.Mesh;
  batch: Batch;
  inst: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  receive: boolean;
}

type Mat = THREE.Material & {
  positionNode?: unknown; alphaMap?: unknown; displacementMap?: unknown; maskNode?: unknown; wireframe?: boolean;
  normalNode?: unknown; outputNode?: unknown; fragmentNode?: unknown; vertexNode?: unknown; geometryNode?: unknown;
  depthNode?: unknown; receivedShadowPositionNode?: unknown; mrtNode?: unknown; envMap?: unknown;
};

const skip = new WeakSet<THREE.Object3D>();
const owned = new WeakMap<THREE.Mesh, Part>();

/** Whether a material draws the same on a batch as on its own mesh. */
function matSafe(mat: THREE.Material | THREE.Material[] | undefined): mat is THREE.Material {
  if (!mat || Array.isArray(mat)) return false;
  const m = mat as Mat;
  if (m.transparent || m.alphaTest > 0 || m.alphaMap || m.displacementMap || m.wireframe || !m.depthTest || !m.depthWrite) return false;
  if (m.positionNode || m.maskNode || m.vertexNode || m.geometryNode || m.fragmentNode || m.outputNode || m.depthNode || m.mrtNode) return false;
  if (m.onBeforeRender !== THREE.Material.prototype.onBeforeRender) return false;
  return (m as unknown as { isLineBasicMaterial?: boolean; isPointsMaterial?: boolean }).isLineBasicMaterial !== true && !(m as unknown as { isPointsMaterial?: boolean }).isPointsMaterial;
}

/** The geometry's vertex layout, or null when a batch can't hold it. */
function layout(g: THREE.BufferGeometry): string | null {
  const p = g.attributes.position as THREE.BufferAttribute | undefined;
  if (!p || p.count > MAX_VERTS) return null;
  if (g.morphAttributes.position || g.morphAttributes.normal || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return null;
  if (g.index && (g.index as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
  let key = "";
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || (a as unknown as { isInstancedBufferAttribute?: boolean }).isInstancedBufferAttribute) return null;
    key += `${name}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0};`;
  }
  return key;
}

/** Whether a mesh (its object part) can be batched; the material and geometry are checked separately. */
function objSafe(m: THREE.Mesh) {
  return m.onBeforeRender === noopBefore && m.layers.mask === 1 && m.frustumCulled && m.renderOrder === 0;
}

function candidate(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh & { isBatchedMesh?: boolean; isSprite?: boolean };
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || m.isBatchedMesh) return false;
  if (owned.has(m) || skip.has(m)) return false;
  return objSafe(m) && matSafe(m.material) && layout(m.geometry) !== null;
}

/** A copy of a geometry's attributes, indexed (a batch's geometries all are or all aren't). */
function indexed(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.attributes[name]);
  if (g.index) out.setIndex(g.index);
  else {
    const n = g.attributes.position.count, idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

const versions = (g: THREE.BufferGeometry) => {
  const v: number[] = [];
  for (const name of Object.keys(g.attributes)) v.push((g.attributes[name] as THREE.BufferAttribute).version);
  v.push(g.index ? g.index.version : -1);
  return v;
};
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** One BatchedMesh drawing one material's parts. Fixed sizes: a full batch is replaced by a bigger one. */
class Batch {
  mesh: THREE.BatchedMesh;
  geos = new Map<THREE.BufferGeometry, Geo>();

  constructor(readonly key: string, material: THREE.Material, receive: boolean, scene: THREE.Scene, readonly maxInst: number, readonly maxVert: number, readonly maxIdx: number) {
    this.mesh = new THREE.BatchedMesh(maxInst, maxVert, maxIdx, material);
    this.mesh.name = "main batch";
    this.mesh.layers.set(MAIN_BATCH_LAYER);
    this.mesh.castShadow = false; // the parts cast (src/look/shadowProxies.ts)
    this.mesh.receiveShadow = receive;
    this.mesh.frustumCulled = true; // by the bounds of its shown parts (bound())
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.boundingSphere = new THREE.Sphere();
    scene.add(this.mesh);
  }

  readonly box = new THREE.Box3();
  /** Take in a shown part's bounding sphere, at its world matrix. */
  grow(g: THREE.BufferGeometry, el: ArrayLike<number>) {
    const s = g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere!), c = s.center;
    const x = el[0] * c.x + el[4] * c.y + el[8] * c.z + el[12], y = el[1] * c.x + el[5] * c.y + el[9] * c.z + el[13], z = el[2] * c.x + el[6] * c.y + el[10] * c.z + el[14];
    const k = Math.sqrt(Math.max(el[0] * el[0] + el[1] * el[1] + el[2] * el[2], el[4] * el[4] + el[5] * el[5] + el[6] * el[6], el[8] * el[8] + el[9] * el[9] + el[10] * el[10]));
    const r = s.radius * k, b = this.box;
    b.min.set(Math.min(b.min.x, x - r), Math.min(b.min.y, y - r), Math.min(b.min.z, z - r));
    b.max.set(Math.max(b.max.x, x + r), Math.max(b.max.y, y + r), Math.max(b.max.z, z + r));
  }

  /** The batch's bounding sphere from the shown parts; false when none is shown. */
  bound() {
    if (this.box.isEmpty()) return false;
    this.box.getBoundingSphere(this.mesh.boundingSphere!);
    return true;
  }

  /** An instance of a geometry (added if it's new), or -1 when the batch is full. */
  place(g: THREE.BufferGeometry): number {
    if (this.mesh.instanceCount >= this.maxInst) return -1;
    let e = this.geos.get(g);
    if (!e) {
      const s = indexed(g), nv = s.attributes.position.count, ni = s.index!.count;
      const fits = () => this.mesh.unusedVertexCount >= nv && this.mesh.unusedIndexCount >= ni;
      if (!fits()) { this.mesh.optimize(); if (!fits()) return -1; }
      e = { id: this.mesh.addGeometry(s), users: 0, versions: versions(g), refreshed: 0 };
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

  /** A geometry's vertices changed in place: copy them again (false: too big for its slot, or changes too often). */
  refresh(g: THREE.BufferGeometry, e: Geo) {
    e.versions = versions(g);
    if (++e.refreshed > MAX_REFRESH) return false;
    const s = indexed(g), r = this.mesh.getGeometryRangeAt(e.id)!;
    if (s.attributes.position.count > r.reservedVertexCount || s.index!.count > r.reservedIndexCount) return false;
    this.mesh.setGeometryAt(e.id, s);
    return true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose(); // the material is the parts' own: kept
  }
}

export class MainBatches {
  private parts: Part[] = [];
  private batches = new Map<string, Batch>();
  private frame = 0;
  private mats = new WeakMap<THREE.Material, number>();
  private matIds = 0;
  readonly stats = { parts: 0, shown: 0, batches: 0, released: 0 };
  /** For probes (window.__mainBatches): true draws every part itself again, the batches hidden. */
  bypass = false;

  constructor(private camera: THREE.Camera) {
    camera.layers.enable(MAIN_BATCH_LAYER);
  }

  /** Once a frame, just before rendering, with the scene's world matrices already current (ShadowProxies.update). */
  update(scene: THREE.Scene) {
    this.frame++;
    for (const b of this.batches.values()) b.mesh.visible = !this.bypass;
    if (this.frame % SCAN_EVERY === 2 || this.frame < 12) this.scan(scene);
    let shown = 0;
    for (const b of this.batches.values()) b.box.makeEmpty();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i], m = p.mesh;
      let vis = m.visible, c: THREE.Object3D | null = m, root: THREE.Object3D = m;
      while (vis && c) { if (!c.visible) vis = false; root = c; c = c.parent; }
      if (vis && root !== scene) { this.release(i, false); continue; }
      if (!objSafe(m)) { this.release(i, true); continue; }
      const mat = m.material as THREE.Material;
      if (m.geometry !== p.geometry || mat !== p.material || m.receiveShadow !== p.receive) {
        if (!matSafe(mat) || layout(m.geometry) === null) { this.release(i, true); continue; }
        this.rehome(p, scene);
      } else if (!matSafe(mat)) { this.release(i, true); continue; }
      const g = p.geometry, e = p.batch.geos.get(g)!;
      if (!same(e.versions, versions(g)) && !p.batch.refresh(g, e)) { this.release(i, true); continue; }
      vis = vis && mat.visible;
      if (vis) {
        const el = m.matrixWorld.elements;
        // Mirrored parts flip their triangles and sheared ones bend their normals: a batch does neither per part.
        const det = el[0] * (el[5] * el[10] - el[6] * el[9]) - el[4] * (el[1] * el[10] - el[2] * el[9]) + el[8] * (el[1] * el[6] - el[2] * el[5]);
        if (det <= 0 || sheared(el)) { this.release(i, true); continue; }
        p.batch.mesh.setMatrixAt(p.inst, m.matrixWorld);
        p.batch.grow(p.geometry, el);
        shown++;
      }
      if (p.batch.mesh.getVisibleAt(p.inst) !== vis) p.batch.mesh.setVisibleAt(p.inst, vis);
    }
    // Each batch is culled whole by the bounds of its shown parts (and each part inside it by its own).
    for (const b of this.batches.values()) if (!this.bypass) b.mesh.visible = b.bound();
    this.stats.parts = this.parts.length;
    this.stats.shown = shown;
    this.stats.batches = this.batches.size;
  }

  private found = new Map<string, THREE.Mesh[]>();
  private scan(scene: THREE.Scene) {
    const f = this.found;
    for (const l of f.values()) l.length = 0;
    scene.traverse((o) => {
      if (!o.parent || !candidate(o)) return;
      const k = this.keyOf(o);
      let l = f.get(k);
      if (!l) f.set(k, (l = []));
      l.push(o);
    });
    for (const [k, l] of f) {
      if (!l.length) { f.delete(k); continue; }
      if (l.length >= MIN_GROUP || this.batches.has(k)) for (const o of l) this.add(o, scene);
    }
  }

  private keyOf(m: THREE.Mesh) {
    const mat = m.material as THREE.Material;
    let id = this.mats.get(mat);
    if (id === undefined) this.mats.set(mat, (id = ++this.matIds));
    return `${id}|${m.receiveShadow ? 1 : 0}|${layout(m.geometry)}`;
  }

  /** Puts a part in its batch, replacing the batch with one twice the size when it's full. */
  private place(p: Part, scene: THREE.Scene) {
    const key = this.keyOf(p.mesh);
    let b = this.batches.get(key);
    if (!b) { b = new Batch(key, p.material, p.receive, scene, 64, 1 << 14, 3 << 14); this.batches.set(key, b); }
    p.batch = b;
    p.inst = b.place(p.geometry);
    if (p.inst >= 0) return;
    const nv = (p.geometry.attributes.position as THREE.BufferAttribute).count * 2;
    const big = new Batch(key, p.material, p.receive, scene, b.maxInst * 2, Math.max(b.maxVert * 2, b.maxVert + nv), Math.max(b.maxIdx * 2, b.maxIdx + nv * 3));
    b.dispose();
    this.batches.set(key, big);
    for (const q of this.parts) if (q.batch === b) { q.batch = big; q.inst = big.place(q.geometry); }
    p.batch = big;
    p.inst = big.place(p.geometry);
  }

  private add(mesh: THREE.Mesh, scene: THREE.Scene) {
    const p = { mesh, inst: -1, geometry: mesh.geometry, material: mesh.material as THREE.Material, receive: mesh.receiveShadow } as Part;
    this.place(p, scene);
    owned.set(mesh, p);
    // The game camera skips the part (its batch draws it); everything else tests its layers as before.
    const cam = this.camera.layers, L = mesh.layers;
    L.test = (l: THREE.Layers) => (l === cam && !this.bypass ? false : layersTest.call(L, l));
    this.parts.push(p);
  }

  /** The part's geometry, material or shadow flag changed: move it to the right batch. */
  private rehome(p: Part, scene: THREE.Scene) {
    p.batch.remove(p.inst, p.geometry);
    if (p.batch.mesh.instanceCount === 0) this.drop(p.batch);
    p.geometry = p.mesh.geometry;
    p.material = p.mesh.material as THREE.Material;
    p.receive = p.mesh.receiveShadow;
    this.place(p, scene);
  }

  private drop(b: Batch) {
    if (this.batches.get(b.key) !== b) return;
    this.batches.delete(b.key);
    b.dispose();
  }

  /** Hand a part back to its mesh (`forever`: it doesn't come back at the next scan). */
  private release(i: number, forever: boolean) {
    const p = this.parts[i];
    p.batch.remove(p.inst, p.geometry);
    if (p.batch.mesh.instanceCount === 0) this.drop(p.batch);
    delete (p.mesh.layers as { test?: unknown }).test;
    owned.delete(p.mesh);
    if (forever) skip.add(p.mesh);
    this.parts[i] = this.parts[this.parts.length - 1];
    this.parts.pop();
    this.stats.released++;
  }
}

/** Whether a world matrix's axes are off square (a non-uniform scale under a rotation): normals would bend. */
function sheared(el: ArrayLike<number>) {
  const ax = el[0], ay = el[1], az = el[2], bx = el[4], by = el[5], bz = el[6], cx = el[8], cy = el[9], cz = el[10];
  const la = ax * ax + ay * ay + az * az, lb = bx * bx + by * by + bz * bz, lc = cx * cx + cy * cy + cz * cz;
  const tol = 1e-6;
  const ab = ax * bx + ay * by + az * bz, bc = bx * cx + by * cy + bz * cz, ca = cx * ax + cy * ay + cz * az;
  return ab * ab > tol * la * lb || bc * bc > tol * lb * lc || ca * ca > tol * lc * la;
}
