// The striders' attacks drawn (sim: src/combat/strider.ts). Cosmetic. Blue, as the robots' weapons are.
// - Beam (Keith 2026-11-01: less ground telegraph, the real beam growing instead; src/combat/beamCore.ts): from the start
//   of the charge a thin live beam from the head's emitter to its strike, flickering, a white-hot core in a blue sheath
//   that thickens to full at the release (a flare), then holds through the sweep as the strike drags after the prey
//   (the damage, the furrow and the red-hot sand: src/game/robotBeam.ts). Keith 2026-11-02: drawn fine like the swarm's
//   beams (src/fx/fineBeam.ts: a thin core in a soft glow, waver, wisps, a melt flash and spatter at the strike).
// - Slam charge (Keith 2026-11-01: soft gradients, not flat strips): a soft ring on the sand at the blast's radius and a
//   soft front growing out to it, and a blue column
//   straight down from the emitter to the sand that thickens; the release: the column flares (the blast itself is the
//   battlefield's, with its crater and blast wave).
import * as THREE from "three/webgpu";
import { Ribbon, SoftRing, glowMaterial } from "../weapons/ribbon";
import { BEAM, SLAM, type Strider } from "./strider";
import { beamPower, beamWidthShare } from "./beamCore";
import type { RobotBeamEvent } from "./robots";
import { STRIDER_PALETTE } from "./striderBody";
import { FineBeam } from "../fx/fineBeam";
import { MeltSparks } from "../fx/meltSparks";

interface Ground { height(x: number, z: number): number }
const RING = 48, LINE = 24, FIRE_T = 0.45, SLAM_T = 0.35;

interface Slot {
  line: Ribbon; ring: SoftRing; fill: SoftRing;
  sheath: THREE.Mesh; core: THREE.Mesh; column: THREE.Mesh; columnCore: THREE.Mesh;
  fine: FineBeam;
  fire: RobotBeamEvent | null; fireT: number; slamT: number; slamAt: THREE.Vector3;
}

export class StriderFx {
  readonly group = new THREE.Group();
  private slots = new Map<number, Slot>();
  private tube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
  private time = 0;
  private sparks: MeltSparks;
  private fl = { ex: 0, ey: 0, ez: 0, x1: 0, y1: 0, z1: 0 };
  /** The beam look's sliders (the robots' "Look: …"); set by whoever has them, else fineBeam's defaults. */
  look: { readonly [k: string]: number | undefined } = {};

  constructor(private ground: Ground) {
    this.group.name = "strider fx";
    this.sparks = new MeltSparks(ground);
    this.group.add(this.sparks.mesh);
  }

  private slot(id: number): Slot {
    let s = this.slots.get(id);
    if (s) return s;
    const P = STRIDER_PALETTE;
    const mesh = (color: number) => { const m = new THREE.Mesh(this.tube, glowMaterial(color, true)); m.frustumCulled = false; m.renderOrder = 6; m.visible = false; this.group.add(m); return m; };
    s = {
      line: new Ribbon(LINE, P.beam, true), ring: new SoftRing(RING, P.beam), fill: new SoftRing(RING, P.beamCore),
      sheath: mesh(P.beam), core: mesh(P.beamCore), column: mesh(P.beam), columnCore: mesh(P.beamCore),
      fine: new FineBeam(this.sparks, this.ground, P.beam, P.beamCore),
      fire: null, fireT: 0, slamT: 0, slamAt: new THREE.Vector3(),
    };
    for (const r of [s.line, s.ring, s.fill]) { r.mesh.visible = false; this.group.add(r.mesh); }
    this.group.add(s.fine.group);
    this.slots.set(id, s);
    return s;
  }

  /** A beam tick (the event's line): the release flares the beam. */
  beam(id: number, e: RobotBeamEvent) { if (!e.release) return; const s = this.slot(id); s.fire = e; s.fireT = 0; }
  /** A slam went off at (x, y, z). */
  slam(id: number, x: number, y: number, z: number) { const s = this.slot(id); s.slamT = SLAM_T; s.slamAt.set(x, y, z); }

