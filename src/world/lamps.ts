// Lamps that light up after dark (Keith 2026-10-29): what a body declares so the night lights (nightLights.ts) can
// light it. Cosmetic. Two ways in, both found by a scan of the scene, so nothing has to be wired lab by lab:
// - `object.userData.lamps = LampSpot[]`: lamps fixed on a body, in its local frame (vehicles, the convoy's cars, the
//   plough). `object.userData.lampsOff = true` turns them off (wrecks, vehicles tied down on a deck).
// - `object.userData.lampSource = (emit) => ...`: lamps that move on their own each frame, in world space (the robot
//   swarm's red eyes, drawn instanced).

/** Lamp kinds: each has its own colour and sliders (nightLights.ts). */
export const LAMP_HEAD = 0, LAMP_FLOOD = 1, LAMP_ROBOT = 2, LAMP_RUNNING = 3, LAMP_CAB = 4, LAMP_TAIL = 5, LAMP_MECH = 6;
export const LAMP_KINDS = 7;
export type LampKind = number;

/** A lamp fixed on a body (local frame of the object carrying it). */
export interface LampSpot {
  kind: LampKind;
  /** Where the lamp sits. */
  p: [number, number, number];
  /** Where it points (unit, local); none for a lamp that only glows (running lights, cab windows). */
  d?: [number, number, number];
  /** How far along d the beam lands; default the kind's reach slider. */
  len?: number;
  /** The beam lands on the terrain (dropped to the ground's height where it lands), not on the body's own deck. */
  ground?: boolean;
}

/**
 * A moving lamp in world space: at (x, y, z), pointing along (ax, ay, az) (unit). With `ground`, the beam lands `reach`
 * metres out along the aim's horizontal part, dropped onto the terrain; without, it lands at p + a * reach (reach 0 =
 * the kind's slider). k scales its brightness (0..1).
 */
export type LampEmit = (kind: LampKind, x: number, y: number, z: number, ax: number, ay: number, az: number, ground: boolean, reach: number, k: number) => void;
/** Called each night frame with the emitter, the time and the night-light values (sweeps and the like). */
export type LampSource = (emit: LampEmit, time: number, values: { readonly [k: string]: number }) => void;
