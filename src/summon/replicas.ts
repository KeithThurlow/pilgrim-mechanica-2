// Mech replicas (Keith 2026-11-02: "something that looks more like a robotic mech, roughly the same size and
// proportions as the player's mech, but very clearly thin and robotic. Lighter. And when you sprint, it would sprint
// with you"). The second kind of companion beside the turret quads (allies.ts). Glue: its own model
// (replicaBody.ts: your own mech slimmed, Keith 2026-11-03; each built with rockets or miniguns at random, Keith 2026-11-02), on the
// owner's walk values, on the owner's team, with a small hit size and a soft body (the owner walks through it and it's
// nudged aside; enemy mechs still bump it), each built with miniguns or a rocket rack (seeded roll), and a brain like the convoy's guardians (src/convoy/guardians.ts): it walks a station at the owner's flank,
// turns on the owner's lock or the nearest foe in reach, stepping out to holding range but never past the leash, and
// fires its miniguns. When the owner sprints it dashes and sprints too (its own energy bars), and runs to catch up when
// it's fallen behind. Destroyed, a new one walks out after `repRebuild` s.
// Ownership: host (health, brains; enemies' rounds hit them). Not networked yet.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import { MechUnit, type MechUnitValues } from "../game/mechUnit";
import { FLAG, type Filter } from "../game/register";
import { mechOwner } from "../game/registerOwners";
import type { ToonLook } from "../look/toon";
import { ReplicaBody, type ReplicaWeapon } from "./replicaBody";

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
  repBuild: 6,
  repHitSize: 0.9,
  repBodySize: 1.1,
  repRocketShare: 0.5,
  repRocketDamage: 30,
  repRocketVolley: 4,
  repRocketRate: 0.18,
  repRocketPause: 3,
  repRocketRadius: 2.5,
  repRocketArc: 3,
  repRocketSpeed: 26,
  repRocketScatter: 2,
  repLegThin: 0.55,
  repFootSize: 0.8,
  repHullW: 0.62,
  repHullH: 0.8,
  repHullL: 0.85,
  repGunSize: 0.72,
  repShade: 0.6,
};
export type ReplicaValues = typeof REPLICA_DEFAULTS;

const G = "Mech replicas", GR = "Mech replicas: rockets", GL = "Mech replicas: look";
export const REPLICA_GROUPS = [G, GR, GL];
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
  { key: "repRebuild", label: "Rebuilt after (s)", min: 1, max: 180, step: 1, group: G, tip: "A destroyed replica walks out again this long after" },
  { key: "repBuild", label: "Builds one every (s)", min: 0, max: 60, step: 0.5, group: G, tip: "Keith 2026-11-02: replicas come out of the pack over time. Out on the sand (or summoned again after the convoy), a missing one walks out this often, one at a time" },
  { key: "repHitSize", label: "Hit size (m)", min: 0.3, max: 3, step: 0.05, group: G, tip: "Radius of the capsule enemy rounds hit (your mech's is 1.7)" },
  { key: "repBodySize", label: "Body size (m)", min: 0.3, max: 4, step: 0.05, group: G, tip: "The pillbox enemy mechs bump into; you walk through them either way (Body collisions › Summons give way)" },
  { key: "repRocketShare", label: "Built with rockets (share)", min: 0, max: 1, step: 0.05, group: GR, tip: "Each replica rolls minigun or rockets when it's built: 0 all miniguns, 1 all rockets" },
  { key: "repRocketDamage", label: "Damage each", min: 0, max: 300, step: 1, group: GR },
  { key: "repRocketVolley", label: "Rockets a volley", min: 1, max: 16, step: 1, group: GR },
  { key: "repRocketRate", label: "One every (s)", min: 0.03, max: 1, step: 0.01, group: GR },
  { key: "repRocketPause", label: "Pause between volleys (s)", min: 0.2, max: 15, step: 0.1, group: GR },
  { key: "repRocketRadius", label: "Blast radius (m)", min: 0.5, max: 8, step: 0.1, group: GR },
  { key: "repRocketArc", label: "Arc height (m)", min: 0, max: 20, step: 0.5, group: GR },
  { key: "repRocketSpeed", label: "Speed (m/s)", min: 5, max: 80, step: 1, group: GR },
  { key: "repRocketScatter", label: "Scatter (m)", min: 0, max: 8, step: 0.1, group: GR },
  // Keith 2026-11-03: your own mech, slimmed: no pilot to carry, so thinner legs, a narrow hull, lighter guns.
  { key: "repLegThin", label: "Legs: thickness ×", min: 0.2, max: 1.2, step: 0.01, group: GL, tip: "The Rampart's legs, this much as thick (their length is the walk's)" },
  { key: "repFootSize", label: "Feet ×", min: 0.3, max: 1.2, step: 0.01, group: GL },
  { key: "repHullW", label: "Hull: width ×", min: 0.3, max: 1.2, step: 0.01, group: GL, tip: "The guns and sockets come in with the hull's sides" },
  { key: "repHullH", label: "Hull: height ×", min: 0.3, max: 1.2, step: 0.01, group: GL },
  { key: "repHullL", label: "Hull: length ×", min: 0.3, max: 1.2, step: 0.01, group: GL },
  { key: "repGunSize", label: "Guns ×", min: 0.3, max: 1.2, step: 0.01, group: GL },
  { key: "repShade", label: "Paint: pale steel (0: your mech's paint)", min: 0, max: 1, step: 0.01, group: GL },
];


