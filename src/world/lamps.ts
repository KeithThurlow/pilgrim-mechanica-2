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

/**
 * Whose fire a short light is (Keith 2026-10-31: enemy attacks light up too, colour-coded so hostile fire reads): the
 * player's side (warm orange), bandits and war bands (hot red-orange), robots (red). Hues and strengths are sliders.
 */
export const FAM_PLAYER = 0, FAM_BANDIT = 1, FAM_ROBOT = 2;
export type LightFamily = number;
/** A battlefield team to its light family (src/game/factions.ts TEAM: raiders 2, robots 3; the rest the player's). */
export const famOfTeam = (team: number): LightFamily => (team === 2 ? FAM_BANDIT : team === 3 ? FAM_ROBOT : FAM_PLAYER);

/**
 * The one request path for short and sustained lights (src/world/nightLights.ts): asked for each frame (or once for
 * flashes), merged where they bunch up (src/world/lightCluster.ts), the biggest clusters get the real lights, the rest
 * are faked on the ground. Cosmetic.
 */
export interface ShortLights {
  /** A blast of this radius. */
  flash(x: number, y: number, z: number, radius: number, fam?: LightFamily): void;
  /** A rocket or shell leaving its tube (k its size, 1 a launcher's rocket). */
  launch(x: number, y: number, z: number, k?: number, fam?: LightFamily): void;
  /** A gun's muzzle flash (small; k its size). */
  gun(x: number, y: number, z: number, k?: number, fam?: LightFamily): void;
  /** A rocket, missile or shell in flight this frame along (dx, dy, dz) (k its size). */
  rocket(x: number, y: number, z: number, dx: number, dy: number, dz: number, k?: number, fam?: LightFamily): void;
  /** A drawn tracer: a share of them carry a light down their line, brighter with power (damage × (1 + pierce)), hot rounds orange. */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, power: number, fam?: LightFamily, hot?: boolean, always?: boolean): void;
  /** A light held this frame: power, reach (m), colour (hex), priority for the real lights (1 like a blast), glow size (m, faked). */
  hold(x: number, y: number, z: number, power: number, range: number, color: number, prio?: number, glow?: number): void;
  /** A round telegraph on the ground at (x, y, z) (y the ground), radius r, u 0..1 how near it is to landing. */
  telegraph(x: number, y: number, z: number, r: number, u: number, fam?: LightFamily): void;
  /** A strip telegraph on the ground from (x0, z0) to (x1, z1), this wide, u 0..1 how near it is to landing. */
  telegraphLine(x0: number, z0: number, x1: number, z1: number, width: number, u: number, fam?: LightFamily): void;
}
/** Bodies that ask for short lights each frame set `object.userData.shortLights = (lights, time) => ...`. */
export type ShortLightSource = (lights: ShortLights, time: number) => void;
