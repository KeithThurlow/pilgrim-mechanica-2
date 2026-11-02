// Mech replicas (Keith 2026-11-02: "something that looks more like a robotic mech, roughly the same size and
// proportions as the player's mech, but very clearly thin and robotic. Lighter. And when you sprint, it would sprint
// with you"). The second kind of companion beside the turret quads (allies.ts). Glue: Ramparts on the stilt legs and the
// light Cuirass hull, painted pale robot steel, on the owner's team, each with its own walk values (the stilt legs'
// shape) and a brain like the convoy's guardians (src/convoy/guardians.ts): it walks a station at the owner's flank,
// turns on the owner's lock or the nearest foe in reach, stepping out to holding range but never past the leash, and
// fires its miniguns. When the owner sprints it dashes and sprints too (its own energy bars), and runs to catch up when
// it's fallen behind. Destroyed, a new one walks out after `repRebuild` s. Bodies load in the background.
// Ownership: host (health, brains; enemies' rounds hit them). Not networked yet.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import { MechUnit, type MechUnitValues } from "../game/mechUnit";
import { FLAG, type Filter } from "../game/register";
import { mechOwner } from "../game/registerOwners";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import { legShape, LEG_SHAPE_KEYS } from "../mech/legTypes";
import type { WalkerValues } from "../mech/walkerTuning";

export const REPLICA_DEFAULTS = {
  repCount: 2,
  repHull: 2200,
  repArmour: 4,
  repDamage: 0.6,
  repEngage: 40,
  repHold: 18,
  repLeash: 45,
  repSide: 9,
  repBack: 2,
  repCatchUp: 12,
  repRebuild: 20,
};
export type ReplicaValues = typeof REPLICA_DEFAULTS;

const G = "Mech replicas";
export const REPLICA_GROUPS = [G];
export const REPLICA_PARAMS: Param[] = [
  { key: "repCount", label: "Mech replicas", min: 0, max: 4, step: 1, group: G, tip: "Thin robot copies of your mech on stilt legs, walking at your flanks" },
  { key: "repHull", label: "Hit points", min: 100, max: 20000, step: 100, group: G },
  { key: "repArmour", label: "Armour", min: 0, max: 40, step: 0.5, group: G },
  { key: "repDamage", label: "Damage ×", min: 0, max: 5, step: 0.05, group: G, tip: "On their miniguns' rounds (the shared minigun sliders)" },
  { key: "repEngage", label: "Picks foes within (m of you)", min: 5, max: 150, step: 1, group: G },
  { key: "repHold", label: "Holds off a foe at (m)", min: 3, max: 60, step: 1, group: G },
  { key: "repLeash", label: "Never further than (m from you)", min: 10, max: 150, step: 1, group: G },
  { key: "repSide", label: "Walks this far to the side (m)", min: 3, max: 30, step: 0.5, group: G },
  { key: "repBack", label: "And this far behind (m)", min: -10, max: 20, step: 0.5, group: G },
  { key: "repCatchUp", label: "Runs to catch up past (m off its spot)", min: 2, max: 60, step: 1, group: G },
  { key: "repRebuild", label: "Rebuilt after (s)", min: 1, max: 180, step: 1, group: G },
];

/** Their paint: pale robot steel. */
export const REPLICA_PAINT = 0xc7d0d4;
/** The look they wear (legs and hull): the stilt legs and the Cuirass's light hull. */
const LOOK = "rampart-stilt";

interface Replica { unit: MechUnit; body: RampartBody; on: boolean }

export class Replicas {
  readonly list: Replica[] = [];
  private loading = false;
  private aim = { x: 0, y: 0, z: 0 };
  private near: number[] = [];
  private filter: Filter;
  private wasBound = false;

  constructor(private bf: Battlefield, private scene: THREE.Object3D, readonly v: MechUnitValues & ReplicaValues, private look: ToonLook,
    private load: () => Promise<RampartBody>, private owner: MechUnit, enemies: Filter) {
    this.filter = { ...enemies, none: (enemies.none ?? 0) | FLAG.Asleep | FLAG.Down };
    bf.register.add(mechOwner("replicas", () => this.units()));
  }

  /** Live ones on the field. */
  units(): MechUnit[] { return this.list.filter((r) => r.on && r.unit.alive).map((r) => r.unit); }

  private async add() {
    this.loading = true;
    try {
      const body = await this.load();
      this.scene.add(body.root);
      const k = this.list.length;
      // Its own values: the shared ones with the stilt legs' walk over them.
      const v = { ...this.v } as MechUnitValues & ReplicaValues;
      const base = Object.fromEntries(LEG_SHAPE_KEYS.filter((key) => key in v).map((key) => [key, (v as unknown as Record<string, number>)[key]])) as Partial<WalkerValues>;
      if (body.setLooks(LOOK, LOOK)) Object.assign(v, legShape(LOOK, base), body.legValues());
      const unit = new MechUnit(this.bf, v, body, this.look, this.owner.team, 30 + k * 2, false);
      unit.uid = `replica:${k}`;
      unit.ally = true;
      unit.paint = REPLICA_PAINT;
      this.list.push({ unit, body, on: false });
      this.place(this.list[k], k);
    } catch (e) { console.warn("replica body not loaded:", e); this.v.repCount = this.list.length; }
    this.loading = false;
  }

