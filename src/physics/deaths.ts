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

/** The thinnest a ragdoll part's collider is (half extent, m). */
const MIN_HALF = 0.1;

export const DEATH_DEFAULTS = {
  deathPush: 1,
  deathLift: 0.5,
  deathSpin: 1,
  jointDamping: 2,
  liveFor: 7,
  maxRagdolls: 30,
  bodyStays: 14,
  floorSize: 120,
  ragdollsPerFrame: 6,
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
  { key: "ragdollsPerFrame", label: "New ragdolls per frame", min: 1, max: 60, step: 1, group: "Performance", tip: "Deaths past this in one frame wait their turn, flying on as they were thrown, and get their physics a frame or two later (perf pass 1: a barrage killing dozens at once made the physics spike to hundreds of ms). The cap on moving bodies is under Death physics" },
];

/** A box part in a body's own frame (origin at its feet, facing +Z), optionally turned (a quaternion x y z w). */
export interface PartSpec {
  half: [number, number, number]; at: [number, number, number]; color: number; mass?: number; rot?: [number, number, number, number];
  /** More boxes welded to this part (heavy bodies only), placed in the same frame as the part. */
  extra?: { half: [number, number, number]; at: [number, number, number]; rot?: [number, number, number, number]; mass?: number }[];
}
/** A joint between parts a and b at a point in the body's own frame; hinge: about this axis with limits; fixed: welded
 *  (heavy bodies only). */
export interface JointSpec { a: number; b: number; at: [number, number, number]; hinge?: [number, number, number]; limits?: [number, number]; fixed?: boolean }

export interface Dead {
  parts: PartSpec[];
  bodies: RAPIER.RigidBody[];
  joints: RAPIER.ImpulseJoint[];
  /** World transforms per part (live from the bodies, frozen after). */
  pos: Vector3[];
  quat: Quaternion[];
  age: number;
  live: boolean;
  /** Vehicles are drawn by their own body: the physics only moves sim.pos and sim.quat for them. Mechs too: their
   *  model's pivots follow the parts (src/physics/mechWreckDraw.ts). */
  kind: "ragdoll" | "vehicle" | "mech";
  /** Extra sink below the sand at the end of its life (metres). */
  sink: number;
  done: boolean;
  /** Waiting for its physics (too many died this frame): flying on as thrown, ballistic, until its turn. */
  pending?: Pending | null;
  /** Kept by its owner (a mech's wreck): not frozen by the cap, never sunk or cleared; the owner calls remove(). */
  keep?: boolean;
  /** Moves at most this long (s) before freezing (default liveFor); frozen sooner once it has settled. */
  moveFor?: number;
  /** Joints that hold their pose at death (a mech's wreck, src/physics/mechWreck.ts). */
  hold?: Hold | null;
  /** Its own ground: a plane fitted to the dunes under it, moved along as it slides (heavy bodies only). */
  plane?: RAPIER.Collider | null;
  planeAt?: Vector3;
  /** Parts that report hitting the sand (the hull and pelvis slamming down): impacts since the owner last drained them. */
  thud?: Thud | null;
}

/** Live tuning for held joints (a mech's wreck): read every frame, so sliders act on wrecks already falling. */
export interface HoldValues {
  /** Each hinge's pull back to its pose at death: N·m per radian, × the whole body's weight × 1 m. */
  mechPoseStiffness: number;
  /** And its damping: N·m per rad/s, × weight × 1 m. */
  mechPoseDamping: number;
  /** Seconds the joints hold before the power dies, the share they keep after, and how long the dying takes. */
  mechHoldFor: number;
  mechHoldEnd: number;
  mechFadeTime: number;
}
interface Hold { hinges: RAPIER.RevoluteImpulseJoint[]; v: HoldValues; weight: number; still: number; gain: number }
interface Thud { parts: number[]; offs: Vector3[]; prevVy: number[]; cool: number[]; impacts: { x: number; y: number; z: number; speed: number }[] }

