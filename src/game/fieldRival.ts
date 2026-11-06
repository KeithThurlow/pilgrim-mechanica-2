// A rival mech out on the field (glue): one Rampart run by the duel lab's brain (src/combat/rivalAi.ts) on a rolled
// loadout (src/combat/rivalKit.ts), fighting the player's mech inside a circle (its arena). The duel's rules come with
// it: a rival level (Recruit, Veteran, Ace) sets its aim lag, reaction and hull share, and its items roll at a level
// the caller picks (usually the player's own plus or minus a few), so it is about the player's equal and beatable.
// Used by the high value targets (src/quests/hvtMech.ts) and the fortress mechs (src/expedition/fortMechs.ts).
// Its body loads on the first put (one Rampart each, reused after). Summoner gear it rolls brings its summons on its
// side, aimed at the player's team only, its brain pressing the keys; dismissed when it goes.
// Host owned (rule 12): its health, its loadout (seeded by the caller), its brain and its summons; drawing is cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "./battlefield";
import { MechUnit, type MechUnitValues } from "./mechUnit";
import { applyLoadout } from "./loadoutApply";
import { lineOfSight } from "./duelGround";
import { Arsenal } from "../weapons/arsenal";
import { ArsenalDraw } from "../weapons/arsenalDraw";
import type { WeaponValues } from "../weapons/tuning";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_LEVELS, type RivalAiValues, type RivalLevel } from "../combat/rivalAi";
import { kitOf, rollRivalLoadout, type KitWeapon } from "../combat/rivalKit";
import { ThreatIds, duelView, threatsFrom } from "../combat/duelThreats";
import { resolve, type LOADOUT_DEFAULTS } from "../items/loadout";
import type { LootValues } from "../items/generate";
import { Summons, type SummonValues } from "../summon/summons";
import { SummonKeys } from "../summon/summonKeys";
import { applyGear } from "../summon/gear";
import { FLAG } from "./register";
import type { Resolved } from "../items/loadout";
import type { DeathPhysics } from "../physics/deaths";

export interface RivalSetup {
  look: ToonLook;
  loadBody: () => Promise<RampartBody>;
  /** The player's weapons, for the brain's dodging (what's in the air). */
  threat: () => { arsenal: Arsenal; wv: WeaponValues } | null;
  /** For summoner gear: the summons' sliders (copied, the gear's counts put in) and the death physics. Left out: none. */
  summons?: { values: SummonValues; deaths: DeathPhysics | null };
  /** The mean item level of the player's loadout (rivals roll theirs relative to it); left out: 1. */
  playerLevel?: () => number;
}

export type FieldRivalValues = MechUnitValues & WeaponValues & LootValues & typeof LOADOUT_DEFAULTS & { rivalBareDashCharges: number; dashCharges: number; hitRadius: number };

export interface RivalPut {
  /** Seeds its loadout and its brain. */
  seed: number;
  x: number; z: number;
  /** Heading it stands facing (radians). */
  face: number;
  /** Its items' level. */
  level: number;
  /** Where it fights (it keeps inside this circle). */
  arena: { x: number; z: number; r: number };
  /** Its hull × on the loadout's hull. */
  hull: number;
  /** Its brain's preset. */
  ai: RivalLevel;
  paint: number;
}

export class FieldRival {
  unit: MechUnit | null = null;
  setup: RivalSetup | null = null;
  /** Its loadout's item level (for the HUD). */
  level = 1;
  /** It died this frame (the glue reads and clears it). */
  died = false;
  /** Placed on the field (alive or a wreck)? */
  placed = false;
  /** Its summons (made on the first put with summoner gear, reused after). */
  summons: Summons | null = null;
  arena = { x: 0, z: 0, r: 30 };
  protected rv: FieldRivalValues & RivalAiValues;
  private body: RampartBody | null = null;
  private arsenal: Arsenal | null = null;
  private draw: ArsenalDraw | null = null;
  private ai: RivalAi;
  private kit: KitWeapon[] = [];
  private ids = new ThreatIds();
  private loading: Promise<void> | null = null;
  private t = 0;
  private cursor = new THREE.Vector3();
  private wasAlive = false;
  private summonKeys: SummonKeys | null = null;
  private sv = {} as SummonValues;
  private fit: Resolved | null = null;

