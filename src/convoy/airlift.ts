// The helipad airlift (Keith 2026-11-01: "hop on a helipad... it charges you as you fly... press a button to get
// dropped off"). A quadcopter at the convoy carries the mech out and lets it go where the player says. Pure, no
// rendering (airliftDraw.ts draws the pad and the quadcopter).
//
//   idle --hold H on the helipad (lead bay deck), heliBase paid from the bank--> clamp (the quadcopter settles over
//   the mech on the deck) --> lift (off the deck to cruise height) --> fly (WASD steers; the bank pays heliPerKm per
//   km flown, a scrap at a time) --H again, or the bank runs dry--> lower (slows to a hover, feet heliDrop over the
//   sand) --> let go: the walker falls and lands itself (CraneCarry.airDrop), so the expedition starts as after a
//   crane drop --> leave (cosmetic: the quadcopter flies home) --> idle
//
// Ownership: host (the fee, the bank, where the mech is let go). The quadcopter's path home is cosmetic.
// Commands in (rule 12): a world-space steer {x, z} and the call key held; events out are plain data.
// Randomness: none.
import type { Param } from "../core/tweaks";
import type { WalkerSim } from "../mech/walker";
import type { DuneField } from "../world/terrain";
import type { Platform } from "./platform";
import type { CraneCarry } from "./carry";
import { hangPose, hangDrop } from "./hold";

export const AIRLIFT_GROUP = "Helipad airlift";
export const AIRLIFT_DEFAULTS = {
  heliOn: 1,
  heliPadZ: -2.5,
  heliPadR: 2.2,
  heliHold: 0.8,
  heliBase: 40,
  heliPerKm: 30,
  heliSpeed: 24,
  heliAccel: 9,
  heliAlt: 16,
  heliClimb: 6,
  heliClamp: 2,
  heliDrop: 2.5,
  heliGrip: 1.7,
  heliLean: 0.04,
  heliTurn: 70,
  heliLeave: 12,
};
export type AirliftValues = typeof AIRLIFT_DEFAULTS;
const G = AIRLIFT_GROUP;
export const AIRLIFT_PARAMS: Param[] = [
  { key: "heliOn", label: "Helipad on (0/1)", min: 0, max: 1, step: 1, group: G },
  { key: "heliPadZ", label: "Helipad forward on the lead bay (m)", min: -6, max: 8, step: 0.5, group: G, tip: "Along the deck from its middle; between the set-down pad and the parking bays by default" },
  { key: "heliPadR", label: "Helipad radius (m)", min: 1, max: 4, step: 0.1, group: G, tip: "Stand this close to its middle to call the quadcopter" },
  { key: "heliHold", label: "Hold H to call (s)", min: 0.1, max: 3, step: 0.1, group: G },
  { key: "heliBase", label: "Fee to start (scrap)", min: 0, max: 400, step: 5, group: G, tip: "Paid from the bank when the quadcopter takes the mech (Keith: a flat rate to start)" },
  { key: "heliPerKm", label: "Fee per km flown (scrap)", min: 0, max: 300, step: 1, group: G, tip: "The bank ticks down by this per km of flight; empty, the mech is dropped where it is" },
  { key: "heliSpeed", label: "Cruise speed (m/s)", min: 5, max: 60, step: 1, group: G, tip: "Higher outruns the ground streaming (sprint is 14)" },
  { key: "heliAccel", label: "Speeds up and slows at (m/s²)", min: 1, max: 30, step: 0.5, group: G },
  { key: "heliAlt", label: "Cruise height, feet over the sand (m)", min: 4, max: 40, step: 0.5, group: G, tip: "Over the highest sand under and ahead of it" },
  { key: "heliClimb", label: "Climb and descent (m/s)", min: 1, max: 20, step: 0.5, group: G },
  { key: "heliClamp", label: "Clamping on the deck (s)", min: 0.3, max: 6, step: 0.1, group: G, tip: "The quadcopter settles over the mech before it lifts" },
  { key: "heliDrop", label: "Let go with feet this high (m)", min: 0, max: 15, step: 0.5, group: G, tip: "The fall to the sand at the drop (the crane's is 3)" },
  { key: "heliGrip", label: "Grip above hips (m)", min: 0.5, max: 3, step: 0.05, group: G },
  { key: "heliLean", label: "Hanging lean per m/s² (rad)", min: 0, max: 0.15, step: 0.005, group: G, tip: "The hanging mech swings back as it speeds up, forward as it slows" },
  { key: "heliTurn", label: "Mech turns to the flight (°/s)", min: 0, max: 180, step: 1, group: G },
  { key: "heliLeave", label: "Quadcopter flies home for (s)", min: 2, max: 30, step: 1, group: G, tip: "Shown this long after the drop" },
];

