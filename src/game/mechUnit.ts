// A mech on the battlefield: the walker sim (legs), the upper-body sim (torso and two miniguns), the Rampart model,
// health, and its rounds fired into the shared battlefield. Used for the player's mech and for bandit mechs (red
// Ramparts for now, Keith 2026-10-24), so both walk, shoot, kick up dust and take hits the same way.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { WalkerSim, leftOf, type MoveCommand, type Landing } from "../mech/walker";
import type { WalkerValues } from "../mech/walkerTuning";
import { UpperSim, triggerOf, type UpperValues, type Aim, type Trigger } from "../mech/upper";
import type { UpperSim as UpperSimT } from "../mech/upper";

/** Where a part hangs on a mech body: the old names (a gun side, a shoulder, the back) or the asset list's sockets. */
export type MountSocket = "left" | "right" | "back" | "shoulderL" | "shoulderR"
  | "HullMount_L" | "HullMount_R" | "Shoulder_L" | "Shoulder_R" | "Grip_L" | "Grip_R" | "Sensor" | "Sensor_Front" | "Sensor_Top" | "Pack" | "Waist_L" | "Waist_R";

/** Fitted parts a body shows (src/items/loadout.ts Resolved.parts plus which sides have a gun). Optional fields are
 *  the mounts (Keith 2026-10-26); a body without them reads only the first four. */
export interface BodyParts {
  gunLeft: boolean; gunRight: boolean; drums: boolean; pack: boolean;
  drumsL?: boolean; drumsR?: boolean; sensor?: boolean; sensorId?: string | null; sensorStyle?: "head" | "cluster" | null; mountL?: "gun" | "arm" | null; mountR?: "gun" | "arm" | null;
}

/** What a mech unit needs from its model: the Rampart, or the stand-in walker (no guns). */
export interface MechBody {
  readonly root: THREE.Object3D;
  readonly armed: boolean;
  update(sim: WalkerSim, upper: UpperSimT): void;
  shoulderLine(out?: THREE.Vector3): THREE.Vector3;
  muzzle(side: 1 | -1, out?: THREE.Vector3): THREE.Vector3;
  barrel(side: 1 | -1, out?: THREE.Vector3): THREE.Vector3;
  eject(side: 1 | -1, out?: THREE.Vector3): THREE.Vector3;
  paint(look: ToonLook, color: number | null): void;
  /** Show or hide fitted parts (a loadout with an empty side, no drums or no pack). */
  showParts?(parts: BodyParts): void;
  /** Show the fitted legs' and hull's models (looks: "rampart" or a variant id); true when the legs changed, and
   *  legValues() then gives their proportions for the walker (src/mech/rampart.ts). */
  setLooks?(legs: string, hull: string): boolean;
  legValues?(): Partial<WalkerValues>;
  /** Where other weapons' stand-ins hang (a gun side's pivot, a shoulder, the back mount, or one of the asset list's
   *  sockets: HullMount_L/R, Shoulder_L/R, Grip_L/R, Sensor, Pack, Waist_L/R), and hiding a side's own pod. */
  mount?(slot: MountSocket): THREE.Object3D;
  showPod?(side: 1 | -1, on: boolean): void;
  /** Cosmetic: turn the sensor head toward the aim (or scan), sweep a cluster (src/mech/head.ts). */
  aimSensor?(dt: number, aim: Aim | null, v: HeadValues): void;
}
import type { ToonLook } from "../look/toon";
import type { TargetCandidate } from "./targeting";

/** The weapons that aren't miniguns (src/weapons/arsenal.ts): stepped with the mech, handed the gun clock's shots. */
export interface MechWeapons {
  /** After the legs and guns moved: charge, paint, fire, fly. */
  step(dt: number, aim: Aim | null, trigger: Trigger): void;
  /** A gun of another class (autocannon) fired a round on its clock: the weapons fire it. */
  shot(side: 1 | -1): void;
  /** A loadout was fitted (src/game/loadoutApply.ts): build the sims and stand-in models for it. */
  configure?(r: import("../items/loadout").Resolved): void;
  /** Special rounds loaded into this side's gun now (the incendiary feed's key, src/weapons/gear.ts), or null. */
  rounds?(side: 1 | -1): import("../weapons/gear").RoundSpec | null;
  /** Share of the walk's speed now (a channelling arm missile pod slows it; 1: none). */
  moveMul?(): number;
  /** Weapons cold (death, hopping out, a round starting over): every trigger and key let go without firing, charges,
   *  paints, lasers and feed effects dropped. Rounds already in the air keep flying. */
  stop?(): void;
}
import { Dash, DASH_DEFAULTS, DASH_PARAMS } from "../mech/dash";
import { HEAD_DEFAULTS, HEAD_PARAMS, type HeadValues } from "../mech/head";
import { Bound, BOUND_DEFAULTS, BOUND_PARAMS } from "../mech/bound";
import type { DustValues } from "../fx/dust";
import type { HitSurface } from "../fx/minigun";
import type { Battlefield, Hittable, SplashOpts } from "./battlefield";
import { armourHit } from "./armour";
import { TRAMPLE_DEFAULTS, TRAMPLE_PARAMS } from "../combat/trample";
import { RepairKits, REPAIR_DEFAULTS, REPAIR_PARAMS, type KitRefusal } from "./repair";
import { Abilities, ABILITY_DEFAULTS, ABILITY_PARAMS } from "../abilities/abilities";
import type { HealTarget } from "../abilities/zones";

