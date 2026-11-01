// Humanoid robots on the battlefield (glue): the sim (src/combat/droids.ts), its drawer and its target together, the
// pulses resolved as rounds of the robots' team (only with a clear line, as the bandits), drawn as blue streaks with a
// zap, and the dead handed to the death physics as white ragdolls. One per lab or expedition; spawn squads into it.
// Ownership: host (the swarm, damage); the streaks, zaps and ragdolls are cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import type { DuneField } from "../world/terrain";
import type { BanditVatData } from "../combat/banditVat";
import { DroidSwarm, type DroidValues } from "../combat/droids";
import { DroidsDraw, droidRagdoll } from "../combat/droidsDraw";
import { InfantryTarget } from "../combat/infantryTarget";
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

  constructor(private bf: Battlefield, scene: THREE.Scene, d: DroidValues, field: DuneField, vat: BanditVatData | null, deaths: DeathPhysics | null, seed = 61) {
    this.sw = new DroidSwarm(d, field, seed);
    this.draw = new DroidsDraw(this.sw, vat);
    scene.add(this.draw.group);
    this.target = new InfantryTarget(this.sw, TEAM.robots, { name: "humanoid robots", surface: "metal", material: "cutter" });
    bf.targets.push(this.target);
    bf.register.add(this.target);
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