  update(dt: number, list: readonly Strider[]) {
    this.time += dt;
    const seen = new Set<number>();
    for (const st of list) {
      const s = this.slot(st.id);
      seen.add(st.id);
      const c = st.charge();
      s.line.mesh.visible = false;
      // The live beam: thin and flickering as it charges, growing to full at the release, held through the sweep.
      if (st.alive && st.mode === BEAM) {
        const sh = st.beamShape(), t = st.modeT, ws = beamWidthShare(t, sh), p = beamPower(t, sh);
        const flare = s.fire ? Math.max(0, 1 - s.fireT / FIRE_T) : 0;
        if (s.fire) { s.fireT += dt; if (s.fireT >= FIRE_T) s.fire = null; }
        const e = st.emitter(V0), a = st.aim, flick = 0.85 + 0.15 * Math.sin(this.time * (40 + 30 * p) + st.id);
        const W = st.v.striderBeamWidth * ws * flick * (1 + 0.6 * flare);
        V1.set(a.x, this.ground.height(a.x, a.z), a.z);
        const f = this.fl;
        f.ex = e.x; f.ey = e.y; f.ez = e.z; f.x1 = V1.x; f.y1 = V1.y; f.z1 = V1.z;
        s.fine.draw(this.time, st.id, f, this.look, W, Math.min(1, 0.55 + 0.45 * p + flare), Math.min(1, p + flare), dt);
        s.sheath.visible = s.core.visible = false;
      } else if (!s.fire || !st.alive) { s.fire = null; s.sheath.visible = s.core.visible = false; s.fine.hide(); }
      // The slam's rings and column.
      if (st.alive && st.mode === SLAM) {
        const R = st.v.striderSlamRadius, a = st.slamAt;
        s.ring.set(a.x, a.z, R - 3, R + 0.4, this.ground, 0.85);
        s.ring.mat.opacity = 0.35 + 0.25 * c;
        const rr = Math.max(0.6, R * c);
        s.fill.set(a.x, a.z, rr - Math.min(rr, 2.5 + 2 * c), rr, this.ground, 0.88);
        s.fill.mat.opacity = 0.6 + 0.5 * c;
        const e = st.emitter(V0);
        this.stretch(s.column, e, V1.set(e.x, this.ground.height(e.x, e.z), e.z), 0.4 + c * 1.4);
        this.stretch(s.columnCore, e, V1, 0.15 + c * 0.5);
        (s.column.material as THREE.MeshBasicMaterial).opacity = 0.25 + c * 0.45;
      } else { s.ring.mesh.visible = s.fill.mesh.visible = false; if (s.slamT <= 0) s.column.visible = s.columnCore.visible = false; }
      // The slam's flare.
      if (s.slamT > 0) {
        s.slamT -= dt;
        const k = Math.max(0, s.slamT / SLAM_T), e = st.alive ? st.emitter(V0) : V0.copy(s.slamAt).setY(s.slamAt.y + 20);
        this.stretch(s.column, e, s.slamAt, 2.5 * k + 0.3);
        this.stretch(s.columnCore, e, s.slamAt, 1.1 * k + 0.1);
        (s.column.material as THREE.MeshBasicMaterial).opacity = 0.8 * k;
      }
    }
    this.sparks.update(dt);
    // Slots of striders gone: hide them.
    for (const [id, s] of this.slots) if (!seen.has(id)) {
      s.fine.hide();
      for (const r of [s.line, s.ring, s.fill]) r.mesh.visible = false;
      for (const m of [s.sheath, s.core, s.column, s.columnCore]) m.visible = false;
    }
  }



  /** A tube from a to b, radius r. */
  private stretch(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const d = V2.subVectors(b, a), len = d.length();
    if (len < 1e-3) { m.visible = false; return; }
    m.visible = true;
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    m.scale.set(r, len, r);
  }
}

const V0 = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
