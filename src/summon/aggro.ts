// Enemies go for your summons (Keith 2026-11-03, via the coordinator: "make every enemy type ... target summons").
// Every enemy kind already takes one Prey per group (src/pilot/quarry.ts: the mech, or the pilot on foot); this puts the
// summoner's ground units into that pick: a group whose middle is within `summonAggro` of a summon, and that summon
// nearer to it than `summonLure` × its prey, goes for the summon instead. The summon is a Prey like the pilot: rounds
// resolve through the battlefield on whatever they hit, bites and saw strikes go to the summon itself (a replica's mech
// unit, a companion or scrapper on the allies' robot sim). Drones fly: only robots that shoot pick them (allies.ts
// aggroOnAllies, per robot). Dismissed summons draw nothing.
// Ownership: host (who enemies go for).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { Prey } from "../pilot/quarry";
import { DEAD, DOWN, MID } from "../combat/robots";
import type { Summons } from "./summons";

export const SUMMON_AGGRO_DEFAULTS = { summonAggro: 22, summonLure: 0.8 };
export type SummonAggroValues = typeof SUMMON_AGGRO_DEFAULTS;
const G = "Summons: enemies";
export const SUMMON_AGGRO_GROUPS = [G];
export const SUMMON_AGGRO_PARAMS: Param[] = [
  { key: "summonAggro", label: "Enemies turn on a summon within (m)", min: 0, max: 80, step: 1, group: G, tip: "An enemy group whose middle is this close to one of your ground summons may go for it instead of you (0: never)" },
  { key: "summonLure", label: "…when it's nearer than you ×", min: 0.1, max: 3, step: 0.05, group: G, tip: "The group goes for the summon while it's within this many times your distance from the group (1: whichever is nearer)" },
];

/** One of the allies' robots (a companion quad or a scrapper) as something to bite. */
class AllyUnit implements Hittable {
  readonly surface: HitSurface = "metal";
  team = 1;
  slot = -1;
  constructor(private s: Summons) {}
  get alive() { const sw = this.s.allies.sw; return this.slot >= 0 && sw.state[this.slot] < DOWN; }
  hitRay() { return -1; }
  damage(amount: number, at?: THREE.Vector3) {
    const sw = this.s.allies.sw, i = this.slot;
    if (!this.alive) return;
    const dx = sw.px[i] - (at?.x ?? sw.px[i]), dz = sw.pz[i] - (at?.z ?? sw.pz[i]), d = Math.hypot(dx, dz) || 1;
    sw.damage(i, amount, dx / d, dz / d);
  }
  splash() { return 0; }
}

export class SummonPrey {
  private replicaPrey: Prey;
  private allyPrey: Prey;
  private ally: AllyUnit;
  private allyAt = new THREE.Vector3(); private allyPos = new THREE.Vector3(); private allyVel = new THREE.Vector3();
  /** Times a group was turned onto a summon (HUD, checks). */
  turned = 0;

  constructor(private s: Summons, public v: SummonAggroValues) {
    this.ally = new AllyUnit(s);
    this.ally.team = s.team;
    const z = new THREE.Vector3();
    this.replicaPrey = { kind: "summon", alive: true, at: z, radius: 1.2, unit: this.ally, sim: { pelvis: z, pos: z, vel: z }, latchLow: 1.6, latchHigh: 3.6 };
    this.allyPrey = { kind: "summon", alive: true, at: this.allyAt, radius: 0.8, unit: this.ally, sim: { pelvis: this.allyAt, pos: this.allyPos, vel: this.allyVel }, latchLow: 0.2, latchHigh: 1.4 };
  }

  /** The prey for a group whose middle is at (x, z): `base` (the mech or pilot), or the summon it turns on. */
  pick(base: Prey, x: number, z: number): Prey {
    const v = this.v, s = this.s;
    if (!(v.summonAggro > 0) || !s.active) return base;
    const db = base.alive ? Math.hypot(base.at.x - x, base.at.z - z) : Infinity;
    const reach = Math.min(v.summonAggro, db * v.summonLure);
    let best = reach, rep: import("../game/mechUnit").MechUnit | null = null, slot = -1;
    for (const u of s.replicas?.units() ?? []) {
      const d = Math.hypot(u.sim.pos.x - x, u.sim.pos.z - z);
      if (d < best) { best = d; rep = u; }
    }
    const sw = s.allies.sw;
    for (let i = 0; i < sw.hi; i++) {
      if (sw.state[i] >= DOWN) continue;
      const d = Math.hypot(sw.px[i] - x, sw.pz[i] - z);
      if (d < best) { best = d; rep = null; slot = i; }
    }
    if (slot >= 0) {
      const p = this.allyPrey;
      this.ally.slot = slot;
      this.allyAt.set(sw.px[slot], sw.hubY[slot], sw.pz[slot]);
      this.allyPos.set(sw.px[slot], sw.py[slot], sw.pz[slot]);
      this.allyVel.set(sw.vx[slot], 0, sw.vz[slot]);
      p.radius = sw.kind[slot] === MID ? sw.size[slot] * 0.4 : 0.6;
      p.alive = sw.state[slot] < DEAD;
      this.turned++;
      return p;
    }
    if (rep) {
      const p = this.replicaPrey;
      p.at = rep.sim.pelvis; p.sim = rep.sim; p.unit = rep; p.alive = rep.alive; p.radius = rep.v.hitRadius + 0.3;
      this.turned++;
      return p;
    }
    return base;
  }
}