export const MECH_DEFAULTS = {
  ...DASH_DEFAULTS,
  ...HEAD_DEFAULTS,
  ...BOUND_DEFAULTS,
  ...TRAMPLE_DEFAULTS,
  ...REPAIR_DEFAULTS,
  ...ABILITY_DEFAULTS,
  /** The legs' trample stats (src/items/bases.ts), × the Trample sliders; the loadout sets them. */
  trample: 1,
  crush: 1,
  hull: 3000,
  armour: 8,
  roundDamage: 12,
  roundAp: 0.1,
  roundPierce: 2,
  roundPen: 1,
  roundPenCurve: 1.75,
  roundSheetHalf: 0.35,
  roundSheetHeight: 10,
  roundLine: 0.5,
  roundSplash: 1.6,
  roundSplashShare: 0.5,
  hitRadius: 1.7,
  respawn: 4,
};
export type MechValues = typeof MECH_DEFAULTS;

export const MECH_PARAMS: Param[] = [
  ...DASH_PARAMS,
  ...HEAD_PARAMS,
  ...BOUND_PARAMS,
  ...TRAMPLE_PARAMS,
  ...REPAIR_PARAMS,
  ...ABILITY_PARAMS,
  { key: "hull", label: "Hull (hit points)", min: 50, max: 10000, step: 10, group: "Mech health" },
  { key: "armour", label: "Hull armour", min: 0, max: 40, step: 0.5, group: "Mech health", tip: "Flat armour per hit (src/game/armour.ts): a hit loses this × (1 − its pierce), keeping at least the floor share. Bites, saws and raider small arms ignore it" },
  { key: "roundAp", label: "Minigun armour pierce", min: 0, max: 1, step: 0.01, group: "Rounds", tip: "Share of a target's armour each round ignores (an item's own pierce stat wins)" },
  { key: "roundDamage", label: "Minigun round damage", min: 0, max: 60, step: 0.5, group: "Mech health", tip: "What each of the player's rounds takes off whatever it hits" },
  { key: "roundPen", label: "Hull minigun penetration (m)", min: 0, max: 6, step: 0.05, group: "Rounds", tip: "Each round's penetration budget in metres of steel equivalent (src/game/sheet.ts): bodies and dune lips cost their chord × their density (Penetration group)" },
  { key: "roundPierce", label: "Item pierce read as the hull's", min: 0.5, max: 6, step: 0.5, group: "Rounds", tip: "An item's pierce stat (until items carry penetration in metres) is read as penetration = hull minigun penetration × (pierce / this) ^ curve: a held light minigun (pierce 1) gets about 0.3 m" },
  { key: "roundPenCurve", label: "Item pierce → penetration curve", min: 0.5, max: 3, step: 0.05, group: "Rounds" },
  { key: "roundSheetHalf", label: "Round sheet half-width (m)", min: 0, max: 2, step: 0.05, group: "Rounds", tip: "Sheet hits: a round hits anything whose hit circle comes within this of its line on the ground" },
  { key: "roundSheetHeight", label: "Round sheet height (m)", min: 1, max: 20, step: 0.5, group: "Rounds", tip: "The sheet reaches from under the ground up to this over its floor (the ground under the gun to the ground under the aim): enough for an excavator's chassis" },
  { key: "roundLine", label: "Round line over the floor (m)", min: 0, max: 5, step: 0.05, group: "Rounds", tip: "Sand costs a round's penetration where it rises over the round's path: the ray from the muzzle to the aim, never lower than this over the floor (Keith 2026-10-26: rounds went through dunes; the tall sheet's top used to be the line)" },
  { key: "roundSplash", label: "Splash radius (m)", min: 0, max: 5, step: 0.1, group: "Rounds", tip: "Where a round ends (sand or body), swarm units this close take a share: rounds into the sand at their feet still count" },
  { key: "roundSplashShare", label: "Splash damage share", min: 0, max: 1.5, step: 0.05, group: "Rounds", tip: "Share of the round's damage at the centre of the splash (half that at its edge)" },
  { key: "hitRadius", label: "Hit size (m)", min: 0.5, max: 3, step: 0.05, group: "Mech health", tip: "Radius of the capsule rounds hit, from the feet up past the hull" },
  { key: "respawn", label: "Rebuilt after (s)", min: 0.5, max: 20, step: 0.5, group: "Mech health", tip: "Lab only: a destroyed player mech stands up again after this long" },
];

