// Humanoid robots on the battlefield (glue): the sim (src/combat/droids.ts), its drawer and its target together, the
// pulses resolved as rounds of the robots' team (only with a clear line, as the bandits), drawn as blue streaks with a
// zap, and the dead handed to the death physics as white ragdolls. One per lab or expedition; spawn squads into it.
// Ownership: host (the swarm, damage); the streaks, zaps and ragdolls are cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import type { DuneField } from "../world/terrain";
import type { BanditVatData } from "../combat/banditVat";
import { DroidSwarm, droidVariant, squadVariant, TROOPER, LANCER, BRUTE, DROID_VARIANT_NAMES, type DroidAllValues } from "../combat/droids";
import { DroidsDraw, droidRagdoll } from "../combat/droidsDraw";
import { InfantryTarget } from "../combat/infantryTarget";
import { DEAD } from "../combat/infantry";
import { TEAM } from "./factions";
import type { Prey } from "../pilot/quarry";
import type { DeathPhysics } from "../physics/deaths";

export class DroidFight {
  readonly sw: DroidSwarm;
  readonly draw: DroidsDraw;
  readonly target: InfantryTarget;
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private aim = new THREE.Vector3();
  private slot = 2;
  /** Pulses fired (HUD, checks). */
  pulses = 0;

  /** v: the shared values (base and variant sliders); variant: TROOPER, LANCER or BRUTE. register: add the target to
   *  the battlefield's register now (a lab), or leave it to the caller (the expedition adds its owners in order). */
  constructor(private bf: Battlefield, scene: THREE.Scene, private v: DroidAllValues, field: DuneField, vat: BanditVatData | null,
    deaths: DeathPhysics | null, readonly variant = TROOPER, register = true, seed = 61 + variant * 17) {
    this.sw = new DroidSwarm(droidVariant(v, variant), field, seed);
    this.draw = new DroidsDraw(this.sw, vat, variant);
    scene.add(this.draw.group);
    this.target = new InfantryTarget(this.sw, TEAM.robots, { name: `humanoid robots: ${DROID_VARIANT_NAMES[variant]}`, surface: "metal", material: "cutter" });
    bf.targets.push(this.target);
    { const d = this.draw.body, t = this.target; d.chillMap = () => { d.frostLook = (bf.v as { frostLook?: number } | undefined)?.frostLook ?? 1; return bf.chills?.chillsOf(t) ?? null; }; }
    if (register) bf.register.add(this.target);
    const sw = this.sw;
    if (deaths) {
      sw.hideDead = true;
      sw.onDeath = (i, nx, nz, speed) => {
        const r = droidRagdoll(sw.v.banditHeight);
        deaths.ragdoll(r.parts, r.joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i], { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, speed);
        this.from.set(sw.px[i], sw.py[i] + sw.v.banditHeight * 0.6, sw.pz[i]);
        bf.sfx.play("metalHit", this.from, 0.9, 0.55, false);
      };
    }
  }

  get count() { return this.sw.count; }

  /** A squad of n round (x, z). */
  spawn(n: number, x: number, z: number): number[] { return this.sw.spawn(n, x, z, 3 + Math.sqrt(n) * 2); }

  /** One frame against prey (the mech or the pilot): move, shoot, draw. */
  update(dt: number, prey: Prey) {
    const sw = this.sw, p = prey.at, bf = this.bf;
    droidVariant(this.v, this.variant, sw.d);
    sw.sync();
    sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.radius }, (fx, fy, fz, tx, ty, tz, i) => {
      if (!prey.alive) return;
      const from = this.draw.muzzle(i, this.from);
      if (!bf.canSee(from, p)) return;
      // The sim aimed from its own (bandit-sized) muzzle: keep its spread, round the line from the robot's gun.
      this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
      this.aim.set(p.x - fx, p.y - fy, p.z - fz).normalize();
      this.dir.sub(this.aim);
      this.aim.subVectors(p, from).normalize();
      this.dir.add(this.aim).normalize();
      const range = sw.v.fireRange + 5;
      this.slot = this.slot >= 19 ? 2 : this.slot + 1;
      bf.fire(this.slot, TEAM.robots, from, this.dir, range, sw.d.droidDamage, { tracer: false, voice: "none", hitScale: 0.45 });
      this.pulses++;
      // The streak flies to about the target if it's on line, else out to range.
      const along = (p.x - from.x) * this.dir.x + (p.y - from.y) * this.dir.y + (p.z - from.z) * this.dir.z;
      const off = Math.hypot(from.x + this.dir.x * along - p.x, from.y + this.dir.y * along - p.y, from.z + this.dir.z * along - p.z);
      this.draw.bolt(from, this.dir, off < prey.radius + 0.5 ? Math.max(1, along) : range, i);
      bf.sfx.play("spit", from, 0.55, 1.9, true);
    });
    this.draw.update(dt, prey.alive ? p : null);
  }
}

/** A member of a squad: which variant's fight, its slot there and the slot's spawn count (a reused slot isn't it). */
export interface DroidMember { f: number; i: number; gen: number }

/** All three variants on one field (one fight each: one draw each), and squads split between them. */
export class DroidSquads {
  readonly fights: DroidFight[];
  constructor(bf: Battlefield, scene: THREE.Scene, v: DroidAllValues, field: DuneField, vat: BanditVatData | null, deaths: DeathPhysics | null, register = true) {
    this.fights = [TROOPER, LANCER, BRUTE].map((k) => new DroidFight(bf, scene, v, field, vat, deaths, k, register));
    this.v = v;
  }
  private v: DroidAllValues;

  get count() { let n = 0; for (const f of this.fights) n += f.count; return n; }
  get kills() { let n = 0; for (const f of this.fights) n += f.target.kills; return n; }
  get pulses() { let n = 0; for (const f of this.fights) n += f.pulses; return n; }
  get meshes() { return this.fights.map((f) => f.draw.mesh); }
  get targets() { return this.fights.map((f) => f.target); }

  /** A squad of n round (x, z), split into variants by the shares (seed: the squad's own split). */
  spawn(n: number, x: number, z: number, seed = Math.random()): DroidMember[] {
    const per = [0, 0, 0];
    for (let k = 0; k < n; k++) per[squadVariant(this.v, k, seed)]++;
    const out: DroidMember[] = [];
    per.forEach((m, f) => { if (m > 0) for (const i of this.fights[f].spawn(m, x, z)) out.push({ f, i, gen: this.fights[f].sw.gen[i] }); });
    return out;
  }

  /** Is the member still that robot, and standing (not dead, not a reused slot)? */
  alive(m: DroidMember): boolean { const sw = this.fights[m.f].sw; return sw.gen[m.i] === m.gen && sw.state[m.i] < DEAD; }

  remove(m: DroidMember) { const sw = this.fights[m.f].sw; if (sw.gen[m.i] === m.gen) sw.remove(m.i); }

  update(dt: number, prey: Prey) { for (const f of this.fights) f.update(dt, prey); }
}
