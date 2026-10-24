// Writing the walker's pose from outside (pure, no rendering), for the times its legs aren't walking: hanging from
// the crane's cradle (swinging with the rope, legs dangling) and kneeling in a parking bay on the deck.
import { Quaternion, Matrix4, Vector3, Euler } from "three";
import type { WalkerSim } from "../mech/walker";
import type { Platform } from "./platform";

const D2R = Math.PI / 180;
const DOWN = new Vector3(0, -1, 0);
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const t = { q: new Quaternion(), q2: new Quaternion(), r: new Quaternion(), m: new Matrix4(), e: new Euler(), a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3() };

/** Feet below the hips while hanging (legs nearly straight). */
export const hangDrop = (sim: WalkerSim) => sim.v.hipHeight * 1.04;

/** The platform's tilt times a heading within it. */
function deckQ(p: Platform, relHeading: number, pitch: number, out: Quaternion) {
  t.m.makeBasis(t.a.set(p.left.x, p.left.y, p.left.z), t.b.set(p.up.x, p.up.y, p.up.z), t.c.set(p.fwd.x, p.fwd.y, p.fwd.z));
  return out.setFromRotationMatrix(t.m).multiply(t.q2.setFromEuler(t.e.set(pitch, relHeading, 0, "YXZ")));
}

function still(sim: WalkerSim, x: number, z: number, heading: number) {
  sim.pos.set(x, 0, z);
  sim.heading = wrap(heading);
  sim.speed = 0;
  sim.vel.set(0, 0, 0);
  sim.turnSpeed = 0;
}

export interface Hang {
  /** The cradle (where the hull is gripped). */
  x: number; y: number; z: number;
  /** Grip height above the hips. */
  grip: number;
  heading: number;
  /** Ground (or deck) under the feet. */
  floorY: number;
  /** Body lean with the rope: angles toward world +x and +z (radians), already scaled by how much it shows. */
  leanX: number; leanZ: number;
  /** Standing on this platform's deck once lowered onto it (feet flat, tilted with it). */
  deck: Platform | null;
}

/** Hang the mech from the cradle: the body swings about the grip, the legs hang, or stand once lowered to the floor. */
export function hangPose(sim: WalkerSim, h: Hang) {
  const v = sim.v, drop = hangDrop(sim);
  still(sim, h.x, h.z, h.heading);
  // Lean: the body's down axis turned toward the rope's direction.
  const sx = Math.sin(h.leanX), sz = Math.sin(h.leanZ);
  t.d.set(sx, -Math.sqrt(Math.max(0.05, 1 - sx * sx - sz * sz)), sz).normalize();
  t.r.setFromUnitVectors(DOWN, t.d);
  const pelvisY = h.y - h.grip;
  const standing = pelvisY - drop <= h.floorY + 0.01;
  if (standing && h.deck) deckQ(h.deck, wrap(h.heading - h.deck.heading), 0, t.q);
  else t.q.copy(t.r).multiply(t.q2.setFromEuler(t.e.set(0, h.heading, 0, "YXZ")));
  sim.pelvisQ.copy(t.q);
  sim.hullQ.copy(t.q);
  // Pelvis below the grip along the leaned body.
  sim.pelvis.copy(t.a.set(0, -h.grip, 0).applyQuaternion(t.r)).add(t.b.set(h.x, h.y, h.z));
  const lx = Math.cos(h.heading), lz = -Math.sin(h.heading), fx = Math.sin(h.heading), fz = Math.cos(h.heading);
  for (const f of sim.feet) {
    const spread = standing ? v.footSpread : v.hipWidth * 0.9;
    // Foot under the hip, offset from the grip, turned with the lean.
    t.a.set(lx * f.side * spread + fx * 0.15, -h.grip - drop, lz * f.side * spread + fz * 0.15).applyQuaternion(t.r);
    f.swinging = false; f.u = 0; f.stanceT = 0;
    f.pos.set(h.x + t.a.x, Math.max(h.floorY, h.y + t.a.y), h.z + t.a.z);
    f.planted.copy(f.pos);
    f.yaw = h.heading + f.side * v.toeOut * D2R;
    f.plantedYaw = f.yaw;
    if (standing && h.deck) f.up.set(h.deck.up.x, h.deck.up.y, h.deck.up.z); else if (standing) f.up.set(0, 1, 0); else f.up.copy(t.d).negate();
    f.plantedUp.copy(f.up);
    // Hanging: toes droop.
    const droop = standing ? 0 : Math.min(1, (pelvisY - drop - h.floorY) / 0.6);
    f.pitch = 0.45 * droop;
    f.toe = 0.35 * droop;
    f.groundY = f.pos.y;
  }
  sim.solve();
}

/** A foot spot on the deck (local left, forward). */
export interface DeckFoot { x: number; z: number }

export interface Kneel {
  /** Body's spot on the deck (local left, forward) and heading relative to the platform. */
  x: number; z: number; relHeading: number;
  /** 0 standing .. 1 fully settled. */
  k: number;
  /** How far the hips drop and the hull tips nose-down when settled (m, degrees). */
  crouch: number; pitch: number;
  /** Where the feet started (local), eased into the stance over the first half of the settle. */
  from: [DeckFoot, DeckFoot] | null;
}

/** Each foot's standing spot (local) for a body at (x, z) facing relHeading: the same stance WalkerSim.reset uses. */
export function stanceFeet(sim: WalkerSim, x: number, z: number, relHeading: number): [DeckFoot, DeckFoot] {
  const lx = Math.cos(relHeading), lz = -Math.sin(relHeading), fx = Math.sin(relHeading), fz = Math.cos(relHeading);
  return sim.feet.map((f) => ({ x: x + lx * f.side * sim.v.footSpread + fx * f.side * 0.25, z: z + lz * f.side * sim.v.footSpread + fz * f.side * 0.25 })) as [DeckFoot, DeckFoot];
}

/** Settle (kneel) on the deck: hips down, hull tipped forward, feet flat in the stance. */
export function kneelPose(sim: WalkerSim, p: Platform, n: Kneel) {
  const v = sim.v, k = n.k * n.k * (3 - 2 * n.k);
  const w = p.toWorld(n.x, 0, n.z);
  still(sim, w.x, w.z, p.heading + n.relHeading);
  const pw = p.toWorld(n.x, p.deck + v.hipHeight - n.crouch * k, n.z);
  sim.pelvis.set(pw.x, pw.y, pw.z);
  deckQ(p, n.relHeading, n.pitch * D2R * k, t.q);
  sim.pelvisQ.copy(t.q);
  sim.hullQ.copy(t.q);
  const to = stanceFeet(sim, n.x, n.z, n.relHeading);
  const e = Math.min(1, n.k * 2), ee = e * e * (3 - 2 * e);
  sim.feet.forEach((f, i) => {
    const a = n.from ? n.from[i] : to[i];
    const fp = p.toWorld(a.x + (to[i].x - a.x) * ee, p.deck, a.z + (to[i].z - a.z) * ee);
    f.swinging = false; f.u = 0; f.stanceT = 0;
    f.pos.set(fp.x, fp.y, fp.z);
    f.planted.copy(f.pos);
    f.yaw = sim.heading + f.side * v.toeOut * D2R;
    f.plantedYaw = f.yaw;
    f.up.set(p.up.x, p.up.y, p.up.z);
    f.plantedUp.copy(f.up);
    f.pitch = 0; f.toe = 0;
    f.groundY = f.pos.y;
  });
  sim.solve();
}