export type MechUnitValues = WalkerValues & UpperValues & DustValues & MechValues;

const WRECK = 0x3b3531;
const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** A minigun round's penetration (m) from an item's pierce stat (MechUnit.roundPen). */
export function roundPenFor(v: { roundPen: number; roundPierce: number; roundPenCurve: number }, pierce?: number): number {
  if (pierce === undefined) return v.roundPen;
  return v.roundPen * Math.pow(Math.max(0, pierce) / Math.max(0.1, v.roundPierce), v.roundPenCurve);
}

export class MechUnit implements Hittable {
  readonly sim: WalkerSim;
  readonly upper: UpperSim;
  surface: HitSurface = "metal";
  alive = true;
  health: number;
  /** Seconds since destroyed (for the lab's rebuild). */
  deadFor = 0;
  /** Recent damage taken per second (for a HUD flash). */
  hurt = 0;
  /** Recent hits for the HUD's hit arcs: where each came from (unit x, z on the ground) and how much it took. Newest
   *  last, at most 8; the HUD drains it. */
  readonly hits: { dx: number; dz: number; amount: number }[] = [];
  /** Repair kits carried (src/game/repair.ts): Q uses one (the useKit command). */
  readonly kits: RepairKits;
  /** Timed abilities from the hull and pack (src/abilities/abilities.ts): keys 3 and 4. */
  readonly abilities: Abilities;
  /** Stable id for heal zones and peers ("player" for the local one; allies and enemies their own). */
  uid = "mech";
  /** Paint colour (null: the model's own). */
  paint: number | null = null;
  /** Hull for this mech instead of the shared slider (bandit mechs). */
  hullOverride: number | null = null;
  /** Armour for this mech instead of the shared slider (bandit mechs). */
  armourOverride: number | null = null;
  /** Damage scale on this mech's own rounds (bandit mechs hit softer than the player). */
  damageScale = 1;
  /** Called on each footfall with where and how hard (stomps for infantry, later). */
  onStomp: ((x: number, z: number, strength: number) => void) | null = null;
  /** After each landing's own dust, prints, sound and damage (labs shake the camera, the convoy lab digs a crater). */
  onLanding: ((l: Landing) => void) | null = null;
  /** Each sprinting footfall with its strength (labs shake the camera by sprintShake). */
  onSprintStep: ((k: number) => void) | null = null;
  /** Each frame of a dash: where the mech is and the dash's direction (labs shove their swarms). */
  onDash: ((x: number, z: number, dirX: number, dirZ: number) => void) | null = null;
  readonly dash: Dash;
  /** The sprint (Keith 2026-10-26): Space held past the dash. */
  readonly bound: Bound;
  private wakeAcc = 0;
  /** Space still held: the dash carries on into the sprint. Set by the lab before step (only while driving). */
  dashHold = false;
  /** The shoulder weapon keys 1-4 held (hold to paint, release to fire). Set by the lab before step. */
  keys: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  /** The ground point under the cursor (null: none), and the soft lock, for weapons that paint or lead. */
  cursor: THREE.Vector3 | null = null;
  lock: TargetCandidate | null = null;
  /** Rail cannons, autocannons, the salvo and the mortar (null: miniguns only). */
  weapons: MechWeapons | null = null;
  /** Kneeling for the pilot (src/pilot/mount.ts): hips this far down (m) and the nose this far down (radians). */
  kneel = 0;
  kneelPitch = 0;
  /** A co-op ally's mech (player: true but not the local one): its effects give way to the local player's. */
  ally = false;
  /** A player sits in it (the lab sets it): standing a while, its legs flex now and then. Enemies stay still. */
  piloted = false;
  /** Sprinting with the weapons off (src/mech/bound.ts gunsOff): no weapon fires, paints and charges are dropped. */
  gunsOff = false;
  private fwdAim = { x: 0, y: 0, z: 0 };
  stepTimes: number[] = [];
  private clock = 0;
  private shoulder = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private eject = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(
    private bf: Battlefield,
    readonly v: MechUnitValues,
    readonly body: MechBody,
    private look: ToonLook,
    readonly team: number,
    /** First of the two muzzle-flash slots this mech's guns use (0 for the player: those carry the flash lights). */
    private flashSlot: number,
    /** The player's guns get the full minigun voice and throw brass. */
    readonly player: boolean,
  ) {
    this.sim = new WalkerSim(v, bf.field);
    // Planted feet sit into soft ground by its surface (src/mech/sink.ts).
    // Only into the terrain itself: standing on something else (a convoy deck, src/convoy/deck.ts) it stays on top.
    this.sim.sinkAt = (x, z) => {
      const g = this.sim.ground;
      if (g !== bf.field && Math.abs(g.height(x, z) - bf.field.height(x, z)) > 0.05) return 0;
      return bf.sinkDepth(x, z);
    };
    this.dash = new Dash(v);
    this.bound = new Bound(v);
    this.upper = new UpperSim(v);
    this.health = v.hull;
    this.kits = new RepairKits(v);
    this.abilities = new Abilities(v);
    const sim = this.sim, dust = bf.dust;
    sim.onFootfall = (f, k) => {
      // In the shallows: a splash and rings instead of a print and dust.
      if (bf.inWater(f.planted.x, f.planted.z)) {
        bf.water!.splash(f.planted.x, f.planted.z, 0.6 + k * 0.5, sim.vel.x * 0.1, sim.vel.z * 0.1);
        this.onStomp?.(f.planted.x, f.planted.z, k);
        return;
      }
      bf.marks.print(f.planted.x, f.planted.z, f.plantedYaw, k);
      // Sprint strides come quickly: each throws less than a walking stomp (boundDust).
      dust.stomp(f.planted.x, f.planted.y, f.planted.z, k * (sim.bounding ? v.boundDust * v.sprintKick : sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1), sim.vel.x, sim.vel.z);
      // Sprinting, each footfall lands with weight: a thump and (in labs that shake) a small shake.
      if (sim.running && sim.runK > 0.5) {
        if (v.sprintThump > 0) bf.sfx.play("brap", f.planted, v.sprintThump * Math.min(1.5, k), 0.32 + 0.04 * Math.random(), true);
        this.onSprintStep?.(k);
      }
      this.onStomp?.(f.planted.x, f.planted.z, k);
    };
    // A landing (a drop, a crest, a jump): both feet stomp at once, scaled by how hard it hit; hard ones hurt.
    sim.onLand = (l) => {
      const k = Math.min(2.2, 0.4 + l.impact / 6);
      // A sprint stride's landing already stomped foot by foot: here only the extra burst, the sound and the shake.
      if (l.bound) {
        for (const f of sim.feet) if (!bf.inWater(f.pos.x, f.pos.z)) dust.stomp(f.pos.x, f.pos.y, f.pos.z, k * 0.8, sim.vel.x, sim.vel.z);
        this.a.set(l.x, l.y, l.z);
        bf.sfx.play("brap", this.a, Math.min(1.8, 0.5 + l.hard * 1.1), 0.4, false);
        this.onStomp?.(l.x, l.z, k * 1.5);
        this.onLanding?.(l);
        return;
      }
      if (l.impact > 1.5) {
        for (const f of sim.feet) {
          if (bf.inWater(f.planted.x, f.planted.z)) { bf.water!.splash(f.planted.x, f.planted.z, 0.6 + k * 0.6, sim.vel.x * 0.1, sim.vel.z * 0.1); continue; }
          bf.marks.print(f.planted.x, f.planted.z, f.plantedYaw, k);
          dust.stomp(f.planted.x, f.planted.y, f.planted.z, k * 1.2, sim.vel.x + sim.skid.x, sim.vel.z + sim.skid.z);
        }
        if (l.impact > v.landSoft) {
          this.a.set(l.x, l.y, l.z);
          bf.sfx.play("brap", this.a, Math.min(1.8, 0.5 + l.hard * 1.1), 0.4, false);
        }
      }
      this.onStomp?.(l.x, l.z, k * 1.5);
      if (l.damage > 0) this.damage(l.damage, this.a.set(l.x, l.y, l.z), this.b.set(0, 1, 0));
      this.onLanding?.(l);
    };
    sim.onLiftOff = (f, k) => {
      if (k < 0.15) return;
      if (bf.inWater(f.pos.x, f.pos.z)) { bf.water!.splash(f.pos.x, f.pos.z, 0.25 * k, -Math.sin(sim.heading) * 0.5, -Math.cos(sim.heading) * 0.5, 0.6); return; }
      const hd = sim.heading;
      dust.kick(f.pos.x, f.pos.y, f.pos.z, -Math.sin(hd), -Math.cos(hd), Math.min(1.6, k) * (sim.bounding ? v.boundDust * v.sprintKick : sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1));
      // Sprinting, the push-off throws the mech on: sand burst back off the toes, and the toes dig in (Keith 21:54).
      if (sim.running && sim.runK > 0.5) {
        const t = f.pose.toe;
        if (v.sprintPushDust > 0) dust.kick(t.x, t.y, t.z, -Math.sin(sim.course), -Math.cos(sim.course), Math.min(2, k) * v.sprintPushDust);
        bf.marks.dig(t.x, t.z, sim.course, k * v.sprintToeDig);
      }
      this.stepTimes.push(this.clock);
      while (this.stepTimes.length && this.clock - this.stepTimes[0] > 3) this.stepTimes.shift();
    };
  }