export type AirliftState = "idle" | "calling" | "clamp" | "lift" | "fly" | "lower" | "leave";
export type AirliftEvent =
  | { type: "called"; fee: number }
  | { type: "refused"; need: number; have: number }
  | { type: "dry" }
  | { type: "dropped"; x: number; z: number; km: number; paid: number };

/** What the player asks this step: where to fly (world, length 0..1) and whether the call/drop key is down. */
export interface AirliftCommand { x: number; z: number; call: boolean }
/** Who pays: the convoy's bank. */
export interface Purse { scrap: number }

const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export class Airlift {
  state: AirliftState = "idle";
  /** The grip (cradle) point while carried, and its velocity. */
  readonly at = { x: 0, y: 0, z: 0 };
  readonly vel = { x: 0, y: 0, z: 0 };
  heading = 0;
  /** Seconds in this state; calling: seconds held. */
  t = 0;
  /** Km flown and scrap paid on this trip (the fee included). */
  km = 0;
  paid = 0;
  /** True on the helipad, aboard and driving, as of the last step (the prompt). */
  onPad = false;
  /** Where the mech was let go (the quadcopter leaves from there). */
  readonly dropAt = { x: 0, y: 0, z: 0 };
  readonly events: AirliftEvent[] = [];
  /** The hull's lean with the acceleration (radians toward +x, +z). */
  private lean = { x: 0, z: 0 };
  private owed = 0;
  private prevCall = false;
  private rel = { x: 0, z: 0 };

  constructor(public v: AirliftValues, readonly pad: Platform, readonly field: DuneField) {}

  /** The helipad's middle (deck-local) and in the world. */
  padLocal() { return { x: 0, z: this.v.heliPadZ * this.pad.craneEnd }; }
  padWorld() { const l = this.padLocal(); return this.pad.toWorld(l.x, this.pad.deck, l.z); }
  /** The quadcopter has the mech (the walker is posed here, not stepped). */
  get holding() { return this.state === "clamp" || this.state === "lift" || this.state === "fly" || this.state === "lower"; }
  /** 0..1 of the call hold. */
  get callShare() { return this.state === "calling" ? Math.min(1, this.t / Math.max(0.05, this.v.heliHold)) : 0; }
  /** Distance from the helipad (horizontal, m). */
  fromPad() { const w = this.padWorld(); return Math.hypot(this.at.x - w.x, this.at.z - w.z); }

  reset() { this.state = "idle"; this.t = 0; this.km = 0; this.paid = 0; this.owed = 0; this.prevCall = false; this.events.length = 0; }

  /**
   * One step (120 Hz), after carry.update. `driving`: the pilot is in the mech. Returns true while the walker is held
   * (posed here; don't step it).
   */
  step(dt: number, sim: WalkerSim, carry: CraneCarry, cmd: AirliftCommand, bank: Purse, driving: boolean): boolean {
    const v = this.v, press = cmd.call && !this.prevCall;
    this.prevCall = cmd.call;
    const g = this.pad;
    if (this.state === "idle" || this.state === "calling" || this.state === "leave") {
      const w = this.padWorld();
      this.onPad = v.heliOn >= 0.5 && driving && carry.state === "aboard" && carry.platform === g && Math.hypot(sim.pos.x - w.x, sim.pos.z - w.z) < v.heliPadR;
    } else this.onPad = false;
    if (this.state === "leave") {
      this.t += dt;
      // Done flying home, or back on the pad already (a fresh quadcopter comes; the old one just goes).
      if (this.t > v.heliLeave || this.onPad) { this.state = "idle"; this.t = 0; }
      else return false;
    }
    switch (this.state) {
      case "idle":
        if (this.onPad && cmd.call && press) { this.state = "calling"; this.t = 0; }
        return false;
      case "calling": {
        if (!this.onPad || !cmd.call) { this.state = "idle"; this.t = 0; return false; }
        this.t += dt;
        if (this.t < v.heliHold) return false;
        const fee = Math.round(v.heliBase);
        if (bank.scrap < fee) {
          this.events.push({ type: "refused", need: fee, have: Math.floor(bank.scrap) });
          this.state = "idle"; this.t = 0;
          this.prevCall = true; // let go before calling again
          return false;
        }
        bank.scrap -= fee;
        this.paid = fee; this.km = 0; this.owed = 0;
        this.events.push({ type: "called", fee });
        const l = g.toLocal(sim.pos.x, sim.pos.z);
        this.rel = { x: l.x, z: l.z };
        this.heading = sim.heading;
        this.lean.x = this.lean.z = 0;
        this.state = "clamp"; this.t = 0;
        carry.airHold();
        this.prevCall = true; // the drop needs a fresh press
        this.poseOnDeck(sim, carry);
        return true;
      }
      case "clamp":
        this.t += dt;
        this.poseOnDeck(sim, carry);
        if (this.t >= v.heliClamp) {
          this.state = "lift"; this.t = 0;
          this.vel.x = g.vel.x; this.vel.y = 0; this.vel.z = g.vel.z;
        }
        return true;
      case "lift":
      case "fly":
      case "lower":
        this.t += dt;
        this.fly(dt, sim, carry, cmd, press, bank);
        return this.holding;
    }
    return false;
  }

  /** Standing on the deck under the settling quadcopter, riding the platform. */
  private poseOnDeck(sim: WalkerSim, carry: CraneCarry) {
    const g = this.pad, w = g.toWorld(this.rel.x, g.deck, this.rel.z), drop = hangDrop(sim);
    this.at.x = w.x; this.at.y = w.y + drop + this.v.heliGrip; this.at.z = w.z;
    this.vel.x = g.vel.x; this.vel.y = 0; this.vel.z = g.vel.z;
    hangPose(sim, { x: w.x, y: this.at.y, z: w.z, grip: this.v.heliGrip, heading: this.heading, floorY: w.y, leanX: 0, leanZ: 0, deck: g });
    carry.ground.onDeck = false;
  }

  /** Feet's lowest safe height here: the highest sand under the mech and along its way ahead. */
  private floor(x: number, z: number) {
    const f = this.field, sp = Math.hypot(this.vel.x, this.vel.z);
    let h = f.height(x, z);
    if (sp > 0.5) for (const d of [10, 25, 45]) h = Math.max(h, f.height(x + (this.vel.x / sp) * d, z + (this.vel.z / sp) * d));
    // Never under the deck it took off from while still over it.
    const g = this.pad, l = g.toLocal(x, z);
    if (Math.abs(l.x) < g.halfW + 3 && Math.abs(l.z) < g.spec.length / 2 + 3) h = Math.max(h, g.y + g.deck + 2);
    return h;
  }

  private fly(dt: number, sim: WalkerSim, carry: CraneCarry, cmd: AirliftCommand, press: boolean, bank: Purse) {
    const v = this.v, a = this.at, vel = this.vel, drop = hangDrop(sim);
    const ground = this.field.height(a.x, a.z);
    // Horizontal: toward the stick at cruise speed (the convoy's speed while lifting off; nothing while lowering).
    let tx = 0, tz = 0;
    if (this.state === "lift") { tx = this.pad.vel.x; tz = this.pad.vel.z; }
    else if (this.state === "fly") { const m = Math.min(1, Math.hypot(cmd.x, cmd.z)); const n = Math.hypot(cmd.x, cmd.z) || 1; tx = (cmd.x / n) * m * v.heliSpeed; tz = (cmd.z / n) * m * v.heliSpeed; }
    const dx = tx - vel.x, dz = tz - vel.z, dl = Math.hypot(dx, dz), step = v.heliAccel * dt;
    let ax = 0, az = 0;
    if (dl > 1e-6) { const k = Math.min(1, step / dl); ax = (dx * k) / dt; az = (dz * k) / dt; vel.x += dx * k; vel.z += dz * k; }
    // Vertical: the grip height that puts the feet at cruise height (or the drop height when lowering).
    const feet = this.state === "lower" ? ground + v.heliDrop : this.floor(a.x, a.z) + v.heliAlt;
    const wantY = feet + drop + v.heliGrip;
    const climb = Math.max(-v.heliClimb, Math.min(v.heliClimb, (wantY - a.y) * 1.5));
    vel.y += Math.max(-v.heliAccel * dt, Math.min(v.heliAccel * dt, climb - vel.y));
    // Never let the feet touch the sand while carried.
    a.x += vel.x * dt; a.z += vel.z * dt; a.y += vel.y * dt;
    const minY = this.field.height(a.x, a.z) + 0.6 + drop + v.heliGrip;
    if (a.y < minY) { a.y = minY; vel.y = Math.max(0, vel.y); }
    // The fee: per km of ground covered.
    const d = Math.hypot(vel.x, vel.z) * dt;
    this.km += d / 1000;
    this.owed += (d / 1000) * v.heliPerKm;
    while (this.owed >= 1 && bank.scrap >= 1) { bank.scrap -= 1; this.owed -= 1; this.paid++; }
    if (this.state === "fly" && this.owed >= 1 && bank.scrap < 1) { this.events.push({ type: "dry" }); this.state = "lower"; this.t = 0; }
    // Lifted clear: hand over the stick.
    if (this.state === "lift" && (a.y >= wantY - 1.5 || this.t > 8)) { this.state = "fly"; this.t = 0; }
    else if (this.state === "fly" && press) { this.state = "lower"; this.t = 0; }
    // Heading: the mech turns to face the way it flies.
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 3 && this.state !== "lift") {
      const want = Math.atan2(vel.x, vel.z), max = v.heliTurn * D2R * dt;
      this.heading = wrap(this.heading + Math.max(-max, Math.min(max, wrap(want - this.heading))));
    }
    // The hull swings back against the acceleration, eased.
    const k = Math.min(1, dt * 3);
    this.lean.x += (Math.max(-0.35, Math.min(0.35, -ax * v.heliLean)) - this.lean.x) * k;
    this.lean.z += (Math.max(-0.35, Math.min(0.35, -az * v.heliLean)) - this.lean.z) * k;
    hangPose(sim, { x: a.x, y: a.y, z: a.z, grip: v.heliGrip, heading: this.heading, floorY: this.field.height(a.x, a.z), leanX: this.lean.x, leanZ: this.lean.z, deck: null, brace: this.state === "lower" ? Math.min(1, this.t / 1.5) : 0 });
    // Lowered and slowed: let go.
    if (this.state === "lower" && Math.abs(a.y - wantY) < 0.4 && sp < 1.5) {
      this.dropAt.x = a.x; this.dropAt.y = a.y; this.dropAt.z = a.z;
      this.events.push({ type: "dropped", x: a.x, z: a.z, km: this.km, paid: this.paid });
      carry.airDrop(sim, vel.x, Math.min(0, vel.y), vel.z);
      this.state = "leave"; this.t = 0;
    }
  }

  /** A stick for the demo or ?heli=metres: straight out from the convoy, away from its side, until that far, then drop. */
  static autopilot(lift: Airlift, out: number, side: { x: number; z: number }): AirliftCommand {
    if (lift.state !== "fly") return { x: 0, z: 0, call: lift.state === "idle" || lift.state === "calling" };
    if (lift.fromPad() >= out) return { x: 0, z: 0, call: true };
    return { x: side.x, z: side.z, call: false };
  }
}

