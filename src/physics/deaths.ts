// Death physics (Keith 2026-10-24: kills should physically affect the world). One Rapier world holds only what has
// died: bandit ragdolls, robot ragdolls and vehicle wrecks. The living stay on their own sims, so nothing about
// walking, driving or swarming changes or slows down. The dune floor is a Rapier heightfield built from the same
// height function, following the camera. Each death is handed over with its speed plus the push of what killed it;
// after liveFor seconds, or when more than maxRagdolls are live, the oldest is frozen (taken out of the world, its
// last pose kept) and later sinks into the sand and is cleared.
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const DEATH_DEFAULTS = {
  deathPush: 1,
  deathLift: 0.5,
  deathSpin: 1,
  jointDamping: 2,
  liveFor: 7,
  maxRagdolls: 40,
  bodyStays: 14,
  floorSize: 120,
};
export type DeathValues = typeof DEATH_DEFAULTS;

export const DEATH_PARAMS: Param[] = [
  { key: "deathPush", label: "Kill push ×", min: 0, max: 4, step: 0.05, group: "Death physics", tip: "How hard the killing round, blast or stomp throws the body" },
  { key: "deathLift", label: "Kill lift ×", min: 0, max: 3, step: 0.05, group: "Death physics", tip: "Share of the push that throws it upward" },
  { key: "deathSpin", label: "Kill spin ×", min: 0, max: 4, step: 0.05, group: "Death physics" },
  { key: "jointDamping", label: "Limb floppiness (damping)", min: 0, max: 20, step: 0.1, group: "Death physics", tip: "Higher: limbs swing less and settle sooner" },
  { key: "liveFor", label: "Bodies move for (s)", min: 1, max: 30, step: 0.5, group: "Death physics", tip: "Then they freeze where they lie" },
  { key: "maxRagdolls", label: "Moving bodies at once", min: 1, max: 200, step: 1, group: "Death physics", tip: "Past this the oldest freeze (the cost of the physics)" },
  { key: "bodyStays", label: "Bodies stay (s)", min: 2, max: 120, step: 1, group: "Death physics", tip: "Then they sink into the sand and are cleared" },
  { key: "floorSize", label: "Physics floor (m)", min: 40, max: 300, step: 10, group: "Death physics", tip: "Size of the patch of dunes the physics knows, centred on the camera" },
];

/** A box part in a body's own frame (origin at its feet, facing +Z). */
export interface PartSpec { half: [number, number, number]; at: [number, number, number]; color: number; mass?: number }
/** A joint between parts a and b at a point in the body's own frame; hinge: about this axis with limits. */
export interface JointSpec { a: number; b: number; at: [number, number, number]; hinge?: [number, number, number]; limits?: [number, number] }

export interface Dead {
  parts: PartSpec[];
  bodies: RAPIER.RigidBody[];
  joints: RAPIER.ImpulseJoint[];
  /** World transforms per part (live from the bodies, frozen after). */
  pos: Vector3[];
  quat: Quaternion[];
  age: number;
  live: boolean;
  /** Vehicles are drawn by their own body: the physics only moves sim.pos and sim.quat for them. */
  kind: "ragdoll" | "vehicle";
  /** Extra sink below the sand at the end of its life (metres). */
  sink: number;
  done: boolean;
}

let ready: Promise<void> | null = null;
/** Load the physics engine (WebAssembly) once. */
export function initPhysics() { return (ready ??= RAPIER.init()); }

export class DeathPhysics {
  readonly world: RAPIER.World;
  readonly dead: Dead[] = [];
  private floor: RAPIER.Collider | null = null;
  private floorAt = new Vector3(1e9, 0, 1e9);
  private acc = 0;
  private q = new Quaternion();
  private v3 = new Vector3();

