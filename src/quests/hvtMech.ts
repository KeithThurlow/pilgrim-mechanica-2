// A high value target on the field (glue; docs/proposal-quests.md): one rival Rampart, the duel lab's brain
// (src/combat/rivalAi.ts) and rolled loadouts (src/combat/rivalKit.ts), put down where hvt.ts summons it and fighting
// the player's mech inside its lair's circle. Its body loads on the first summon (one extra Rampart, reused after).
// Summoner gear it rolls (a drone rack, a swarm hive, a replica bay) brings its summons on its side, aimed at the
// player's team only (2026-11-04, as the duel lab's rival), its brain pressing the keys; dismissed when it goes.
// Host owned (rule 12): its health, its loadout (seeded by the lair), its brain and its summons; drawing is cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import { MechUnit, type MechUnitValues } from "../game/mechUnit";
import { applyLoadout } from "../game/loadoutApply";
import { lineOfSight } from "../game/duelGround";
import { Arsenal } from "../weapons/arsenal";
import { ArsenalDraw } from "../weapons/arsenalDraw";
import type { WeaponValues } from "../weapons/tuning";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_LEVELS, type RivalAiValues } from "../combat/rivalAi";
import { kitOf, rollRivalLoadout, type KitWeapon } from "../combat/rivalKit";
import { ThreatIds, duelView, threatsFrom } from "../combat/duelThreats";
import { resolve, type LOADOUT_DEFAULTS } from "../items/loadout";
import type { LootValues } from "../items/generate";
import type { Lair, HvtValues } from "./hvt";
import { Summons, type SummonValues } from "../summon/summons";
import { SummonKeys } from "../summon/summonKeys";
import { applyGear } from "../summon/gear";
import { FLAG } from "../game/register";
import type { Resolved } from "../items/loadout";
import type { DeathPhysics } from "../physics/deaths";

/** HVT paint: soot black (the rival military is blue-grey, bandits red). */
export const HVT_PAINT = 0x2b2622;

export interface HvtSetup {
  look: ToonLook;
  loadBody: () => Promise<RampartBody>;
  /** The player's weapons, for the brain's dodging (what's in the air). */
  threat: () => { arsenal: Arsenal; wv: WeaponValues } | null;
  /** For summoner gear: the summons' sliders (copied, the gear's counts put in) and the death physics. Left out: none. */
  summons?: { values: SummonValues; deaths: DeathPhysics | null };
}

type Values = MechUnitValues & WeaponValues & LootValues & HvtValues & typeof LOADOUT_DEFAULTS;

export class HvtMech {
  unit: MechUnit | null = null;
  lair: Lair | null = null;
  private body: RampartBody | null = null;
  private arsenal: Arsenal | null = null;
  private draw: ArsenalDraw | null = null;
  private ai: RivalAi;
  private kit: KitWeapon[] = [];
  private ids = new ThreatIds();
  private loading: Promise<void> | null = null;
  private t = 0;
  private cursor = new THREE.Vector3();
  private rv: Values & RivalAiValues;
  setup: HvtSetup | null = null;
  /** Its loadout's item level (for the HUD). */
  level = 1;
  /** It died this frame (the glue reads and clears it). */
  died = false;
  /** Alive as of the last step (whatever kills it, inside its step or not, is seen on the next). */
  private wasAlive = false;
  /** Its summons (made on the first spawn with summoner gear, reused after) and the keys its brain presses. */
  summons: Summons | null = null;
  private summonKeys: SummonKeys | null = null;
  private sv = {} as SummonValues;
  private fit: Resolved | null = null;

  constructor(private bf: Battlefield, private scene: THREE.Scene, v: Values, private player: MechUnit) {
    this.rv = { ...v, ...RIVAL_AI_DEFAULTS, ...(RIVAL_LEVELS.veteran as Partial<RivalAiValues>) } as Values & RivalAiValues;
    this.ai = new RivalAi(this.rv, 1);
  }

  /** On the field and alive? */
  get alive() { return !!this.unit && !!this.lair && this.unit.alive; }
  /** For the register (soft lock, the player's weapons): the mech while it's on the field. */
  list(): MechUnit[] { return this.unit && this.lair ? [this.unit] : []; }

