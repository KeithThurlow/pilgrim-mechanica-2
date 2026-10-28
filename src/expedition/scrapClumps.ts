// Scrap clumps (cosmetic: the scrap is already on the at-risk list when the spot is done; this is how it arrives):
// a stripped spot bursts into clumps that arc up and home on the mech (or the pilot), each worth a share of the
// scrap. Each arrival calls onArrive with its share, so the HUD's count ticks up as they land and the jingle plays.
// Math.random is fine here (rule 12: FX only).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

export const CLUMP_DEFAULTS = { clumpScrap: 3, clumpMax: 16, clumpSpread: 0.45, clumpFlight: 0.65, clumpArc: 5, clumpSize: 0.35 };
export type ClumpValues = typeof CLUMP_DEFAULTS;
const G = "Loot";
export const CLUMP_PARAMS: Param[] = [
  { key: "clumpScrap", label: "Scrap per clump", min: 1, max: 20, step: 1, group: G, tip: "A stripped spot bursts into one clump per this much scrap (up to the max)" },
  { key: "clumpMax", label: "Clumps per spot (max)", min: 1, max: 40, step: 1, group: G },
  { key: "clumpSpread", label: "Clumps launch over (s)", min: 0, max: 2, step: 0.05, group: G },
  { key: "clumpFlight", label: "Clump flight (s)", min: 0.2, max: 2, step: 0.05, group: G },
  { key: "clumpArc", label: "Clump arc height (m)", min: 0, max: 15, step: 0.5, group: G },
  { key: "clumpSize", label: "Clump size (m)", min: 0.1, max: 1, step: 0.05, group: G },
];

interface Clump { from: THREE.Vector3; side: THREE.Vector3; delay: number; t: number; amount: number; last: boolean; total: number }
const MAX = 256;

export class ScrapClumps {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private list: Clump[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  /** A clump landed: its scrap, whether it was a burst's last, and the burst's total. */
  onArrive: ((amount: number, last: boolean, total: number) => void) | null = null;

  constructor(public v: ClumpValues) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.5, metalness: 0.6, emissive: 0xffa040, emissiveIntensity: 0.55, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Scrap still in the air (the HUD holds it back until it lands). */
  get inFlight() { let n = 0; for (const c of this.list) n += c.amount; return n; }

  /** A spot stripped at (x, y, z) paying this much scrap. */
  burst(x: number, y: number, z: number, scrap: number) {
    const v = this.v, n = Math.max(1, Math.min(Math.round(v.clumpMax), Math.ceil(scrap / Math.max(1, v.clumpScrap))));
    let left = scrap;
    for (let k = 0; k < n && this.list.length < MAX; k++) {
      const amount = k === n - 1 ? left : Math.floor(scrap / n);
      left -= amount;
      const a = Math.random() * Math.PI * 2;
      this.list.push({
        from: new THREE.Vector3(x + Math.sin(a) * 1.2, y + 0.5, z + Math.cos(a) * 1.2),
        side: new THREE.Vector3(Math.sin(a) * (2 + Math.random() * 3), 0, Math.cos(a) * (2 + Math.random() * 3)),
        delay: (v.clumpSpread * k) / Math.max(1, n - 1) + Math.random() * 0.03, t: 0, amount, last: k === n - 1, total: scrap,
      });
    }
  }

  /** Drop everything in the air without paying it (a lost run). */
  clear() { this.list.length = 0; this.mesh.count = 0; }

  /** One frame: home on (tx, ty, tz). */
  update(dt: number, tx: number, ty: number, tz: number) {
    const v = this.v, F = Math.max(0.05, v.clumpFlight);
    let n = 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const c = this.list[k];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.t += dt / F;
      if (c.t >= 1) { this.list.splice(k, 1); this.onArrive?.(c.amount, c.last, c.total); continue; }
      // Out sideways and up first, then a quickening pull home.
      const t = c.t, pull = t * t * (3 - 2 * t), out = Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - t);
      this.p.set(
        c.from.x + (tx - c.from.x) * pull + c.side.x * out,
        c.from.y + (ty - c.from.y) * pull + Math.sin(Math.PI * t) * v.clumpArc,
        c.from.z + (tz - c.from.z) * pull + c.side.z * out,
      );
      this.e.set(t * 9 + k, t * 7, 0);
      this.q.setFromEuler(this.e);
      const sz = v.clumpSize * (1 - 0.5 * t * t);
      this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
      if (n < MAX) this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