  /** Station k at the owner's flank: alternating sides, the second pair further out. */
  private station(k: number, out: { x: number; z: number }) {
    const o = this.owner.sim, H = o.heading, fx = Math.sin(H), fz = Math.cos(H), lx = Math.cos(H), lz = -Math.sin(H);
    const side = k % 2 ? -1 : 1, d = this.v.repSide * (1 + Math.floor(k / 2) * 0.7);
    out.x = o.pos.x + lx * side * d - fx * this.v.repBack + o.vel.x * 0.4;
    out.z = o.pos.z + lz * side * d - fz * this.v.repBack + o.vel.z * 0.4;
    return out;
  }

  private place(r: Replica, k: number) {
    const u = r.unit, s = this.station(k, { x: 0, z: 0 });
    this.tune(u);
    u.reset(s.x, s.z, this.owner.sim.heading);
    u.upper.resupply();
    r.body.root.visible = true;
    r.on = true;
    if (!this.bf.targets.includes(u)) this.bf.targets.push(u);
  }

  private off(r: Replica) {
    r.on = false;
    r.unit.goCold();
    r.body.root.visible = false;
    const i = this.bf.targets.indexOf(r.unit);
    if (i >= 0) this.bf.targets.splice(i, 1);
  }

  private tune(u: MechUnit) { u.hullOverride = this.v.repHull; u.armourOverride = this.v.repArmour; u.damageScale = this.v.repDamage; }

  update(dt: number) {
    const v = this.v, o = this.owner, want = Math.max(0, Math.min(4, Math.round(v.repCount)));
    if (this.list.length < want && !this.loading) void this.add();
    const reg = this.bf.register, P = o.sim.pos, st = { x: 0, z: 0 };
    // The owner's lock (inside reach), and the foes round the owner.
    const L = o.lock, lockIn = !!L && Math.hypot(L.x - P.x, L.z - P.z) <= v.repEngage;
    this.near.length = 0;
    reg.near(P.x, P.z, v.repEngage, this.filter, this.near);
    const sprinting = o.bound.on, sprintStart = sprinting && !this.wasBound;
    this.wasBound = sprinting;
    this.list.forEach((r, k) => {
      if (k >= want) { if (r.on) this.off(r); return; }
      const u = r.unit;
      if (!r.on) { if (o.alive) this.place(r, k); return; }
      this.tune(u);
      if (!u.alive) {
        u.step(dt, { x: 0, z: 0, sprint: false }, null, false);
        if (u.deadFor > v.repRebuild && o.alive) this.place(r, k);
        return;
      }
      const p = u.sim.pelvis;
      this.station(k, st);
      // Its foe: the lock, else the nearest one to it in reach; none while it's past the leash.
      let fx = 0, fy = 0, fz = 0, has = false;
      const far = Math.hypot(p.x - P.x, p.z - P.z) > v.repLeash;
      if (o.alive && !far && !sprinting) {
        if (lockIn) { fx = L!.x; fy = L!.y; fz = L!.z; has = true; }
        else {
          let bd = Infinity;
          for (const e of this.near) { const d = (reg.x[e] - p.x) ** 2 + (reg.z[e] - p.z) ** 2; if (d < bd) { bd = d; fx = reg.x[e]; fy = reg.y[e]; fz = reg.z[e]; has = true; } }
        }
      }
      // Where to stand: its station, or out to holding range of the foe, leashed to the owner.
      let gx = st.x, gz = st.z;
      if (has) {
        const dx = fx - p.x, dz = fz - p.z, d = Math.hypot(dx, dz) || 1;
        gx = fx - (dx / d) * v.repHold; gz = fz - (dz / d) * v.repHold;
        const lx = gx - P.x, lz = gz - P.z, l = Math.hypot(lx, lz);
        if (l > v.repLeash) { gx = P.x + (lx / l) * v.repLeash; gz = P.z + (lz / l) * v.repLeash; }
      }
      const walk = Math.max(1, u.v.walkSpeed);
      let mx = (gx - p.x) / 5 + o.sim.vel.x / walk, mz = (gz - p.z) / 5 + o.sim.vel.z / walk;
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      if (ml < 0.05) { mx = 0; mz = 0; }
      const off = Math.hypot(gx - p.x, gz - p.z);
      // Sprinting with the owner: a dash into the sprint, held while the owner holds it.
      if (sprintStart && !u.bound.on) u.tryDash(ml > 0.05 ? mx : Math.sin(o.sim.heading), ml > 0.05 ? mz : Math.cos(o.sim.heading));
      u.dashHold = sprinting;
      if (has) this.aim.x = fx, this.aim.y = fy, this.aim.z = fz;
      const dist = has ? Math.hypot(fx - p.x, fz - p.z) : Infinity;
      u.step(dt, { x: mx, z: mz, sprint: !has && off > v.repCatchUp }, has ? this.aim : null, has && dist < u.v.range + 4);
    });
  }

  /** Every replica on the field and alive: where it is and its radius (for enemies to turn on). */
  each(fn: (x: number, y: number, z: number, r: number) => void) {
    for (const r of this.list) if (r.on && r.unit.alive) { const p = r.unit.sim.pelvis; fn(p.x, p.y, p.z, r.unit.v.hitRadius); }
  }

  /** Their meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.list.filter((r) => r.on).map((r) => r.body.root); }

  hud(): string {
    const up = this.units().length;
    return want(this.v.repCount) ? ` · replicas ${up}/${want(this.v.repCount)}` : "";
  }
}
const want = (n: number) => Math.max(0, Math.min(4, Math.round(n)));