  /**
   * Dash along (x, z) (world; any length): a front-loaded shove that skids the planted feet. Returns true if it went
   * (a charge was free). While it runs, onDash is called each frame with where the mech is and which way it goes.
   */
  /** Each foot's skid point for the dash furrow (x, z, then 1 while skidding). */
  private skidFrom = [new THREE.Vector3(), new THREE.Vector3()];
  /** Each foot's slide dust carry-over (fractional puffs). */
  private slideAcc = [0, 0];

  tryDash(x: number, z: number): boolean {
    if (!this.alive || !this.sim.canDash || !this.dash.start(x, z)) return false;
    this.sim.dash(this.dash.dirX, this.dash.dirZ);
    // The hydraulics bang: a burst of sand off both feet.
    for (const f of this.sim.feet) this.bf.dust.stomp(f.pos.x, f.pos.y, f.pos.z, 1.3, -this.dash.dirX * 4, -this.dash.dirZ * 4);
    this.bf.sfx.play("brap", this.sim.pelvis, 0.9, 0.35, false);
    return true;
  }

  get maxHealth() { return this.hullOverride ?? this.v.hull; }

  reset(x: number, z: number, heading: number) {
    this.sim.reset(x, z, heading);
    this.upper.reset(heading);
    this.health = this.maxHealth;
    this.alive = true;
    this.deadFor = 0;
    this.goCold();
    this.bf.nightLights?.streams.clear();
    this.body.paint(this.look, this.paint);
  }

