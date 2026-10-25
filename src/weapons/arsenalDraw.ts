// Draws an arsenal (src/weapons/arsenal.ts): its paints (each shoulder weapon's strip or ring, each rail cannon's
// charge beam, a fired line mortar's strip), the rockets and missiles in flight (a dark body and a hot flare; their
// smoke is the dust system's), shells (hot slugs stretched along their flight), each rail beam (a blinding beam that
// fades fast, then a glowing trail) and the faint targeting lasers with small glints running along them.
import * as THREE from "three/webgpu";
import type { Arsenal } from "./arsenal";
import { RAIL_GLOW } from "./arsenal";
import type { Paint, Vec3 } from "./painter";
import { ProjectileMeshes } from "./projectileDraw";
import { PainterDraw } from "./painterDraw";
import { Ribbon, glowMaterial } from "./ribbon";

interface Ground { height(x: number, z: number): number }

const MAX_ROCKETS = 64, MAX_SLUGS = 48, MAX_BEAMS = 4, MAX_LASERS = 6;
const LASER = 0xff3a2a;

export class ArsenalDraw {
  readonly group = new THREE.Group();
  private paints: PainterDraw[] = [];
  private rockets: THREE.InstancedMesh;
  private flares: THREE.InstancedMesh;
  private slugs: THREE.InstancedMesh;
  private beams: { flat: Ribbon; up: Ribbon; trail: Ribbon; lead: THREE.Mesh }[] = [];
  private lasers: { line: THREE.Mesh; glint: THREE.Mesh }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private d = new THREE.Vector3();
  private t = 0;
  /** The library's rocket, missile and mortar-shell models, once loaded (the boxes and slugs stand in until then). */
  private proj = new ProjectileMeshes(64);

