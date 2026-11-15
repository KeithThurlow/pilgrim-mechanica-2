// Draws a mech's energy weapons (src/weapons/energy/energyGuns.ts): pulse bolts (a thin red line with a white core
// that fades in a blink, a spark of light where it lands), the beam laser (a flickering orange-red beam with a white
// core, a glow at the muzzle and a pulsing spot where it burns), the nova lance (a cyan ball swelling at the muzzle as it
// charges; the shot a thick white-cyan beam that thins and fades, and where it lands a burst of light: a white flash, a
// cyan shell swelling out, a ring racing over the sand, a column of light and arcs crackling out), plasma bolts (a green-white ball, stretched along its
// flight, with a short glowing tail), particle orbs (a violet ball with a wobbling halo and motes swirling round it)
// lightning (jagged blue-white bolts through every target, re-jagged every frame so they crackle) and the sunder beam
// (a thin flickering gold aim line while it charges, then a thick gold-white beam that swells in and pulses). Cosmetic.
// Impact (Keith 2026-11-15): light pools (soft additive discs laid on the sand, no real lights, so a phone pays only the
// fill) under the sunder beam, where it lands and under every body it burns, a glare on those bodies and a gold burst
// where it first lands; the arc caster's bolts glow wider and light the sand, flash on what they strike, and leave
// charge crackling over each body for a while (src/weapons/energy/energyGuns.ts flares, shocks).
import * as THREE from "three/webgpu";
import type { EnergyGuns, Bolt } from "./energyGuns";
import { glowMaterial } from "../ribbon";

const MAX_BOLTS = 24, MAX_ORBS = 48, MAX_MOTES = 160, MAX_SEGS = 512, MAX_POOLS = 128, MAX_GLARES = 160;
const COL = { laser: 0xff3b3b, beam: 0xff6a2e, lance: 0x8fdcff, plasma: 0x6dff8a, orb: 0xb27dff, arc: 0x9fd2ff, sunder: 0xffd84a } as const;
const Z = new THREE.Vector3(0, 0, 1);

interface Line { glow: THREE.Mesh; core: THREE.Mesh; end: THREE.Mesh }

export class EnergyDraw {
  readonly group = new THREE.Group();
  private bolts: Line[] = [];
  private beams: (Line & { muzzle: THREE.Mesh })[] = [];
  private charges: { ball: THREE.Mesh; halo: THREE.Mesh }[] = [];
  private teles: Line[] = [];
  /** The lance's bursts of light (src/weapons/energy/energyGuns.ts Nova). */
  private novas: { flash: THREE.Mesh; shell: THREE.Mesh; ring: THREE.Mesh; ring2: THREE.Mesh; pillar: THREE.Mesh; pillarCore: THREE.Mesh }[] = [];
  /** Plasma bolts and orbs (instanced: core, glow, tail) and the orbs' motes; lightning segments. */
  private cores: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private motes: THREE.InstancedMesh;
  private segs: THREE.InstancedMesh;
  private segGlow: THREE.InstancedMesh;
  /** Light pools on the sand (soft discs) and glare balls on bodies hit. */
  private pools: THREE.InstancedMesh;
  private glares: THREE.InstancedMesh;
  private np = 0;
  private ng = 0;
  private endCore: THREE.Mesh[] = [];
  private up = new THREE.Vector3(0, 1, 0);
  private nrm = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private d = new THREE.Vector3();
  private a = new THREE.Vector3();
  private t = 0;

