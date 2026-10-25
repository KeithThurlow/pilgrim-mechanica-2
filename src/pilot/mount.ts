// Getting out of the mech and back in (pure, no rendering; Keith 2026-10-26: hold F to hop out, in the field and at
// the convoy; hold F by your mech to get back in). A state machine with timers; the lab says what's possible (where
// the mech is, whether it may kneel here, whether it has finished kneeling) and moves things when it says so.
//
//   in --hold F--> kneeling (the mech crouches) --> out climbing (the pilot climbs down beside it) --> out
//   out --hold F within range--> in climbing (up to the hatch) --> in (the mech stands up)
//
// Holding F needs a fresh press each time (holding on after getting out doesn't climb straight back in).
// Ownership (multiplayer later): the player's own; the hold is a command in (MountInput.hold), never read from keys.
import type { Param } from "../core/tweaks";

export const MOUNT_DEFAULTS = {
  pilotHold: 0.6,
  pilotKneelTime: 0.5,
  pilotClimbTime: 1.1,
  pilotRange: 3,
  pilotRiseTime: 0.6,
  pilotKneelDrop: 1.1,
  pilotKneelPitch: 8,
  pilotOutSide: 2.4,
  pilotCamDist: 15,
};
export type MountValues = typeof MOUNT_DEFAULTS;
const G = "Pilot: getting out";
export const MOUNT_PARAMS: Param[] = [
  { key: "pilotHold", label: "Hold F (s)", min: 0.1, max: 2, step: 0.05, group: G, tip: "Hold this long to hop out, or (in range) back in; a ring fills on the HUD" },
  { key: "pilotKneelTime", label: "Mech kneels in (s)", min: 0.1, max: 3, step: 0.05, group: G, tip: "Out in the field (at the convoy the bay's park settle does it)" },
  { key: "pilotClimbTime", label: "Climb down / up (s)", min: 0.3, max: 4, step: 0.05, group: G, tip: "Hatch to the ground beside the mech (was 2 s in the proposal; Keith: quicker)" },
  { key: "pilotRange", label: "Get back in within (m)", min: 1, max: 10, step: 0.1, group: G, tip: "From the pilot to the mech's middle, flat" },
  { key: "pilotRiseTime", label: "Mech stands up in (s)", min: 0.1, max: 3, step: 0.05, group: G },
  { key: "pilotKneelDrop", label: "Kneel: hips down (m)", min: 0, max: 2, step: 0.05, group: G },
  { key: "pilotKneelPitch", label: "Kneel: nose down (°)", min: -10, max: 30, step: 0.5, group: G },
  { key: "pilotOutSide", label: "Steps out this far (m)", min: 1, max: 5, step: 0.05, group: G, tip: "From the mech's middle to where the pilot lands (left side first, else right, behind, ahead)" },
  { key: "pilotCamDist", label: "Camera on foot (m)", min: 6, max: 60, step: 0.5, group: G, tip: "The game camera zooms in this close while on foot, back out when you get in" },
];

export type MountState = "in" | "kneeling" | "climbOut" | "out" | "climbIn";

/** What the lab tells the mount each frame. */
export interface MountInput {
  /** F held. */
  hold: boolean;
  /** Hopping out is allowed here (null) or why not (shown on the HUD). */
  blockOut: string | null;
  /** The mech has finished kneeling (field: the mount's own kneel; convoy: the bay's park settle). */
  knelt: boolean;
  /** The pilot is within pilotRange of the mech (and the mech is alive). */
  inRange: boolean;
}

export type MountEvent = "kneel" | "climbOut" | "out" | "climbIn" | "in" | null;

export class Mount {
  state: MountState = "in";
  /** F held: 0..1 of pilotHold. */
  hold = 0;
  /** Progress through a climb, 0..1. */
  t = 0;
  /** The field kneel: 0 standing .. 1 knelt (eased by the caller). */
  kneel = 0;
  /** F must be let go before the next hold counts. */
  private fresh = true;
  /** Why the last hold didn't go (HUD). */
  why: string | null = null;

  constructor(public v: MountValues) {}

  /** Back in the mech at once (start, respawn, recovery). */
  reset() { this.state = "in"; this.hold = 0; this.t = 0; this.kneel = 0; this.fresh = true; this.why = null; }
  /** Start on foot at once (lab flag). */
  startOut() { this.state = "out"; this.hold = 0; this.t = 1; this.kneel = 1; this.fresh = false; }

  /** The pilot is inside, driving the mech. */
  get driving() { return this.state === "in"; }
  /** The pilot is drawn (climbing or on foot). */
  get pilotShown() { return this.state === "climbOut" || this.state === "out" || this.state === "climbIn"; }
  /** On foot and free to walk. */
  get onFoot() { return this.state === "out"; }

  update(dt: number, inp: MountInput): MountEvent {
    const v = this.v;
    if (!inp.hold) this.fresh = true;
    const charging = inp.hold && this.fresh;
    let ev: MountEvent = null;
    // The field kneel follows the state: down while out of the cockpit, up once back in.
    const down = this.state !== "in";
    this.kneel = Math.max(0, Math.min(1, this.kneel + (down ? dt / Math.max(0.05, v.pilotKneelTime) : -dt / Math.max(0.05, v.pilotRiseTime))));
    switch (this.state) {
      case "in":
        this.why = charging ? inp.blockOut : null;
        this.hold = charging && !inp.blockOut ? Math.min(1, this.hold + dt / Math.max(0.05, v.pilotHold)) : 0;
        if (this.hold >= 1) { this.state = "kneeling"; this.hold = 0; this.fresh = false; ev = "kneel"; }
        break;
      case "kneeling":
        if (inp.knelt) { this.state = "climbOut"; this.t = 0; ev = "climbOut"; }
        break;
      case "climbOut":
        this.t = Math.min(1, this.t + dt / Math.max(0.05, v.pilotClimbTime));
        if (this.t >= 1) { this.state = "out"; ev = "out"; }
        break;
      case "out":
        this.why = charging && !inp.inRange ? "too far from your mech" : null;
        this.hold = charging && inp.inRange ? Math.min(1, this.hold + dt / Math.max(0.05, v.pilotHold)) : 0;
        if (this.hold >= 1) { this.state = "climbIn"; this.t = 0; this.hold = 0; this.fresh = false; ev = "climbIn"; }
        break;
      case "climbIn":
        this.t = Math.min(1, this.t + dt / Math.max(0.05, v.pilotClimbTime));
        if (this.t >= 1) { this.state = "in"; ev = "in"; }
        break;
    }
    return ev;
  }
}

/**
 * Where the pilot is during a climb: from the hatch (on the hull, above the hips) out to the side and down to the
 * landing spot (or back), t 0..1. Out over the first third, down the rest, with a little sag like a ladder climb.
 */
export function climbPath(hatch: { x: number; y: number; z: number }, foot: { x: number; y: number; z: number }, t: number, out = { x: 0, y: 0, z: 0 }) {
  const e = (k: number) => k * k * (3 - 2 * k);
  const a = Math.min(1, t / 0.35), b = Math.max(0, (t - 0.25) / 0.75);
  const side = e(a) * 0.55 + e(b) * 0.45;
  out.x = hatch.x + (foot.x - hatch.x) * side;
  out.z = hatch.z + (foot.z - hatch.z) * side;
  out.y = hatch.y + (foot.y - hatch.y) * e(b);
  return out;
}
