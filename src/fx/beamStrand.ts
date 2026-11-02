// A thin glowing strand from one point to another, rebuilt in place every frame (Keith 2026-11-02: "finer particle
// beams and brightness around them rather than super wide beams"). Two crossed ribbons (so it reads from any side
// without knowing the camera) with a soft cross-section texture: a bright line in a faint halo. Each vertex can be
// pushed off the line (waver, a spiralling wisp) and given its own brightness (flicker running along it, wisps
// breaking up). Additive, unlit, unfogged. Cosmetic: Math.random is fine here.
import * as THREE from "three/webgpu";

/** Cross-section: u across (a sharp core in a soft halo, `core` its share), v along (ends faded a little). */
function strandTexture(core: number): THREE.DataTexture {
  const N = 64, data = new Uint8Array(N * 4 * 4);
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1;
    const v = Math.exp(-(x * x) / (core * core)) + 0.35 * Math.pow(Math.max(0, 1 - Math.abs(x)), 2.4);
    const c = Math.round(255 * Math.min(1, v));
    for (let j = 0; j < 4; j++) data.set([c, c, c, 255], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(data, N, 4);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const TEX: Record<string, THREE.DataTexture> = {};

/** Offsets of each point along the strand off the straight line, in the strand's two cross axes (m), and its brightness. */
export type StrandShape = (t: number, out: { a: number; b: number; k: number }) => void;

export class BeamStrand {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private o = { a: 0, b: 0, k: 1 };

  /** segs pieces along it; core the share of the width that is the bright line (smaller is sharper). */
  constructor(private segs: number, color: number, core = 0.22) {
    const n = segs + 1, g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(n * 4 * 2), idx: number[] = [];
    // Two ribbons: vertices [plane][point][side].
    for (let p = 0; p < 2; p++) for (let i = 0; i < n; i++) for (let s = 0; s < 2; s++) {
      const v = (p * n + i) * 2 + s;
      uv[v * 2] = s; uv[v * 2 + 1] = i / segs;
    }
    for (let p = 0; p < 2; p++) for (let i = 0; i < segs; i++) {
      const a = (p * n + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute("position", this.pos); g.setAttribute("color", this.col); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const key = core.toFixed(3);
    this.mat = new THREE.MeshBasicMaterial({
      color, map: (TEX[key] ??= strandTexture(core)), vertexColors: true, transparent: true, depthWrite: false, fog: false,
      toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Lay it from (x0..) to (x1..), `width` across, each point shaped by shape(t). */
  set(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, shape?: StrandShape) {
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // Cross axes: A level and square to the line, B square to both.
    let ax = dz, az = -dx, ay = 0;
    const al = Math.hypot(ax, az);
    if (al < 1e-4) { ax = 1; az = 0; } else { ax /= al; az /= al; }
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const n = this.segs + 1, P = this.pos.array as Float32Array, C = this.col.array as Float32Array, o = this.o, h = width / 2;
    for (let i = 0; i < n; i++) {
      const t = i / this.segs;
      o.a = 0; o.b = 0; o.k = 1;
      shape?.(t, o);
      const cx = x0 + (x1 - x0) * t + ax * o.a + bx * o.b, cy = y0 + (y1 - y0) * t + ay * o.a + by * o.b, cz = z0 + (z1 - z0) * t + az * o.a + bz * o.b;
      const k = Math.max(0, o.k);
      for (let p = 0; p < 2; p++) {
        const ux = p ? bx : ax, uy = p ? by : ay, uz = p ? bz : az;
        for (let s = 0; s < 2; s++) {
          const v = ((p * n + i) * 2 + s) * 3, sg = s ? h : -h;
          P[v] = cx + ux * sg; P[v + 1] = cy + uy * sg; P[v + 2] = cz + uz * sg;
          C[v] = C[v + 1] = C[v + 2] = k;
        }
      }
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
    this.mesh.visible = true;
  }
}