  /** Advance one frame: legs and guns at 120 Hz, fire whatever the guns fired, pose the model. */
  /** shotAt: where the minigun rounds go, if not the aim (the lab aims the arms ahead of a moving lock, the rounds at it). */
  step(dt: number, cmd: MoveCommand, aim: Aim | null, trigger: Trigger, shotAt: Aim | null = aim) {
    this.clock += dt;
    // A pilot in: the legs may flex now and then while it stands (the walker's idle).
    if (this.piloted && !cmd.idle) cmd = { ...cmd, idle: true };
    this.hurt = Math.max(0, this.hurt - dt * 400);
    // Out of the mech: the weapons go cold (nothing held keeps charging or painting; Keith 2026-10-31).
    if (this.wasPiloted && !this.piloted) this.goCold();
    this.wasPiloted = this.piloted;
    // Dead: the weapons still fly what is already in the air, with every trigger let go.
    if (!this.alive) { this.deadFor += dt; this.weapons?.step(dt, null, false); return; }
    this.heal(this.kits.step(dt));
    this.abilities.step(dt);
    // Braced by the Field weld: rooted where it stands.
    if (this.abilities.braced > 0) cmd = { ...cmd, x: 0, z: 0, sprint: false };
    const { sim, upper, body, v } = this;
    body.shoulderLine(this.shoulder);
    const fired: (1 | -1)[] = [];
    const sub = Math.max(1, Math.ceil(dt * 120));
    const dash = this.dash;
    // Sprinting a while (sprintGunsAfter), the weapons are off (src/mech/bound.ts): no trigger, and the torso, guns and
    // head face the line of travel (turned that share into a drift) with the hull leaning forward by speed.
    const want = { trigger, aim };
    // The legs know where the guns aim (walking far round from it, they step backwards).
    const move: MoveCommand = { ...cmd };
    // A weapon that slows the walk while it fires (the arm missile pod's channel): a shorter stick, not while sprinting.
    const slow = cmd.sprint ? 1 : this.weapons?.moveMul?.() ?? 1;
    if (slow < 1) { const k = slow / Math.max(1, Math.hypot(move.x, move.z)); move.x *= k; move.z *= k; }
    for (let i = 0; i < sub; i++) {
      // Space held past the dash: the sprint (the walker runs its gait).
      this.bound.update(dt / sub, this.dashHold, sim, dash);
      this.gunsOff = this.bound.gunsOff && this.alive;
      if (this.gunsOff) { trigger = false; aim = this.travelAim(); } else { trigger = want.trigger; aim = want.aim; }
      upper.leanFwd = this.gunsOff ? v.sprintHullLean * D2R * clamp((sim.speed - v.walkSpeed) / Math.max(0.5, (sim.boundTopNow || v.boundTop) - v.walkSpeed), 0, 1) : 0;
      // The slope along the slide: + uphill. Read a couple of metres either side of the body.
      const gx = dash.dirX * 2, gz = dash.dirZ * 2, f = this.bf.field;
      const grade = dash.active ? (f.height(sim.pos.x + gx, sim.pos.z + gz) - f.height(sim.pos.x - gx, sim.pos.z - gz)) / 4 : 0;
      dash.update(dt / sub, grade);
      // The walker's steps (src/mech/dashSteps.ts) move the body, crouch and lean it; the shove (dash.ts) only times the
      // damage cut and the crowd shove now.
      sim.push.set(0, 0, 0);
      sim.crouch = this.kneel;
      sim.leanPitch = this.kneelPitch;
      sim.leanRoll = 0;
      const wasDashing = sim.inDash;
      // Where the guns are aimed (none: the legs always turn to the travel; a torso with nothing to aim at follows them).
      move.face = cmd.face ?? (aim ? Math.atan2(aim.x - sim.pos.x, aim.z - sim.pos.z) : undefined);
      sim.update(dt / sub, move);
      // Its steps and burst done (2026-10-31: the burst, not just the steps), the shove is over too: it times the damage
      // cut and the crowd shove through the whole burst.
      if (wasDashing && !sim.inDash) dash.cut();
      for (const s of upper.update(dt / sub, sim.heading, this.shoulder, aim, body.armed ? trigger : false)) fired.push(s);
    }
    body.update(sim, upper);
    body.aimSensor?.(dt, aim, v);
    // Wading: the body pushes a wake (rings dropped as it moves, overlapping into a V).
    const bf = this.bf;
    if (bf.water) {
      const moved = Math.hypot(sim.vel.x, sim.vel.z) * dt + Math.hypot(dash.vx, dash.vz) * dt;
      if (moved > 0 && bf.inWater(sim.pos.x, sim.pos.z, 0.15)) {
        this.wakeAcc = bf.water.wake(sim.pos.x, sim.pos.z, moved, this.wakeAcc, 0.7, 1.4);
        if (dash.active && Math.random() < dt * 25) for (const f of sim.feet) bf.water.splash(f.pos.x, f.pos.z, 0.8, dash.dirX, dash.dirZ, 0.8);
      }
    }
    // Any skidding foot (the dash's slide, a drift in the sprint, a landing skid, sliding down a face) carves the ground:
    // sand thrown along it by the slide's speed and the surface, and a furrow in the dents (Keith 2026-10-26 18:28).
    sim.feet.forEach((f, i) => {
      const from = this.skidFrom[i], sp = Math.hypot(f.slide.x, f.slide.z);
      if (f.swinging || sp < v.slideMin) { from.z = 0; this.slideAcc[i] = 0; return; }
      if (bf.inWater(f.pos.x, f.pos.z)) { if (Math.random() < dt * 20) bf.water!.splash(f.pos.x, f.pos.z, 0.6, f.slide.x / sp, f.slide.z / sp, 0.6); from.z = 0; return; }
      this.slideAcc[i] = bf.dust.slide(f.pos.x, f.pos.y, f.pos.z, f.slide.x, f.slide.z, dt, this.slideAcc[i]);
      // A furrow from where the foot was last frame (a skid that just started begins here).
      if (from.z === 0) from.set(f.pos.x, f.pos.z, 1);
      bf.marks.furrow(from.x, from.y, f.pos.x, f.pos.z, 0.9, dt);
      from.set(f.pos.x, f.pos.z, 1);
    });
    // Whatever is in the dash's way gets shoved (the lab decides what that is).
    if (dash.active) this.onDash?.(sim.pos.x, sim.pos.z, dash.dirX, dash.dirZ);
    // Sprinting through a crowd shoves it aside like a dash.
    if (!dash.active && sim.bounding && sim.speed > 6) this.onDash?.(sim.pos.x, sim.pos.z, Math.sin(sim.course), Math.cos(sim.course));
    const left = leftOf(upper.torsoYaw);
    for (const s of fired) {
      // A gun with its own item values (src/items) fires with those; else the shared sliders.
      const own = upper.guns[s === 1 ? 0 : 1].stats;
      if (own?.cls && own.cls !== "minigun") { this.weapons?.shot(s); continue; }
      // Off the ground (a leap, a jump), the guns spray wider.
      const spread = (((own?.spread ?? v.spread) + (sim.airborne ? v.airGunSpread : 0)) * Math.PI) / 180;
      body.muzzle(s, this.muzzle);
      body.barrel(s, this.dir);
      // A gun only fires once its barrel is inside the fire cone (upper.ts), so the round flies from the real muzzle
      // straight to the aim, like the autocannon. Using the barrel's own heading carried the arm's swing lag (the
      // outward arm turns slower) and the gap between the model's muzzle and the sim's shoulder, so on small targets
      // the left gun's rounds landed off to the left (Keith 2026-10-25). Before that, the barrel's pitch put rounds
      // ~2 m low at 20 m (Keith: "very hard to hit"). The barrel's heading stays the fallback with no aim.
      const at = shotAt ?? aim;
      if (at) {
        const flat = Math.hypot(at.x - this.muzzle.x, at.z - this.muzzle.z);
        if (flat > 1) this.dir.set(at.x - this.muzzle.x, at.y - this.muzzle.y, at.z - this.muzzle.z).normalize();
      }
      const tilt = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
      const d = this.dir.clone().add(tilt.addScaledVector(this.dir, -tilt.dot(this.dir))).normalize();
      if (this.player) body.eject(s, this.eject);
      // Ignited rounds (Keith 2026-10-30): this side's feed has them loaded; what they hit burns.
      const special = this.weapons?.rounds?.(s) ?? null;
      const proto = special ? { ...own?.proto, burn: { time: special.burnTime, dps: special.burnDps } } : own?.proto;
      // Armour pierce: the gun's own (an item's), else the slider; special rounds add theirs (armour-piercing, later).
      const ap = Math.min(1, (own?.ap ?? v.roundAp) + (special?.ap ?? 0));
      this.bf.fire(this.flashSlot + (s === 1 ? 0 : 1), this.team, this.muzzle, d, own?.range ?? v.range, (own?.damage ?? v.roundDamage) * this.damageScale, this.player
        ? { eject: this.eject, outboard: left.clone().multiplyScalar(s), voice: "player", ally: this.ally, sheet: { half: v.roundSheetHalf, height: v.roundSheetHeight, line: v.roundLine, pen: this.roundPen(own?.pierce), aim: at }, splash: v.roundSplash, splashShare: v.roundSplashShare, proto, hot: !!special, pierce: ap }
        : { voice: "other", hitScale: 0.7, proto: special ? proto : undefined, hot: !!special, pierce: ap });
    }
    // The other weapons see what the guns saw: with the weapons off, no trigger (they drop paints and charges, gunsOff).
    this.weapons?.step(dt, aim, trigger);
    if (this.player && body.armed) {
      const guns = upper.guns.filter((g) => g.enabled && (!g.stats?.cls || g.stats.cls === "minigun"));
      this.bf.gunAudio.update(this, dt, guns.some((g) => triggerOf(trigger, g.side === 1 ? 0 : 1)), guns, guns.map((g) => body.muzzle(g.side, new THREE.Vector3())));
    }
  }

