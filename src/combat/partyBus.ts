// The party bus's crew (Keith 2026-10-29): a big bus rides with the war band and, every so often within reach of the
// mech, brakes, throws its back door open and lets a wave of bandits out (the existing infantry swarm, its baked
// animation and AI: they run at the mech and shoot), up to a cap of its own alive at once, for as long as the bus
// lives. Kill the bus and the drops stop: a priority target. Pure sim, no drawing (the bus itself is a Raider in
// warband.ts; its lights and music are cosmetic there).
// Ownership: host state (the bus, its clock, who it dropped). Ids (rule 12): the bus `id` is stable (the band's id plus
// its place), each bandit it drops gets `<bus id>/b<n>` and keeps the swarm's own uid; the swarm picks spawn spots
// from its seeded generator, so a drop is repeatable.
import type { Param } from "../core/tweaks";
import { DEAD, type InfantrySwarm } from "./infantry";

export const BUS_DEFAULTS = {
  bandBuses: 1,
  busHull: 2600,
  busTopSpeed: 11,
  busWave: 6,
  busEvery: 9,
  busCap: 14,
  busDropFrom: 90,
  busStop: 2.6,
  busDoorAt: 0.9,
  busRing: 46,
  busMusic: 0.7,
};
export type BusValues = typeof BUS_DEFAULTS;

const G = "Party bus";
export const BUS_PARAMS: Param[] = [
  { key: "bandBuses", label: "Party buses per band", min: 0, max: 3, step: 1, group: G },
  { key: "busHull", label: "Bus: hit points", min: 50, max: 10000, step: 50, group: G, tip: "Tougher than any other raider vehicle but the War Rig: a priority target" },
  { key: "busTopSpeed", label: "Bus: top speed (m/s)", min: 2, max: 30, step: 0.5, group: G },
  { key: "busWave", label: "Bandits per drop", min: 1, max: 30, step: 1, group: G },
  { key: "busEvery", label: "A drop every (s)", min: 1, max: 60, step: 0.5, group: G },
  { key: "busCap", label: "Most of its bandits alive at once", min: 1, max: 60, step: 1, group: G, tip: "A drop only tops the bus's own bandits up to this" },
  { key: "busDropFrom", label: "Drops within (m) of the mech", min: 10, max: 300, step: 5, group: G },
  { key: "busStop", label: "Stops for (s)", min: 0.5, max: 8, step: 0.1, group: G, tip: "Brakes and stands with the door open: the moment to hit it" },
  { key: "busDoorAt", label: "Bandits out after (s)", min: 0, max: 4, step: 0.1, group: G, tip: "Time from braking to the bandits piling out of the back" },
  { key: "busRing", label: "Circles at (m)", min: 15, max: 120, step: 1, group: G, tip: "It hangs back on a wider circle than the gun trucks and never makes gun runs" },
  { key: "busMusic", label: "Music volume", min: 0, max: 2, step: 0.05, group: G },
];

/** Where the bus is this step (a plain snapshot of its car sim). */
export interface BusAt { x: number; z: number; heading: number; speed: number; half: number }

export class BusCrew {
  /** The bandits it has dropped that are still alive: swarm slot, the slot's generation then, and the stable id. */
  readonly slots: number[] = [];
  readonly gens: number[] = [];
  readonly ids: string[] = [];
  /** Seconds since the last drop (starts part way, so the first comes soon after it closes in). */
  clock: number;
  /** Seconds left of standing with the door open (the driver brakes while this is above 0). */
  stopping = 0;
  /** Bandits and drops so far. */
  dropped = 0;
  waves = 0;
  private dropDone = true;

  constructor(readonly id: string, v: BusValues) { this.clock = v.busEvery * 0.6; }

  /** Its bandits still alive (prunes the dead and the slots reused since). */
  alive(sw: InfantrySwarm): number {
    for (let k = this.slots.length - 1; k >= 0; k--) {
      const i = this.slots[k];
      if (sw.gen[i] !== this.gens[k] || sw.state[i] >= DEAD) { this.slots.splice(k, 1); this.gens.splice(k, 1); this.ids.splice(k, 1); }
    }
    return this.slots.length;
  }

  get braking() { return this.stopping > 0; }

  /**
   * One step. busAlive false (wrecked) or no swarm: nothing more, ever. dist: from the bus to whoever it hunts.
   * Returns the swarm slots of any bandits let out this step.
   */
  step(dt: number, v: BusValues, sw: InfantrySwarm | null, busAlive: boolean, fleeing: boolean, bus: BusAt, dist: number): number[] {
    if (!busAlive || !sw) { this.stopping = 0; this.dropDone = true; return NONE; }
    this.clock += dt;
    if (this.stopping > 0) {
      this.stopping -= dt;
      const opened = v.busStop - this.stopping >= v.busDoorAt;
      if (!this.dropDone && ((opened && Math.abs(bus.speed) < 2.5) || this.stopping <= 0)) { this.dropDone = true; return this.drop(v, sw, bus); }
      return NONE;
    }
    if (this.clock >= v.busEvery && dist <= v.busDropFrom && !fleeing && this.alive(sw) < Math.round(v.busCap)) {
      this.stopping = v.busStop; this.dropDone = false; this.clock = 0;
    }
    return NONE;
  }

  /** Out of the back door: tops its bandits up to the cap with at most a wave. */
  private drop(v: BusValues, sw: InfantrySwarm, bus: BusAt): number[] {
    const n = Math.min(Math.round(v.busWave), Math.round(v.busCap) - this.alive(sw));
    if (n <= 0) return NONE;
    const fx = Math.sin(bus.heading), fz = Math.cos(bus.heading), back = bus.half + 1.6;
    const made = sw.spawn(n, bus.x - fx * back, bus.z - fz * back, 1 + Math.sqrt(n) * 0.5);
    for (const i of made) {
      // Out of the door, running away from the bus at first.
      sw.heading[i] = bus.heading + Math.PI;
      this.slots.push(i); this.gens.push(sw.gen[i]); this.ids.push(`${this.id}/b${++this.dropped}`);
    }
    this.waves++;
    return made;
  }
}
const NONE: number[] = [];