  constructor(protected bf: Battlefield, private scene: THREE.Scene, v: FieldRivalValues, protected player: MechUnit) {
    this.rv = { ...v, ...RIVAL_AI_DEFAULTS, ...(RIVAL_LEVELS.veteran as Partial<RivalAiValues>) } as FieldRivalValues & RivalAiValues;
    this.ai = new RivalAi(this.rv, 1);
  }

  /** On the field and alive? */
  get alive() { return this.placed && !!this.unit && this.unit.alive; }
  /** For the register (soft lock, the player's weapons): the mech while it's on the field. */
  list(): MechUnit[] { return this.unit && this.placed ? [this.unit] : []; }

  private async load() {
    const s = this.setup!;
    const body = await s.loadBody();
    this.body = body;
    body.root.visible = false;
    this.scene.add(body.root);
    const unit = new MechUnit(this.bf, this.rv, body, s.look, 2, 20, false);
    const p = this.player;
    const foe = () => ({ x: p.sim.pelvis.x, y: p.sim.pelvis.y + 0.6, z: p.sim.pelvis.z, r: this.rv.hitRadius, key: "foe", vx: p.sim.vel.x, vz: p.sim.vel.z });
    this.arsenal = new Arsenal(this.bf, unit, this.rv, s.look, () => (p.alive ? [foe()] : []));
    this.arsenal.findTarget = (key) => (key === "foe" && p.alive ? foe() : null);
    unit.weapons = this.arsenal;
    this.draw = new ArsenalDraw(this.arsenal, this.bf.field, () => this.bf.nightLights);
    this.scene.add(this.draw.group);
    this.unit = unit;
  }

  /** Load its body now (so a later put is instant); false when it can't (no setup: headless, or it failed). */
  async ready(): Promise<boolean> {
    if (!this.setup) return false;
    try { if (!this.unit) await (this.loading ??= this.load()); } catch { return false; }
    return true;
  }

  /** Put it down with a fresh loadout and full health. Resolves false when it can't (no setup, or no body). */
  async put(o: RivalPut): Promise<boolean> {
    if (!(await this.ready())) return false;
    const unit = this.unit!, v = this.rv;
    Object.assign(v, RIVAL_AI_DEFAULTS, RIVAL_LEVELS[o.ai] as Partial<RivalAiValues>);
    this.level = Math.max(1, Math.round(o.level));
    const lo = rollRivalLoadout(o.seed, v, { level: this.level });
    const r = resolve(lo, { ...v, bareDashCharges: v.rivalBareDashCharges });
    applyLoadout(unit, r);
    unit.hullOverride = Math.round(r.values.hull * o.hull);
    this.kit = kitOf(r, v);
    this.fit = r;
    this.fitSummons(r);
    unit.reset(o.x, o.z, o.face);
    unit.health = unit.maxHealth;
    unit.paint = o.paint;
    unit.body.paint(this.setup!.look, o.paint);
    unit.upper.resupply();
    unit.dash.charges = Math.round(v.dashCharges);
    this.ai = new RivalAi(this.rv, o.seed % 100000);
    this.arena = { ...o.arena };
    this.placed = true;
    this.t = 0;
    this.died = false;
    this.wasAlive = true;
    this.body!.root.visible = true;
    if (!this.bf.targets.includes(unit)) this.bf.targets.push(unit);
    return true;
  }

