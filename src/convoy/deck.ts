// The mech bay's deck as ground (pure, no rendering): where the mech can walk on the moving platform, its marked
// spots (parking bays, launch pads, the crane's set-down pad), and what keeps a walking mech on it.
//
// Riding: the walker sim works in world space, so each frame the platform's motion since the last frame (turn about
// its middle, shift, heave and tilt under the mech) is applied to the whole walker (WalkerSim.carry): body, springs,
// planted feet and swing targets all move with the deck, then the walker takes its own step relative to it.
// Ground: while the mech is aboard, the walker's ground is the deck plane (extended a little past the edges so
// lookups just outside don't see a 3 m drop); otherwise it's the dunes.
// Keeping on: the mech is a circle that can't leave the deck (rails, along the cut-cornered outline) or pass through
// the deck furniture. A rear mech bay (crane aft) has the same layout mirrored along its length, the cab still in front.
import type { Param } from "../core/tweaks";
import type { Ground, WalkerSim } from "../mech/walker";
import type { DuneField } from "../world/terrain";
import type { Platform, PlatformSpec } from "./platform";
import { landingXs, LANDING_IN, LANDING_HALF } from "./train";
import { outside, keepInside } from "./outline";

export const DECK_DEFAULTS = {
  deckMechRadius: 1.5,
  deckParkZ: -8,
  deckParkX: 4,
  deckLaunchX: 5.8,
  deckPadRadius: 1.8,
  craneSetDown: 2,
};
export type DeckValues = typeof DECK_DEFAULTS;

export const DECK_PARAMS: Param[] = [
  { key: "deckMechRadius", label: "Mech radius on deck (m)", min: 0.5, max: 3, step: 0.05, group: "Deck", tip: "How close the mech's middle gets to the rails and deck furniture" },
  { key: "deckParkZ", label: "Parking bays forward (m)", min: -16, max: 4, step: 0.5, group: "Deck", tip: "Where the two parking bays sit along the deck" },
  { key: "deckParkX", label: "Parking bays apart (m)", min: 2.5, max: 6, step: 0.1, group: "Deck", tip: "Each bay's middle this far either side of the centre line" },
  { key: "deckLaunchX", label: "Launch pads out (m)", min: 2, max: 7, step: 0.1, group: "Deck", tip: "The launch pads beside the crane, this far out from the centre line" },
  { key: "deckPadRadius", label: "Pad radius (m)", min: 0.8, max: 3, step: 0.05, group: "Deck", tip: "Stand this close to a pad's middle to be on it" },
  { key: "craneSetDown", label: "Set-down pad (m)", min: -16, max: 14, step: 0.5, group: "Deck", tip: "Where the crane sets a picked-up mech on the deck, forward of the middle" },
];

/** A marked spot on the deck (local left, forward). */
export interface Spot { x: number; z: number; kind: "park" | "launch" | "setdown"; side?: 1 | -1 }
/** Furniture to walk round: an axis-aligned box (local, half sizes) or a circle. */
export interface Block { x: number; z: number; hx: number; hz: number; r?: number }

/** Parking bay size (m): the marked rectangle. */
export const BAY_W = 5.4, BAY_L = 7;
/** Cab depth at the front of the bay platform. */
export const CAB_DEPTH = 3.6;

/** Along-deck positions of a bay's crane, set-down pad, parking bays and aft stores, mirrored on a rear bay. */
export function bayZ(p: Platform, v: DeckValues & { craneMount: number }) {
  const e = p.craneEnd;
  return { crane: v.craneMount * e, setDown: v.craneSetDown * e, park: v.deckParkZ * e, ...storesZ(p.spec) };
}

/** Along-deck spot of a bay's tool hut and crates: aft on the lead bay, just behind the cab on a rear bay. */
export function storesZ(spec: PlatformSpec) {
  const L = spec.length;
  return (spec.crane ?? 1) > 0 ? { stores: -L / 2 + 4, crates: -L / 2 + 3.7 } : { stores: L / 2 - CAB_DEPTH - 2.2, crates: L / 2 - CAB_DEPTH - 1.5 };
}

