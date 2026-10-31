// Draws an arsenal (src/weapons/arsenal.ts): its paints (each shoulder weapon's strip or ring, each rail cannon's
// charge beam, a fired line mortar's strip), the rockets and missiles in flight (a dark body and a hot flare; their
// smoke is the dust system's), shells (hot slugs stretched along their flight), the rail cannon (while charging: its
// coils lighting in turn with arcs crawling between them, a thin aim line on the sand and a charge meter round the
// reticle; on release: a hard bright streak for a frame or two, a muzzle flash, then an ionised trail that drifts into
// wisps and fades) and the faint targeting lasers with small glints running along them.
import * as THREE from "three/webgpu";
import type { Arsenal } from "./arsenal";
import { RAIL_GLOW } from "./arsenal";
import { coilGlow } from "./rail";
import type { Paint, Vec3 } from "./painter";
import { ProjectileMeshes } from "./projectileDraw";
import { PainterDraw } from "./painterDraw";
import { Ribbon, glowMaterial } from "./ribbon";
import type { NightLights } from "../world/nightLights";

interface Ground { height(x: number, z: number): number }

const MAX_ROCKETS = 160, MAX_SLUGS = 48, MAX_BEAMS = 4, MAX_LASERS = 6, MAX_COILS = 32, MAX_ARCS = 24;
const LASER = 0xff3a2a;

export class ArsenalDraw {
  readonly group = new THREE.Group();
  private paints: PainterDraw[] = [];
  private rockets: THREE.InstancedMesh;
  private flares: THREE.InstancedMesh;
  private slugs: THREE.InstancedMesh;
  private beams: { streak: THREE.Mesh; core: THREE.Mesh; flash: THREE.Mesh; trailA: Ribbon; trailB: Ribbon; wisp: Ribbon }[] = [];
  /** The rail's charge: coil glows, arcs between lit coils, the aim line on the sand and the meter at the reticle. */
  private coils: THREE.InstancedMesh;
  private arcs: THREE.InstancedMesh;
  private aimLines: Ribbon[] = [];
  private meters: { back: Ribbon; fill: Ribbon }[] = [];
  private pts: { x: number; y: number; z: number }[] = [];
  private lasers: { line: THREE.Mesh; glint: THREE.Mesh }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private d = new THREE.Vector3();
  private t = 0;
  /** The library's rocket, missile and mortar-shell models, once loaded (the boxes and slugs stand in until then). */
  private proj = new ProjectileMeshes(MAX_ROCKETS);