/** A ragdoll's bodies not yet made: its parts' starting velocities and spins, in the order of parts. */
interface Pending { joints: JointSpec[]; lin: { x: number; y: number; z: number }[]; ang: { x: number; y: number; z: number }[]; floor: number }

let ready: Promise<void> | null = null;
/** Load the physics engine (WebAssembly) once. */
export function initPhysics() { return (ready ??= RAPIER.init()); }

export class DeathPhysics {
  readonly world: RAPIER.World;
  readonly dead: Dead[] = [];
  private floor: RAPIER.Collider | null = null;
  private floorAt = new Vector3(1e9, 0, 1e9);
  private acc = 0;
  /** Ragdolls made since the last step, and those waiting their turn (oldest first). */
  private madeThisFrame = 0;
  private waiting: Dead[] = [];
  private q = new Quaternion();
  private v3 = new Vector3();

  /** Call initPhysics() first. */
  constructor(public v: DeathValues, private ground: Ground) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  /** Keep the physics floor under the action: rebuilt when the focus moves a quarter of its size. */
  /** The ground changed under the floor (a crater): rebuild it on a later follow(), at most every half second. */
  groundChanged() { if (this.staleAt < 0) this.staleAt = performance.now(); }
  private staleAt = -1;

  follow(x: number, z: number) {
    const size = this.v.floorSize;
    const stale = this.staleAt >= 0 && performance.now() - this.staleAt > 500;
    if (stale) this.staleAt = -1;
    if (!stale && this.floor && Math.hypot(x - this.floorAt.x, z - this.floorAt.z) < size / 4) return;
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
    const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz).setFriction(0.9).setCollisionGroups(FLOOR);
    this.floor = this.world.createCollider(desc);
    this.floorAt.set(cx, 0, cz);
  }

  /**
   * Hand a body to the physics: parts and joints in its own frame, placed at (x, y, z) facing yaw, moving with the
   * velocity it had, and thrown by a push (dirX, dirZ: the kill's flat direction; strength in m/s).
   */
  ragdoll(parts: PartSpec[], joints: JointSpec[], x: number, y: number, z: number, yaw: number,
    vel: { x: number; y: number; z: number }, dirX: number, dirZ: number, strength: number): Dead {
    const v = this.v;
    const base = this.q.setFromAxisAngle(UP, yaw);
    const push = strength * v.deathPush;
    const d: Dead = {
      parts, bodies: [], joints: [], pos: parts.map(() => new Vector3()), quat: parts.map(() => new Quaternion()),
      age: 0, live: true, kind: "ragdoll", sink: 0, done: false,
    };
    const pend: Pending = { joints, lin: [], ang: [], floor: y };
    parts.forEach((p, k) => {
      const at = this.v3.set(p.at[0], p.at[1], p.at[2]).applyQuaternion(base);
      // Upper parts get more of the push, so a body folds over instead of sliding.
      const tall = 0.4 + Math.min(1, p.at[1] / 1.6);
      d.pos[k].set(x + at.x, y + at.y, z + at.z);
      d.quat[k].copy(base);
      if (p.rot) d.quat[k].multiply(new Quaternion(p.rot[0], p.rot[1], p.rot[2], p.rot[3]));
      pend.lin.push({ x: vel.x + dirX * push * tall, y: vel.y + push * v.deathLift * tall, z: vel.z + dirZ * push * tall });
      pend.ang.push({ x: (Math.random() - 0.5) * v.deathSpin * 4, y: (Math.random() - 0.5) * v.deathSpin * 2, z: (Math.random() - 0.5) * v.deathSpin * 4 });
    });
    d.pending = pend;
    this.dead.push(d);
    // Made now while this frame's allowance lasts, else queued (perf pass 1).
    if (this.madeThisFrame < Math.max(1, v.ragdollsPerFrame ?? 6) && this.waiting.length === 0) this.make(d);
    else this.waiting.push(d);
    return d;
  }

  /** Give a waiting ragdoll its bodies and joints, where it has flown to, moving as it moves now. */
  private make(d: Dead) {
    const pend = d.pending;
    if (!pend) return;
    d.pending = null;
    this.madeThisFrame++;
    if (!d.live || d.done) return;
    const v = this.v, w = this.world, parts = d.parts;
    const bodies: RAPIER.RigidBody[] = [];
    parts.forEach((p, k) => {
      const P = d.pos[k], Q = d.quat[k];
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(P.x, P.y, P.z)
        .setRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w })
        .setLinvel(pend.lin[k].x, pend.lin[k].y, pend.lin[k].z)
        .setAngvel(pend.ang[k])
        .setLinearDamping(0.1).setAngularDamping(v.jointDamping * 0.15);
      const b = w.createRigidBody(desc);
      // Thin parts (a cutter's shins, 11 cm across) could slip through the dune floor's heightfield lying flat on it:
      // their colliders are at least MIN_HALF thick (the look is drawn from the part, not the collider).
      w.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(MIN_HALF, p.half[0]), Math.max(MIN_HALF, p.half[1]), Math.max(MIN_HALF, p.half[2])).setDensity(p.mass ?? 600).setFriction(0.8).setCollisionGroups(BODY), b);
      bodies.push(b);
    });
    for (const j of pend.joints) {
      const A = parts[j.a], B = parts[j.b];
      // Anchors in each part's own frame (undo a turned part's rotation). Hinges assume unturned parts.
      const a1 = anchor(j.at, A), a2 = anchor(j.at, B);
      const data = j.hinge ? RAPIER.JointData.revolute(a1, a2, { x: j.hinge[0], y: j.hinge[1], z: j.hinge[2] }) : RAPIER.JointData.spherical(a1, a2);
      if (j.hinge && j.limits) { data.limitsEnabled = true; data.limits = j.limits; }
      d.joints.push(w.createImpulseJoint(data, bodies[j.a], bodies[j.b], true));
    }
    d.bodies = bodies;
    this.read(d);
  }

  /** A waiting ragdoll flies on as one piece (no spin), falling but not below where it died. */
  private drift(d: Dead, dt: number) {
    const pend = d.pending!;
    let low = Infinity;
    for (let k = 0; k < d.pos.length; k++) {
      const l = pend.lin[k];
      l.y -= 9.81 * dt;
      d.pos[k].x += l.x * dt; d.pos[k].y += l.y * dt; d.pos[k].z += l.z * dt;
      low = Math.min(low, d.pos[k].y);
    }
    const under = this.ground.height(d.pos[0].x, d.pos[0].z);
    const floor = Math.min(pend.floor, under);
    if (low < floor) for (let k = 0; k < d.pos.length; k++) { d.pos[k].y += floor - low; pend.lin[k].y = Math.max(0, pend.lin[k].y); }
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
    w.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setDensity(250).setFriction(0.7).setCollisionGroups(WRECK), b);
    w.createCollider(RAPIER.ColliderDesc.cuboid(cab.half[0], cab.half[1], cab.half[2]).setTranslation(cab.at[0], cab.at[1], cab.at[2]).setDensity(150).setFriction(0.7).setCollisionGroups(WRECK), b);
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
    // Never made: it keeps the pose it flew to.
    if (d.pending) { d.pending = null; const i = this.waiting.indexOf(d); if (i >= 0) this.waiting.splice(i, 1); }
    this.read(d);
    for (const j of d.joints) this.world.removeImpulseJoint(j, false);
    if (d.plane) { this.world.removeCollider(d.plane, false); d.plane = null; }
    for (const b of d.bodies) this.world.removeRigidBody(b);
    d.joints = []; d.bodies = [];
    d.live = false;
  }

  step(dt: number) {
    const v = this.v;
    // This frame's new ragdolls: the waiting ones first, oldest first, up to the allowance; the rest fly on.
    // (Those made since the last step count against it; the count starts again after this step.)
    const cap = Math.max(1, v.ragdollsPerFrame ?? 6);
    while (this.waiting.length && this.madeThisFrame < cap) this.make(this.waiting.shift()!);
    this.madeThisFrame = 0;
    for (const d of this.waiting) this.drift(d, dt);
    // Freeze the oldest past the cap, and any that have moved long enough.
    const live = this.dead.filter((d) => d.live && !d.keep);
    for (let i = 0; i < live.length - v.maxRagdolls; i++) this.freeze(live[i]);
    for (const d of this.dead) if (d.live && d.age > (d.moveFor ?? v.liveFor)) this.freeze(d);
    // Fixed 60 Hz steps (at most 3 a frame).
    this.acc = Math.min(this.acc + dt, 3 / 60);
    for (const d of this.dead) if (d.live && d.hold) { this.holdPose(d); this.fitPlane(d); }
    while (this.acc >= 1 / 60) {
      this.world.timestep = 1 / 60;
      this.world.step();
      for (const d of this.dead) if (d.live && d.thud) this.listen(d, 1 / 60);
      this.acc -= 1 / 60;
    }
    for (const d of this.dead) {
      d.age += dt;
      if (d.live && !d.pending) this.read(d);
      if (d.keep) { if (d.live && d.hold && this.settled(d, dt)) this.freeze(d); continue; }
      // At the end, sink into the sand, then clear.
      const end = v.bodyStays;
      if (d.age > end) d.sink = Math.min(1.5, (d.age - end) * 0.4);
      if (d.age > end + 4) { this.freeze(d); d.done = true; }
    }
    for (let i = this.dead.length - 1; i >= 0; i--) if (this.dead[i].done) this.dead.splice(i, 1);
  }

  /**
   * A heavy body that holds its shape (a destroyed mech): parts in world space (origin 0, yaw 0), each with its own
   * starting velocity, made at once (they're rare). Every body starts unturned (its box turned inside it), so a hinge's
   * axis and limits read the same from both sides and angle 0 is the pose it died in; each hinge has a motor pulling
   * back to 0 (hold), fixed joints are welded.
   */
  heavy(parts: PartSpec[], joints: JointSpec[], lin: { x: number; y: number; z: number }[], ang: { x: number; y: number; z: number },
    o: { damping: number; moveFor: number; hold: HoldValues; thud: { part: number; at: [number, number, number] }[] }): Dead {
    const w = this.world;
    const d: Dead = {
      parts, bodies: [], joints: [], pos: parts.map(() => new Vector3()), quat: parts.map(() => new Quaternion()),
      age: 0, live: true, kind: "mech", sink: 0, done: false, keep: true, moveFor: o.moveFor,
    };
    let weight = 0;
    parts.forEach((p, k) => {
      const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.at[0], p.at[1], p.at[2])
        .setLinvel(lin[k].x, lin[k].y, lin[k].z).setAngvel(ang)
        .setLinearDamping(0.15).setAngularDamping(o.damping));
      for (const c of [p, ...(p.extra ?? [])]) {
        const r = c.rot ?? [0, 0, 0, 1];
        const rr = Math.min(0.12, Math.min(...c.half) * 0.5);
        w.createCollider(RAPIER.ColliderDesc.roundCuboid(c.half[0] - rr, c.half[1] - rr, c.half[2] - rr, rr).setTranslation(c.at[0] - p.at[0], c.at[1] - p.at[1], c.at[2] - p.at[2])
          .setRotation({ x: r[0], y: r[1], z: r[2], w: r[3] }).setDensity(c.mass ?? p.mass ?? 2000).setFriction(0.9).setRestitution(0).setCollisionGroups(MECH), b);
      }
      weight += b.mass() * 9.81;
      d.bodies.push(b);
    });
    const hinges: RAPIER.RevoluteImpulseJoint[] = [];
    const I = { x: 0, y: 0, z: 0, w: 1 };
    for (const j of joints) {
      const A = parts[j.a].at, B = parts[j.b].at;
      const a1 = { x: j.at[0] - A[0], y: j.at[1] - A[1], z: j.at[2] - A[2] }, a2 = { x: j.at[0] - B[0], y: j.at[1] - B[1], z: j.at[2] - B[2] };
      const data = j.fixed ? RAPIER.JointData.fixed(a1, I, a2, I)
        : j.hinge ? RAPIER.JointData.revolute(a1, a2, { x: j.hinge[0], y: j.hinge[1], z: j.hinge[2] }) : RAPIER.JointData.spherical(a1, a2);
      if (j.hinge && j.limits) { data.limitsEnabled = true; data.limits = j.limits; }
      const joint = w.createImpulseJoint(data, d.bodies[j.a], d.bodies[j.b], true);
      d.joints.push(joint);
      if (j.hinge && !j.fixed) {
        const h = joint as RAPIER.RevoluteImpulseJoint;
        h.configureMotorModel(RAPIER.MotorModel.ForceBased);
        hinges.push(h);
      }
    }
    d.hold = { hinges, v: o.hold, weight, still: 0, gain: -1 };
    // The heavy chain on the heightfield's (or a trimesh's) triangles gained energy and never settled: legs flailing
    // for seconds (2026-11-01, tools/mechwreck-check.ts). On a flat box it settles in a few seconds, so each wreck
    // lies on its own plane fitted to the dunes under it, refitted as it moves.
    d.plane = w.createCollider(RAPIER.ColliderDesc.cuboid(30, 1, 30).setFriction(1.4).setCollisionGroups(MECH_FLOOR));
    d.planeAt = new Vector3(1e9, 0, 0);
    this.fitPlane(d);
    this.holdPose(d);
    d.thud = {
      parts: o.thud.map((t) => t.part), offs: o.thud.map((t) => new Vector3(t.at[0] - parts[t.part].at[0], t.at[1] - parts[t.part].at[1], t.at[2] - parts[t.part].at[2])),
      prevVy: o.thud.map((t) => lin[t.part].y), cool: o.thud.map(() => 0), impacts: [],
    };
    this.read(d);
    this.dead.push(d);
    return d;
  }

  /** Move a wreck's plane under it when it has moved a metre: the dunes there as a plane (least squares over ±6 m). */
  private fitPlane(d: Dead) {
    const b = d.bodies[0], t = b.translation();
    if (!d.plane || Math.hypot(t.x - d.planeAt!.x, t.z - d.planeAt!.z) < 1) return;
    d.planeAt!.set(t.x, 0, t.z);
    let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0, sh = 0, n = 0;
    for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) {
      const x = i * 3, z = k * 3, h = this.ground.height(t.x + x, t.z + z);
      sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h; sh += h; n++;
    }
    // A grid centred on the body: x and z sums are 0, so the fit separates.
    const a = sh / n, det = sxx * szz - sxz * sxz || 1;
    const gx = (sxh * szz - szh * sxz) / det, gz = (szh * sxx - sxh * sxz) / det;
    const nrm = new Vector3(-gx, 1, -gz).normalize();
    const q = new Quaternion().setFromUnitVectors(UP, nrm);
    d.plane.setTranslation({ x: t.x - nrm.x, y: a - nrm.y, z: t.z - nrm.z });
    d.plane.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  /** Take a kept body out for good (its owner is done with it: a mech rebuilt). */
  remove(d: Dead) {
    this.freeze(d);
    d.done = true;
    const i = this.dead.indexOf(d);
    if (i >= 0) this.dead.splice(i, 1);
  }

  /** The power in a wreck's joints now, as a share (1 until mechHoldFor, fading to mechHoldEnd). */
  static holdGain(v: HoldValues, age: number) {
    const f = Math.min(1, Math.max(0, (age - v.mechHoldFor) / Math.max(0.01, v.mechFadeTime)));
    return 1 - f * (1 - v.mechHoldEnd);
  }

  /** Set each hinge's motor (toward the pose at death) for the power left; only when it changed. */
  private holdPose(d: Dead) {
    const h = d.hold!, v = h.v, g = DeathPhysics.holdGain(v, d.age);
    // The damping stays when the power dies (seized joints only slow things), so it can only settle.
    const k = v.mechPoseStiffness * h.weight * g, c = v.mechPoseDamping * h.weight;
    const key = k * 1e-3 + c;
    if (key === h.gain) return;
    h.gain = key;
    for (const j of h.hinges) j.configureMotorPosition(0, k, c);
  }

  /** Thud points (on their parts) falling fast that suddenly stop near the sand: an impact (where, how fast it came down). */
  private listen(d: Dead, dt: number) {
    const t = d.thud!, p = this.v3, q = this.q;
    t.parts.forEach((k, i) => {
      const b = d.bodies[k], r = b.rotation(), o = b.translation(), c = b.worldCom(), l = b.linvel(), w = b.angvel();
      p.copy(t.offs[i]).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).add(this.v3b.set(o.x, o.y, o.z));
      // The point's own speed: the body's, plus its spin about the centre of mass.
      const vy = l.y + w.z * (p.x - c.x) - w.x * (p.z - c.z);
      t.cool[i] = Math.max(0, t.cool[i] - dt);
      if (t.prevVy[i] < -2 && vy - t.prevVy[i] > 1.5 && t.cool[i] <= 0 && p.y - this.ground.height(p.x, p.z) < 2) {
        t.impacts.push({ x: p.x, y: p.y, z: p.z, speed: -t.prevVy[i] });
        t.cool[i] = 0.4;
      }
      t.prevVy[i] = vy;
    });
  }
  private v3b = new Vector3();

  /** A wreck at rest for a second (after its joints have gone quiet): no point stepping it. */
  private settled(d: Dead, dt: number) {
    const h = d.hold!;
    if (d.age < h.v.mechHoldFor + h.v.mechFadeTime) return false;
    let fast = 0;
    for (const b of d.bodies) { const l = b.linvel(), a = b.angvel(); fast = Math.max(fast, Math.hypot(l.x, l.y, l.z), Math.hypot(a.x, a.y, a.z) * 0.5); }
    h.still = fast < 0.08 ? h.still + dt : 0;
    return h.still > 1;
  }

  get liveCount() { return this.dead.filter((d) => d.live).length; }
}

const UP = new Vector3(0, 1, 0);

/** A joint point (body frame) relative to a part, in the part's own (possibly turned) frame. */
function anchor(at: [number, number, number], p: PartSpec) {
  const v = new Vector3(at[0] - p.at[0], at[1] - p.at[1], at[2] - p.at[2]);
  if (p.rot) v.applyQuaternion(new Quaternion(p.rot[0], p.rot[1], p.rot[2], p.rot[3]).invert());
  return { x: v.x, y: v.y, z: v.z };
}
// Collision groups (16 bits membership, 16 bits filter): the floor is group 1 and meets everything; the dead are
// group 2 and meet only the floor (bodies passing through each other is cheap and rarely seen; touching their own
// neighbouring parts at every joint was most of the cost and made limbs jitter).
const FLOOR = (0x0001 << 16) | 0xffff;
const BODY = (0x0002 << 16) | 0x0001;
// Mech wrecks meet only the planes under them (see heavy()).
const MECH = (0x0008 << 16) | 0x0010;
const MECH_FLOOR = (0x0010 << 16) | 0x0008;
// Vehicle wrecks also meet each other.
const WRECK = (0x0004 << 16) | 0x0005;
