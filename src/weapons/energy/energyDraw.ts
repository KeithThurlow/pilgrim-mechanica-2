// Draws a mech's energy weapons (src/weapons/energy/energyGuns.ts): pulse bolts (a thin red line with a white core
// that fades in a blink, a spark of light where it lands), the beam laser (a flickering orange-red beam with a white
// core, a glow at the muzzle and a pulsing spot where it burns), the nova lance (a cyan ball swelling at the muzzle as it
// charges; the shot a thick white-cyan beam that thins and fades). Cosmetic.
import * as THREE from "three/webgpu";
import type { EnergyGuns, Bolt } from "./energyGuns";
import { glowMaterial } from "../ribbon";

const MAX_BOLTS = 24;
const COL = { laser: 0xff3b3b, beam: 0xff6a2e, lance: 0x8fdcff } as const;
const Z = new THREE.Vector3(0, 0, 1);

interface Line { glow: THREE.Mesh; core: THREE.Mesh; end: THREE.Mesh }

export class EnergyDraw {
  readonly group = new THREE.Group();
  private bolts: Line[] = [];
  private beams: (Line & { muzzle: THREE.Mesh })[] = [];
  private charges: { ball: THREE.Mesh; halo: THREE.Mesh }[] = [];
  private d = new THREE.Vector3();
  private a = new THREE.Vector3();
  private t = 0;

  constructor(private guns: EnergyGuns) {
    const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const ball = new THREE.SphereGeometry(0.5, 12, 8);
    const mesh = (geo: THREE.BufferGeometry, col: number) => { const m = new THREE.Mesh(geo, glowMaterial(col, true)); m.frustumCulled = false; m.renderOrder = 5; m.visible = false; this.group.add(m); return m; };
    const line = (col: number): Line => ({ glow: mesh(unitBox, col), core: mesh(unitBox, 0xffffff), end: mesh(ball, col) });
    for (let i = 0; i < MAX_BOLTS; i++) this.bolts.push(line(COL.laser));
    for (let i = 0; i < 2; i++) {
      this.beams.push({ ...line(COL.beam), muzzle: mesh(ball, 0xffd2a0) });
      this.charges.push({ ball: mesh(ball, 0xe8fbff), halo: mesh(ball, COL.lance) });
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
    // Beams: flickering width, the burn spot pulsing.
    g.sides.forEach((s, i) => {
      const B = this.beams[i], c = this.charges[i];
      if (s.beam.on) {
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
    });
  }
}
