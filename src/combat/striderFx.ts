// The striders' attacks drawn (sim: src/combat/strider.ts). Cosmetic. Blue, as the robots' weapons are.
// - Beam charge: a line on the sand along where the beam will plough, brightening and widening to the beam's width as
//   the charge fills (so a dash off it reads by day). The fire: a white-hot core in a blue sheath from the head's
//   emitter, its strike sweeping down the furrow for a moment (the damage and the burnt furrow: src/game/robotBeam.ts).
// - Slam charge: a ring on the sand at the blast's radius and a second ring filling out to it, and a blue column
//   straight down from the emitter to the sand that thickens; the release: the column flares (the blast itself is the
//   battlefield's, with its crater and blast wave).
import * as THREE from "three/webgpu";
import { Ribbon, glowMaterial, type P3 } from "../weapons/ribbon";
import { BEAM, SLAM, type Strider } from "./strider";
import type { RobotBeamEvent } from "./robots";
import { STRIDER_PALETTE } from "./striderBody";

interface Ground { height(x: number, z: number): number }
const RING = 48, LINE = 24, FIRE_T = 0.45, SLAM_T = 0.35;

interface Slot {
  line: Ribbon; ring: Ribbon; fill: Ribbon;
  sheath: THREE.Mesh; core: THREE.Mesh; column: THREE.Mesh; columnCore: THREE.Mesh;
  fire: RobotBeamEvent | null; fireT: number; slamT: number; slamAt: THREE.Vector3;
}

export class StriderFx {
  readonly group = new THREE.Group();
  private slots = new Map<number, Slot>();
  private pts: P3[] = Array.from({ length: RING }, () => ({ x: 0, y: 0, z: 0 }));
  private tube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
  private time = 0;

  constructor(private ground: Ground) { this.group.name = "strider fx"; }

  private slot(id: number): Slot {
    let s = this.slots.get(id);
    if (s) return s;
    const P = STRIDER_PALETTE;
    const mesh = (color: number) => { const m = new THREE.Mesh(this.tube, glowMaterial(color, true)); m.frustumCulled = false; m.renderOrder = 6; m.visible = false; this.group.add(m); return m; };
    s = {
      line: new Ribbon(LINE, P.beam, true), ring: new Ribbon(RING + 1, P.beam, true), fill: new Ribbon(RING + 1, P.beamCore, true),
      sheath: mesh(P.beam), core: mesh(P.beamCore), column: mesh(P.beam), columnCore: mesh(P.beamCore),
      fire: null, fireT: 0, slamT: 0, slamAt: new THREE.Vector3(),
    };
    for (const r of [s.line, s.ring, s.fill]) { r.mesh.visible = false; this.group.add(r.mesh); }
    this.slots.set(id, s);
    return s;
  }

  /** A beam fired (the event's line). */
  beam(id: number, e: RobotBeamEvent) { const s = this.slot(id); s.fire = e; s.fireT = 0; }
  /** A slam went off at (x, y, z). */
  slam(id: number, x: number, y: number, z: number) { const s = this.slot(id); s.slamT = SLAM_T; s.slamAt.set(x, y, z); }

  update(dt: number, list: readonly Strider[]) {
    this.time += dt;
    const seen = new Set<number>();
    for (const st of list) {
      const s = this.slot(st.id);
      seen.add(st.id);
      const c = st.charge();
      // The beam's warning line.
      if (st.alive && st.mode === BEAM) {
        const L = st.beamLine(), n = LINE;
        for (let i = 0; i < n; i++) { const u = i / (n - 1); this.pts[i].x = L.start.x + (L.end.x - L.start.x) * u; this.pts[i].z = L.start.z + (L.end.z - L.start.z) * u; }
        const locked = c >= st.v.striderBeamTrack;
        s.line.set(this.pts.slice(0, n), locked ? st.v.striderBeamWidth : 0.25 + c * 0.6, "ground", this.ground, 0.1);
        s.line.mat.opacity = 0.2 + c * 0.6 + (locked ? Math.sin(this.time * 24) * 0.12 : 0);
      } else s.line.mesh.visible = false;
      // The slam's rings and column.
      if (st.alive && st.mode === SLAM) {
        const R = st.v.striderSlamRadius, a = st.slamAt;
        this.circle(a.x, a.z, R);
        s.ring.set(this.pts, 0.5, "ground", this.ground, 0.12, true);
        s.ring.mat.opacity = 0.5 + Math.sin(this.time * 18) * 0.2 * c;
        this.circle(a.x, a.z, Math.max(0.5, R * c));
        s.fill.set(this.pts, 0.35 + c * 0.6, "ground", this.ground, 0.14, true);
        s.fill.mat.opacity = 0.35 + c * 0.5;
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
      // The beam firing: from the emitter, its strike sweeping down the furrow.
      if (s.fire) {
        s.fireT += dt;
        const f = s.fire, u = Math.min(1, s.fireT / (FIRE_T * 0.6)), k = 1 - s.fireT / FIRE_T;
        if (k <= 0) { s.fire = null; s.sheath.visible = s.core.visible = false; }
        else {
          const hit = V1.set(f.start.x + (f.end.x - f.start.x) * u, 0, f.start.z + (f.end.z - f.start.z) * u);
          hit.y = this.ground.height(hit.x, hit.z);
          V0.set(f.from.x, f.from.y, f.from.z);
          this.stretch(s.sheath, V0, hit, f.width * 0.5 * (0.6 + 0.4 * k));
          this.stretch(s.core, V0, hit, f.width * 0.18);
          (s.sheath.material as THREE.MeshBasicMaterial).opacity = 0.7 * k;
          (s.core.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 1.4 * k);
        }
      }
    }
    // Slots of striders gone: hide them.
    for (const [id, s] of this.slots) if (!seen.has(id)) {
      for (const r of [s.line, s.ring, s.fill]) r.mesh.visible = false;
      for (const m of [s.sheath, s.core, s.column, s.columnCore]) m.visible = false;
    }
  }

  private circle(x: number, z: number, r: number) {
    for (let i = 0; i < RING; i++) { const a = (i / RING) * Math.PI * 2; this.pts[i].x = x + Math.sin(a) * r; this.pts[i].z = z + Math.cos(a) * r; }
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