  /** Where the torso looks with the weapons off: far along the line of travel (turned sprintFaceDrift into a drift), level with the shoulders. */
  private travelAim(): Aim {
    const sim = this.sim, d = Math.atan2(Math.sin(sim.heading - sim.course), Math.cos(sim.heading - sim.course));
    const yaw = (sim.running || sim.bounding ? sim.course : sim.heading) + d * this.v.sprintFaceDrift;
    const a = this.fwdAim;
    a.x = this.shoulder.x + Math.sin(yaw) * 40; a.z = this.shoulder.z + Math.cos(yaw) * 40; a.y = this.shoulder.y;
    return a;
  }

  /**
   * A minigun round's penetration budget (m): the hull minigun's slider, or an item's pierce stat read against it
   * (penetration × (pierce / roundPierce) ^ roundPenCurve) until items carry penetration in metres.
   */
  roundPen(pierce?: number): number { return roundPenFor(this.v, pierce); }

  /** Rounds hit a capsule from the feet up past the hull. */
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    const p = this.sim.pelvis;
    this.a.set(p.x, p.y - 2.4, p.z);
    this.b.set(p.x, p.y + 1.6, p.z);
    return rayCapsule(o, d, this.a, this.b, this.v.hitRadius, maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  /** A blast at a point: hurt if it reaches the hull's capsule, full at the centre, half at the edge. */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, o?: SplashOpts) {
    if (!this.alive) return 0;
    const p = this.sim.pelvis;
    const y = Math.min(Math.max(at.y, p.y - 2.4), p.y + 1.6);
    const d = Math.max(0, Math.hypot(at.x - p.x, at.y - y, at.z - p.z) - this.v.hitRadius);
    if (d > radius) return 0;
    this.damage(damage * (1 - 0.5 * d / Math.max(0.01, radius)), at, dir, o?.pierce);
    return 1;
  }