  constructor(private guns: EnergyGuns) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const ball = new THREE.SphereGeometry(0.5, 12, 8);
    const mesh = (geo: THREE.BufferGeometry, col: number) => { const m = new THREE.Mesh(geo, glowMaterial(col, true)); m.frustumCulled = false; m.renderOrder = 5; m.visible = false; this.group.add(m); return m; };
    const line = (col: number): Line => ({ glow: mesh(unitBox, col), core: mesh(unitBox, 0xffffff), end: mesh(ball, col) });
    for (let i = 0; i < MAX_BOLTS; i++) this.bolts.push(line(COL.laser));
    const inst = (geo: THREE.BufferGeometry, col: number, n: number) => {
      const m = new THREE.InstancedMesh(geo, glowMaterial(col, true), n);
      m.frustumCulled = false; m.renderOrder = 5; m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.group.add(m);
      return m;
    };
    this.cores = inst(ball, 0xffffff, MAX_ORBS);
    this.glows = inst(ball, 0xffffff, MAX_ORBS * 2);
    this.motes = inst(ball, 0xffffff, MAX_MOTES);
    this.segs = inst(unitBox, 0xffffff, MAX_SEGS);
    this.segGlow = inst(unitBox, 0xffffff, MAX_SEGS);
    // A disc bright in the middle and fading to nothing at its rim (vertex colours), flat on the sand.
    const disc = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const dp = disc.attributes.position, dc = new Float32Array(dp.count * 3);
    for (let i = 0; i < dp.count; i++) { const r = Math.hypot(dp.getX(i), dp.getZ(i)), k = Math.pow(Math.max(0, 1 - r), 1.6); dc[i * 3] = dc[i * 3 + 1] = dc[i * 3 + 2] = k; }
    disc.setAttribute("color", new THREE.BufferAttribute(dc, 3));
    this.pools = inst(disc, 0xffffff, MAX_POOLS);
    (this.pools.material as THREE.MeshBasicMaterial).vertexColors = true;
    this.pools.renderOrder = 4;
    this.glares = inst(ball, 0xffffff, MAX_GLARES);
    const ring = new THREE.RingGeometry(0.82, 1, 56).rotateX(-Math.PI / 2), column = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++)
      this.novas.push({ flash: mesh(ball, 0xffffff), shell: mesh(ball, COL.lance), ring: mesh(ring, COL.lance), ring2: mesh(ring, 0xe8fbff), pillar: mesh(column, COL.lance), pillarCore: mesh(column, 0xffffff) });
    for (let i = 0; i < 2; i++) {
      this.beams.push({ ...line(COL.beam), muzzle: mesh(ball, 0xffd2a0) });
      this.charges.push({ ball: mesh(ball, 0xe8fbff), halo: mesh(ball, COL.lance) });
      this.teles.push(line(COL.sunder));
      this.endCore.push(mesh(ball, 0xfffbe8));
    }
  }

  /** Lay a line mesh from a to b at width w. */
  private lay(m: THREE.Mesh, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, w: number, opacity: number) {
    this.d.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = this.d.length();
    if (len < 0.05 || opacity <= 0.01) { m.visible = false; return; }
    m.position.set(from.x, from.y, from.z);
    m.quaternion.setFromUnitVectors(Z, this.d.divideScalar(len));
    m.scale.set(w, w, len);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, opacity);
    m.visible = true;
  }

  private ball(m: THREE.Mesh, at: { x: number; y: number; z: number }, size: number, opacity: number) {
    if (size <= 0.01 || opacity <= 0.01) { m.visible = false; return; }
    m.position.set(at.x, at.y, at.z);
    m.scale.setScalar(size);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, opacity);
    m.visible = true;
  }

  private put(im: THREE.InstancedMesh, i: number, pos: THREE.Vector3, q: THREE.Quaternion, sc: THREE.Vector3, col: number, k = 1) {
    this.m.compose(pos, q, sc);
    im.setMatrixAt(i, this.m);
    im.setColorAt(i, this.c.setHex(col).multiplyScalar(k));
  }

  private drawOrbs() {
    const g = this.guns, v = g.v;
    let nc = 0, ng = 0, nm = 0;
    const id = this.q.identity();
    for (const o of g.orbs) {
      if (nc >= MAX_ORBS) break;
      if (o.cls === "plasma") {
        const r = v.plasmaSize;
        this.q.setFromUnitVectors(Z, o.dir);
        this.put(this.cores, nc++, o.pos, this.q, this.s.set(r * 0.55, r * 0.55, r * 1.1), 0xeaffef);
        this.put(this.glows, ng++, o.pos, this.q, this.s.set(r * 1.1, r * 1.1, r * 2.2), COL.plasma, 0.8);
        // The tail: a longer, fainter glow behind it.
        this.p.copy(o.pos).addScaledVector(o.dir, -r * 1.6);
        this.put(this.glows, ng++, this.p, this.q, this.s.set(r * 0.6, r * 0.6, r * 3.2), COL.plasma, 0.35);
      } else {
        const r = v.orbSize, w = 1 + 0.12 * Math.sin(this.t * 9 + o.seed) + 0.06 * Math.sin(this.t * 23 + o.seed * 2);
        id.identity();
        this.put(this.cores, nc++, o.pos, id, this.s.setScalar(r * 0.55 * w), 0xf3e8ff);
        this.put(this.glows, ng++, o.pos, id, this.s.setScalar(r * 1.3 * w), COL.orb, 0.55);
        this.put(this.glows, ng++, o.pos, id, this.s.setScalar(o.radius * 1.6 * (0.95 + 0.05 * w)), COL.orb, 0.08);
        // Motes swirling round it, out to its burn radius.
        for (let k = 0; k < 10 && nm < MAX_MOTES; k++) {
          const a = this.t * (2 + (k % 3)) + k * 2.4 + o.seed, rr = o.radius * (0.35 + 0.6 * ((k * 0.37 + o.seed) % 1));
          this.p.set(o.pos.x + Math.cos(a) * rr, o.pos.y + Math.sin(a * 1.3 + k) * 0.6, o.pos.z + Math.sin(a) * rr);
          this.put(this.motes, nm++, this.p, id, this.s.setScalar(0.12 + 0.06 * Math.sin(a * 3)), COL.orb, 1);
        }
      }
    }
    for (const [im, n] of [[this.cores, nc], [this.glows, ng], [this.motes, nm]] as const) {
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /**
   * The lance's burst of light: a white flash that blinks out, a cyan shell swelling to the burst's edge, two rings
   * racing out over the sand (the second slower and paler), and a column of light standing up and thinning away.
   */
  private drawNovas() {
    const g = this.guns, v = g.v, list = g.novas;
    this.novas.forEach((N, i) => {
      const n = list[i];
      const sunder = n?.cls === "sunder";
      if (!n || !sunder && v.lanceNovaSize <= 0 && v.lanceNovaPillar <= 0) { N.flash.visible = N.shell.visible = N.ring.visible = N.ring2.visible = N.pillar.visible = N.pillarCore.visible = false; return; }
      const col = sunder ? COL.sunder : COL.lance;
      for (const m of [N.shell, N.ring, N.pillar]) (m.material as THREE.MeshBasicMaterial).color.setHex(col);
      (N.ring2.material as THREE.MeshBasicMaterial).color.setHex(sunder ? 0xfff3c8 : 0xe8fbff);
      const k = Math.min(1, n.age / Math.max(1e-3, n.life)), f = 1 - k, R = n.r * (sunder ? 1 : v.lanceNovaSize), P = 0.5 + 0.5 * n.power;
      const out = 1 - Math.pow(1 - k, 3), fl = 0.85 + 0.15 * Math.sin(this.t * 70 + n.seed);
      // The flash: full in the first tenth, gone by a quarter.
      const blink = Math.max(0, 1 - n.age / (0.18 * n.life + 0.04));
      this.ball(N.flash, n.at, R * (0.5 + 0.5 * out) * P, blink * fl);
      this.ball(N.shell, n.at, R * 2 * (0.25 + 0.85 * out), f * f * 0.55 * P);
      const gy = n.ground + 0.08;
      this.flat(N.ring, n.at.x, gy, n.at.z, R * (0.3 + 1.5 * out), f * 0.9 * P);
      this.flat(N.ring2, n.at.x, gy + 0.02, n.at.z, R * (0.2 + 1.0 * Math.pow(k, 0.7)), f * f * 0.6 * P);
      // The column: up fast, then thinning while it fades.
      if (sunder) this.pool(n.at.x, n.at.z, R * (2.2 + 1.5 * out), COL.sunder, 1.4 * f * v.sunderGlow);
      const H = (sunder ? R * 2 : v.lanceNovaPillar) * P * Math.min(1, n.age * 12), w = Math.max(0.05, R * 0.22 * (1 - 0.8 * k));
      this.column(N.pillar, n.at.x, n.ground, n.at.z, w, H, f * f * 0.7 * fl);
      this.column(N.pillarCore, n.at.x, n.ground, n.at.z, w * 0.35, H * 1.1, f * f * fl);
    });
  }

  /** A light pool on the sand at (x, z): radius r, colour × k, laid on the slope there. */
  private pool(x: number, z: number, r: number, col: number, k: number) {
    if (this.np >= MAX_POOLS || r <= 0.05 || k <= 0.01) return;
    const h = this.guns.groundAt, e = 0.6, y = h(x, z);
    this.nrm.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize();
    this.q.setFromUnitVectors(this.up, this.nrm);
    this.p.set(x, y + 0.12, z);
    this.put(this.pools, this.np++, this.p, this.q, this.s.set(r, 1, r), col, Math.min(2, k));
  }

  /** A glare ball (additive) at p: size r, colour × k. */
  private glare(x: number, y: number, z: number, r: number, col: number, k: number) {
    if (this.ng >= MAX_GLARES || r <= 0.01 || k <= 0.01) return;
    this.p.set(x, y, z);
    this.put(this.glares, this.ng++, this.p, this.q.identity(), this.s.setScalar(r), col, Math.min(2, k));
  }

  /** Bodies lit by hits: a glare on them and light on the sand under them. */
  private drawFlares() {
    const g = this.guns, v = g.v;
    for (const f of g.flares) {
      const k = 1 - f.age / Math.max(1e-3, f.life), fl = 0.8 + 0.2 * Math.random();
      if (f.cls === "sunder") {
        const L = v.sunderGlow;
        this.glare(f.x, f.y, f.z, f.r * 1.5 * fl, COL.sunder, 0.55 * k * L);
        this.glare(f.x, f.y, f.z, f.r * 0.6 * fl, 0xfffbe8, 0.9 * k * L);
        this.pool(f.x, f.z, f.r * 2.6, COL.sunder, 0.7 * k * L);
      } else {
        const A = v.arcFlash, kk = k * k;
        this.glare(f.x, f.y, f.z, f.r * 1.4 * A * (0.7 + 0.3 * k), COL.arc, 0.8 * kk);
        this.glare(f.x, f.y, f.z, f.r * 0.55 * A, 0xf2fbff, kk);
        this.pool(f.x, f.z, f.r * 2.4 * A, COL.arc, 0.9 * kk);
      }
    }
  }

  private flat(m: THREE.Mesh, x: number, y: number, z: number, r: number, opacity: number) {
    if (r <= 0.01 || opacity <= 0.01) { m.visible = false; return; }
    m.position.set(x, y, z); m.quaternion.identity(); m.scale.set(r, 1, r);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, opacity);
    m.visible = true;
  }

  private column(m: THREE.Mesh, x: number, y: number, z: number, w: number, h: number, opacity: number) {
    if (h <= 0.05 || opacity <= 0.01) { m.visible = false; return; }
    m.position.set(x, y, z); m.quaternion.identity(); m.scale.set(w, h, w);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, opacity);
    m.visible = true;
  }

  /** Lightning: each link between two points broken into jagged segments, re-jagged every frame. */
  private drawArcs() {
    const g = this.guns;
    let n = 0;
    const a = this.a, b = this.p, bg = g.v.arcBoltGlow, gw = 0.22 * Math.max(0.3, bg);
    for (const arc of g.arcs) {
      const f = 1 - arc.age / Math.max(1e-3, arc.life);
      for (let i = 0; i + 1 < arc.pts.length; i++) {
        const p0 = arc.pts[i], p1 = arc.pts[i + 1];
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
        const pieces = Math.max(3, Math.min(14, Math.round(len / 1.2)));
        const jag = Math.min(1.2, 0.12 * len + 0.2);
        a.set(p0.x, p0.y, p0.z);
        for (let k = 1; k <= pieces && n < MAX_SEGS; k++) {
          const t = k / pieces, mid = k < pieces ? jag * Math.sin(t * Math.PI) : 0;
          b.set(p0.x + (p1.x - p0.x) * t + (Math.random() - 0.5) * 2 * mid, p0.y + (p1.y - p0.y) * t + (Math.random() - 0.5) * mid, p0.z + (p1.z - p0.z) * t + (Math.random() - 0.5) * 2 * mid);
          this.d.subVectors(b, a);
          const L = this.d.length();
          if (L > 1e-3) {
            this.q.setFromUnitVectors(Z, this.d.divideScalar(L));
            this.put(this.segs, n, a, this.q, this.s.set(0.05, 0.05, L), 0xffffff, f);
            this.put(this.segGlow, n, a, this.q, this.s.set(gw, gw, L), COL.arc, 0.8 * f);
            n++;
          }
          a.copy(b);
        }
      }
      // The bolt lights the sand along it (a pool at each point it passes through) and flashes at the muzzle.
      if (bg > 0 && arc.age < arc.life) {
        for (let i = 1; i < arc.pts.length; i++) { const p = arc.pts[i]; this.pool(p.x, p.z, 2.2 * bg, COL.arc, 0.6 * f); }
        const p0 = arc.pts[0];
        this.glare(p0.x, p0.y, p0.z, 0.5 * bg * f, 0xf2fbff, f);
      }
    }
    // Charge left on what the arc struck: a few short sparks jumping over the body each frame, coming and going, and a
    // flickering blue haze round it, thinning out as the charge drains.
    for (const sh of g.shocks) {
      const f = 1 - sh.age / Math.max(1e-3, sh.life);
      if (Math.random() > 0.35 + 0.65 * f) continue;
      const R = sh.r * 0.8, count = 1 + Math.floor(Math.random() * (1 + 2.5 * f));
      this.glare(sh.x, sh.y, sh.z, sh.r * (0.9 + 0.3 * Math.random()), COL.arc, 0.22 * f);
      if (Math.random() < 0.5) this.pool(sh.x, sh.z, sh.r * 1.8, COL.arc, 0.35 * f);
      for (let j = 0; j < count && n < MAX_SEGS; j++) {
        // From one point on the body's shell to another nearby, bowed out a little.
        const t0 = Math.random() * Math.PI * 2, y0 = (Math.random() - 0.4) * R;
        a.set(sh.x + Math.cos(t0) * R, sh.y + y0, sh.z + Math.sin(t0) * R);
        const t1 = t0 + (Math.random() - 0.5) * 2.2, y1 = y0 + (Math.random() - 0.5) * R * 1.2;
        const ex = sh.x + Math.cos(t1) * R, ey = sh.y + y1, ez = sh.z + Math.sin(t1) * R;
        const sx = a.x, sy = a.y, sz = a.z, jag = 0.35 * R;
        for (let q = 1; q <= 4 && n < MAX_SEGS; q++) {
          const t = q / 4, mid = q < 4 ? jag * Math.sin(t * Math.PI) : 0;
          b.set(sx + (ex - sx) * t + (Math.random() - 0.5) * mid, sy + (ey - sy) * t + (Math.random() - 0.5) * mid + mid * 0.5, sz + (ez - sz) * t + (Math.random() - 0.5) * mid);
          this.d.subVectors(b, a);
          const L = this.d.length();
          if (L > 1e-3) {
            this.q.setFromUnitVectors(Z, this.d.divideScalar(L));
            this.put(this.segs, n, a, this.q, this.s.set(0.035, 0.035, L), 0xffffff, 0.5 + 0.5 * f);
            this.put(this.segGlow, n, a, this.q, this.s.set(0.16 * Math.max(0.5, bg), 0.16 * Math.max(0.5, bg), L), COL.arc, 0.6 * f);
            n++;
          }
          a.copy(b);
        }
      }
    }
    // The arc caster's charge: short sparks crackling off the muzzle, more and longer as the capacitors fill.
    for (const sd of g.sides) {
      if (sd.cls !== "arc" || !sd.charge.on) continue;
      const k = sd.charge.k, gl = g.v.arcGlow, at = sd.charge.at;
      const count = Math.floor(k * 4 + Math.random() * 1.5);
      for (let j = 0; j < count && n < MAX_SEGS; j++) {
        const L = (0.25 + 0.75 * k) * gl * (0.5 + Math.random() * 0.5);
        const th = Math.random() * Math.PI * 2, ph = (Math.random() - 0.3) * Math.PI * 0.6;
        a.set(at.x, at.y, at.z);
        const dx = Math.cos(th) * Math.cos(ph), dy = Math.sin(ph), dz = Math.sin(th) * Math.cos(ph);
        for (let q = 1; q <= 3 && n < MAX_SEGS; q++) {
          const t = (q / 3) * L, j2 = q < 3 ? 0.12 * L : 0;
          b.set(at.x + dx * t + (Math.random() - 0.5) * j2, at.y + dy * t + (Math.random() - 0.5) * j2, at.z + dz * t + (Math.random() - 0.5) * j2);
          this.d.subVectors(b, a);
          const len = this.d.length();
          if (len > 1e-3) {
            this.q.setFromUnitVectors(Z, this.d.divideScalar(len));
            this.put(this.segs, n, a, this.q, this.s.set(0.03, 0.03, len), 0xffffff, 0.6 + 0.4 * k);
            this.put(this.segGlow, n, a, this.q, this.s.set(0.14, 0.14, len), COL.arc, 0.5 * k);
            n++;
          }
          a.copy(b);
        }
      }
    }
    for (const im of [this.segs, this.segGlow]) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  update(dt = 1 / 60) {
    const g = this.guns, v = g.v;
    this.t += dt;
    this.np = 0; this.ng = 0;
    // Bolts and lance shots: newest last, the oldest dropped when there are more than the pool.
    const list: Bolt[] = g.bolts.slice(-MAX_BOLTS);
    this.bolts.forEach((L, i) => {
      const b = list[i];
      if (!b) { L.glow.visible = L.core.visible = L.end.visible = false; return; }
      const f = 1 - b.age / Math.max(1e-3, b.life);
      const col = COL[b.cls];
      (L.glow.material as THREE.MeshBasicMaterial).color.setHex(col);
      (L.end.material as THREE.MeshBasicMaterial).color.setHex(col);
      if (b.cls === "lance") {
        const w = (0.3 + 0.5 * b.power) * (0.3 + 0.7 * f);
        this.lay(L.glow, b.from, b.to, w, f * 0.9);
        this.lay(L.core, b.from, b.to, w * 0.35, f);
        this.ball(L.end, b.to, (1.2 + 2 * b.power) * (1.3 - 0.5 * f), f * 0.8);
      } else {
        const w = v.pulseWidth;
        this.lay(L.glow, b.from, b.to, w * 2.2, f * 0.85);
        this.lay(L.core, b.from, b.to, w * 0.6, f);
        this.ball(L.end, b.to, (b.hit ? 0.7 : 0.45) * (0.6 + 0.4 * f), f * 0.9);
      }
    });
    this.drawOrbs();
    this.drawArcs();
    this.drawNovas();
    this.drawFlares();
    // Beams: flickering width, the burn spot pulsing.
    g.sides.forEach((s, i) => {
      const B = this.beams[i], c = this.charges[i];
      const sunder = s.cls === "sunder", col = sunder ? COL.sunder : COL.beam;
      (B.glow.material as THREE.MeshBasicMaterial).color.setHex(col);
      (B.end.material as THREE.MeshBasicMaterial).color.setHex(col);
      (c.halo.material as THREE.MeshBasicMaterial).color.setHex(sunder ? COL.sunder : s.cls === "arc" ? COL.arc : COL.lance);
      if (s.beam.on && sunder) {
        // The sunder beam: swells in over a fifth of a second, throbs, thins in its last moments.
        const fl = 0.88 + 0.12 * Math.sin(this.t * 41 + i * 2) + 0.06 * Math.sin(this.t * 113);
        const grow = Math.min(1, s.beam.age * 5) * Math.min(1, 0.4 + s.sim.left * 6);
        const w = v.sunderCore * fl * grow;
        this.lay(B.glow, s.beam.from, s.beam.to, w * 2.6, 0.8);
        this.lay(B.core, s.beam.from, s.beam.to, w * 0.8, 1);
        this.ball(B.end, s.beam.to, (1.6 + 0.6 * Math.sin(this.t * 29)) * grow, 0.9);
        this.ball(this.endCore[i], s.beam.to, (0.7 + 0.25 * Math.sin(this.t * 53)) * grow, 1);
        this.ball(B.muzzle, s.beam.from, w * 3.2, 0.95);
        // The light it throws: a big pool where it lands, a faint lit lane along the sand under it, a glow at the gun.
        const L = v.sunderGlow * grow;
        if (L > 0) {
          const to = s.beam.to, from = s.beam.from;
          this.pool(to.x, to.z, (4.5 + 0.8 * Math.sin(this.t * 31)) * Math.sqrt(L), COL.sunder, 1.1 * fl * L);
          this.pool(to.x, to.z, 1.8 * Math.sqrt(L), 0xfff3c8, 1.2 * fl * L);
          this.glare(to.x, to.y + 0.3, to.z, 2.6 * fl, COL.sunder, 0.35 * L);
          const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz), steps = Math.min(16, Math.floor(len / 3.5));
          for (let k = 1; k < steps; k++) { const t = k / steps; this.pool(from.x + dx * t, from.z + dz * t, 2.2, COL.sunder, 0.32 * fl * L); }
          this.pool(from.x, from.z, 3, COL.sunder, 0.5 * L);
        }
      } else if (s.beam.on) {
        const fl = 0.85 + 0.15 * Math.sin(this.t * 63 + i * 2) + 0.08 * Math.sin(this.t * 151);
        const grow = Math.min(1, s.beam.age * 12);
        const w = v.beamCore * fl * grow;
        this.lay(B.glow, s.beam.from, s.beam.to, w * 2.4, 0.75);
        this.lay(B.core, s.beam.from, s.beam.to, w * 0.7, 1);
        this.ball(B.end, s.beam.to, (s.beam.hit ? 0.9 : 0.7) * (0.8 + 0.3 * Math.sin(this.t * 37)), 0.9);
        this.ball(B.muzzle, s.beam.from, w * 3, 0.9);
      } else B.glow.visible = B.core.visible = B.end.visible = B.muzzle.visible = false;
      if (!(s.beam.on && sunder)) this.endCore[i].visible = false;
      if (s.charge.on && s.cls === "arc") {
        // The arc's capacitors: a small blue-white ball swelling and flickering faster as it charges (the crackle round
        // it is in drawArcs).
        const k = s.charge.k, gl = v.arcGlow, fl = 0.75 + 0.25 * Math.sin(this.t * (30 + 70 * k)) * Math.random();
        this.a.set(s.charge.at.x, s.charge.at.y, s.charge.at.z);
        this.ball(c.ball, this.a, (0.06 + 0.22 * k) * gl * fl, 0.5 + 0.5 * k);
        this.ball(c.halo, this.a, (0.2 + 0.6 * k) * gl * fl, 0.15 + 0.35 * k);
      } else if (s.charge.on) {
        const k = s.charge.k, fl = 0.9 + 0.1 * Math.sin(this.t * (20 + 40 * k));
        this.a.set(s.charge.at.x, s.charge.at.y, s.charge.at.z);
        this.ball(c.ball, this.a, (0.12 + 0.45 * k) * fl, 0.6 + 0.4 * k);
        this.ball(c.halo, this.a, (0.3 + 1.1 * k) * fl, 0.25 + 0.35 * k);
      } else c.ball.visible = c.halo.visible = false;
      const T = this.teles[i];
      if (s.tele.on) {
        // The aim line: faint and broken up at first, steadier and brighter as the charge fills.
        const k = s.tele.k, on = Math.sin(this.t * (50 + 30 * k)) > 0.6 - k ? 1 : 0.35;
        this.lay(T.glow, s.tele.from, s.tele.to, 0.06 + 0.1 * k, (0.25 + 0.55 * k) * on);
        this.lay(T.core, s.tele.from, s.tele.to, 0.02 + 0.03 * k, (0.4 + 0.6 * k) * on);
        this.ball(T.end, s.tele.to, 0.3 + 0.9 * k, 0.3 + 0.5 * k);
      } else T.glow.visible = T.core.visible = T.end.visible = false;
    });
    for (const [im, n] of [[this.pools, this.np], [this.glares, this.ng]] as const) {
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