  private async load() {
    const s = this.setup!;
    const body = await s.loadBody();
    this.body = body;
    body.root.visible = false;
    this.scene.add(body.root);
    const unit = new MechUnit(this.bf, this.rv, body, s.look, 2, 20, false);
    unit.paint = HVT_PAINT;
    body.paint(s.look, HVT_PAINT);
    const p = this.player;
    const foe = () => ({ x: p.sim.pelvis.x, y: p.sim.pelvis.y + 0.6, z: p.sim.pelvis.z, r: this.rv.hitRadius, key: "foe", vx: p.sim.vel.x, vz: p.sim.vel.z });
    this.arsenal = new Arsenal(this.bf, unit, this.rv, s.look, () => (p.alive ? [foe()] : []));
    this.arsenal.findTarget = (key) => (key === "foe" && p.alive ? foe() : null);
    unit.weapons = this.arsenal;
    this.draw = new ArsenalDraw(this.arsenal, this.bf.field, () => this.bf.nightLights);
    this.scene.add(this.draw.group);
    this.unit = unit;
  }

  /**
   * Put the lair's mech down at (x, z), facing the lair, its items rolled at `level` (seeded by the lair). Resolves
   * false when it can't (no setup: headless, or the body failed to load).
   */
  async spawn(lair: Lair, x: number, z: number, level: number): Promise<boolean> {
    if (!this.setup) return false;
    try { if (!this.unit) await (this.loading ??= this.load()); } catch { return false; }
    const unit = this.unit!, v = this.rv;
    this.level = Math.max(1, Math.round(level));
    const lo = rollRivalLoadout(lair.seed, v, { level: this.level });
    const r = resolve(lo, { ...v, bareDashCharges: v.rivalBareDashCharges });
    applyLoadout(unit, r);
    unit.hullOverride = Math.round(r.values.hull * v.hvtHull);
    this.kit = kitOf(r, v);
    this.fit = r;
    this.fitSummons(r);
    unit.reset(x, z, Math.atan2(lair.x - x, lair.z - z));
    unit.health = unit.maxHealth;
    unit.body.paint(this.setup.look, HVT_PAINT);
    unit.upper.resupply();
    unit.dash.charges = Math.round(v.dashCharges);
    this.ai = new RivalAi(this.rv, lair.seed % 100000);
    this.lair = lair;
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
      // Only the player's side (their mech, pilot and summons), not the robots and bandits round the lair.
      const foes = { all: FLAG.Hittable, none: FLAG.Down, team: this.player.team };
      this.summons = new Summons(this.bf, this.scene, this.sv, this.bf.field, u, foes, ss.deaths, { look: this.setup!.look });
      this.summonKeys = new SummonKeys(this.summons);
    }
    this.summons.setActive(gear);
  }

  /** Off the field (gone to ground, or its wreck cleared). */
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
    this.lair = null;
  }

  /** One frame: its view of the fight, its commands, its step. */
  step(dt: number) {
    const u = this.unit, lair = this.lair;
    if (!u || !lair) return;
    this.t += dt;
    const p = this.player, v = this.rv;
    let cmd = null;
    if (u.alive && p.alive) {
      const ts = this.setup?.threat();
      const threats = ts ? threatsFrom(ts.arsenal, p.team, this.bf.shells, ts.wv, this.ids) : [];
      const field = this.bf.field;
      const sees = (ax: number, az: number, bx: number, bz: number) => lineOfSight((x, z) => field.height(x, z), [], ax, az, bx, bz);
      const view = duelView(this.t, u, this.kit, this.arsenal!, p, threats, [], sees, { x: lair.x, z: lair.z, r: v.hvtArena });
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
    u.step(dt, cmd?.move ?? { x: 0, z: 0, sprint: false }, cmd?.aim ?? null, cmd?.trigger ?? false, cmd?.shotAt ?? null);
    this.summonKeys?.update(this.fit, !!cmd?.keys[0], !!cmd?.keys[1]);
    this.draw!.update();
    if (this.wasAlive && !u.alive) { this.died = true; this.summons?.setActive(false); }
    this.wasAlive = u.alive;
  }

  /** Its summons' frame, every frame whether it's on the field or not (dismissed ones finish going). */
  stepSummons(dt: number) { this.summons?.update(dt); }

  /** Its meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.body && this.lair ? [this.body.root] : []; }

  /** Where it is (for drops, marks, the radar). */
  get pos() { return this.unit ? this.unit.sim.pelvis : null; }
}