  /** The night lights rockets ask for light (cosmetic), when the lab has a look. */
  constructor(private arsenal: Arsenal, private ground: Ground, private lights: (() => NightLights | null) | null = null) {
    const body = new THREE.CylinderGeometry(0.11, 0.13, 1, 8).rotateX(Math.PI / 2);
    this.rockets = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0x3e3c35, roughness: 0.6 }), MAX_ROCKETS);
    this.flares = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), glowMaterial(0xffb060, true), MAX_ROCKETS);
    this.slugs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), glowMaterial(0xffd08a, true), MAX_SLUGS);
    for (const o of [this.rockets, this.flares, this.slugs]) { o.frustumCulled = false; o.count = 0; this.group.add(o); }
    this.rockets.castShadow = true;
    this.group.add(this.proj.group);
    const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < MAX_BEAMS; i++) {
      const streak = new THREE.Mesh(unitBox, glowMaterial(RAIL_GLOW, true)), core = new THREE.Mesh(unitBox, glowMaterial(0xffffff, true));
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(0xe8fbff, true));
      const trailA = new Ribbon(64, 0xa8ecff, true), trailB = new Ribbon(64, 0xa8ecff, true), wisp = new Ribbon(64, 0xcfe9f2, false);
      for (const o of [streak, core, flash]) { o.frustumCulled = false; o.renderOrder = 5; }
      this.group.add(streak, core, flash, trailA.mesh, trailB.mesh, wisp.mesh);
      this.beams.push({ streak, core, flash, trailA, trailB, wisp });
    }
    this.coils = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), glowMaterial(RAIL_GLOW, true), MAX_COILS);
    this.arcs = new THREE.InstancedMesh(unitBox, glowMaterial(0xdff8ff, true), MAX_ARCS);
    for (const o of [this.coils, this.arcs]) { o.frustumCulled = false; o.count = 0; o.renderOrder = 5; this.group.add(o); }
    for (let i = 0; i < 2; i++) {
      const line = new Ribbon(64, RAIL_GLOW, true);
      const back = new Ribbon(40, 0x2a3a40, false), fill = new Ribbon(40, RAIL_GLOW, true);
      back.mat.opacity = 0.45;
      this.group.add(line.mesh, back.mesh, fill.mesh);
      this.aimLines.push(line); this.meters.push({ back, fill });
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
    const lights = this.lights?.() ?? null;
    const rocket = (pos: Vec3, prev: Vec3, k: number, kind: "rocket" | "missile" = "rocket") => {
      if (n >= MAX_ROCKETS) return;
      this.p.set(pos.x, pos.y, pos.z);
      this.d.set(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
      if (this.d.lengthSq() < 1e-8) this.d.set(0, 1, 0);
      this.q.setFromUnitVectors(Z, this.d.normalize());
      // Its light (src/world/nightLights.ts: a glow, an exhaust flare, a real light merged with its neighbours).
      lights?.rocket(pos.x, pos.y, pos.z, this.d.x, this.d.y, this.d.z, kind === "rocket" ? 1 : 0.6, a.fam);
      // Bent air behind it (src/fx/blastWaves.ts heat shimmer).
      a.waves.exhaust(pos.x, pos.y, pos.z, this.d.x, this.d.y, this.d.z, kind === "rocket" ? 1 : 0.7);
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
        lights?.rocket(r.pos.x, r.pos.y, r.pos.z, dir.x, dir.y, dir.z, 0.7, a.fam);
        a.waves.exhaust(r.pos.x, r.pos.y, r.pos.z, dir.x, dir.y, dir.z, 0.7);
        if (proj.ready("mortar-shell")) proj.add("mortar-shell", r.pos, dir, 1.3); else slug(r.pos, dir, 1.2);
      }
    }
    for (const sh of a.shells.list) if (sh.live) { slug(sh.pos, sh.vel, 1); lights?.rocket(sh.pos.x, sh.pos.y, sh.pos.z, sh.vel.x, sh.vel.y, sh.vel.z, 0.3, a.fam); }
    // Painted strips and rings glow on the sand and light it at night (Keith 2026-10-31: lit telegraphs): brighter
    // when ready, and a fired strip (the line mortar's walk) at full while its rockets come down.
    if (lights) paints.forEach((p, i) => {
      if (!p.on) return;
      const fired = i >= 2 && (i - 2) % 2 === 1;
      const u = fired ? 1 : p.ready ? 0.55 : 0.15;
      if (p.strip) lights.telegraphLine(p.strip.ax, p.strip.az, p.strip.bx, p.strip.bz, p.strip.width, u * (p.strip ? Math.max(0.3, p.charge) : 1), a.fam);
      if (p.ring) lights.telegraph(p.ring.x, this.ground.height(p.ring.x, p.ring.z), p.ring.z, p.ring.r, u, a.fam);
    });
    proj.end();
    this.rockets.count = this.flares.count = n;
    this.slugs.count = ns;
    this.rockets.instanceMatrix.needsUpdate = this.flares.instanceMatrix.needsUpdate = this.slugs.instanceMatrix.needsUpdate = true;

    // Rail charging: the coils light in turn from the breech, arcs crawl between the lit ones, a thin line on the sand
    // to where the slug would stop, and a meter filling round the reticle.
    let nc = 0, na = 0;
    a.sides.forEach((s, i) => {
      const line = this.aimLines[i], meter = this.meters[i];
      line.mesh.visible = meter.back.mesh.visible = meter.fill.mesh.visible = false;
      if (s.kind !== "rail") return;
      const c = s.rail.holding ? s.rail.charge : 0;
      const gp = s.model?.glowPoints ?? [];
      const lit: THREE.Vector3[] = [];
      gp.forEach((g, gi) => {
        const k = coilGlow(c, gi, gp.length);
        if (k <= 0.02 || nc >= MAX_COILS) return;
        const p = g.getWorldPosition(new THREE.Vector3());
        const r = (0.18 + 0.22 * k) * (0.85 + 0.3 * Math.random());
        this.m.compose(p, this.q.identity(), this.s.set(r, r, r));
        this.coils.setMatrixAt(nc++, this.m);
        if (k > 0.5) lit.push(p);
      });
      // Arcs: short jagged sparks between neighbouring lit coils, flickering.
      if (v.railCoilArcs > 0) for (let k = 0; k + 1 < lit.length && na < MAX_ARCS; k++) {
        if (Math.random() > 0.55 * v.railCoilArcs) continue;
        const p0 = lit[k], p1 = lit[k + 1];
        const mid = this.p.lerpVectors(p0, p1, 0.3 + Math.random() * 0.4).add(this.d.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25));
        for (const [from, to] of [[p0, mid.clone()], [mid.clone(), p1]] as const) {
          if (na >= MAX_ARCS) break;
          this.d.subVectors(to, from);
          const len = this.d.length();
          if (len < 1e-3) continue;
          this.q.setFromUnitVectors(Z, this.d.divideScalar(len));
          this.m.compose(from, this.q, this.s.set(0.03, 0.03, len));
          this.arcs.setMatrixAt(na++, this.m);
        }
      }
      if (s.aimLine.length >= 2) {
        line.set(s.aimLine, v.beamWidth * 1.1, "ground", this.ground, 0.07);
        line.mat.opacity = 0.35 + 0.55 * c;
        line.mat.color.setHex(c >= v.railMinCharge ? RAIL_GLOW : 0x6c8890);
      }
      if (s.meterAt && s.rail.holding) {
        // A ring round the reticle: dim behind, filling clockwise from the top of the screen; full flashes white.
        const R = 1.9, m = s.meterAt, pts = this.pts;
        const ring = (frac: number) => {
          pts.length = 0;
          const n = Math.max(2, Math.round(36 * frac));
          for (let k = 0; k <= n; k++) { const ang = (k / 36) * Math.PI * 2; pts.push({ x: m.x + Math.sin(ang) * R, y: 0, z: m.z + Math.cos(ang) * R }); }
          return pts;
        };
        meter.back.set(ring(1), 0.22, "ground", this.ground, 0.09);
        meter.back.mesh.visible = true;
        if (c > 0.01) {
          meter.fill.set(ring(c), 0.3, "ground", this.ground, 0.1);
          meter.fill.mat.opacity = 0.95;
          meter.fill.mat.color.setHex(c >= 1 ? 0xffffff : c >= v.railMinCharge ? RAIL_GLOW : 0x6c8890);
        }
      }
    });
    this.coils.count = nc; this.arcs.count = na;
    this.coils.instanceMatrix.needsUpdate = this.arcs.instanceMatrix.needsUpdate = true;

    // Rail slugs: a hard bright streak for a frame or two and a flash at the muzzle, then the ionised trail fading,
    // drifting and curling into wisps.
    const shots = a.railShots.slice(-MAX_BEAMS);
    this.beams.forEach((b, i) => {
      const shot = shots[i];
      for (const o of [b.streak, b.core, b.flash, b.trailA.mesh, b.trailB.mesh, b.wisp.mesh]) o.visible = false;
      if (!shot || shot.path.length < 2) return;
      const f = shot.from, to = shot.to;
      const streak = Math.max(0, 1 - shot.age / Math.max(0.01, v.railStreak));
      if (streak > 0) {
        this.p.set(f.x, f.y, f.z); this.d.set(to.x - f.x, to.y - f.y, to.z - f.z);
        const len = this.d.length();
        this.q.setFromUnitVectors(Z, this.d.divideScalar(len || 1));
        const w = 0.35 + 0.45 * shot.power;
        b.streak.position.copy(this.p); b.streak.quaternion.copy(this.q); b.streak.scale.set(w, w, len);
        b.core.position.copy(this.p); b.core.quaternion.copy(this.q); b.core.scale.set(w * 0.35, w * 0.35, len);
        (b.streak.material as THREE.MeshBasicMaterial).opacity = streak;
        (b.core.material as THREE.MeshBasicMaterial).opacity = Math.min(1, streak * 1.5);
        b.streak.visible = b.core.visible = true;
        // The streak lights its line for a moment, by its charge (Keith 2026-10-31: tracers show power).
        if (lights) for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4;
          lights.hold(f.x + (to.x - f.x) * t, f.y + (to.y - f.y) * t, f.z + (to.z - f.z) * t, lights.v.railLight * shot.power * streak / 4, lights.v.tracerRange * 1.6, RAIL_GLOW, 1.5);
        }
      }
      const flash = Math.max(0, 1 - shot.age / 0.12);
      if (flash > 0 && v.railBlast > 0) {
        const r = (1.2 + 1.6 * shot.power) * v.railBlast * (0.6 + 0.4 * flash);
        b.flash.position.set(f.x + shot.dir.x * r * 0.4, f.y, f.z + shot.dir.z * r * 0.4); b.flash.scale.setScalar(r);
        (b.flash.material as THREE.MeshBasicMaterial).opacity = flash;
        b.flash.visible = true;
      }
      const T = Math.max(0.05, v.railTrail), fade = Math.max(0, 1 - shot.age / T);
      if (fade <= 0) return;
      // The trail: the path drifting up and sideways as it ages, wobbling along its length (seeded per shot).
      const age = shot.age, pts = this.pts;
      const drift = v.railWisp * age;
      const curl = (k: number, ph: number) => Math.sin(k * 0.45 + shot.seed + ph + age * 2.2) * drift * 0.6 + Math.sin(k * 1.3 + shot.seed * 2 + ph) * drift * 0.25;
      pts.length = 0;
      shot.path.forEach((p, k) => pts.push({ x: p.x + curl(k, 0) * -shot.dir.z, y: p.y + drift * 0.35 + curl(k, 1.7) * 0.4, z: p.z + curl(k, 0) * shot.dir.x }));
      const tw = 0.2 + 0.25 * shot.power + drift * 0.5;
      b.trailA.set(pts, tw, "flat", null); b.trailB.set(pts, tw, "up", null);
      b.trailA.mat.opacity = b.trailB.mat.opacity = fade * fade * 0.7;
      // Wisps: a wider, paler, ragged ribbon that lingers (normal blending: it reads as vapour, not light).
      pts.length = 0;
      shot.path.forEach((p, k) => pts.push({ x: p.x + curl(k, 3.1) * -shot.dir.z * 1.6, y: p.y + drift * 0.6 + curl(k, 4.2) * 0.7, z: p.z + curl(k, 3.1) * shot.dir.x * 1.6 }));
      if (v.railWisp > 0) {
        b.wisp.set(pts, (0.4 + drift * 1.4) * (0.7 + 0.3 * shot.power), "flat", null);
        b.wisp.mat.opacity = Math.min(1, age * 6) * fade * 0.35;
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