/** The bay platform's layout from its size, the crane's mount and the deck values (and the footbridges' landings). */
export function deckLayout(p: Platform, v: DeckValues & { craneMount: number; bridgeCount?: number }) {
  const { length: L, width: W } = p.spec;
  const z = bayZ(p, v);
  const spots: Spot[] = [
    { x: v.deckParkX, z: z.park, kind: "park" },
    { x: -v.deckParkX, z: z.park, kind: "park" },
    { x: v.deckLaunchX, z: z.crane, kind: "launch", side: 1 },
    { x: -v.deckLaunchX, z: z.crane, kind: "launch", side: -1 },
    { x: 0, z: z.setDown, kind: "setdown" },
  ];
  const blocks: Block[] = [
    // Crane mast ring.
    { x: 0, z: z.crane, hx: 0, hz: 0, r: 1.9 },
    // Cab across the front.
    { x: 0, z: L / 2 - CAB_DEPTH / 2, hx: W / 2, hz: CAB_DEPTH / 2 },
    // Service tower between the parking bays.
    { x: 0, z: z.park, hx: 0.8, hz: 1.9 },
    // Tool hut and crates (aft, or forward of the crane on a rear bay).
    { x: -(W / 2 - 2.2), z: z.stores, hx: 1.5, hz: 2 },
    { x: W / 2 - 1.8, z: z.crates, hx: 0.6, hz: 1.3 },
  ];
  // Footbridge landing towers: on the tail when a car follows (the lead), on the nose when it follows one (the rear bay).
  const xs = landingXs(v.bridgeCount ?? 0, W);
  if (p.follows < 0 || p.craneEnd > 0) for (const x of xs) blocks.push({ x, z: -L / 2 + LANDING_IN, hx: LANDING_HALF, hz: LANDING_HALF });
  return { spots, blocks, halfW: W / 2, halfL: L / 2 };
}

/** The walker's ground: the deck plane while the mech is aboard, the dunes otherwise. */
export class DeckGround implements Ground {
  onDeck = false;
  /** Lookups this far past the deck edge still read the deck (m). */
  skirt = 3;
  /** The platform whose deck this is (the carry switches it to the bay of the crane in use). */
  constructor(readonly field: DuneField, public bay: Platform) {}

  /** Inside the deck's outline (plus margin m)? */
  over(x: number, z: number, margin = 0) {
    const p = this.bay, l = p.toLocal(x, z);
    return outside(p.outline, l.x, l.z) < margin;
  }

  /** The deck plane's height at world (x, z). */
  deckHeight(x: number, z: number) {
    const p = this.bay, u = p.up, o = p.toWorld(0, p.deck, 0);
    return o.y - (u.x * (x - o.x) + u.z * (z - o.z)) / u.y;
  }

  height(x: number, z: number) {
    return this.onDeck && this.over(x, z, this.skirt) ? this.deckHeight(x, z) : this.field.height(x, z);
  }

  normal(x: number, z: number, out: number[] = [0, 1, 0]) {
    if (this.onDeck && this.over(x, z, this.skirt)) { out[0] = this.bay.up.x; out[1] = this.bay.up.y; out[2] = this.bay.up.z; return out; }
    return this.field.normal(x, z, out);
  }
}

/** A copy of a platform's pose, to carry a walker by the platform's motion since. */
export class PoseSnap {
  x = 0; y = 0; z = 0; heading = 0;
  up = { x: 0, y: 1, z: 0 };
  deck = 0;
  ok = false;
  take(p: Platform) {
    this.x = p.x; this.y = p.y; this.z = p.z; this.heading = p.heading;
    this.up = { ...p.up }; this.deck = p.deck; this.ok = true;
  }
  /** The deck plane's height at world (x, z) in this pose. */
  deckHeight(x: number, z: number) {
    // Deck origin: the platform origin plus up * deck.
    const ox = this.x + this.up.x * this.deck, oy = this.y + this.up.y * this.deck, oz = this.z + this.up.z * this.deck;
    return oy - (this.up.x * (x - ox) + this.up.z * (z - oz)) / this.up.y;
  }
}

/**
 * Move a walker standing on the deck with the platform from its pose in `was` to where it is now, then remember the
 * new pose. The mech's spot on the deck (local x, z) stays put; its height follows the deck plane under it.
 */
export function rideDeck(sim: WalkerSim, p: Platform, was: PoseSnap) {
  if (!was.ok) { was.take(p); return; }
  const dyaw = p.heading - was.heading;
  const dx = p.x - was.x, dz = p.z - was.z;
  // The deck under the mech's middle: where that spot is now (turned and shifted) and how high the deck is there.
  const c = Math.cos(dyaw), s = Math.sin(dyaw), rx = sim.pos.x - was.x, rz = sim.pos.z - was.z;
  const nx = was.x + rx * c + rz * s + dx, nz = was.z - rx * s + rz * c + dz;
  const o = p.toWorld(0, p.deck, 0), u = p.up;
  const nowY = o.y - (u.x * (nx - o.x) + u.z * (nz - o.z)) / u.y;
  const dy = nowY - was.deckHeight(sim.pos.x, sim.pos.z);
  sim.carry(dx, dy, dz, dyaw, was.x, was.z);
  was.take(p);
}