  /** Flat armour per hit (src/game/armour.ts): the hull's. */
  armourOf() { return this.armourOverride ?? this.v.armour; }

  /** Health bar (an enemy mech's: the bars skip the player's team): always on, over the hull. */
  bars(out: import("../ui/healthBars").BarEntry[]) {
    if (!this.alive) return;
    const p = this.sim.pelvis;
    out.push({ key: this, x: p.x, y: p.y + 3.4, z: p.z, hp: this.health, max: this.maxHealth, armour: this.armourOf(), width: 3.6, always: true });
  }

  /** The useKit command (Q): start a repair kit; why not, or null when it started. */
  useKit(): KitRefusal | null { return this.kits.use(this.health, this.maxHealth, this.alive); }

  /** Repair: up to the max hull, never on a wreck. Returns what it added. */
  heal(amount: number) {
    if (!this.alive || amount <= 0) return 0;
    const add = Math.min(amount, this.maxHealth - this.health);
    if (add <= 0) return 0;
    this.health += add;
    return add;
  }

  /** This mech as a heal zone sees it (src/abilities/zones.ts). */
  healTarget(): HealTarget {
    const self = this;
    return {
      get id() { return self.uid; }, get team() { return self.team; }, get x() { return self.sim.pelvis.x; }, get z() { return self.sim.pelvis.z; },
      get alive() { return self.alive; }, get max() { return self.maxHealth; }, heal: (n) => self.heal(n),
    };
  }

