// What stands on each convoy platform (pure data, no rendering): cabs, huts, containers, tanks, machinery modules,
// and the vehicles tied down on the motor pool. The body draws these (platformBody.ts), the pipe generator routes
// round them and runs pipes up the ones marked `mount` (pipes.ts), and the vehicles aboard are placed from `cars`.
// Frame: the platform's local frame (x left, y up, z forward), y = 0 on the ground plane, deck top at D.
import type { CarKind } from "../vehicles/car";
import type { PlatformSpec } from "./platform";
import { storesZ } from "./deck";

export const PAL = {
  steel: 0x8f8a7f,
  deck: 0x8a8274,
  dark: 0x4a453e,
  tyre: 0x232120,
  hub: 0x8a857a,
  rust: 0x8a4a2a,
  teal: 0x4f6f6a,
  sand: 0xb9a27a,
  bone: 0xcfc6b2,
  hazard: 0xd8a019,
  orange: 0xd0642a,
  glass: 0x1a1612,
  red: 0x8f3b2a,
  ochre: 0xb08a3e,
  olive: 0x6a6a48,
};
export const KIND_PAINT = { bay: 0x7a7458, workshop: PAL.teal, housing: PAL.sand, fuel: PAL.rust, motorpool: PAL.olive } as const;

type V3 = [number, number, number];

/** A box (size w, h, l) or a cylinder (size r, length, -) lying along z (axis "z") or standing (axis "y"). */
export interface Furn {
  shape: "box" | "cyl";
  size: V3;
  at: V3;
  color: number;
  axis?: "y" | "z";
  /** Pipes may run up its walls. */
  mount?: boolean;
}

/** A vehicle tied down on the deck: local position on the deck and heading relative to the platform. */
export interface CarSlot { kind: CarKind; x: number; z: number; heading: number }

/** An axis-aligned box in the platform frame: centre and half sizes. */
export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number }

/** The furniture's bounding boxes. */
export function furnBox(f: Furn): Box {
  if (f.shape === "box") return { x: f.at[0], y: f.at[1], z: f.at[2], hx: f.size[0] / 2, hy: f.size[1] / 2, hz: f.size[2] / 2 };
  const r = f.size[0], h = f.size[1] / 2;
  return f.axis === "y" ? { x: f.at[0], y: f.at[1], z: f.at[2], hx: r, hy: h, hz: r } : { x: f.at[0], y: f.at[1], z: f.at[2], hx: r, hy: r, hz: h };
}

/** Depth of the cab across the front of every platform. */
export const CAB_LEN = 3;

/**
 * The furniture on a platform with deck top at D. The mech bay's (`bay` values from the deck and crane) keeps its
 * walking deck clear apart from the cab, the tool hut and the crates aft (deck.ts walks round the same boxes).
 */
export function furniture(spec: PlatformSpec, D: number): { items: Furn[]; cars: CarSlot[] } {
  const { length: L, width: W, kind } = spec;
  const paint = KIND_PAINT[kind];
  const items: Furn[] = [];
  const cars: CarSlot[] = [];
  const box = (size: V3, at: V3, color: number, mount = false) => items.push({ shape: "box", size, at, color, mount });
  const cyl = (r: number, len: number, at: V3, color: number, axis: "y" | "z" = "z") => items.push({ shape: "cyl", size: [r, len, 0], at, color, axis });
  /** A machinery module (pump, compressor, generator): a block with a cap, pipes run between these. */
  const machine = (x: number, z: number, w: number, h: number, l: number, color: number) => {
    box([w, h, l], [x, D + h / 2, z], color, true);
    box([w * 0.7, 0.25, l * 0.6], [x, D + h + 0.12, z], PAL.dark);
  };

  // Cab across the front.
  const cabZ = L / 2 - 2;
  box([Math.min(W - 1, 6), 2.4, CAB_LEN], [0, D + 1.2, cabZ], paint, true);

  if (kind === "bay") {
    // Tool hut and crates aft (forward, behind the cab, on a rear bay with its crane aft).
    const z = storesZ(spec);
    box([3, 2.6, 4], [-(W / 2 - 2.2), D + 1.3, z.stores], PAL.teal, true);
    for (let i = 0; i < 3; i++) box([1.2, 1.2, 1.2], [W / 2 - 1.8, D + 0.6 + (i === 2 ? 1.2 : 0), z.crates - 0.7 + (i % 2) * 1.4], PAL.ochre);
  } else if (kind === "housing") {
    // Containers stacked two high, a hut with a canopy.
    box([2.5, 2.6, 6], [W / 2 - 1.6, D + 1.3, 3], PAL.red, true);
    box([2.5, 2.6, 6], [W / 2 - 1.6, D + 3.9, 3.4], PAL.teal, true);
    box([4, 2.8, 5], [-(W / 2 - 2.4), D + 1.4, -4], PAL.bone, true);
    machine(-(W / 2 - 1.6), 4, 1.6, 1.3, 1.8, PAL.steel);
    machine(W / 2 - 1.6, -6, 1.8, 1.5, 2.2, PAL.ochre);
  } else if (kind === "workshop") {
    // A big shed, a gantry over the open end, machine modules round the walls.
    box([W - 3, 3.6, 11], [0, D + 1.8, -1], PAL.bone, true);
    for (let i = 0; i < 4; i++) box([1.1, 1.1, 1.1], [-(W / 2 - 1.4) + (i % 2) * 1.3, D + 0.55, -L / 2 + 2 + Math.floor(i / 2) * 1.3], PAL.ochre);
    machine(W / 2 - 1.8, -L / 2 + 3.5, 2, 1.6, 2.6, PAL.steel);
    machine(-(W / 2 - 1.8), 7.5, 1.8, 1.4, 2.2, PAL.teal);
    machine(W / 2 - 1.8, 7.5, 1.8, 1.8, 1.8, PAL.ochre);
    machine(0, -L / 2 + 4, 2.6, 1.2, 1.6, PAL.steel);
  } else if (kind === "fuel") {
    for (const sx of [1, -1]) {
      cyl(1.6, 14, [sx * 2.3, D + 1.8, -2], PAL.bone);
      for (const sz of [-7, 3]) box([3.4, 1, 0.5], [sx * 2.3, D + 0.5, sz], PAL.dark);
    }
    machine(2.6, 7.5, 2, 1.4, 1.8, PAL.red);
    machine(-2.6, 7.5, 1.6, 1.6, 1.6, PAL.steel);
    machine(0, -L / 2 + 2.2, 3, 1.2, 1.4, PAL.steel);
  } else if (kind === "motorpool") {
    // Two vehicles tied down nose to tail, a bowser module and lockers.
    cars.push({ kind: "technical", x: -1.6, z: 4.5, heading: 0 }, { kind: "gunTruck", x: -1.4, z: -5, heading: 0 });
    box([1.2, 2.2, 5], [W / 2 - 1.2, D + 1.1, -4], PAL.olive, true);
    machine(W / 2 - 1.5, 4.5, 1.8, 1.5, 2.4, PAL.steel);
    machine(-(W / 2 - 1.6), -L / 2 + 2, 2, 1.2, 1.4, PAL.ochre);
  }
  return { items, cars };
}
