// The stress lab's enemies: the robot swarm, the bandit swarm and a war band on one battlefield, wired the way their
// own labs wire them (rounds through bf.fire, deaths to the ragdoll physics, footfall dust, lobbed charges and
// rockets), each topped up to a count every frame. Trimmed: no wading, no per-lab readouts.
import * as THREE from "three/webgpu";
import type { CombatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import { MechUnit } from "../../src/game/mechUnit";
import { RobotSwarm, DOWN as R_DOWN, BIG, MID, SMALL, robotCentre, type RobotValues } from "../../src/combat/robots";
import { RobotsDraw } from "../../src/combat/robotsDraw";
import { RobotTarget } from "../../src/combat/robotTarget";
import { RobotTearFx, type RobotTearValues } from "../../src/combat/robotTearFx";
import { YELLOW, YELLOW_DIRTY, GREY } from "../../src/combat/robotShapes";
import { InfantrySwarm, DEAD as B_DEAD, INFANTRY_MAX, type InfantryValues } from "../../src/combat/infantry";
import { InfantryDraw, CLOTH, type BanditLookValues } from "../../src/combat/infantryDraw";
import { InfantryTarget } from "../../src/combat/infantryTarget";
import { loadBanditVat } from "../../src/combat/banditVat";
import { Warband, type WarbandValues } from "../../src/combat/warband";
import { robotRagdoll, BANDIT_PARTS, BANDIT_JOINTS } from "../../src/physics/bodies";

export interface StressValues {
  stressSpawnFrom: number;
  stressTracerShare: number;
  stressRocketShare: number;
}
type V = StressValues & RobotValues & RobotTearValues & InfantryValues & BanditLookValues & WarbandValues;
type Mark = (stage: string) => void;

/** A random point on a ring round the mech. */
function ring(lab: CombatLab<object>, r: number) {
  const a = Math.random() * Math.PI * 2, p = lab.player.sim.pos;
  return { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
}

export class StressRobots {
  readonly sw: RobotSwarm;
  readonly draw: RobotsDraw;
  private tear: RobotTearFx;
  private target: RobotTarget;
  private slot = 2;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private at = new THREE.Vector3();
  private up = new THREE.Vector3(0, -1, 0);

  constructor(private lab: CombatLab<V>) {
    const { V, bf, field, player } = lab;
    const sw = this.sw = new RobotSwarm(V, field);
    sw.lookGround = bf.lookGround;
    this.draw = new RobotsDraw(sw);
    lab.app.scene.add(this.draw.group);
    this.target = new RobotTarget(sw, 3);
    bf.targets.push(this.target);
    sw.hideDead = true;
    const RAG = [[0x9a9c9e, 0x4a4d51], [YELLOW, YELLOW_DIRTY], [YELLOW, GREY]];
    sw.onDeath = (i, nx, nz, speed) => {
      const kind = sw.kind[i], [body, leg] = RAG[kind];
      const { parts, joints } = robotRagdoll(sw, i, body, leg);
      lab.deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
        { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, kind === SMALL ? Math.max(3, speed) : 1);
    };
    sw.onFootfall = (i, x, y, z) => bf.dust.stomp(x, y, z, sw.kind[i] === BIG ? 0.5 : 0.12);
    const lobFrom = new THREE.Vector3();
    sw.onLob = (_i, fx, fy, fz, x, z, flight) => bf.lob(3, lobFrom.set(fx, fy, fz), x, z, flight, V.robotBigLobArc, V.robotBigLobRadius, V.robotBigShotDamage);
    this.tear = new RobotTearFx(bf.gunFx, bf.sfx, field, V);
    lab.app.scene.add(this.tear.group);
    void player;
  }

  topUp(n: number) {
    const sw = this.sw, want = Math.min(n, 1000) - sw.count;
    if (want <= 0) return;
    const k = Math.min(want, 60), p = ring(this.lab, this.lab.V.stressSpawnFrom);
    sw.spawn(k, p.x, p.z, 5 + Math.sqrt(k));
  }

  candidates(out: TargetCandidate[]) {
    const sw = this.sw;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= R_DOWN) continue;
      const c = { x: 0, y: 0, z: 0, r: 0, key: i as unknown, vx: sw.vx[i], vz: sw.vz[i] };
      c.r = Math.max(0.6, robotCentre(sw, i, c));
      out.push(c);
    }
  }

  update(dt: number, mark: Mark) {
    const { V, bf, player } = this.lab, sw = this.sw, p = player.sim.pelvis;
    const SHOT: Record<number, { flash: number; hit: number }> = { [SMALL]: { flash: 0.35, hit: 0.3 }, [MID]: { flash: 0.7, hit: 0.6 }, [BIG]: { flash: 1.2, hit: 1 } };
    sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: 2, vx: player.sim.vel.x, vz: player.sim.vel.z },
      (fx, fy, fz, tx, ty, tz, kind) => {
        this.from.set(fx, fy, fz);
        if (!bf.canSee(this.from, p)) return;
        this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
        const drawn = kind !== SMALL || Math.random() < V.stressTracerShare;
        if (drawn) this.slot = this.slot >= 19 ? 2 : this.slot + 1;
        const damage = kind === BIG ? V.robotBigShotDamage : kind === MID ? V.robotMidShotDamage : V.robotShotDamage;
        bf.fire(this.slot, 3, this.from, this.dir, this.from.distanceTo(p) + 8, damage,
          drawn ? { flashScale: SHOT[kind].flash, voice: "other", hitScale: SHOT[kind].hit } : { tracer: false, voice: "none" });
      },
      (i, damage) => { player.damage(damage, this.at.set(sw.px[i], sw.py[i], sw.pz[i]), this.up); this.tear.bite(sw.px[i], sw.py[i], sw.pz[i], p.x, p.z); },
      (_i, damage, x, y, z) => { player.damage(damage, this.at.set(x, y, z), this.up); this.tear.bite(x, y, z, p.x, p.z); });
    mark("robots sim");
    this.draw.update(dt);
    this.tear.update(dt);
    mark("robots draw");
  }
}

