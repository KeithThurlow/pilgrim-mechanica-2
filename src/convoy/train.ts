// The convoy as a train (Keith 2026-10-24: "more like a train ... the mech can potentially walk in between them",
// with temporary bridges for people). Pure, no rendering.
//
// Order: the platforms follow each other along the route in the layout's order, trainGap metres of clear sand
// between one's tail and the next one's nose. One line by default; with two lanes the cars after the lead alternate
// into a left and a right line, each laneSide metres off the route, each following its own predecessor.
// Each car rides on two "bogies" (route points 40% of its length ahead of and behind its middle, on its lane), so
// the line snakes through turns like train cars instead of moving as a rigid block (platform.ts).
// Footbridges: between each car and the one ahead of it in its line, bridgeCount light gangways from a landing on
// the leading car's tail to one on the following car's nose, bridgeRise above the decks so a mech walks under them.
// They're drawn between the two attach points every frame, so they stretch and swing with the cars.
import type { Param } from "../core/tweaks";
import type { Platform } from "./platform";

export const TRAIN_DEFAULTS = {
  trainGap: 9,
  trainLanes: 1,
  trainLaneSide: 11,
  bridgeCount: 1,
  bridgeRise: 3,
};
export type TrainValues = typeof TRAIN_DEFAULTS;

export const TRAIN_PARAMS: Param[] = [
  { key: "trainGap", label: "Gap between cars (m)", min: 6, max: 40, step: 0.5, group: "Train", tip: "Clear sand between one platform's tail and the next one's nose: room for the mech to walk through" },
  { key: "trainLanes", label: "Lines", min: 1, max: 2, step: 1, group: "Train", tip: "1: one long train. 2: the cars after the lead split into two shorter lines side by side (the plough cuts the road wider by the lines' spread)" },
  { key: "trainLaneSide", label: "Lines apart (m)", min: 6, max: 20, step: 0.5, group: "Train", tip: "With two lines, each runs this far either side of the route" },
  { key: "bridgeCount", label: "Footbridges per gap", min: 0, max: 2, step: 1, group: "Footbridges", tip: "Gangways between neighbouring cars, for people to cross (0 none, 1 centre, 2 both sides)" },
  { key: "bridgeRise", label: "Bridge above deck (m)", min: 1.5, max: 6, step: 0.1, group: "Footbridges", tip: "Landing height above the decks: high enough for the mech to walk under (its hood is about 4.4 m)" },
];

/** Landing in from the car's end (m): the middle of the landing tower. */
export const LANDING_IN = 1;
/** Half size of a landing tower's footprint (m). */
export const LANDING_HALF = 0.9;
/** Most a bridge's landings sit off the centre line (m), so every car width has room. */
const SPREAD = 3.4;

/** Lateral positions (local x) of the bridge landings on a car of width w. */
export function landingXs(count: number, w: number): number[] {
  const n = Math.round(count);
  if (n <= 0) return [];
  if (n === 1) return [0];
  const s = Math.min(SPREAD, w / 2 - 1.6);
  return [s, -s];
}

/** The cab across every car's front (furniture.ts): its roof top above the deck, its back face in from the nose. */
export const CAB_ROOF = 2.6, CAB_BACK = 3.5;
/** Half the cab's width on a car of width w (furniture.ts: min(w - 1, 6) wide). */
export const cabHalf = (w: number) => Math.min(w - 1, 6) / 2;
/** Stairs climb this much run per metre of rise (about 42°), this wide. */
export const STAIR_RUN = 1.1, STAIR_W = 1;

/** A footbridge landing on a car (local x, z), its top above the deck, and whether it sits on the cab roof. */
export interface Landing { x: number; z: number; top: number; onCab: boolean; end: "nose" | "tail" }
/** A stair (local): from the bottom (x0, z0) at y0 above the deck up to the top (x1, z1) at y1, w wide. */
export interface Stair { x0: number; z0: number; y0: number; x1: number; z1: number; y1: number; w: number }

/**
 * A car's footbridge landings and the stairs up to them (pure; platformBody.ts draws them, walkways.ts walks them,
 * deck.ts keeps the mech off them). A tail landing is a tower from the deck with a stair down its side; a nose landing
 * sits on the cab roof, reached by a stair up the cab's back face (a step up from the roof onto the landing).
 */