  damage(amount: number, at: THREE.Vector3, dir: THREE.Vector3, pierce?: number) {
    if (!this.alive) return;
    amount = armourHit(amount, this.armourOf(), pierce);
    if (this.dash.shoving) amount *= this.v.dashDamageCut;
    amount *= this.abilities.damageScale;
    this.health -= amount;
    this.hurt += amount;
    void at;
    // Where it came from: against the round's travel (a blast's push points away from it too).
    const l = Math.hypot(dir.x, dir.z);
    if (l > 1e-4) {
      const last = this.hits[this.hits.length - 1];
      const dx = -dir.x / l, dz = -dir.z / l;
      // Rounds from one gun in one step merge into one arc.
      if (last && last.dx * dx + last.dz * dz > 0.97) last.amount += amount;
      else { this.hits.push({ dx, dz, amount }); if (this.hits.length > 8) this.hits.shift(); }
    }
    if (this.health <= 0) this.destroy();
  }

  private wasPiloted = false;
  /** Weapons cold: triggers released without firing, charges, paints, lasers and feed effects dropped, the gun loops faded out. */
  goCold() {
    this.weapons?.stop?.();
    for (const g of this.upper.guns) g.firing = false;
    this.bf.gunAudio.release(this);
  }

  private destroy() {
    this.alive = false;
    this.health = 0;
    this.deadFor = 0;
    this.kits.cut();
    this.goCold();
    this.body.paint(this.look, WRECK);
    // A burst of dark smoke and sand where it went down.
    const p = this.sim.pelvis, dust = this.bf.dust;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      dust.smoke(p.x + Math.cos(a), p.y - 1 + Math.random() * 2, p.z + Math.sin(a), Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s,
        0.8 + Math.random() * 0.8, 3 + Math.random() * 3, 0.85, 0.75);
    }
    this.bf.dust.stomp(p.x, p.y - 3, p.z, 2.5);
  }
}

/** Distance along a unit ray to a capsule (segment a-b, radius r), or -1. */
/** Outward normal of a capsule (axis a-b) at a point on its surface. */
export function capsuleNormal(at: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((at.x - a.x) * abx + (at.y - a.y) * aby + (at.z - a.z) * abz) / l2));
  out.set(at.x - (a.x + abx * t), at.y - (a.y + aby * t), at.z - (a.z + abz * t));
  return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 1, 0);
}

export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, maxDist: number): number {
  // Closest approach between the ray and the segment, then a sphere test there (good enough for hits).
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const aox = o.x - a.x, aoy = o.y - a.y, aoz = o.z - a.z;
  const dd = 1, ee = abx * abx + aby * aby + abz * abz, de = d.x * abx + d.y * aby + d.z * abz;
  const dao = d.x * aox + d.y * aoy + d.z * aoz, eao = abx * aox + aby * aoy + abz * aoz;
  const den = dd * ee - de * de;
  let s = den > 1e-6 ? (de * eao - ee * dao) / den : 0; // along the ray
  let t = ee > 1e-6 ? (eao + s * de) / ee : 0; // along the segment
  t = Math.max(0, Math.min(1, t));
  // Re-solve s for the clamped t.
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  s = (cx - o.x) * d.x + (cy - o.y) * d.y + (cz - o.z) * d.z;
  if (s < 0 || s > maxDist + r) return -1;
  const px = o.x + d.x * s - cx, py = o.y + d.y * s - cy, pz = o.z + d.z * s - cz;
  const dist2 = px * px + py * py + pz * pz;
  if (dist2 > r * r) return -1;
  const back = Math.sqrt(r * r - dist2);
  const hit = s - back;
  return hit >= 0 && hit <= maxDist ? hit : -1;
}
