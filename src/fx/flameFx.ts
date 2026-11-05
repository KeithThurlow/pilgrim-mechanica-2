// Fire's look (Keith 2026-11-05; cosmetic, local, Math.random allowed): flame particles for the flamers' stream (fuel
// that flies dark from the fuel nozzle until the igniter's flame catches it, then burns along it), flames licking off
// burning things and pools, embers. Camera-facing quads in two instanced meshes: the flames added on (bright, no depth
// write), the unlit fuel and soot drawn over (dark). One draw call each. The battlefield owns one (bf.flames) and feeds
// it burning targets and pools every frame; the flamers emit their gobs into it.
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, uv, smoothstep, float } from "three/tsl";

export const FLAME_MAX = 4096;

interface Ground { height(x: number, z: number): number }

/** Particle kinds: a stream gob (dark fuel, then flame), a flame lick (burning thing, pool), an ember. */
const GOB = 0, LICK = 1, EMBER = 2;

export class FlameFx {
  readonly group = new THREE.Group();
  private hot: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
  private hotData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_MAX * 4), 4);
  private darkData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_MAX * 4), 4);
  // Particles (structure of arrays).
  n = 0;
  private px = new Float32Array(FLAME_MAX); private py = new Float32Array(FLAME_MAX); private pz = new Float32Array(FLAME_MAX);
  private vx = new Float32Array(FLAME_MAX); private vy = new Float32Array(FLAME_MAX); private vz = new Float32Array(FLAME_MAX);
  private age = new Float32Array(FLAME_MAX); private life = new Float32Array(FLAME_MAX);
  private size = new Float32Array(FLAME_MAX); private grow = new Float32Array(FLAME_MAX);
  /** Gobs: seconds before the flame catches (<0: lit from the start). */
  private ign = new Float32Array(FLAME_MAX);
  private kind = new Uint8Array(FLAME_MAX);
  private heat = new Float32Array(FLAME_MAX);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** Look values (the Flame stream sliders; the arsenal sets them). */
  rise = 3; drag = 1.6; gravity = 4;

  constructor(private ground: Ground) {
    const mk = (data: THREE.InstancedBufferAttribute, additive: boolean) => {
      data.setUsage(THREE.DynamicDrawUsage);
      const d = instancedBufferAttribute<"vec4">(data);
      const r = uv().mul(2).sub(1).length();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      mat.colorNode = d.xyz;
      mat.opacityNode = float(1).sub(smoothstep(additive ? 0.15 : 0.35, 1, r)).mul(d.w);
      if (additive) mat.blending = THREE.AdditiveBlending;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, FLAME_MAX);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = additive ? 5 : 4;
      return mesh;
    };
    this.dark = mk(this.darkData, false);
    this.hot = mk(this.hotData, true);
    this.group.add(this.dark, this.hot);
  }

  private add(k: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, ign: number, heat = 1): number {
    if (this.n >= FLAME_MAX) return -1;
    const i = this.n++;
    this.kind[i] = k; this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.grow[i] = grow; this.ign[i] = ign; this.heat[i] = heat;
    return i;
  }

  /** A gob of the stream: leaves at (x, y, z) at velocity v, dark until `ign` s, then flame (growing `grow` × over life). */
  gob(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, ign: number) {
    this.add(GOB, x, y, z, vx, vy, vz, life, size, grow, ign);
  }

  /** The igniter's pilot flame: a tiny lick at the nozzle (every frame while fitted). */
  pilot(x: number, y: number, z: number, k = 1) {
    this.add(LICK, x, y, z, (Math.random() - 0.5) * 0.2, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.08, 0.1 * k, 1.6, -1, 0.9);
  }

  /** Flames licking up at a point (a burning thing, a pool): `k` scales how big, `heat` how bright (0..1). */
  lick(x: number, y: number, z: number, k = 1, heat = 1) {
    this.add(LICK, x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.35, (0.35 + Math.random() * 0.35) * k, 2.2, -1, heat);
  }

  ember(x: number, y: number, z: number) {
    this.add(EMBER, x, y, z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.9, 0.06 + Math.random() * 0.05, 1, -1);
  }

  update(dt: number, camera: THREE.Camera) {
    const g = this.ground;
    let keep = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const k = this.kind[i], lit = this.age[i] >= this.ign[i];
      const drag = Math.exp(-(k === GOB ? (lit ? this.drag * 1.6 : this.drag * 0.3) : 1.5) * dt);
      this.vx[i] *= drag; this.vz[i] *= drag;
      this.vy[i] = this.vy[i] * drag + (k === GOB && !lit ? -this.gravity : k === EMBER ? -0.5 : this.rise) * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const gy = g.height(this.px[i], this.pz[i]);
      if (this.py[i] < gy + 0.05) {
        // On the sand: the stream splashes and spreads, flames lick up from it.
        this.py[i] = gy + 0.05;
        if (this.vy[i] < 0) this.vy[i] = k === GOB ? 0.6 : 0;
        this.vx[i] *= 0.5; this.vz[i] *= 0.5;
      }
      if (keep !== i) this.copy(keep, i);
      keep++;
    }
    this.n = keep;
    // Draw: hot (lit gobs, licks, embers) and dark (unlit fuel, soot from old flames).
    this.q.copy(camera.quaternion);
    const ha = this.hotData.array as Float32Array, da = this.darkData.array as Float32Array;
    let nh = 0, nd = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i], k = this.kind[i];
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      if (k === GOB && this.age[i] < this.ign[i]) {
        // Unlit fuel: a dark amber streak of gel.
        const sz = this.size[i] * 0.45;
        this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
        this.dark.setMatrixAt(nd, this.m);
        const o = nd * 4; da[o] = 0.22; da[o + 1] = 0.13; da[o + 2] = 0.05; da[o + 3] = 0.85;
        nd++;
        continue;
      }
      // Lit: from the moment it caught (gobs) or was made.
      const lt = k === GOB ? Math.min(1, (this.age[i] - Math.max(0, this.ign[i])) / Math.max(0.05, this.life[i] - Math.max(0, this.ign[i]))) : t;
      const sz = this.size[i] * (1 + (this.grow[i] - 1) * Math.sqrt(lt));
      const h = this.heat[i];
      let r: number, gg: number, b: number, a: number;
      if (k === EMBER) { r = 1.6; gg = 0.7; b = 0.25; a = 1 - t; }
      else if (lt < 0.15) { const u = lt / 0.15; r = 1.8; gg = 1.5 - 0.5 * u; b = 0.8 - 0.6 * u; a = 0.9; }
      else if (lt < 0.6) { const u = (lt - 0.15) / 0.45; r = 1.8 - 0.6 * u; gg = 1.0 - 0.65 * u; b = 0.2 - 0.15 * u; a = 0.9 - 0.3 * u; }
      else { const u = (lt - 0.6) / 0.4; r = 1.2 - 0.9 * u; gg = 0.35 - 0.3 * u; b = 0.05; a = 0.6 * (1 - u); }
      this.m.compose(this.p, this.q, this.s.set(sz, sz * (k === LICK ? 1.4 : 1), sz));
      this.hot.setMatrixAt(nh, this.m);
      const o = nh * 4; ha[o] = r * h; ha[o + 1] = gg * h; ha[o + 2] = b * h; ha[o + 3] = a;
      nh++;
      // The tail of a big flame leaves a puff of soot over it.
      if (k !== EMBER && lt > 0.7 && sz > 0.8 && nd < FLAME_MAX) {
        this.p.y += sz * 0.4;
        this.m.compose(this.p, this.q, this.s.set(sz * 0.9, sz * 0.9, sz * 0.9));
        this.dark.setMatrixAt(nd, this.m);
        const od = nd * 4; da[od] = 0.08; da[od + 1] = 0.07; da[od + 2] = 0.06; da[od + 3] = 0.35 * (1 - (lt - 0.7) / 0.3);
        nd++;
      }
    }
    for (const [mesh, data, n] of [[this.hot, this.hotData, nh], [this.dark, this.darkData, nd]] as const) {
      mesh.count = n;
      if (n) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        data.clearUpdateRanges(); data.addUpdateRange(0, n * 4); data.needsUpdate = true;
      }
    }
  }

  private copy(a: number, b: number) {
    this.kind[a] = this.kind[b]; this.px[a] = this.px[b]; this.py[a] = this.py[b]; this.pz[a] = this.pz[b];
    this.vx[a] = this.vx[b]; this.vy[a] = this.vy[b]; this.vz[a] = this.vz[b]; this.age[a] = this.age[b]; this.life[a] = this.life[b];
    this.size[a] = this.size[b]; this.grow[a] = this.grow[b]; this.ign[a] = this.ign[b]; this.heat[a] = this.heat[b];
  }
}