export function landingLayout(spec: { length: number; width: number }, ends: { nose: boolean; tail: boolean }, bridgeCount: number, rise: number) {
  const { length: L, width: W } = spec;
  const landings: Landing[] = [], stairs: Stair[] = [];
  const xs = landingXs(bridgeCount, W);
  const tower = (x: number, z: number) => {
    // Down the tower's side, toward the middle (or to the left with one landing).
    const dir = x === 0 ? 1 : -Math.sign(x), run = rise * STAIR_RUN;
    stairs.push({ x0: x + dir * (LANDING_HALF + run), z0: z, y0: 0, x1: x + dir * LANDING_HALF, z1: z, y1: rise, w: STAIR_W });
  };
  if (ends.tail) for (const x of xs) {
    const z = -L / 2 + LANDING_IN;
    landings.push({ x, z, top: rise, onCab: false, end: "tail" });
    tower(x, z);
  }
  if (ends.nose) for (const x of xs) {
    const z = L / 2 - LANDING_IN, onCab = Math.abs(x) < cabHalf(W) - 0.3;
    landings.push({ x, z, top: rise, onCab, end: "nose" });
    if (!onCab) { tower(x, z); continue; }
    const zb = L / 2 - CAB_BACK;
    stairs.push({ x0: x, z0: zb - CAB_ROOF * STAIR_RUN, y0: 0, x1: x, z1: zb, y1: CAB_ROOF, w: STAIR_W });
  }
  return { landings, stairs };
}

/** A stair's footprint as a local box (centre and half sizes), for keeping the mech off it. */
export function stairBox(s: Stair) {
  return { x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2, hx: Math.abs(s.x1 - s.x0) / 2 + (s.x0 === s.x1 ? s.w / 2 : 0), hz: Math.abs(s.z1 - s.z0) / 2 + (s.z0 === s.z1 ? s.w / 2 : 0) };
}

/**
 * Lay the train out: along-route offset from the head, side offset and the car each one follows (index, -1 for the
 * lead). Platforms are in layout order; the first is the lead.
 */
export function arrange(platforms: Platform[], v: TrainValues) {
  const lanes = Math.round(v.trainLanes) >= 2 ? 2 : 1;
  // Last car in each line: lane 0 (one line), or +1 / -1 (two lines), all starting behind the lead.
  const tail = new Map<number, number>();
  platforms.forEach((p, i) => {
    if (i === 0) { p.along = 0; p.side = 0; p.lane = 0; p.follows = -1; return; }
    const lane = lanes === 1 ? 0 : i % 2 === 1 ? 1 : -1;
    const prev = tail.get(lane) ?? 0;
    const q = platforms[prev];
    p.lane = lane;
    p.side = lane * v.trainLaneSide;
    p.follows = prev;
    p.along = q.along - q.spec.length / 2 - v.trainGap - p.spread - p.spec.length / 2;
    tail.set(lane, i);
  });
}

/** Which ends of each car carry bridge landings: a nose landing if it follows a car, a tail one if a car follows it. */
export function landingEnds(platforms: Platform[]): { nose: boolean; tail: boolean }[] {
  const out = platforms.map((p) => ({ nose: p.follows >= 0, tail: false }));
  for (const p of platforms) if (p.follows >= 0) out[p.follows].tail = true;
  return out;
}

export interface Span {
  /** The leading car's index and the following one's. */
  from: number;
  to: number;
  /** World attach points: on the leading car's tail landing, and on the following car's nose landing. */
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  /** The span between the landings when the two cars are in line on flat ground (m). */
  rest: number;
  /** Raised clear: the cars have pulled too far apart (or too close) for the gangway to telescope. */
  lifted: boolean;
}

/** Each gangway half is this share of the resting span: they slide over each other from REACH_MIN to REACH_MAX. */
export const BRIDGE_HALF = 0.75;
/** The gangway lifts clear beyond these shares of its resting span, and lowers again inside the second pair. */
export const REACH_MAX = 1.45, REACH_MIN = 0.8;
const LOWER_MAX = 1.35, LOWER_MIN = 0.88;

/** The footbridges as they hang this frame (reusing `out`). */
export function bridgeSpans(platforms: Platform[], v: TrainValues, out: Span[] = []): Span[] {
  let k = 0;
  platforms.forEach((p, i) => {
    if (p.follows < 0) return;
    const q = platforms[p.follows];
    const xs = landingXs(v.bridgeCount, Math.min(q.spec.width, p.spec.width));
    for (let j = 0; j < xs.length; j++) {
      const s = out[k] ?? (out[k] = { from: 0, to: 0, a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, rest: 0, lifted: false });
      // At rest: the cars in line on flat ground (with two lines, the first car of a line sits off to the side).
      s.from = p.follows; s.to = i; s.rest = Math.hypot(v.trainGap + 2 * LANDING_IN, p.side - q.side);
      // With two lines both first cars reach back to the lead's tail landings, splaying out to their lines.
      q.toWorld(xs[j], q.deck + v.bridgeRise, -q.spec.length / 2 + LANDING_IN, s.a);
      p.toWorld(xs[j], p.deck + v.bridgeRise, p.spec.length / 2 - LANDING_IN, s.b);
      // Too far apart in a tight turn (or squeezed): the gangway lifts clear, and lowers again once back in reach.
      const r = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z) / s.rest;
      s.lifted = s.lifted ? r > LOWER_MAX || r < LOWER_MIN : r > REACH_MAX || r < REACH_MIN;
      k++;
    }
  });
  out.length = k;
  return out;
}
