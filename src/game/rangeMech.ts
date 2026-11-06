// A target mech for the weapons lab's range (Keith 2026-11-06: "on the right we had a mech moving up and down"): an
// enemy Rampart off to the mech's right walking back and forth along the range (up and down the screen), its torso
// always on the player, never firing. For tracking and lead on a mech-sized target with mech armour. Destroyed, its
// wreck falls and it stands up again where it was. Host-owned (a target); its paint and wreck are cosmetic.
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { MechUnit, type MechUnitValues } from "./mechUnit";
import type { Battlefield } from "./battlefield";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import type { TargetCandidate } from "./targeting";

export const RANGE_MECH_DEFAULTS = {
  moverOn: 1,
  moverX: -30,
  moverZ: 12,
  moverSpan: 18,
  moverPace: 0.6,
  moverSprint: 0,
  moverHull: 3000,
  moverArmour: 8,
  moverBack: 4,
};
export type RangeMechValues = typeof RANGE_MECH_DEFAULTS;

const G = "Target mech";
export const RANGE_MECH_PARAMS: Param[] = [
  { key: "moverOn", label: "On (0-1)", min: 0, max: 1, step: 1, group: G },
  { key: "moverX", label: "Across (m, − right)", min: -60, max: 60, step: 1, group: G },
  { key: "moverZ", label: "Centre of its walk ahead (m)", min: -20, max: 80, step: 1, group: G },
  { key: "moverSpan", label: "Walks this far each way (m)", min: 0, max: 50, step: 1, group: G },
  { key: "moverPace", label: "Pace (share of a walk)", min: 0, max: 1, step: 0.05, group: G, tip: "1: the legs' full walk, 6 m/s" },
  { key: "moverSprint", label: "Sprint (0-1)", min: 0, max: 1, step: 1, group: G },
  { key: "moverHull", label: "Hull", min: 100, max: 20000, step: 100, group: G },
  { key: "moverArmour", label: "Armour", min: 0, max: 30, step: 0.5, group: G, tip: "Flat armour per hit; a rival mech's is 8" },
  { key: "moverBack", label: "Stands up again after (s)", min: 0.5, max: 30, step: 0.5, group: G },
];

export class RangeMech {
  unit: MechUnit | null = null;
  private dir = 1;
  private wasAlive = true;
  kills = 0;

  constructor(private bf: Battlefield, private v: MechUnitValues & RangeMechValues) {}

  async load(loadBody: () => Promise<RampartBody>, look: ToonLook, scene: THREE.Object3D) {
    const body = await loadBody();
    scene.add(body.root);
    const u = new MechUnit(this.bf, this.v, body, look, 2, 40, false);
    u.uid = "range-mech";
    u.paint = 0x9a5b3c;
    body.paint(look, u.paint);
    this.unit = u;
    this.place();
    this.bf.targets.push(u);
  }

  /** Put it back at the middle of its walk with a full hull. */
  place() {
    const u = this.unit;
    if (!u) return;
    u.hullOverride = Math.round(this.v.moverHull);
    u.armourOverride = this.v.moverArmour;
    u.reset(this.v.moverX, this.v.moverZ, 0);
    this.dir = 1;
  }

  /** The mechs for the register (none while it's off). */
  list(): MechUnit[] { return this.unit && this.v.moverOn > 0 ? [this.unit] : []; }

  update(dt: number, foe: { x: number; y: number; z: number }) {
    const u = this.unit, v = this.v;
    if (!u) return;
    u.body.root.visible = v.moverOn > 0;
    if (v.moverOn <= 0) return;
    u.hullOverride = Math.round(v.moverHull);
    u.armourOverride = v.moverArmour;
    if (this.wasAlive && !u.alive) this.kills++;
    this.wasAlive = u.alive;
    if (!u.alive) {
      if (u.deadFor > v.moverBack) this.place();
      else u.step(dt, { x: 0, z: 0, sprint: false }, null, false);
      return;
    }
    const z = u.sim.pos.z;
    if (z > v.moverZ + v.moverSpan) this.dir = -1;
    else if (z < v.moverZ - v.moverSpan) this.dir = 1;
    // Drifted off its line (shoved): steer back onto it.
    const back = Math.max(-0.5, Math.min(0.5, (v.moverX - u.sim.pos.x) * 0.2));
    u.step(dt, { x: back * v.moverPace, z: this.dir * v.moverPace, sprint: v.moverSprint > 0 }, foe, false);
  }

  /** The demo's lock on it, led by its walk. */
  lock(): TargetCandidate | null {
    const u = this.unit;
    if (!u || !u.alive || this.v.moverOn <= 0) return null;
    const p = u.sim.pelvis;
    return { x: p.x, y: p.y + 0.6, z: p.z, r: this.v.hitRadius, key: u, vx: u.sim.vel.x, vz: u.sim.vel.z };
  }
}
