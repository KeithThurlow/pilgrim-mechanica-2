// Two small mesh helpers for the weapons' marks, rebuilt in place every frame: a ribbon along a polyline (flat on the
// sand, flat in the air, or standing up), and a patch (a grid mapped onto the ground by a function: a strip, a disc).
// Both glow (basic, additive or alpha, not lit), drawn over the sand without fighting it.
import * as THREE from "three/webgpu";

interface Ground { height(x: number, z: number): number }
export interface P3 { x: number; y: number; z: number }

export function glowMaterial(color: number, additive = false) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
  return m;
}

export class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private pos: THREE.BufferAttribute;

  constructor(private max: number, color: number, additive = false) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    const idx: number[] = [];
    for (let i = 0; i + 1 < max; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = glowMaterial(color, additive);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /**
   * Lay it along points (closed: back to the first). mode "ground": flat on the sand at `lift` over it (points' y
   * ignored); "flat": flat at the points' heights; "up": standing up (width in y).
   */
  set(pts: readonly P3[], width: number, mode: "ground" | "flat" | "up", ground: Ground | null, lift = 0.08, closed = false) {
    const n = Math.min(this.max, pts.length + (closed ? 1 : 0));
    const a = this.pos.array as Float32Array;
    const at = (i: number) => pts[closed ? i % pts.length : Math.min(i, pts.length - 1)];
    for (let i = 0; i < n; i++) {
      const p = at(i), prev = at(Math.max(0, i - 1)), next = at(Math.min(n - 1, i + 1));
      const q = closed ? at((i + pts.length - 1) % pts.length) : prev;
      let dx = next.x - q.x, dz = next.z - q.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const h = width / 2;
      if (mode === "up") {
        a.set([p.x, p.y - h, p.z, p.x, p.y + h, p.z], i * 6);
      } else {
        const ox = -dz * h, oz = dx * h;
        const y1 = mode === "ground" ? ground!.height(p.x + ox, p.z + oz) + lift : p.y;
        const y2 = mode === "ground" ? ground!.height(p.x - ox, p.z - oz) + lift : p.y;
        a.set([p.x + ox, y1, p.z + oz, p.x - ox, y2, p.z - oz], i * 6);
      }
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.mesh.visible = n >= 2;
  }
}

/** A grid of nu × nv cells laid on the sand through map(u, v) → (x, z), u and v in 0..1. */
export class GroundPatch {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private pos: THREE.BufferAttribute;
  private xz = { x: 0, z: 0 };

  constructor(private nu: number, private nv: number, color: number, additive = false) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    const idx: number[] = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    g.setIndex(idx);
    this.mat = glowMaterial(color, additive);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  set(map: (u: number, v: number, out: { x: number; z: number }) => void, ground: Ground, lift = 0.06) {
    const a = this.pos.array as Float32Array;
    let k = 0;
    for (let i = 0; i <= this.nu; i++) for (let j = 0; j <= this.nv; j++) {
      map(i / this.nu, j / this.nv, this.xz);
      a[k++] = this.xz.x; a[k++] = ground.height(this.xz.x, this.xz.z) + lift; a[k++] = this.xz.z;
    }
    this.pos.needsUpdate = true;
    this.mesh.visible = true;
  }
}
