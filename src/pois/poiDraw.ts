// Draws a POI site: its props merged into one vertex-coloured mesh (one draw call per POI), flat decals for scorches
// and ruts that follow the ground, and burnt raider vehicles from src/vehicles/carBody.ts. Stand-in geometry: rocks,
// plates, struts, I-beam ribs, curved hull plates, a capsule pod; looks can be swapped without touching the sim.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Ground } from "../mech/walker";
import { CarBody } from "../vehicles/carBody";
import type { PoiSite, PropDef, Tone } from "./site";

const TONE: Record<Tone, number> = {
  rock: 0x9c8468, rockDark: 0x7a6650, steel: 0x7a766e, hull: 0xbdb6a6, rust: 0x7d4426, dark: 0x3b3632,
  burnt: 0x2f2b28, hazard: 0xc9961e, cloth: 0xc8743a, olive: 0x606044, scorch: 0x2a2420, rut: 0x8a7458,
};

export const POI_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });

/** A soft round alpha falloff for the decals. */
function falloff() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  // alphaMap reads the green channel: white in the middle fading to black at the rim, fully opaque pixels.
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.55, "#ccc");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
let DECAL: Record<"scorch" | "rut", THREE.MeshStandardMaterial> | null = null;
function decalMats() {
  if (DECAL) return DECAL;
  const a = falloff();
  const mk = (color: number, opacity: number) => new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, transparent: true, opacity, alphaMap: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return (DECAL = { scorch: mk(TONE.scorch, 0.75), rut: mk(TONE.rut, 0.55) });
}

const e = new THREE.Euler(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), c = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);

export class PoiDraw {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly vehicles: CarBody[] = [];

  constructor(readonly site: PoiSite, ground: Ground) {
    const p = site.place;
    const oy = ground.height(p.x, p.z);
    this.group.position.set(p.x, oy, p.z);
    this.group.name = p.kind;
    const parts: THREE.BufferGeometry[] = [];
    for (const d of site.props) {
      if (d.shape === "disc") { this.decal(d, ground, oy); continue; }
      const g = shape(d);
      if (!g) continue;
      e.set(d.pitch, d.yaw, d.roll, "YXZ");
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(d.x - p.x, ground.height(d.x, d.z) + d.y - oy, d.z - p.z), q, one);
      g.applyMatrix4(m);
      parts.push(paint(g, TONE[d.tone]));
    }
    if (parts.length) {
      const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, POI_MAT);
      parts.forEach((g) => g.dispose());
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    for (const w of site.vehicles) {
      const body = new CarBody(w.kind);
      body.setWrecked(true);
      body.root.position.set(w.x - p.x, ground.height(w.x, w.z) + body.v.rideHeight - w.sink - oy, w.z - p.z);
      body.root.rotation.set(w.pitch, w.yaw, w.roll, "YXZ");
      body.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(body.root);
      this.vehicles.push(body);
      this.meshes.push(...body.meshes());
    }
    this.group.updateMatrixWorld(true);
  }

  /** A flat decal following the ground (a grid of 9 x 9 points over its ellipse). */
  private decal(d: PropDef, ground: Ground, oy: number) {
    const p = this.site.place, N = 8;
    const g = new THREE.PlaneGeometry(d.size[0] * 2, d.size[2] * 2, N, N).rotateX(-Math.PI / 2).rotateY(d.yaw);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + d.x, z = pos.getZ(i) + d.z;
      pos.setXYZ(i, x - p.x, ground.height(x, z) + 0.05 - oy, z - p.z);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, decalMats()[d.tone === "rut" ? "rut" : "scorch"]);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  dispose() {
    this.group.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && mm.geometry) mm.geometry.dispose(); });
    this.group.removeFromParent();
  }
}

/** Geometry for one prop, centred, in its own frame. */
function shape(d: PropDef): THREE.BufferGeometry | null {
  const [sx, sy, sz] = d.size;
  switch (d.shape) {
    case "box": return new THREE.BoxGeometry(sx, sy, sz);
    case "cyl": return new THREE.CylinderGeometry(sx, sx, sy, 8);
    case "cone": return new THREE.ConeGeometry(sx, sy, 10);
    case "pod": return new THREE.CapsuleGeometry(sx, Math.max(0.1, sy - 2 * sx), 4, 12);
    case "rock": {
      const g = new THREE.DodecahedronGeometry(0.5, 0);
      // Lumpy: push each corner in or out by a hash of its position and the rock's place.
      const pos = g.getAttribute("position");
      const seed = d.x * 12.9898 + d.z * 78.233;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const h = Math.sin(seed + x * 41.3 + y * 17.1 + z * 29.7) * 43758.5453;
        const k = 0.8 + 0.35 * (h - Math.floor(h));
        pos.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
      }
      return g;
    }
    case "arc": {
      // A curved hull plate: an annular sector (about 70 degrees) of chord sx and thickness sy, extruded sz along z.
      const half = (35 * Math.PI) / 180, R = sx / (2 * Math.sin(half));
      const s = new THREE.Shape();
      s.absarc(0, 0, R, Math.PI / 2 - half, Math.PI / 2 + half, false);
      s.absarc(0, 0, R - sy, Math.PI / 2 + half, Math.PI / 2 - half, true);
      const g = new THREE.ExtrudeGeometry(s, { depth: sz, bevelEnabled: false, curveSegments: 6 });
      g.translate(0, -R + R * (1 - Math.cos(half)) * 0.5, -sz / 2);
      return g;
    }
    case "rib": {
      // An I-beam: two flanges and a web, along z.
      const f = Math.max(0.04, sy * 0.15);
      const parts = [
        new THREE.BoxGeometry(sx, f, sz).translate(0, (sy - f) / 2, 0),
        new THREE.BoxGeometry(sx, f, sz).translate(0, -(sy - f) / 2, 0),
        new THREE.BoxGeometry(Math.max(0.04, sx * 0.2), sy - 2 * f, sz),
      ];
      const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
      parts.forEach((p) => p.dispose());
      return g;
    }
    case "cloth": {
      // A sheet lying on the sand in soft folds.
      const g = new THREE.PlaneGeometry(sx, sz, 6, 8).rotateX(-Math.PI / 2);
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) pos.setY(i, 0.12 * Math.sin(pos.getX(i) * 2.3 + pos.getZ(i) * 0.9) + 0.06);
      return g;
    }
    default: return null;
  }
}

/** Non-indexed, positions + normals + one colour, ready to merge. */
function paint(g: THREE.BufferGeometry, color: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  for (const k of Object.keys(ng.attributes)) if (k !== "position" && k !== "normal") ng.deleteAttribute(k);
  if (!ng.getAttribute("normal")) ng.computeVertexNormals();
  const n = ng.getAttribute("position").count, col = new Float32Array(n * 3);
  c.setHex(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.clearGroups();
  return ng;
}