interface Replica { unit: MechUnit; body: ReplicaBody; on: boolean; builds: number; clock: number; left: number; side: 1 | -1 }

/** How wide a replica is to the convoy's cars (m), and how far ahead and how finely it looks for one in its way. */
const BLOCK_R = 2.2, DETOUR_LOOK = 24, DETOUR_STEP = 2;

/** A seeded 0..1 from integers (the weapon roll, rocket scatter). */
function hash01(a: number, b: number, c = 0) {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x7f4a7c15, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export class Replicas {
  readonly list: Replica[] = [];
  private aim = { x: 0, y: 0, z: 0 };
  private near: number[] = [];
  private filter: Filter;
  private wasBound = false;

  private from = new THREE.Vector3();
  private buildClock = 0;
  /** Seconds until the next one walks out (0: none waiting; the action bar). */
  building = 0;
  /** Solid things replicas walk round (the convoy lab: its cars and the plough): (x, z) pushed out of them for a body
   *  of radius r, or null when clear. */
  blockers: ((x: number, z: number, r: number) => { x: number; z: number } | null) | null = null;

  /** The first blocked point on the way from (x, z) to (gx, gz), pushed out past the edge (a waypoint), or null. */
  private detour(x: number, z: number, gx: number, gz: number): { x: number; z: number } | null {
    const dx = gx - x, dz = gz - z, d = Math.hypot(dx, dz);
    if (d < 1) return null;
    for (let t = DETOUR_STEP; t < Math.min(d, DETOUR_LOOK); t += DETOUR_STEP) {
      const px = x + (dx / d) * t, pz = z + (dz / d) * t;
      const o = this.blockers!(px, pz, BLOCK_R + 1.5);
      if (o) return o;
    }
    return null;
  }
  private shots = 0;

  constructor(private bf: Battlefield, private scene: THREE.Object3D, readonly v: MechUnitValues & ReplicaValues, private look: ToonLook,
    private owner: MechUnit, enemies: Filter, private seed = 1) {
    this.filter = { ...enemies, none: (enemies.none ?? 0) | FLAG.Asleep | FLAG.Down };
    bf.register.add(mechOwner("replicas", () => this.units()));
  }

  /** Live ones on the field. */
  units(): MechUnit[] { return this.list.filter((r) => r.on && r.unit.alive).map((r) => r.unit); }

  private add() {
    const body = new ReplicaBody(this.look);
    this.scene.add(body.root);
    const k = this.list.length;
    // Its own values: the owner's walk and guns, a small hit and body size.
    const v = { ...this.v } as MechUnitValues & ReplicaValues;
    const unit = new MechUnit(this.bf, v, body, this.look, this.owner.team, 30 + k * 2, false);
    unit.uid = `replica:${k}`;
    unit.ally = true;
    unit.softSolid = true;
    body.root.visible = false;
    this.list.push({ unit, body, on: false, builds: 0, clock: 0, left: 0, side: 1 });
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
    // Built with miniguns or rockets: a seeded roll per build.
    const w: ReplicaWeapon = hash01(this.seed, k, r.builds++) < this.v.repRocketShare ? "rockets" : "minigun";
    r.body.setWeapon(w);
    r.clock = 0; r.left = 0;
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

  private tune(u: MechUnit) {
    u.hullOverride = this.v.repHull; u.armourOverride = this.v.repArmour; u.damageScale = this.v.repDamage;
    // Walk and guns follow the shared sliders; size is its own.
    Object.assign(u.v, this.v);
    u.v.hitRadius = this.v.repHitSize; u.v.bodyRadius = this.v.repBodySize; u.v.trample = 1;
  }

  /** A rocket replica's volleys: after the pause, `repRocketVolley` rockets, alternating sides, lobbed at the foe. */
  private rockets(r: Replica, k: number, dt: number, has: boolean, fx: number, fz: number, dist: number) {
    const v = this.v, u = r.unit;
    r.clock += dt;
    if (r.left <= 0) {
      if (!has || dist > u.v.range + 10 || r.clock < v.repRocketPause) return;
      r.left = Math.max(1, Math.round(v.repRocketVolley)); r.clock = v.repRocketRate;
    }
    while (r.left > 0 && r.clock >= v.repRocketRate) {
      r.clock -= v.repRocketRate; r.left--;
      if (!has) { r.left = 0; break; }
      r.side = r.side === 1 ? -1 : 1;
      const n = this.shots++, a = hash01(this.seed, k * 977 + 13, n) * Math.PI * 2, d = Math.sqrt(hash01(this.seed, k * 977 + 29, n)) * v.repRocketScatter;
      r.body.muzzle(r.side, this.from);
      const tx = fx + Math.cos(a) * d, tz = fz + Math.sin(a) * d;
      const flight = Math.max(0.3, Math.hypot(tx - this.from.x, tz - this.from.z) / Math.max(1, v.repRocketSpeed));
      this.bf.lob(this.owner.team, this.from, tx, tz, flight, v.repRocketArc, v.repRocketRadius, v.repRocketDamage);
    }
  }

  update(dt: number) {
    const v = this.v, o = this.owner, want = Math.max(0, Math.min(4, Math.round(v.repCount)));
    while (this.list.length < want) this.add();
    const reg = this.bf.register, P = o.sim.pos, st = { x: 0, z: 0 };
    // The owner's lock (inside reach), and the foes round the owner.
    const L = o.lock, lockIn = !!L && Math.hypot(L.x - P.x, L.z - P.z) <= v.repEngage;
    this.near.length = 0;
    reg.near(P.x, P.z, v.repEngage, this.filter, this.near);
    const sprinting = o.bound.on, sprintStart = sprinting && !this.wasBound;
    this.wasBound = sprinting;
    let built = false, waiting = false;
    this.buildClock += dt;
    this.list.forEach((r, k) => {
      if (k >= want) { if (r.on) this.off(r); return; }
      const u = r.unit;
      // Built one at a time, `repBuild` s apart.
      if (!r.on) { if (o.alive && !built && this.buildClock >= v.repBuild) { this.place(r, k); this.buildClock = 0; built = true; } else waiting = true; return; }
      this.tune(u);
      r.body.setLook(v);
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
      // Round anything solid in the way (the convoy's cars): the goal moved out of it, and a waypoint off the edge of
      // the first one on the straight line there.
      if (this.blockers) {
        const g = this.blockers(gx, gz, BLOCK_R);
        if (g) { gx = g.x; gz = g.z; }
        const w = this.detour(p.x, p.z, gx, gz);
        if (w) { gx = w.x; gz = w.z; }
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
      const rockets = r.body.weapon === "rockets";
      u.step(dt, { x: mx, z: mz, sprint: !has && off > v.repCatchUp }, has ? this.aim : null, !rockets && has && dist < u.v.range + 4);
      if (rockets) this.rockets(r, k, dt, has, fx, fz, dist);
      // Never inside a car.
      const out = this.blockers?.(u.sim.pos.x, u.sim.pos.z, BLOCK_R);
      if (out) { u.sim.pos.x = out.x; u.sim.pos.z = out.z; }
    });
    if (!waiting) this.buildClock = 0;
    this.building = waiting ? Math.max(0, v.repBuild - this.buildClock) : 0;
  }

  /** Every replica on the field and alive: where it is and its radius (for enemies to turn on). */
  each(fn: (x: number, y: number, z: number, r: number) => void) {
    for (const r of this.list) if (r.on && r.unit.alive) { const p = r.unit.sim.pelvis; fn(p.x, p.y, p.z, r.unit.v.hitRadius); }
  }

  /** Their meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.list.filter((r) => r.on).map((r) => r.body.root); }

  hud(): string {
    const up = this.units(), rk = this.list.filter((r) => r.on && r.unit.alive && r.body.weapon === "rockets").length;
    return want(this.v.repCount) ? ` · replicas ${up.length}/${want(this.v.repCount)} (${up.length - rk} minigun, ${rk} rockets)` : "";
  }
}
const want = (n: number) => Math.max(0, Math.min(4, Math.round(n)));
