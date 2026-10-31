// The pilot in a lab (glue): hold F to hop out and back in (mount.ts), the pilot walking (pilot.ts) on the ground and
// whatever surfaces the lab registers (src/world/walkable.ts), his body (pilotBody.ts) and HUD (pilotHud.ts), the
// camera zooming in on foot, the field kneel on the mech, and the pilot as a target the enemies can pick
// (quarry.ts). The convoy lab and the combat lab shell both use it; the lab says where hopping out is allowed and
// (at the convoy) does the bay's kneel itself.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { IsoCamera } from "../core/isoCamera";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { Walkable } from "../world/walkable";
import { loadBanditVat } from "../combat/banditVat";
import { PilotSim, PILOT_DEFAULTS, PILOT_PARAMS, type Stick, type Blocker } from "./pilot";
import { Mount, MOUNT_DEFAULTS, MOUNT_PARAMS, climbPath, type MountEvent } from "./mount";
import { PilotBody, PILOT_LOOK_DEFAULTS, PILOT_LOOK_PARAMS } from "./pilotBody";
import { PilotHud } from "./pilotHud";
import { PilotUnit, Quarry, QUARRY_DEFAULTS, QUARRY_PARAMS } from "./quarry";

export const ON_FOOT_DEFAULTS = {
  ...PILOT_DEFAULTS, ...MOUNT_DEFAULTS, ...PILOT_LOOK_DEFAULTS, ...QUARRY_DEFAULTS, pilotMechKeep: 1.3,
  pilotReach: 2.5, pilotStripRate: 0.5, pilotStripNoise: 0.35, pilotTerminalReach: 1.6,
};
export type OnFootValues = typeof ON_FOOT_DEFAULTS;
export const ON_FOOT_PARAMS: Param[] = [
  ...PILOT_PARAMS, ...MOUNT_PARAMS, ...QUARRY_PARAMS, ...PILOT_LOOK_PARAMS,
  { key: "pilotMechKeep", label: "Keep off the mech's legs (m)", min: 0.3, max: 3, step: 0.05, group: "Pilot", tip: "From the mech's middle, on top of his body radius" },
  { key: "pilotReach", label: "Strips within (m)", min: 0.5, max: 8, step: 0.1, group: "Pilot: salvage", tip: "E strips a salvage spot this close to the pilot on foot (the mech reaches 7 m)" },
  { key: "pilotStripRate", label: "Strips at (× the mech)", min: 0.05, max: 2, step: 0.05, group: "Pilot: salvage", tip: "By hand: slower than the mech's tools" },
  { key: "pilotStripNoise", label: "Noise (× the mech's)", min: 0, max: 1.5, step: 0.05, group: "Pilot: salvage", tip: "How far stripping by hand is heard (wakes camps)" },
  { key: "pilotTerminalReach", label: "Uses a terminal within (m)", min: 0.5, max: 5, step: 0.1, group: "Pilot", tip: "E opens the bay screen this close to a bay terminal" },
];
/** The pilot's topic for a lab's panel. */
export const PILOT_TOPIC = { id: "pilot", label: "Pilot", groups: ["Pilot", "Pilot: getting out", "Pilot: enemies", "Pilot: salvage", "Pilot: look", "Pilot: walkways"] };

const D2R = Math.PI / 180;

export interface OnFootFrame {
  /** F held. */
  hold: boolean;
  /** WASD as a world stick, and Shift. */
  stick: Stick;
  run: boolean;
  /** Hopping out isn't allowed here: why (shown on the HUD), or null. */
  blockOut: string | null;
  /** The convoy does the kneel (a parked bay): has it finished? Undefined: the mount kneels the mech itself (the field). */
  knelt?: boolean;
  /** A prompt for the HUD line (the terminal, salvage). */
  prompt?: string;
  /** Step the walk here (false: the lab calls walk() inside its own fixed steps, e.g. after the convoy moves). */
  walkHere?: boolean;
  /** On the sand: shove out of solid footprints (the convoy's cars). */
  pushOut?: (x: number, z: number, r: number) => { x: number; z: number } | null;
}

export class OnFoot {
  readonly sim: PilotSim;
  readonly mount: Mount;
  readonly body: PilotBody;
  readonly hud: PilotHud;
  readonly unit: PilotUnit;
  readonly quarry: Quarry;
  /** The mount's last event this frame (for the lab: "kneel", "out", "in", ...). */
  event: MountEvent = null;
  /** The pilot died this frame (once). */
  died = false;
  /** Seconds since he died (labs bring him back). */
  deadFor = 0;
  private side = 0;
  private hatch = new THREE.Vector3();
  private foot = { x: 0, y: 0, z: 0 };
  private from = { x: 0, y: 0, z: 0 };
  private drawAt = { x: 0, y: 0, z: 0 };
  private drawHeading = 0;
  private camBack = 40;
  private blockers: Blocker[] = [{ x: 0, z: 0, r: 1 }];
  private lastPushOut: OnFootFrame["pushOut"];