/** Keep a walking mech on the deck and out of the furniture. Returns true if it was pushed. */
export function keepOnDeck(sim: WalkerSim, p: Platform, v: DeckValues & { craneMount: number; bridgeCount?: number }) {
  const lay = deckLayout(p, v), r = v.deckMechRadius;
  const l = p.toLocal(sim.pos.x, sim.pos.z);
  let { x, z } = keepInside(p.outline, l.x, l.z, r);
  for (const b of lay.blocks) {
    if (b.r !== undefined) {
      const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), m = b.r + r;
      if (d < m) { const k = d > 1e-6 ? m / d : 1; x = b.x + (d > 1e-6 ? dx * k : m); z = b.z + (d > 1e-6 ? dz * k : 0); }
      continue;
    }
    // Circle against box: push out along the shallower side.
    const qx = Math.max(b.x - b.hx, Math.min(b.x + b.hx, x)), qz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, z));
    const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-6) { x = qx + (dx / d) * r; z = qz + (dz / d) * r; }
    else {
      // Centre inside the box: out through the nearest face.
      const ox = b.hx + r - Math.abs(x - b.x), oz = b.hz + r - Math.abs(z - b.z);
      if (ox < oz) x = b.x + Math.sign(x - b.x || 1) * (b.hx + r); else z = b.z + Math.sign(z - b.z || 1) * (b.hz + r);
    }
  }
  // Swinging feet land on the deck, not past the rail (walking hard into the edge aims the steps out over it).
  const s = Math.sin(p.heading), c = Math.cos(p.heading), fm = 0.45;
  for (const f of sim.feet) {
    if (!f.swinging) continue;
    const q = p.toLocal(f.target.x, f.target.z);
    const { x: qx, z: qz } = keepInside(p.outline, q.x, q.z, fm);
    if (Math.abs(qx - q.x) < 1e-9 && Math.abs(qz - q.z) < 1e-9) continue;
    f.target.x = p.x + c * qx + s * qz;
    f.target.z = p.z - s * qx + c * qz;
    const o = p.toWorld(0, p.deck, 0), u = p.up;
    f.target.y = o.y - (u.x * (f.target.x - o.x) + u.z * (f.target.z - o.z)) / u.y;
  }
  if (Math.abs(x - l.x) < 1e-6 && Math.abs(z - l.z) < 1e-6) return false;
  sim.pos.x = p.x + c * x + s * z;
  sim.pos.z = p.z - s * x + c * z;
  return true;
}

/** A stick that walks the mech to a deck spot (local x, z), easing off near it; zero once within `stop` m. */
export function walkToSpot(sim: WalkerSim, p: Platform, x: number, z: number, stop = 0.4): { x: number; z: number; sprint: boolean } {
  const w = p.toWorld(x, 0, z), dx = w.x - sim.pos.x, dz = w.z - sim.pos.z, d = Math.hypot(dx, dz);
  if (d < stop) return { x: 0, z: 0, sprint: false };
  // Speed by distance in m/s, whatever the walk speed: 1 m/s near the spot, 4 m/s from 3 m out (faster, the committed
  // turn circles a close spot instead of reaching it).
  const ws = Math.max(1, sim.v.walkSpeed);
  const mag = Math.min(1, Math.max(1, Math.min(4, (4 * d) / 3)) / ws);
  return { x: (dx / d) * mag, z: (dz / d) * mag, sprint: false };
}

/** The spot the mech's middle is on (within the pad radius, or inside a parking bay's marking), if any. */
export function spotAt(sim: WalkerSim, p: Platform, v: DeckValues & { craneMount: number }): Spot | null {
  const l = p.toLocal(sim.pos.x, sim.pos.z);
  for (const s of deckLayout(p, v).spots) {
    if (s.kind === "park" ? Math.abs(l.x - s.x) < BAY_W / 2 - 0.6 && Math.abs(l.z - s.z) < BAY_L / 2 - 0.6 : Math.hypot(l.x - s.x, l.z - s.z) < v.deckPadRadius) return s;
  }
  return null;
}
