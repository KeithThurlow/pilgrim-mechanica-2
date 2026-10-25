// Draws an arsenal (src/weapons/arsenal.ts): its paints (the back weapon's strip or ring, each rail cannon's charge
// beam), the rockets in flight (a dark body and a hot flare; their smoke is the dust system's), the autocannon's
// shells (hot slugs stretched along their flight) and each rail beam (a blinding beam that fades fast, and a glowing
// trail along its line that fades over the trail slider).
import * as THREE from "three/webgpu";
import type { Arsenal } from "./arsenal";
import { RAIL_GLOW } from "./arsenal";
import { PainterDraw } from "./painterDraw";
import { Ribbon, glowMaterial } from "./ribbon";

interface Ground { height(x: number, z: number): number }

const MAX_ROCKETS = 32, MAX_SHELLS = 24, MAX_BEAMS = 4;

export class ArsenalDraw {
  readonly group = new THREE.Group();
  private paints: PainterDraw[];
  private rockets: THREE.InstancedMesh;
  private flares: THREE.InstancedMesh;
  private slugs: THREE.InstancedMesh;
  private beams: { flat: Ribbon; up: Ribbon; trail: Ribbon; lead: THREE.Mesh }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private d = new THREE.Vector3();

  constructor(private arsenal: Arsenal, ground: Ground) {
    this.paints = [0, 1, 2, 3].map(() => new PainterDraw(ground, arsenal.v));
    for (const pd of this.paints) this.group.add(pd.group);
    const body = new THREE.CylinderGeometry(0.11, 0.13, 1, 8).rotateX(Math.PI / 2);
    this.rockets = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x3e3c35, roughness: 0.6 }), MAX_ROCKETS);
    this.flares = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), glowMaterial(0xffb060, true), MAX_ROCKETS);
    this.slugs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), glowMaterial(0xffd08a, true), MAX_SHELLS);
    for (const o of [this.rockets, this.flares, this.slugs]) { o.frustumCulled = false; o.count = 0; this.group.add(o); }
    this.rockets.castShadow = true;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const flat = new Ribbon(64, RAIL_GLOW, true), up = new Ribbon(64, RAIL_GLOW, true), trail = new Ribbon(64, RAIL_GLOW, true);
      const lead = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), glowMaterial(0xe8fbff, true));
      lead.frustumCulled = false;
      this.group.add(flat.mesh, up.mesh, trail.mesh, lead);
      this.beams.push({ flat, up, trail, lead });
    }
  }

  meshes(): THREE.Object3D[] { return this.arsenal.meshes(); }

  update() {
    const a = this.arsenal, v = a.v;
    this.paints[0].update(a.backPaint);
    this.paints[1].update(a.sides[0].paint);
    this.paints[2].update(a.sides[1].paint);
    this.paints[3].update(a.firedPaint);

    // Rockets: along their flight, with a flare at the tail.
    let n = 0;
    for (const r of a.salvo.rockets) {
      if (!r.live || !r.launched || n >= MAX_ROCKETS) continue;
      this.p.set(r.pos.x, r.pos.y, r.pos.z);
      this.d.set(r.pos.x - r.prev.x, r.pos.y - r.prev.y, r.pos.z - r.prev.z);
      if (this.d.lengthSq() < 1e-8) this.d.set(0, 1, 0);
      this.q.setFromUnitVectors(Z, this.d.normalize());
      this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
      this.rockets.setMatrixAt(n, this.m);
      this.p.addScaledVector(this.d, -0.6);
      const k = 0.55 + Math.random() * 0.25;
      this.m.compose(this.p, this.q, this.s.set(k, k, k * 1.8));
      this.flares.setMatrixAt(n, this.m);
      n++;
    }
    this.rockets.count = this.flares.count = n;
    this.rockets.instanceMatrix.needsUpdate = this.flares.instanceMatrix.needsUpdate = true;

    // Autocannon shells: hot slugs stretched along their flight.
    n = 0;
    for (const sh of a.shells.list) {
      if (!sh.live || n >= MAX_SHELLS) continue;
      this.d.copy(sh.vel).normalize();
      this.q.setFromUnitVectors(Z, this.d);
      this.m.compose(sh.pos, this.q, this.s.set(0.28, 0.28, 1.6));
      this.slugs.setMatrixAt(n++, this.m);
    }
    this.slugs.count = n;
    this.slugs.instanceMatrix.needsUpdate = true;

    // Rail beams: the beam itself for a blink, the trail fading after it.
    const shots = a.railShots.slice(-MAX_BEAMS);
    this.beams.forEach((b, i) => {
      const shot = shots[i];
      for (const o of [b.flat.mesh, b.up.mesh, b.trail.mesh, b.lead]) o.visible = false;
      if (!shot || shot.path.length < 2) return;
      const flash = Math.max(0, 1 - shot.age / 0.22), fade = Math.max(0, 1 - shot.age / Math.max(0.05, v.railTrail));
      if (flash > 0) {
        const w = (0.5 + 0.9 * shot.power) * (0.5 + flash);
        b.flat.set(shot.path, w, "flat", null); b.up.set(shot.path, w, "up", null);
        b.flat.mat.opacity = b.up.mat.opacity = Math.min(1, flash * 1.2);
        b.flat.mat.color.setHex(flash > 0.6 ? 0xe8fbff : RAIL_GLOW); b.up.mat.color.copy(b.flat.mat.color);
        // The leg from the muzzle down to the beam's first point.
        const f = shot.from, p0 = shot.path[0];
        this.p.set(f.x, f.y, f.z); this.d.set(p0.x - f.x, p0.y - f.y, p0.z - f.z);
        const len = this.d.length();
        b.lead.position.copy(this.p); b.lead.quaternion.setFromUnitVectors(Z, this.d.normalize()); b.lead.scale.set(w * 0.6, w * 0.6, len);
        (b.lead.material as THREE.MeshBasicMaterial).opacity = flash;
        b.lead.visible = true;
      }
      if (fade > 0) {
        b.trail.set(shot.path, 0.25 + 0.35 * shot.power, "flat", null);
        b.trail.mat.opacity = fade * fade * 0.85;
      }
    });
  }
}

const Z = new THREE.Vector3(0, 0, 1);