  constructor(private arsenal: Arsenal, private ground: Ground) {
    const body = new THREE.CylinderGeometry(0.11, 0.13, 1, 8).rotateX(Math.PI / 2);
    this.rockets = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x3e3c35, roughness: 0.6 }), MAX_ROCKETS);
    this.flares = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), glowMaterial(0xffb060, true), MAX_ROCKETS);
    this.slugs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), glowMaterial(0xffd08a, true), MAX_SLUGS);
    for (const o of [this.rockets, this.flares, this.slugs]) { o.frustumCulled = false; o.count = 0; this.group.add(o); }
    this.rockets.castShadow = true;
    this.group.add(this.proj.group);
    for (let i = 0; i < MAX_BEAMS; i++) {
      const flat = new Ribbon(64, RAIL_GLOW, true), up = new Ribbon(64, RAIL_GLOW, true), trail = new Ribbon(64, RAIL_GLOW, true);
      const lead = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), glowMaterial(0xe8fbff, true));
      lead.frustumCulled = false;
      this.group.add(flat.mesh, up.mesh, trail.mesh, lead);
      this.beams.push({ flat, up, trail, lead });
    }
    for (let i = 0; i < MAX_LASERS; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), glowMaterial(LASER, true));
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), glowMaterial(0xffd0c0, true));
      for (const o of [line, glint]) { o.frustumCulled = false; o.renderOrder = 4; this.group.add(o); }
      this.lasers.push({ line, glint });
    }
  }

  private paintDraw(i: number) {
    while (this.paints.length <= i) { const pd = new PainterDraw(this.ground, this.arsenal.v); this.paints.push(pd); this.group.add(pd.group); }
    return this.paints[i];
  }

  update(dt = 1 / 60) {
    const a = this.arsenal, v = a.v;
    this.t += dt;
    const paints: Paint[] = [a.sides[0].paint, a.sides[1].paint, ...a.shoulders.flatMap((s) => [s.paint, s.fired])];
    paints.forEach((p, i) => this.paintDraw(i).update(p));
    for (let i = paints.length; i < this.paints.length; i++) this.paints[i].update({ on: false } as Paint);

    // Rockets and missiles: along their flight, a flare at the tail. Line mortar and autocannon shells: hot slugs.
    let n = 0, ns = 0;
    const proj = this.proj;
    proj.begin();
    const rocket = (pos: Vec3, prev: Vec3, k: number, kind: "rocket" | "missile" = "rocket") => {
      if (n >= MAX_ROCKETS) return;
      this.p.set(pos.x, pos.y, pos.z);
      this.d.set(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
      if (this.d.lengthSq() < 1e-8) this.d.set(0, 1, 0);
      this.q.setFromUnitVectors(Z, this.d.normalize());
      // The modelled rocket or missile when it's loaded (the box body hidden at zero scale), the flare either way.
      const modelled = proj.ready(kind);
      if (modelled) proj.add(kind, this.p, this.d, kind === "rocket" ? 1 : 1.2);
      this.m.compose(this.p, this.q, modelled ? this.s.set(0, 0, 0) : this.s.set(k, k, k * 1.2));
      this.rockets.setMatrixAt(n, this.m);
      this.p.addScaledVector(this.d, -0.6 * k);
      const f = (0.55 + Math.random() * 0.25) * k;
      this.m.compose(this.p, this.q, this.s.set(f, f, f * 1.8));
      this.flares.setMatrixAt(n, this.m);
      n++;
    };
    const slug = (pos: Vec3, dir: Vec3, k: number) => {
      if (ns >= MAX_SLUGS) return;
      this.d.set(dir.x, dir.y, dir.z);
      if (this.d.lengthSq() < 1e-8) this.d.set(0, 1, 0);
      this.q.setFromUnitVectors(Z, this.d.normalize());
      this.m.compose(this.p.set(pos.x, pos.y, pos.z), this.q, this.s.set(0.28 * k, 0.28 * k, 1.6 * k));
      this.slugs.setMatrixAt(ns++, this.m);
    };
    for (const r of a.rockets.list) if (r.live) rocket(r.pos, r.prev, 1.6);
    for (const sh of a.shoulders) {
      for (const m of sh.swarm.missiles) if (m.live && m.launched) rocket(m.pos, m.prev, 0.9, "missile");
      // Line mortar shells: the modelled shell along its flight once loaded (was a long hot slug).
      for (const r of sh.line.rockets) if (r.live && r.launched) {
        const dir = { x: r.pos.x - r.prev.x, y: r.pos.y - r.prev.y, z: r.pos.z - r.prev.z };
        if (proj.ready("mortar-shell")) proj.add("mortar-shell", r.pos, dir, 1.3); else slug(r.pos, dir, 1.2);
      }
    }
    for (const sh of a.shells.list) if (sh.live) slug(sh.pos, sh.vel, 1);
    proj.end();
    this.rockets.count = this.flares.count = n;
    this.slugs.count = ns;
    this.rockets.instanceMatrix.needsUpdate = this.flares.instanceMatrix.needsUpdate = this.slugs.instanceMatrix.needsUpdate = true;

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

    // Targeting lasers: a very faint line, with a glint sliding along it now and then.
    const lasers = [...a.sides.map((s) => s.laser), ...a.shoulders.map((s) => s.laser)].filter((l) => l.on);
    this.lasers.forEach((L, i) => {
      const l = lasers[i];
      L.line.visible = L.glint.visible = false;
      if (!l) return;
      this.d.subVectors(l.to, l.from);
      const len = this.d.length();
      if (len < 0.2) return;
      this.d.divideScalar(len);
      L.line.position.copy(l.from); L.line.quaternion.setFromUnitVectors(Z, this.d); L.line.scale.set(v.laserWidth, v.laserWidth, len);
      (L.line.material as THREE.MeshBasicMaterial).opacity = Math.min(1, l.k);
      L.line.visible = true;
      if (v.laserGlisten > 0) {
        const ph = (this.t * 0.7 + i * 0.37) % 1.6;
        if (ph < 1) {
          L.glint.position.copy(l.from).addScaledVector(this.d, len * ph);
          L.glint.scale.setScalar(v.laserWidth * 5 * v.laserGlisten);
          (L.glint.material as THREE.MeshBasicMaterial).opacity = Math.min(1, l.k * 1.6 * Math.sin(ph * Math.PI));
          L.glint.visible = true;
        }
      }
    });
  }
}

const Z = new THREE.Vector3(0, 0, 1);