  private constructor(readonly v: OnFootValues, readonly walkable: Walkable, readonly mech: MechUnit, readonly iso: IsoCamera, bf: Battlefield, scene: THREE.Scene, vat: Awaited<ReturnType<typeof loadBanditVat>> | null) {
    this.sim = new PilotSim(v, walkable);
    this.mount = new Mount(v);
    this.body = new PilotBody(vat, v);
    scene.add(this.body.group);
    this.hud = new PilotHud();
    this.unit = new PilotUnit(this.sim, v);
    bf.targets.push(this.unit);
    this.quarry = new Quarry(mech, this.unit, v);
  }

  /** Load the pilot's body (the bandits' bake) and set him up, inside the mech. */
  static async create(v: OnFootValues, walkable: Walkable, mech: MechUnit, iso: IsoCamera, bf: Battlefield, scene: THREE.Scene) {
    const vat = await loadBanditVat().catch((e) => { console.warn("pilot bake not loaded, a capsule instead:", e); return null; });
    return new OnFoot(v, walkable, mech, iso, bf, scene, vat);
  }

  /** Driving the mech (not getting out, not on foot). */
  get driving() { return this.mount.driving; }
  /** On foot and alive: WASD walks him. */
  get walking() { return this.mount.onFoot && this.sim.alive; }
  /** Drawn and followed by the camera. */
  get shown() { return this.mount.pilotShown; }

  /** Back in the mech at once (restart, respawn, recovery home). */
  reset() {
    this.mount.reset();
    this.sim.revive();
    this.unit.exposed = false;
    this.deadFor = 0;
    this.mech.kneel = this.mech.kneelPitch = 0;
    this.iso.zoomTo(this.camBack);
  }

  /** Start on foot beside the mech (?onfoot), already zoomed in. */
  startOut() {
    this.mount.startOut();
    this.pickSide();
    const f = this.footSpot();
    this.sim.place(f.x, f.y, f.z, this.mech.sim.heading);
    this.sim.revive();
    this.unit.exposed = true;
    this.camBack = this.iso.zoomTarget;
    this.iso.setDistance(this.v.pilotCamDist);
  }

