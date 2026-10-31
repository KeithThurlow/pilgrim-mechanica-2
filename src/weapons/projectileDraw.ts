// Projectiles in flight drawn as the library's models (rocket.glb, missile, mortar shell; src/weapons/library.ts),
// one instanced mesh per kind, painted once (the model's own paint or the Rampart scheme, times its wear). Each
// instance is centred on the projectile and points along its flight. A kind draws nothing until its model has
// loaded: ready(kind) says when the caller can stop drawing its own stand-in.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadDef } from "./library";
import { SCHEMES, SECTIONS, GLOW_SHARE } from "./palette";
import type { ModelDef } from "./parts";

export type ProjectileKind = "rocket" | "missile" | "mortar-shell";
const Z = new THREE.Vector3(0, 0, 1);

/** One geometry for a model: parts at their pivots, colour = paint x wear, centred on its middle along Z. */
function bake(def: ModelDef) {
  const geos = def.parts.map((p) => {
    const g = p.geometry.clone().translate(p.pivot.x, p.pivot.y, p.pivot.z);
    const c = g.attributes.color as THREE.BufferAttribute, s = g.attributes.section;
    const col = new THREE.Color();
    for (let i = 0; i < c.count; i++) {
      const sec = SECTIONS[Math.round(s.getX(i))];
      col.setHex(def.palette?.[sec] ?? SCHEMES[0].colors[sec]).convertSRGBToLinear();
      const w = sec in GLOW_SHARE ? 2.5 : 1;
      c.setXYZ(i, col.r * c.getX(i) * w, col.g * c.getY(i) * w, col.b * c.getZ(i) * w);
    }
    for (const a of ["section", "heat"]) g.deleteAttribute(a);
    return g;
  });
  const g = mergeGeometries(geos, false)!;
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  return g;
}

export class ProjectileMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<ProjectileKind, THREE.InstancedMesh>();
  private count = new Map<ProjectileKind, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private d = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private max = 64) {
    for (const kind of ["rocket", "missile", "mortar-shell"] as ProjectileKind[]) {
      // Rockets draw the slim code rocket (Keith 2026-10-31: rocket.glb read as a cruise missile from the game camera).
      loadDef(kind === "rocket" ? "rocket-thin" : kind).then((def) => {
        const mesh = new THREE.InstancedMesh(bake(def), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }), this.max);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.count = 0;
        this.meshes.set(kind, mesh);
        this.group.add(mesh);
      }, (e) => console.warn(`projectile model ${kind}:`, e));
    }
  }

  /** Has this kind's model loaded (so the caller can stop drawing its own)? */
  ready(kind: ProjectileKind) { return this.meshes.has(kind); }

  /** Start a frame. */
  begin() { for (const k of this.meshes.keys()) this.count.set(k, 0); }

  /** One projectile at pos flying along dir (any length), scaled by k. */
  add(kind: ProjectileKind, pos: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, k = 1) {
    const mesh = this.meshes.get(kind);
    if (!mesh) return;
    const n = this.count.get(kind) ?? 0;
    if (n >= this.max) return;
    this.d.set(dir.x, dir.y, dir.z);
    if (this.d.lengthSq() < 1e-10) this.d.set(0, 1, 0);
    this.q.setFromUnitVectors(Z, this.d.normalize());
    this.m.compose(this.p.set(pos.x, pos.y, pos.z), this.q, this.s.set(k, k, k));
    mesh.setMatrixAt(n, this.m);
    this.count.set(kind, n + 1);
  }

  /** Finish a frame. */
  end() {
    for (const [k, mesh] of this.meshes) { mesh.count = this.count.get(k) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
  }
}
