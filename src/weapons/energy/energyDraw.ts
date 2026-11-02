// Draws a mech's energy weapons (src/weapons/energy/energyGuns.ts): pulse bolts (a thin red line with a white core
// that fades in a blink, a spark of light where it lands), the beam laser (a flickering orange-red beam with a white
// core, a glow at the muzzle and a pulsing spot where it burns), the nova lance (a cyan ball swelling at the muzzle as it
// charges; the shot a thick white-cyan beam that thins and fades), plasma bolts (a green-white ball, stretched along its
// flight, with a short glowing tail), particle orbs (a violet ball with a wobbling halo and motes swirling round it)
// lightning (jagged blue-white bolts through every target, re-jagged every frame so they crackle) and the sunder beam
// (a thin flickering gold aim line while it charges, then a thick gold-white beam that swells in and pulses). Cosmetic.
import * as THREE from "three/webgpu";
import type { EnergyGuns, Bolt } from "./energyGuns";
import { glowMaterial } from "../ribbon";

const MAX_BOLTS = 24, MAX_ORBS = 48, MAX_MOTES = 160, MAX_SEGS = 320;
const COL = { laser: 0xff3b3b, beam: 0xff6a2e, lance: 0x8fdcff, plasma: 0x6dff8a, orb: 0xb27dff, arc: 0x9fd2ff, sunder: 0xffd84a } as const;
const Z = new THREE.Vector3(0, 0, 1);

interface Line { glow: THREE.Mesh; core: THREE.Mesh; end: THREE.Mesh }

export class EnergyDraw {
  readonly group = new THREE.Group();
  private bolts: Line[] = [];
  private beams: (Line & { muzzle: THREE.Mesh })[] = [];
  private charges: { ball: THREE.Mesh; halo: THREE.Mesh }[] = [];
  private teles: Line[] = [];
  /** Plasma bolts and orbs (instanced: core, glow, tail) and the orbs' motes; lightning segments. */
  private cores: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private motes: THREE.InstancedMesh;
  private segs: THREE.InstancedMesh;
  private segGlow: THREE.InstancedMesh;
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
    for (let i = 0; i < 2; i++) {
      this.beams.push({ ...line(COL.beam), muzzle: mesh(ball, 0xffd2a0) });
      this.charges.push({ ball: mesh(ball, 0xe8fbff), halo: mesh(ball, COL.lance) });
      this.teles.push(line(COL.sunder));
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

  /** Lightning: each link between two points broken into jagged segments, re-jagged every frame. */
  private drawArcs() {
    const g = this.guns;
    let n = 0;
    const a = this.a, b = this.p;
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
            this.put(this.segGlow, n, a, this.q, this.s.set(0.22, 0.22, L), COL.arc, 0.7 * f);
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
    // Beams: flickering width, the burn spot pulsing.
    g.sides.forEach((s, i) => {
      const B = this.beams[i], c = this.charges[i];
      const sunder = s.cls === "sunder", col = sunder ? COL.sunder : COL.beam;
      (B.glow.material as THREE.MeshBasicMaterial).color.setHex(col);
      (B.end.material as THREE.MeshBasicMaterial).color.setHex(col);
      (c.halo.material as THREE.MeshBasicMaterial).color.setHex(sunder ? COL.sunder : COL.lance);
      if (s.beam.on && sunder) {
        // The sunder beam: swells in over a fifth of a second, throbs, thins in its last moments.
        const fl = 0.88 + 0.12 * Math.sin(this.t * 41 + i * 2) + 0.06 * Math.sin(this.t * 113);
        const grow = Math.min(1, s.beam.age * 5) * Math.min(1, 0.4 + s.sim.left * 6);
        const w = v.sunderCore * fl * grow;
        this.lay(B.glow, s.beam.from, s.beam.to, w * 2.6, 0.8);
        this.lay(B.core, s.beam.from, s.beam.to, w * 0.8, 1);
        this.ball(B.end, s.beam.to, (1.6 + 0.6 * Math.sin(this.t * 29)) * grow, 0.9);
        this.ball(B.muzzle, s.beam.from, w * 3.2, 0.95);
      } else if (s.beam.on) {
        const fl = 0.85 + 0.15 * Math.sin(this.t * 63 + i * 2) + 0.08 * Math.sin(this.t * 151);
        const grow = Math.min(1, s.beam.age * 12);
        const w = v.beamCore * fl * grow;
        this.lay(B.glow, s.beam.from, s.beam.to, w * 2.4, 0.75);
        this.lay(B.core, s.beam.from, s.beam.to, w * 0.7, 1);
        this.ball(B.end, s.beam.to, (s.beam.hit ? 0.9 : 0.7) * (0.8 + 0.3 * Math.sin(this.t * 37)), 0.9);
        this.ball(B.muzzle, s.beam.from, w * 3, 0.9);
      } else B.glow.visible = B.core.visible = B.end.visible = B.muzzle.visible = false;
      if (s.charge.on) {
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
  }
}