export class StressBandits {
  readonly sw: InfantrySwarm;
  draw: InfantryDraw | null = null;
  private target: InfantryTarget;
  private rocketClock = new Float32Array(INFANTRY_MAX);
  private slot = 2;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3();

  constructor(private lab: CombatLab<V>) {
    const { V, bf, field } = lab;
    const sw = this.sw = new InfantrySwarm(V, field);
    this.target = new InfantryTarget(sw, 2);
    bf.targets.push(this.target);
    sw.hideDead = true;
    sw.onDeath = (i, nx, nz, speed) => {
      lab.deaths.ragdoll(BANDIT_PARTS(CLOTH[sw.look[i] & 3]), BANDIT_JOINTS, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
        { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, speed);
    };
  }

  async load() {
    const vat = await loadBanditVat().catch(() => null);
    this.draw = new InfantryDraw(this.sw, this.lab.V, vat);
    this.lab.app.scene.add(this.draw.group);
  }

  topUp(n: number) {
    const sw = this.sw, want = Math.min(n, 1000) - sw.count;
    if (want <= 0) return;
    const k = Math.min(want, 60), p = ring(this.lab, this.lab.V.stressSpawnFrom);
    sw.spawn(k, p.x, p.z, 4 + Math.sqrt(k));
  }

  candidates(out: TargetCandidate[]) {
    const sw = this.sw, V = this.lab.V;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= B_DEAD - 1) continue;
      out.push({ x: sw.px[i], y: sw.py[i] + V.banditHeight * 0.55, z: sw.pz[i], r: Math.max(0.6, V.banditRadius), key: i, vx: sw.vx[i], vz: sw.vz[i] });
    }
  }

  update(dt: number, mark: Mark) {
    const { V, bf, player } = this.lab, sw = this.sw, p = player.sim.pelvis, rc = this.rocketClock;
    for (let i = 0; i < rc.length; i++) rc[i] -= dt;
    sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: 3 }, (fx, fy, fz, tx, ty, tz, i) => {
      this.from.set(fx, fy, fz);
      if (!bf.canSee(this.from, p)) return;
      if ((i * 0.618034) % 1 < V.stressRocketShare) {
        if (rc[i] > 0) return;
        rc[i] = 6 * (0.8 + Math.random() * 0.4);
        const flight = Math.hypot(p.x - fx, p.z - fz) / 16;
        bf.lob(2, this.from, p.x, p.z, flight, 2.5, 2.8, 18);
        return;
      }
      this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = Math.random() < V.stressTracerShare;
      if (drawn) this.slot = this.slot >= 19 ? 2 : this.slot + 1;
      bf.fire(this.slot, 2, this.from, this.dir, V.fireRange + 5, 0.6, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
    });
    mark("bandits sim");
    this.draw?.update(dt);
    mark("bandits draw");
  }
}