  /** Summoner gear on: its summons out (made the first time), the gear's counts in. None fitted: dismissed. */
  private fitSummons(r: Resolved) {
    const ss = this.setup?.summons, sm = r.summons, u = this.unit!;
    const gear = sm.replicas + sm.drones + sm.scrappers > 0;
    if (!ss || (!gear && !this.summons)) return;
    Object.assign(this.sv, ss.values);
    applyGear(this.sv, r);
    if (!this.summons) {
      // Only the player's side (their mech, pilot and summons), not the robots and bandits round it.
      const foes = { all: FLAG.Hittable, none: FLAG.Down, team: this.player.team };
      this.summons = new Summons(this.bf, this.scene, this.sv, this.bf.field, u, foes, ss.deaths, { look: this.setup!.look });
      this.summonKeys = new SummonKeys(this.summons);
    }
    this.summons.setActive(gear);
  }

  /** Off the field. */
  despawn() {
    this.summons?.setActive(false);
    const u = this.unit;
    if (u) {
      u.goCold();
      const k = this.bf.targets.indexOf(u);
      if (k >= 0) this.bf.targets.splice(k, 1);
      u.keys = [false, false, false, false];
    }
    if (this.body) this.body.root.visible = false;
    this.placed = false;
  }

  /**
   * One frame: its view of the fight, its commands, its step. Not fighting (`fight` false): it walks back to the
   * middle of its arena and stands, guns cold.
   */
  step(dt: number, fight = true) {
    const u = this.unit;
    if (!u || !this.placed) return;
    this.t += dt;
    const p = this.player;
    let cmd = null;
    if (u.alive && p.alive && fight) {
      const ts = this.setup?.threat();
      const threats = ts ? threatsFrom(ts.arsenal, p.team, this.bf.shells, ts.wv, this.ids) : [];
      const field = this.bf.field;
      const sees = (ax: number, az: number, bx: number, bz: number) => lineOfSight((x, z) => field.height(x, z), [], ax, az, bx, bz);
      const view = duelView(this.t, u, this.kit, this.arsenal!, p, threats, [], sees, this.arena);
      const rs = this.summons, sm = this.fit?.summons;
      if (rs && sm && rs.active) view.self.summon = { droneKeys: sm.droneKeys, swarmKeys: sm.swarmKeys, strikeReady: rs.strikeCool <= 0, drones: rs.drones.flying, swarmOut: rs.allies.mode === "sent", scrappers: rs.allies.scrappers, swarmMax: this.sv.swarmCount };
      cmd = this.ai.decide(view, dt);
    }
    this.arsenal!.railSnapped = this.ai.snapped;
    u.keys = cmd ? cmd.keys : [false, false, false, false];
    u.cursor = cmd?.cursor ? this.cursor.set(cmd.cursor.x, this.bf.field.height(cmd.cursor.x, cmd.cursor.z), cmd.cursor.z) : null;
    u.lock = cmd?.lock ?? null;
    u.dashHold = !!cmd?.dashHold;
    if (cmd?.power) u.weapons?.powerCut?.();
    if (cmd?.dash) u.tryDash(cmd.dash.x, cmd.dash.z, false);
    let move = cmd?.move ?? { x: 0, z: 0, sprint: false };
    if (!cmd && u.alive) {
      const s = u.sim.pelvis, hx = this.arena.x - s.x, hz = this.arena.z - s.z, hd = Math.hypot(hx, hz);
      if (hd > 3) move = { x: (hx / hd) * 0.5, z: (hz / hd) * 0.5, sprint: false };
    }
    u.step(dt, move, cmd?.aim ?? null, cmd?.trigger ?? false, cmd?.shotAt ?? null);
    this.summonKeys?.update(this.fit, !!cmd?.keys[0], !!cmd?.keys[1]);
    this.draw!.update();
    if (this.wasAlive && !u.alive) { this.died = true; this.summons?.setActive(false); }
    this.wasAlive = u.alive;
  }

  /** Its summons' frame, every frame whether it's on the field or not (dismissed ones finish going). */
  stepSummons(dt: number) { this.summons?.update(dt); }

  /** Its meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.body && this.placed ? [this.body.root] : []; }

  /** Where it is (for drops, marks, the radar). */
  get pos() { return this.unit ? this.unit.sim.pelvis : null; }
}
