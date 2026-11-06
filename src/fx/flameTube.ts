// Draws the flamers' fuel lines (src/fx/flameStream.ts) as one continuous tube each (Keith 2026-11-05: "extrude a mesh
// along there and then apply noise along the length"). Drawing only, cosmetic. One dynamic mesh for every line: a ring
// of RING vertices round each point, rebuilt on the CPU each frame (a few hundred points at most).
// - Thin at the nozzle, widening as the fuel burns along (Flame look › Line width near / far).
// - Pushed in and out by noise running down its length, more as it goes (Line lumps), so it boils and wavers.
// - Colour by how far through its burn: blue at the nozzle, white-hot yellow, then orange, deep orange at the end; a
//   hotter core where you look straight in, softer orange at the rim. Drawn over the scene in 0..1 colours (Keith's
//   render pass, 2026-11-05: added HDR fire clipped to white on the sand).
import * as THREE from "three/webgpu";
import {
  attribute, positionLocal, normalLocal, positionWorld, mx_noise_float, time, vec3, float, mix, smoothstep, normalView,
  positionView, dot, normalize, abs, clamp, uniform,
} from "three/tsl";
import type { FuelLine } from "./flameStream";

const RING = 8, MAXP = 4000, MAXV = MAXP * RING, FUEL_STRIP = 128, SUB = 3;

export interface TubeLook { flameTube: number; flameTubeNear: number; flameTubeFar: number; flameTubeLump: number }

