// The mech's body against what it runs into, each frame (Keith 2026-10-31; rules in src/combat/trample.ts): reads the
// mech's ground velocity (from its own motion, so the walk, the run, the dash's steps and the sprint all count), tramples
// bandits and scrappers through their hit adapters, rams vehicles (both shoved by mass, both hurt), and hands the
// swarms the charge as a threat to dive out of. Feedback (a crunch, a kick of sand) here too.
// Ownership: host (damage, shoves, the threats); the sound and dust are cosmetic.
import * as THREE from "three/webgpu";
import type { MechUnit } from "./mechUnit";
import type { Battlefield } from "./battlefield";
import type { InfantrySwarm } from "../combat/infantry";
import type { InfantryTarget } from "../combat/infantryTarget";
import type { RobotSwarm } from "../combat/robots";
import type { RobotTarget } from "../combat/robotTarget";
import type { Raider } from "../combat/warband";
import type { Arsenal } from "../weapons/arsenal";
import type { Shells } from "./shells";
import type { WeaponValues } from "../weapons/tuning";
import { threatsFrom, ThreatIds } from "../combat/duelThreats";
import { chargeThreat, closingSpeed, ram, VEHICLE_MASS, type GroundThreat, type MechBody, type TrampleHit, type TrampleValues } from "../combat/trample";