  /** Where the camera should look: the pilot while he's shown, else null (the mech). */
  focus(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.shown) return null;
    return out.set(this.drawAt.x, this.drawAt.y + 0.9, this.drawAt.z);
  }

  /** The pilot's flat distance to the mech's middle. */
  /** The pilot HUD's own health bar (off where the vitals HUD shows the pilot, src/ui/vitalsHud.ts). */
  showHealth = true;
  get toMech() { const m = this.mech.sim.pos, p = this.sim.pos; return Math.hypot(p.x - m.x, p.z - m.z); }

  /** One walking step (call at the lab's fixed rate, after moving surfaces moved). */
  walk(dt: number, stick: Stick, run: boolean, pushOut?: OnFootFrame["pushOut"]) {
    if (!this.mount.onFoot) return;
    this.sim.ride();
    const b = this.blockers[0], m = this.mech.sim.pos;
    b.x = m.x; b.z = m.z; b.r = this.v.pilotMechKeep;
    this.sim.step(dt, this.walking ? stick : { x: 0, z: 0 }, run, this.blockers, pushOut ?? this.lastPushOut);
  }

  /** Once a frame: the mount, the walk (unless the lab steps it), the kneel, the body, the HUD, the camera. */
  update(dt: number, f: OnFootFrame) {
    const v = this.v, m = this.mount, sim = this.sim;
    this.lastPushOut = f.pushOut;
    this.died = false;
    const wasAlive = sim.alive;
    const inRange = this.mech.alive && sim.alive && this.toMech <= v.pilotRange;
    const ev = m.update(dt, { hold: f.hold, blockOut: this.mech.alive ? f.blockOut : "the mech is down", knelt: f.knelt ?? m.kneel >= 0.98, inRange });
    this.event = ev;
    if (ev === "climbOut") { this.pickSide(); this.camBack = this.iso.zoomTarget; this.iso.zoomTo(v.pilotCamDist); }
    if (ev === "out") {
      const ft = this.footSpot(), hm = this.mech.sim.pos;
      sim.place(ft.x, ft.y, ft.z, Math.atan2(ft.x - hm.x, ft.z - hm.z));
      sim.revive();
      this.unit.exposed = true;
    }
    if (ev === "climbIn") { this.from.x = sim.pos.x; this.from.y = sim.pos.y; this.from.z = sim.pos.z; this.unit.exposed = false; }
    if (ev === "in") this.iso.zoomTo(this.camBack);
    // The field kneel (the convoy's bay does its own).
    const k = f.knelt === undefined ? m.kneel * m.kneel * (3 - 2 * m.kneel) : 0;
    this.mech.kneel = k * v.pilotKneelDrop;
    this.mech.kneelPitch = k * v.pilotKneelPitch * D2R;

    if (f.walkHere !== false) {
      const n = Math.max(1, Math.ceil(dt * 120));
      for (let i = 0; i < n; i++) this.walk(dt / n, f.stick, f.run, f.pushOut);
    }
    if (wasAlive && !sim.alive) { this.died = true; this.deadFor = 0; }
    if (!sim.alive) this.deadFor += dt;
    this.quarry.update();

    // Where he's drawn: climbing along the path, or where he walks.
    this.hatch.set(this.mech.sim.pelvis.x, this.mech.sim.pelvis.y + 1.25, this.mech.sim.pelvis.z);
    if (m.state === "climbOut") {
      const ft = this.footSpot();
      climbPath(this.hatch, ft, m.t, this.drawAt);
      this.drawHeading = Math.atan2(this.hatch.x - ft.x, this.hatch.z - ft.z);
    } else if (m.state === "climbIn") {
      climbPath(this.hatch, this.from, 1 - m.t, this.drawAt);
      this.drawHeading = Math.atan2(this.hatch.x - this.from.x, this.hatch.z - this.from.z);
    } else { this.drawAt.x = sim.pos.x; this.drawAt.y = sim.pos.y; this.drawAt.z = sim.pos.z; this.drawHeading = sim.heading; }
    const climbing = m.state === "climbOut" || m.state === "climbIn";
    this.body.update(dt, this.drawAt.x, this.drawAt.y, this.drawAt.z, this.drawHeading, climbing ? 0 : sim.speed, sim.running, m.pilotShown, m.onFoot, !sim.alive);

    // HUD: the hold ring and what it does, the lab's prompt, his health.
    let text = "", ring: number | null = null;
    if (!sim.alive && m.onFoot) text = `<span class="bad">Pilot killed</span>`;
    else if (m.state === "in") {
      if (m.why) text = `<span class="bad">Can't get out: ${m.why}</span>`;
      else if (m.hold > 0) { ring = m.hold; text = "Hold <b>F</b>: get out"; }
    } else if (m.state === "kneeling") text = "Kneeling…";
    else if (m.state === "climbOut") text = "Climbing down…";
    else if (m.state === "climbIn") text = "Climbing in…";
    else if (m.onFoot) {
      if (inRange) { ring = m.hold; text = "Hold <b>F</b>: get back in"; }
      else if (m.why) text = `<span class="bad">${m.why}</span>`;
    }
    if (f.prompt && sim.alive) text = text ? `${text}<br>${f.prompt}` : f.prompt;
    this.hud.set(ring, text, m.onFoot && this.showHealth ? sim.health / Math.max(1, v.pilotHealth) : null, m.onFoot ? sim.hurt / 15 : 0);
  }

  /** The first side the pilot can step out to: left, right, behind, ahead of the mech (on the level it stands on). */
  private pickSide() {
    for (let i = 0; i < 4; i++) { this.side = i; if (this.spotOk(this.footSpot())) return; }
    this.side = 0;
  }

  private spotOk(f: { x: number; y: number; z: number }) {
    const ft = this.feetY();
    return Math.abs(f.y - ft) < 0.7 && !!this.walkable.walkHeight(f.x, f.z, ft + 0.2, this.v.pilotStepUp);
  }

  private feetY() { const [a, b] = this.mech.sim.feet; return Math.min(a.pos.y, b.pos.y); }

  /** The landing spot beside the mech on the chosen side (world, on whatever is there at the mech's feet' level). */
  private footSpot() {
    const s = this.mech.sim, h = s.heading, d = this.v.pilotOutSide;
    const dirs = [[Math.cos(h), -Math.sin(h)], [-Math.cos(h), Math.sin(h)], [-Math.sin(h), -Math.cos(h)], [Math.sin(h), Math.cos(h)]];
    const [dx, dz] = dirs[this.side];
    const x = s.pos.x + dx * d, z = s.pos.z + dz * d, ft = this.feetY();
    const w = this.walkable.walkHeight(x, z, ft + 0.2, this.v.pilotStepUp) ?? this.walkable.floorBelow(x, z, ft + 0.5);
    this.foot.x = x; this.foot.y = w.y; this.foot.z = z;
    return this.foot;
  }
}
