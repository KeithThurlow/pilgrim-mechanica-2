// Who the enemies go for (Keith 2026-10-26: enemies attack a parked mech, and the pilot, who is very vulnerable).
// The enemy sims each take one target per update (robots.ts, infantry.ts, warband.ts); rather than change how they
// think, the labs hand them a Prey picked here: the mech, or the pilot on foot when he's closer (or nearly as close:
// pilotLure) to the group, or the only one left. Rounds then resolve on whatever they hit (the pilot is a Hittable on
// the player's team), so a burst at the pilot can still hit the parked mech standing in the way.
// Ownership (multiplayer later): the host's (who enemies go for, and damage).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable } from "../game/battlefield";
import { rayCapsule, type MechUnit } from "../game/mechUnit";
import type { HitSurface } from "../fx/minigun";
import type { PilotSim, PilotValues } from "./pilot";

export const QUARRY_DEFAULTS = {
  pilotLure: 1.6,
  pilotHurt: 1,
  pilotNotice: 0.5,
};
export type QuarryValues = typeof QUARRY_DEFAULTS;
const G = "Pilot: enemies";
export const QUARRY_PARAMS: Param[] = [
  { key: "pilotLure", label: "Enemies prefer the pilot ×", min: 0.2, max: 5, step: 0.05, group: G, tip: "A group goes for the pilot over the mech while he's within this many times the mech's distance from it" },
  { key: "pilotHurt", label: "Damage to the pilot ×", min: 0, max: 5, step: 0.05, group: G, tip: "On top of what each attack does to a mech" },
  { key: "pilotNotice", label: "Pilot noticed within (× wake range)", min: 0, max: 2, step: 0.05, group: G, tip: "A sleeping swarm camp wakes for a pilot on foot this much closer than for the mech" },
];

/** What an enemy group goes for this frame. */
export interface Prey {
  kind: "mech" | "pilot";
  alive: boolean;
  /** Where to shoot (the hull, or the pilot's chest). */
  at: THREE.Vector3;
  /** Body radius (robots keep this far off it; latch rings round it). */
  radius: number;
  /** For the war band's drivers and gunners (the MechUnit shape): aim point, ground position, velocity. */
  sim: { pelvis: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3 };
  /** Takes the bites and saw strikes (rounds and blasts resolve through the battlefield). */
  unit: Hittable;
  /** Robots cling to the mech this high (m above the ground); on the pilot, lower. */
  latchLow?: number;
  latchHigh?: number;
}

/** The pilot as something to shoot: a capsule from his feet to his head, on the player's team. */
export class PilotUnit implements Hittable {
  team = 1;
  surface: HitSurface = "flesh";
  /** Counted only while he's on foot (the lab says). */
  exposed = false;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  /** Called when he's hit (the lab flashes the screen, plays a grunt). */
  onHit: ((amount: number) => void) | null = null;

  constructor(readonly sim: PilotSim, public v: PilotValues & QuarryValues) {}

  get alive() { return this.exposed && this.sim.alive; }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    if (!this.alive) return -1;
    const p = this.sim.pos, r = this.v.pilotRadius + 0.1;
    this.a.set(p.x, p.y + r, p.z); this.b.set(p.x, p.y + this.v.pilotHeight - r, p.z);
    return rayCapsule(o, d, this.a, this.b, r, maxDist);
  }

  damage(amount: number) {
    if (!this.alive) return;
    const k = amount * this.v.pilotHurt;
    this.sim.damage(k);
    this.onHit?.(k);
  }

  splash(at: THREE.Vector3, radius: number, damage: number) {
    if (!this.alive) return 0;
    const p = this.sim.pos, y = Math.min(Math.max(at.y, p.y), p.y + this.v.pilotHeight);
    const d = Math.max(0, Math.hypot(at.x - p.x, at.y - y, at.z - p.z) - this.v.pilotRadius);
    if (d > radius) return 0;
    this.damage(damage * (1 - 0.5 * d / Math.max(0.01, radius)));
    return 1;
  }

  readonly material = "flesh" as const;
}

/** Picks the mech or the pilot for each enemy group. */
export class Quarry {
  readonly mechPrey: Prey;
  readonly pilotPrey: Prey;
  private pilotAt = new THREE.Vector3();
  private pilotPos = new THREE.Vector3();
  private pilotVel = new THREE.Vector3();
  private mechAt = new THREE.Vector3();

  constructor(readonly mech: MechUnit, readonly pilot: PilotUnit, public v: PilotValues & QuarryValues) {
    const m = mech;
    this.mechPrey = {
      kind: "mech", alive: true, at: this.mechAt, radius: 2, unit: m,
      sim: { pelvis: this.mechAt, pos: m.sim.pos, vel: m.sim.vel },
    };
    this.pilotPrey = {
      kind: "pilot", alive: false, at: this.pilotAt, radius: 0.45, unit: pilot,
      sim: { pelvis: this.pilotAt, pos: this.pilotPos, vel: this.pilotVel }, latchLow: 0.2, latchHigh: 1.3,
    };
  }

  /** Refresh both preys' positions (each frame, before the enemies step). */
  update() {
    const p = this.mech.sim.pelvis, s = this.pilot.sim;
    this.mechAt.copy(p);
    this.mechPrey.alive = this.mech.alive;
    this.pilotPos.set(s.pos.x, s.pos.y, s.pos.z);
    this.pilotAt.set(s.pos.x, s.pos.y + this.v.pilotHeight * 0.65, s.pos.z);
    this.pilotVel.set(s.worldVel.x, 0, s.worldVel.z);
    this.pilotPrey.alive = this.pilot.alive;
  }

  /** The pilot is out and alive. */
  get pilotOut() { return this.pilot.alive; }

  /** The prey for a group whose middle is at (x, z): the pilot when he's out and near enough, else the mech. */
  pick(x: number, z: number): Prey {
    const m = this.mechPrey, p = this.pilotPrey;
    if (!p.alive) return m;
    if (!m.alive) return p;
    const dm = Math.hypot(m.at.x - x, m.at.z - z), dp = Math.hypot(p.at.x - x, p.at.z - z);
    return dp <= dm * this.v.pilotLure ? p : m;
  }
}