export class BodyContact {
  readonly body: MechBody = { x: 0, z: 0, vx: 0, vz: 0, reach: 3, crush: 1 };
  /** This frame's hits (plain data, rule 12): trampled bandits and scrappers, rammed vehicles. */
  readonly hits: TrampleHit[] = [];
  /** Hits since construction (HUD). */
  kills = 0;
  rams = 0;
  private lx = NaN; private lz = NaN;
  private chargeId = 0x40000000;
  private charging = false;
  private cool = new WeakMap<object, number>();
  private at = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private unit: MechUnit, private bf: Battlefield | null = null) {}

  /** The sliders and the legs' stats, off the mech (MECH_DEFAULTS carries the Trample group). */
  private get v(): TrampleValues & { trample: number; crush: number } { return this.unit.v; }

  /** Read the mech's motion this frame (call once a frame, after the mech stepped). */
  step(dt: number): MechBody {
    const u = this.unit, p = u.sim.pos, b = this.body;
    this.hits.length = 0;
    if (dt > 0 && Number.isFinite(this.lx)) {
      const vx = (p.x - this.lx) / dt, vz = (p.z - this.lz) / dt;
      // A respawn or a teleport isn't a charge.
      if (Math.hypot(vx, vz) > 60) { b.vx = 0; b.vz = 0; } else { b.vx += (vx - b.vx) * 0.6; b.vz += (vz - b.vz) * 0.6; }
    }
    this.lx = p.x; this.lz = p.z;
    if (!u.alive) { b.vx = 0; b.vz = 0; }
    b.x = p.x; b.z = p.z;
    b.reach = this.v.trampleReach * (this.v.trample || 1);
    b.crush = this.v.crush || 1;
    return b;
  }

  /** The charging mech as a threat (a new id each charge), or null. */
  charge(): GroundThreat | null {
    const t = this.unit.alive ? chargeThreat(this.body, this.chargeId, this.v) : null;
    if (t && !this.charging) t.id = ++this.chargeId;
    this.charging = !!t;
    return t;
  }

  /**
   * What the swarms can dive out of this frame: the charge, and the mech's telegraphed shots (mortar and rocket rings,
   * the line mortar's strip, missiles; the duel's threat list, src/combat/duelThreats.ts) when it has an arsenal.
   */
  threats(arsenal: Arsenal | null, shells: Shells | null, wv: WeaponValues | null): GroundThreat[] {
    const out: GroundThreat[] = arsenal && shells && wv ? threatsFrom(arsenal, this.unit.team, shells, wv, this.ids) : [];
    const c = this.charge();
    if (c) out.push(c);
    return out;
  }
  private ids = new ThreatIds();

  /** Trample a bandit swarm (its target counts the kills). */
  infantry(sw: InfantrySwarm, target: InfantryTarget | null): number {
    if (!this.unit.alive) return 0;
    const from = this.hits.length;
    const n = sw.trample(this.body, this.v, (i, d, dx, dz, s) => (target ? target.crush(i, d, dx, dz, s) : sw.damage(i, d, dx, dz, s)), this.hits);
    this.feedback(from);
    return n;
  }

  /** Trample small robots. */
  robots(sw: RobotSwarm, target: RobotTarget | null): number {
    if (!this.unit.alive) return 0;
    const from = this.hits.length;
    const n = sw.trample(this.body, this.v, (i, d, dx, dz) => (target ? target.crush(i, d, dx, dz) : sw.damage(i, d, dx, dz)), this.hits);
    this.feedback(from);
    return n;
  }

  /**
   * Ram vehicles: a mech whose reach touches a vehicle's capsule while closing shoves it (the two masses share the
   * closing speed, with a bounce) and both take the same damage (armour ignored: it's the whole frame).
   */
  vehicles(list: readonly Raider[], dt: number): number {
    const u = this.unit, b = this.body;
    if (!u.alive) return 0;
    let n = 0;
    for (const r of list) {
      const cd = this.cool.get(r) ?? 0;
      if (cd > 0) { this.cool.set(r, cd - dt); }
      if (!r.alive) continue;
      const s = r.sim, sh = r.shape, fx = Math.sin(s.heading), fz = Math.cos(s.heading);
      // Nearest point on the vehicle's spine.
      const rx = b.x - s.pos.x, rz = b.z - s.pos.z, along = Math.max(-sh.half, Math.min(sh.half, rx * fx + rz * fz));
      const cx = s.pos.x + fx * along, cz = s.pos.z + fz * along;
      const R = b.reach + sh.radius, dx = cx - b.x, dz = cz - b.z, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const c = closingSpeed(b, cx, cz, s.vel.x, s.vel.z);
      // Out of the overlap, whatever the speed: the mech's body is solid to vehicles.
      const push = R - d;
      s.pos.x += c.nx * push; s.pos.z += c.nz * push;
      if (cd > 0 || c.closing < 0.5) continue;
      const m = VEHICLE_MASS[r.kind] ?? 8, hit = ram(c.closing, m, this.v);
      // Into the car's own axes: forward (speed) and its +X side (lateral); a hit off the middle spins it.
      const lx = Math.cos(s.heading), lz = -Math.sin(s.heading);
      s.speed += hit.dvOther * (c.nx * fx + c.nz * fz);
      s.lateral += hit.dvOther * (c.nx * lx + c.nz * lz);
      s.yawRate += (hit.dvOther * along / Math.max(1, sh.half * sh.half)) * (c.nx * lx + c.nz * lz);
      this.cool.set(r, 0.5);
      n++; this.rams++;
      if (hit.damage > 0) {
        this.at.set(cx, s.pos.y + 1, cz); this.dir.set(c.nx, 0, c.nz);
        r.damage(hit.damage, this.at, this.dir, 1);
        this.dir.set(-c.nx, 0, -c.nz);
        u.damage(hit.mechDamage, this.at, this.dir, 1);
      }
      this.hits.push({ kind: "vehicle", id: r.id, damage: hit.damage, closing: c.closing, killed: !r.alive, x: cx, z: cz });
      const bf = this.bf;
      if (bf) {
        this.at.set(cx, s.pos.y + 1, cz);
        bf.sfx.play("metalHit", this.at, Math.min(1, 0.4 + c.closing * 0.06), 0.5, false);
        bf.dust.kick(cx, s.pos.y, cz, c.nx, c.nz, Math.min(2, c.closing * 0.15));
      }
    }
    return n;
  }

  private feedback(from: number) {
    const bf = this.bf;
    for (let k = from; k < this.hits.length; k++) {
      const h = this.hits[k];
      if (h.killed) this.kills++;
      if (!bf) continue;
      const y = bf.field.height(h.x, h.z), sp = Math.hypot(this.body.vx, this.body.vz) || 1;
      bf.dust.kick(h.x, y, h.z, this.body.vx / sp, this.body.vz / sp, Math.min(1.5, h.closing * 0.1));
      if (k === from) {
        this.at.set(h.x, y + 1, h.z);
        // A crunch: a low, slowed body hit (bandits) or a bent-metal knock (scrappers).
        bf.sfx.play(h.kind === "robot" ? "metalHit" : "dirtHit", this.at, Math.min(1, 0.35 + h.closing * 0.05), h.kind === "robot" ? 0.7 : 0.55, false);
      }
    }
  }
}