export class FlameTube {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAXV * 3);
  private nrm = new Float32Array(MAXV * 3);
  /** u (share of its burn), metres along the line, radius, alpha. */
  private dat = new Float32Array(MAXV * 4);
  /** 1 on a freeze ray's line. */
  private cld = new Float32Array(MAXV);
  private idx = new Uint32Array(MAXP * RING * 6);
  private geo = new THREE.BufferGeometry();
  private aPos: THREE.BufferAttribute; private aNrm: THREE.BufferAttribute; private aDat: THREE.BufferAttribute;
  private aCld: THREE.BufferAttribute; private aIdx: THREE.BufferAttribute;
  // Scratch for one strip.
  private sx = new Float32Array(FUEL_STRIP * SUB); private sy = new Float32Array(FUEL_STRIP * SUB); private sz = new Float32Array(FUEL_STRIP * SUB);
  private su = new Float32Array(FUEL_STRIP * SUB);
  private cx = new Float32Array(FUEL_STRIP); private cy = new Float32Array(FUEL_STRIP); private cz = new Float32Array(FUEL_STRIP);
  private cu = new Float32Array(FUEL_STRIP);
  private lump = uniform(0.6);

  constructor() {
    const mk = (a: Float32Array, n: number) => { const b = new THREE.BufferAttribute(a, n); b.setUsage(THREE.DynamicDrawUsage); return b; };
    this.aPos = mk(this.pos, 3); this.aNrm = mk(this.nrm, 3); this.aDat = mk(this.dat, 4); this.aCld = mk(this.cld, 1);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1); this.aIdx.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.aPos); this.geo.setAttribute("normal", this.aNrm);
    this.geo.setAttribute("tubeData", this.aDat); this.geo.setAttribute("tubeCold", this.aCld);
    this.geo.setIndex(this.aIdx);
    this.geo.setDrawRange(0, 0);

    const d = attribute<"vec4">("tubeData", "vec4"), cold = attribute<"float">("tubeCold", "float");
    const u = d.x, along = d.y, r = d.z;
    // Noise running down the line (the fuel boiling as it flies), and a finer one on top.
    const nz = mx_noise_float(vec3(along.mul(0.55).sub(time.mul(9)), positionWorld.y.mul(0.8), positionWorld.x.add(positionWorld.z).mul(0.6)));
    const fine = mx_noise_float(positionWorld.mul(2.6).add(vec3(0, time.mul(-4), 0)));
    const lump = this.lump;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    mat.positionNode = positionLocal.add(normalLocal.mul(r.mul(nz.mul(0.7).add(fine.mul(0.3))).mul(u.mul(0.9).add(0.15)).mul(lump)));
    const face = abs(dot(normalize(normalView), normalize(positionView.negate())));
    // PC render 2026-11-05: the line read pale cream. White only just out of the nozzle, yellow within a fifth of its
    // burn, orange by halfway, deep orange at the end.
    const blue = vec3(0.45, 0.62, 1.0), white = vec3(1.0, 0.9, 0.55), yellow = vec3(1.0, 0.7, 0.16), orange = vec3(1.0, 0.42, 0.06), deep = vec3(0.78, 0.2, 0.04);
    // Blue for the first few metres (the old nozzle cone's job, now the line's own; the cone is off by default).
    const along1 = mix(blue, white, smoothstep(0.02, 0.08, u));
    const along2 = mix(along1, yellow, smoothstep(0.08, 0.22, u));
    const along3 = mix(along2, orange, smoothstep(0.22, 0.5, u));
    const fire = mix(along3, deep, smoothstep(0.65, 1.0, u));
    // Hotter core where you look straight in, more orange at the rim (more so further along).
    const core = smoothstep(0.55, 1, face).mul(float(1).sub(u.mul(0.6)));
    const rimCol = mix(fire, orange, float(1).sub(smoothstep(0.1, 0.6, face)).mul(0.6));
    const hot = mix(rimCol, white, core.mul(0.35));
    const ice = mix(vec3(0.85, 0.95, 1.0), vec3(0.62, 0.8, 0.95), u);
    mat.colorNode = clamp(mix(hot, ice, cold).mul(fine.mul(0.12).add(1)), 0, 1);
    mat.opacityNode = smoothstep(0.0, 0.45, face).mul(d.w).mul(mix(float(0.95), float(0.4), cold)).mul(nz.mul(0.12).add(0.95));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    // Over the flames, halos and smoke (all drawn before it), so it reads in a crowd of burning things.
    this.mesh.renderOrder = 7;
  }

  private nv = 0; private ni = 0;

  /** Builds every line's tube for this frame. */
  draw(lines: Iterable<FuelLine>, L: TubeLook) {
    this.lump.value = L.flameTubeLump;
    this.nv = 0; this.ni = 0;
    if (L.flameTube > 0) for (const l of lines) {
      // Strips: oldest first, broken where a point went; the newest runs on to the nozzle while it pours.
      let k = 0;
      for (let i = 0; i <= l.n; i++) {
        const atNozzle = i === l.n;
        if (atNozzle && !l.pouring) break;
        if (!atNozzle && l.brk[i] && k > 0) { this.strip(k, l, L); k = 0; }
        if (k >= FUEL_STRIP) { this.strip(k, l, L); k = 0; }
        if (atNozzle) { this.sx[k] = l.nx; this.sy[k] = l.ny; this.sz[k] = l.nz; this.su[k] = 0; }
        else { this.sx[k] = l.px[i]; this.sy[k] = l.py[i]; this.sz[k] = l.pz[i]; this.su[k] = Math.min(1, l.age[i] / Math.max(0.05, l.burn[i])); }
        k++;
      }
      if (k > 0) this.strip(k, l, L);
    }
    this.geo.setDrawRange(0, this.ni);
    // Nothing to draw: hidden, so WebGPU isn't asked for a draw with no indices.
    this.mesh.visible = this.ni > 0;
    for (const a of [this.aPos, this.aNrm, this.aDat, this.aCld]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.nv * a.itemSize); a.needsUpdate = true; }
    this.aIdx.clearUpdateRanges(); this.aIdx.addUpdateRange(0, this.ni); this.aIdx.needsUpdate = true;
  }

  /** One strip of k points (oldest first) as a tube. */
  private strip(k0: number, l: FuelLine, L: TubeLook) {
    if (k0 < 2) return;
    // Rounded between the points (Catmull-Rom, SUB samples a span; PC render 2026-11-05: swung, the line read as sharp
    // zigzags with hard corners, like lightning, not a bending hose).
    this.cx.set(this.sx.subarray(0, k0)); this.cy.set(this.sy.subarray(0, k0)); this.cz.set(this.sz.subarray(0, k0)); this.cu.set(this.su.subarray(0, k0));
    let k = 0;
    const cr = (a: Float32Array, j: number, t: number) => {
      const p0 = a[Math.max(0, j - 1)], p1 = a[j], p2 = a[j + 1], p3 = a[Math.min(k0 - 1, j + 2)];
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
    };
    for (let j = 0; j < k0 - 1; j++) for (let q = 0; q < SUB; q++) {
      const t = q / SUB;
      this.sx[k] = cr(this.cx, j, t); this.sy[k] = cr(this.cy, j, t); this.sz[k] = cr(this.cz, j, t);
      this.su[k] = this.cu[j] + (this.cu[j + 1] - this.cu[j]) * t;
      k++;
    }
    this.sx[k] = this.cx[k0 - 1]; this.sy[k] = this.cy[k0 - 1]; this.sz[k] = this.cz[k0 - 1]; this.su[k] = this.cu[k0 - 1]; k++;
    if (this.nv + k * RING > MAXV) return;
    const base = this.nv;
    let along = 0;
    // Metres from the nozzle end, for the noise to run down (counted from the newest end).
    for (let j = k - 1; j > 0; j--) along += Math.hypot(this.sx[j] - this.sx[j - 1], this.sy[j] - this.sy[j - 1], this.sz[j] - this.sz[j - 1]);
    let tx = 0, ty = 0, tz = 1;
    for (let j = 0; j < k; j++) {
      const a = Math.max(0, j - 1), b = Math.min(k - 1, j + 1);
      const dx = this.sx[b] - this.sx[a], dy = this.sy[b] - this.sy[a], dz = this.sz[b] - this.sz[a];
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-5) { tx = dx / dl; ty = dy / dl; tz = dz / dl; }
      // A side across the line (level), and the line's own up.
      let ax = tz, az = -tx;
      let al = Math.hypot(ax, az);
      if (al < 1e-4) { ax = 1; az = 0; al = 1; }
      ax /= al; az /= al;
      // The line's own up: side × tangent (both unit and square to each other).
      const bx = -az * ty, by = az * tx - ax * tz, bz = ax * ty;
      const u = this.su[j];
      // Wider as it burns along; the far end of a strip tapers off, the near end at the nozzle is thin anyway.
      let r = (L.flameTubeNear + (L.flameTubeFar - L.flameTubeNear) * Math.pow(u, 1.3)) * l.width * L.flameTube;
      const ends = j === 0 ? 0.35 : 1;
      r *= ends;
      const alpha = (j === 0 ? 0.3 : 1) * (u > 0.85 ? 1 - (u - 0.85) / 0.15 * 0.6 : 1);
      if (j > 0) along -= Math.hypot(this.sx[j] - this.sx[j - 1], this.sy[j] - this.sy[j - 1], this.sz[j] - this.sz[j - 1]);
      for (let q = 0; q < RING; q++) {
        const th = (q / RING) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        const nx = ax * c + bx * s, ny = by * s, nz = az * c + bz * s;
        const v = this.nv++;
        this.pos[v * 3] = this.sx[j] + nx * r; this.pos[v * 3 + 1] = this.sy[j] + ny * r; this.pos[v * 3 + 2] = this.sz[j] + nz * r;
        this.nrm[v * 3] = nx; this.nrm[v * 3 + 1] = ny; this.nrm[v * 3 + 2] = nz;
        this.dat[v * 4] = u; this.dat[v * 4 + 1] = along + l.seed; this.dat[v * 4 + 2] = r; this.dat[v * 4 + 3] = alpha;
        this.cld[v] = l.cold ? 1 : 0;
      }
    }
    for (let j = 0; j < k - 1; j++) for (let q = 0; q < RING; q++) {
      const a = base + j * RING + q, b = base + j * RING + (q + 1) % RING, c = a + RING, d = b + RING;
      this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = b;
      this.idx[this.ni++] = b; this.idx[this.ni++] = c; this.idx[this.ni++] = d;
    }
  }
}