const RED = 0xc4523f;

export class StressWarband {
  wb!: Warband;
  private spare: MechUnit[] = [];
  private clock = 0;

  constructor(private lab: CombatLab<V>) {}

  /** Load the bandit mechs ahead (red Ramparts) and make the war band. */
  async load(mechs: number) {
    const { V, bf, toon } = this.lab;
    for (let i = 0; i < mechs; i++) {
      const b = await this.lab.loadRampart();
      const m = new MechUnit(bf, V, b, toon, 2, 20 + i * 2, false);
      m.paint = RED;
      b.paint(toon, RED);
      this.spare.push(m);
    }
    const wb: Warband = new Warband(bf, V, () => this.spare.find((m) => !wb.mechs.includes(m)) ?? null, this.lab.deaths);
    this.wb = wb;
    // No band of its own until topUp asks for one.
    (V as WarbandValues).bandTechnicals = 0; V.bandTrucks = 0; V.bandSixWheelers = 0; V.bandWarRigs = 0; V.bandTanks = 0; V.bandMechs = 0;
    this.lab.app.scene.add(wb.group);
  }

  get vehicles() { return this.wb.raiders.filter((r) => r.alive).length; }
  get mechs() { return this.wb.mechs.filter((m) => m.alive).length; }

  /** Bring in a band sized to what's missing (at most one every 2 s). */
  topUp(vehicles: number, mechs: number, dt: number) {
    this.clock += dt;
    if (this.clock < 2) return;
    const nv = Math.max(0, Math.round(vehicles) - this.vehicles), nm = Math.max(0, Math.min(this.spare.length, Math.round(mechs)) - this.mechs);
    if (nv === 0 && nm === 0) return;
    this.clock = 0;
    const V = this.lab.V;
    const trucks = Math.floor(nv * 0.25), six = Math.floor(nv * 0.1), rigs = Math.floor(nv * 0.05), tanks = Math.floor(nv * 0.1);
    V.bandTrucks = trucks; V.bandSixWheelers = six; V.bandWarRigs = rigs; V.bandTanks = tanks;
    V.bandTechnicals = nv - trucks - six - rigs - tanks; V.bandMechs = nm;
    this.wb.spawn(this.lab.player.sim.pelvis);
    V.bandTechnicals = 0; V.bandTrucks = 0; V.bandSixWheelers = 0; V.bandWarRigs = 0; V.bandTanks = 0; V.bandMechs = 0;
  }

  candidates(out: TargetCandidate[]) {
    const V = this.lab.V;
    for (const r of this.wb.raiders) if (r.alive) out.push({ x: r.sim.pos.x, y: r.centreY, z: r.sim.pos.z, r: r.shape.radius + 0.5, key: r, vx: r.sim.vel.x, vz: r.sim.vel.z });
    for (const m of this.wb.mechs) if (m.alive) out.push({ x: m.sim.pelvis.x, y: m.sim.pelvis.y + 0.6, z: m.sim.pelvis.z, r: V.hitRadius, key: m, vx: m.sim.vel.x, vz: m.sim.vel.z });
  }

  update(dt: number, mark: Mark) {
    this.wb.update(dt, this.lab.player);
    mark("war band");
  }
}