  /** Call initPhysics() first. */
  constructor(public v: DeathValues, private ground: Ground) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  /** Keep the physics floor under the action: rebuilt when the focus moves a quarter of its size. */
  follow(x: number, z: number) {
    const size = this.v.floorSize;
    if (this.floor && Math.hypot(x - this.floorAt.x, z - this.floorAt.z) < size / 4) return;
    if (this.floor) this.world.removeCollider(this.floor, false);
    // Heights on a grid every 1.5 m, centred on the collider: r along X, c along Z, stored r-major (checked against
    // the height function by tools/deaths-check.ts).
    const n = Math.max(8, Math.round(size / 1.5));
    const heights = new Float32Array((n + 1) * (n + 1));
    const cx = Math.round(x), cz = Math.round(z);
    for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) {
      const px = cx - size / 2 + (r / n) * size, pz = cz - size / 2 + (c / n) * size;
      heights[r * (n + 1) + c] = this.ground.height(px, pz);
    }
    const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz).setFriction(0.9);
    this.floor = this.world.createCollider(desc);
    this.floorAt.set(cx, 0, cz);
  }

  /**
   * Hand a body to the physics: parts and joints in its own frame, placed at (x, y, z) facing yaw, moving with the
   * velocity it had, and thrown by a push (dirX, dirZ: the kill's flat direction; strength in m/s).
   */
  ragdoll(parts: PartSpec[], joints: JointSpec[], x: number, y: number, z: number, yaw: number,
    vel: { x: number; y: number; z: number }, dirX: number, dirZ: number, strength: number): Dead {
    const v = this.v, w = this.world;
    const base = this.q.setFromAxisAngle(UP, yaw);
    const bodies: RAPIER.RigidBody[] = [];
    const push = strength * v.deathPush;
    for (const p of parts) {
      const at = this.v3.set(p.at[0], p.at[1], p.at[2]).applyQuaternion(base);
      // Upper parts get more of the push, so a body folds over instead of sliding.
      const tall = 0.4 + Math.min(1, p.at[1] / 1.6);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x + at.x, y + at.y, z + at.z)
        .setRotation({ x: base.x, y: base.y, z: base.z, w: base.w })
        .setLinvel(vel.x + dirX * push * tall, vel.y + push * v.deathLift * tall, vel.z + dirZ * push * tall)
        .setAngvel({ x: (Math.random() - 0.5) * v.deathSpin * 4, y: (Math.random() - 0.5) * v.deathSpin * 2, z: (Math.random() - 0.5) * v.deathSpin * 4 })
        .setLinearDamping(0.1).setAngularDamping(v.jointDamping * 0.15);
      const b = w.createRigidBody(desc);
      w.createCollider(RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]).setDensity(p.mass ?? 600).setFriction(0.8), b);
      bodies.push(b);
    }
    const made: RAPIER.ImpulseJoint[] = [];
    for (const j of joints) {
      const A = parts[j.a], B = parts[j.b];
      const a1 = { x: j.at[0] - A.at[0], y: j.at[1] - A.at[1], z: j.at[2] - A.at[2] };
      const a2 = { x: j.at[0] - B.at[0], y: j.at[1] - B.at[1], z: j.at[2] - B.at[2] };
      const data = j.hinge ? RAPIER.JointData.revolute(a1, a2, { x: j.hinge[0], y: j.hinge[1], z: j.hinge[2] }) : RAPIER.JointData.spherical(a1, a2);
      if (j.hinge && j.limits) { data.limitsEnabled = true; data.limits = j.limits; }
      made.push(w.createImpulseJoint(data, bodies[j.a], bodies[j.b], true));
    }
    const d: Dead = {
      parts, bodies, joints: made, pos: parts.map(() => new Vector3()), quat: parts.map(() => new Quaternion()),
      age: 0, live: true, kind: "ragdoll", sink: 0, done: false,
    };
    this.read(d);
    this.dead.push(d);
    return d;
  }

  /** A vehicle wreck: one rigid body (a chassis box and a cab box), thrown by a blast. */
  wreck(half: [number, number, number], cab: { half: [number, number, number]; at: [number, number, number] }, pos: Vector3, quat: Quaternion,
    vel: Vector3, dirX: number, dirZ: number, lift: number, spin: number): Dead {
    const v = this.v, w = this.world;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinvel(vel.x + dirX * 3 * v.deathPush, vel.y + lift * v.deathLift * 2, vel.z + dirZ * 3 * v.deathPush)
      // Spin mostly end over end and sideways across the blast, so it can roll over.
      .setAngvel({ x: dirZ * spin * v.deathSpin + (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin * 0.5, z: -dirX * spin * v.deathSpin + (Math.random() - 0.5) * spin })
      .setAngularDamping(0.3);
    const b = w.createRigidBody(desc);
    w.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setDensity(250).setFriction(0.7), b);
    w.createCollider(RAPIER.ColliderDesc.cuboid(cab.half[0], cab.half[1], cab.half[2]).setTranslation(cab.at[0], cab.at[1], cab.at[2]).setDensity(150).setFriction(0.7), b);
    const d: Dead = {
      parts: [{ half, at: [0, 0, 0], color: 0 }], bodies: [b], joints: [], pos: [new Vector3()], quat: [new Quaternion()],
      age: 0, live: true, kind: "vehicle", sink: 0, done: false,
    };
    this.read(d);
    this.dead.push(d);
    return d;
  }

  private read(d: Dead) {
    d.bodies.forEach((b, i) => {
      const t = b.translation(), r = b.rotation();
      d.pos[i].set(t.x, t.y, t.z);
      d.quat[i].set(r.x, r.y, r.z, r.w);
    });
  }

  /** Take a body out of the world, keeping its last pose. */
  private freeze(d: Dead) {
    if (!d.live) return;
    this.read(d);
    for (const j of d.joints) this.world.removeImpulseJoint(j, false);
    for (const b of d.bodies) this.world.removeRigidBody(b);
    d.joints = []; d.bodies = [];
    d.live = false;
  }

  step(dt: number) {
    const v = this.v;
    // Freeze the oldest past the cap, and any that have moved long enough.
    const live = this.dead.filter((d) => d.live);
    for (let i = 0; i < live.length - v.maxRagdolls; i++) this.freeze(live[i]);
    for (const d of this.dead) if (d.live && d.age > v.liveFor) this.freeze(d);
    // Fixed 60 Hz steps (at most 3 a frame).
    this.acc = Math.min(this.acc + dt, 3 / 60);
    while (this.acc >= 1 / 60) {
      this.world.timestep = 1 / 60;
      this.world.step();
      this.acc -= 1 / 60;
    }
    for (const d of this.dead) {
      d.age += dt;
      if (d.live) this.read(d);
      // At the end, sink into the sand, then clear.
      const end = v.bodyStays;
      if (d.age > end) d.sink = Math.min(1.5, (d.age - end) * 0.4);
      if (d.age > end + 4) { this.freeze(d); d.done = true; }
    }
    for (let i = this.dead.length - 1; i >= 0; i--) if (this.dead[i].done) this.dead.splice(i, 1);
  }

  get liveCount() { return this.dead.filter((d) => d.live).length; }
}

const UP = new Vector3(0, 1, 0);
