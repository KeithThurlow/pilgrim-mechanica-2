// The expedition loop wired into the convoy lab (glue; the rules live in expedition.ts, fuel.ts, returnPoint.ts and
// radar.ts): POIs and salvage out in the sand (sites.ts), swarm camps (swarmCamps.ts), the state machine fed from the
// crane's states (dropped on the sand = launched, gripped by the crane = picked up, banked), fuel burnt from what the
// mech does, the return point and the fuel warning, the radar scope and the HUD, the fade and the trip home.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { ConvoyRoute } from "../convoy/route";
import type { Convoy } from "../convoy/platform";
import type { CraneCarry } from "../convoy/carry";
import type { MoveCommand } from "../mech/walker";
import type { Aim } from "../mech/upper";
import { ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN } from "../combat/robots";
import { INFANTRY_DEFAULTS, INFANTRY_PARAMS } from "../combat/infantry";
import { BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS } from "../combat/infantryDraw";
import type { BanditVatData } from "../combat/banditVat";
import { WARBAND_DEFAULTS, WARBAND_PARAMS } from "../combat/warband";
import { BanditField, BANDIT_DEFAULTS, BANDIT_PARAMS, BANDIT_GROUPS } from "./banditCamps";
import { WarColumns, COLUMN_DEFAULTS, COLUMN_PARAMS } from "./warColumns";
import { BanditCamps, WarBands } from "./humans";
import { Fortresses, FORT_LIFE_DEFAULTS, FORT_LIFE_PARAMS } from "./fortresses";
import { Hubs, HUB_LIFE_DEFAULTS, HUB_LIFE_PARAMS } from "./hubs";
import { Warlord } from "./warlord";
import { Skirmishes, packSource, aftermathSite, clashDrops } from "./fights";
import { FACTION_DEFAULTS, FACTION_PARAMS, FACTION_GROUPS, Relations, FightDirector, type FightGroup } from "../game/factions";
import type { Register } from "../game/register";
import { ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../combat/robotTearFx";
import { POI_PARAMS } from "../world/pois";
import { SITE_PARAMS } from "../pois/kinds";
import { SALVAGE_PARAMS } from "../pois/salvage";
import { SALVAGE_FX_PARAMS } from "../pois/salvageDraw";
import { Expedition, EXPEDITION_DEFAULTS, EXPEDITION_PARAMS, ON_SAND as SAND } from "./expedition";
import { Fuel, FUEL_DEFAULTS, FUEL_PARAMS, fuelWarning } from "./fuel";
import { returnPoint, craneTracks, clock, RETURN_DEFAULTS, RETURN_PARAMS, type ReturnPoint, type CraneTrack } from "./returnPoint";
import { RadarZoom, RADAR_DEFAULTS, RADAR_PARAMS, linked, radarPicture, type RadarWorld } from "./radar";
import { Seeker, SEEKER_DEFAULTS, SEEKER_PARAMS, seekNearest } from "./seekers";
import { RadarDraw } from "./radarDraw";
import { RadarSound } from "./radarSound";
import { CampField, CAMP_DEFAULTS, CAMP_PARAMS } from "./camps";
import { SwarmCamps, SWARM_CAMP_DEFAULTS, SWARM_CAMP_PARAMS } from "./swarmCamps";
import { FieldSites, SITES_DEFAULTS, SITES_PARAMS } from "./sites";
import { ExpeditionHud } from "./expeditionHud";
import { DepthField, DEPTH_DEFAULTS, DEPTH_PARAMS, DEPTH_GROUP, convoyDepth } from "./depth";
import { PadField, PadCaller, PAD_DEFAULTS, PAD_PARAMS, PAD_GROUP, PAD_PLACE_GROUP, padQuote, quoteText, type Pad, type Quote, type CallState } from "./pads";
import { PadDraw } from "./padDraw";
import { Unlocks, UNLOCK_DEFAULTS, UNLOCK_PARAMS, UNLOCK_GROUP } from "./unlocks";
import { ThreatField, THREAT_DEFAULTS, THREAT_PARAMS, THREAT_GROUPS, type ThreatEvent } from "./threats";
import { ThreatMarks, type Mark } from "./threatMarks";
import type { Prey } from "../pilot/quarry";
import { FieldLoot, FIELD_LOOT_DEFAULTS, FIELD_LOOT_PARAMS } from "./loot";
import { banditThreat } from "./threat";
import type { LootValues } from "../items/generate";
import { levelPower } from "../items/level";
import { BodyContact } from "../game/bodyContact";
import type { Arsenal } from "../weapons/arsenal";
import type { WeaponValues } from "../weapons/tuning";
import type { Raider } from "../combat/warband";
import { mechOwner } from "../game/registerOwners";
import { QuestLoop, QUEST_DEFAULTS, QUEST_PARAMS, QUEST_GROUPS } from "../quests/questLoop";

export const LOOP_DEFAULTS = {
  ...EXPEDITION_DEFAULTS, ...FUEL_DEFAULTS, ...RETURN_DEFAULTS, ...RADAR_DEFAULTS, ...SEEKER_DEFAULTS, ...CAMP_DEFAULTS, ...SWARM_CAMP_DEFAULTS,
  ...SITES_DEFAULTS, ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...THREAT_DEFAULTS, ...DEPTH_DEFAULTS, ...PAD_DEFAULTS, ...UNLOCK_DEFAULTS,
  ...FIELD_LOOT_DEFAULTS, ...INFANTRY_DEFAULTS, ...BANDIT_LOOK_DEFAULTS, ...WARBAND_DEFAULTS, ...BANDIT_DEFAULTS, ...COLUMN_DEFAULTS, ...FACTION_DEFAULTS,
  ...QUEST_DEFAULTS,
  ...FORT_LIFE_DEFAULTS,
  ...HUB_LIFE_DEFAULTS,
};
export type LoopValues = typeof LOOP_DEFAULTS;
export const LOOP_PARAMS: Param[] = [
  ...DEPTH_PARAMS, ...PAD_PARAMS, ...UNLOCK_PARAMS, ...THREAT_PARAMS, ...EXPEDITION_PARAMS, ...FUEL_PARAMS, ...RETURN_PARAMS, ...RADAR_PARAMS, ...SEEKER_PARAMS, ...CAMP_PARAMS, ...SWARM_CAMP_PARAMS,
  ...POI_PARAMS, ...SITES_PARAMS, ...SITE_PARAMS, ...SALVAGE_PARAMS, ...SALVAGE_FX_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS,
  ...FIELD_LOOT_PARAMS, ...FACTION_PARAMS, ...BANDIT_PARAMS, ...COLUMN_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS, ...WARBAND_PARAMS,
  ...QUEST_PARAMS,
  ...FORT_LIFE_PARAMS,
  ...HUB_LIFE_PARAMS,
];
/** Topics for the lab's panel. */
export const LOOP_TOPICS = [
  { id: "expedition", label: "Expedition", groups: ["Expedition", DEPTH_GROUP, "Fuel", "Way home", "Radar"] },
  { id: "quests", label: "Contracts and HVTs", groups: QUEST_GROUPS },
  { id: "extraction", label: "Extraction and unlocks", groups: [PAD_GROUP, PAD_PLACE_GROUP, UNLOCK_GROUP] },
  { id: "pois", label: "POIs and salvage", groups: ["POI placement", "Pads", "Salvage", "Salvage heat", "Salvage: look", ...new Set(SITE_PARAMS.map((p) => p.group))] },
  { id: "threats", label: "Packs and raids", groups: THREAT_GROUPS },
  { id: "fortress", label: "Fortresses and hubs", groups: ["Fortress: layout", "Fortress: salvage", "Fortress: gates", "Fortress: garrison", "Fortress: warlord", "Manufacturing hub: layout", "Manufacturing hub: salvage", "Manufacturing hub: fabricators", "Manufacturing hub: production"] },
  { id: "loot", label: "Loot", groups: ["Loot", "Loot rolls"] },
  { id: "factions", label: "Factions and fights", groups: FACTION_GROUPS },
  { id: "raiders", label: "Bandits and war bands", groups: [...BANDIT_GROUPS, "War band columns", "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: dodge", "Bandits: look", "War band", "Raider guns", "Raider health", "Raider driving", "Raider wrecks"] },
  { id: "swarms", label: "Swarms", groups: ["Swarm camps", "Swarm camps: behaviour", "Unknown areas", "Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones", "Robots: beam", "Robots: hit parts"] },
];


/**
 * The pilot (src/pilot/onFoot.ts), when he's out of the mech: where he is, whether he's alive, who the swarm should go
 * for (the prey picked for its middle), how much closer he wakes a camp, and his salvage reach, rate and noise.
 */
export interface LoopPilot {
  onFoot: boolean; alive: boolean; x: number; z: number;
  prey: (x: number, z: number) => Prey; notice: number;
  reach: number; rate: number; noise: number;
}
/** Optional extras for the loop: the bandit bake (boxes if null). */
export interface LoopOptions {
  vat?: BanditVatData | null;
  /** The ground changed over a box (a fortress gate went down): rebuild the terrain meshes there. */
  groundChanged?: (x0: number, z0: number, x1: number, z1: number) => void;
}
export interface LoopInput { night?: number; eHeld: boolean; recallHeld: boolean; jHeld?: boolean; demo: boolean; mark?: (stage: string) => void; pilot?: LoopPilot; canvas?: HTMLCanvasElement }

export class ExpeditionLoop {
  readonly exp: Expedition;
  readonly fuel: Fuel;
  readonly sites: FieldSites;
  readonly camps: CampField;
  /** Distance from the road and the danger it makes (depth.ts). */
  readonly depth: DepthField;
  readonly swarms: SwarmCamps;
  /** The raider faction (Keith 2026-10-28): bandit camps (settled) and war band columns (roaming), and how the factions meet. */
  readonly bandits: BanditField;
  readonly banditCamps: BanditCamps;
  /** Fortresses whose alarm has gone: seconds until their war band rolls out (negative: sent). */
  private fortCalls = new Map<string, number>();
  /** Bandit fortresses: their gates and garrisons (fortresses.ts). */
  readonly forts: Fortresses;
  readonly hubs: Hubs;
  readonly columns: WarColumns;
  readonly bands: WarBands;
  /** The mech's body against bandits, scrappers and vehicles (src/game/bodyContact.ts). */
  readonly contact: BodyContact;
  /** The player's weapons, for the bandits' dive rolls out of telegraphed shots (the convoy lab sets it). */
  threatSource: { arsenal: Arsenal; wv: WeaponValues } | null = null;
  private raiderList: Raider[] = [];
  readonly relations: Relations;
  readonly director: FightDirector;
  readonly skirmish: Skirmishes;
  private groupList: FightGroup[] = [];
  private packSrc?: ReturnType<typeof packSource>;
  private clashSeq = 0;
  /** Resolved clashes so far (the lab's line and the checks). */
  clashes = 0;
  readonly zoom: RadarZoom;
  readonly radar: RadarDraw;
  /** Time since the scope last redrew (it redraws at radarHz). */
  private radarDt = 1;
  /** Road points last seen (the sites forget which sieges the road blocks when it grows). */
  private roadSeen = -1;
  readonly hud: ExpeditionHud;
  /** Scrap clumps, item drops, the loot panel and its sounds (loot.ts). */
  readonly loot: FieldLoot;
  /** Contracts and high value targets (src/quests/questLoop.ts). */
  readonly quests: QuestLoop;
  /** The sensor's seekers (src/expedition/seekers.ts): the lab sets the modes from the loadout and cycles them. */
  readonly seeker = new Seeker();
  private sound: RadarSound;
  /** Roaming packs, raids and distant blasts (threats.ts), and their marks at the screen's edge. */
  readonly threats: ThreatField;
  private marks = new ThreatMarks();
  private events: ThreatEvent[] = [];
  private blasts: { id: string; x: number; z: number; t: number }[] = [];
  private plumeT = 0;
  private blastSeq = 0;
  /** Raids sent by salvage heat, handled with the next threat step. */
  private pending: ThreatEvent[] = [];
  /** Where the mech (or the pilot on foot) was at the last threat step. */
  private at = { x: 0, z: 0 };
  readonly home: ReturnPoint = { x: 0, z: 0, walk: 0, eta: 0, crane: 0, reachable: false };
  /** The same, sprinting all the way. */
  readonly homeSprint: ReturnPoint = { x: 0, z: 0, walk: 0, eta: 0, crane: 0, reachable: false };
  warn: 0 | 1 | 2 = 0;
  private tracks: CraneTrack[] = [];
  private world: RadarWorld = { mech: { x: 0, z: 0 }, convoy: [], route: [], home: null, pois: [], blobs: [], unknown: [], contacts: [] };
  private slowT = 0;
  private humanBlobs: { id: string; x: number; z: number; guess: number; awake: boolean }[] = [];
  private humanContacts: { id: number; x: number; z: number; kind: number }[] = [];
  /** Firing, stripping, sprinting or dashing, as of the last threat step (war bands hear it too). */
  private loud = false;
  private homeT = 0;
  /** Dashes counted so far (fuel per dash). */
  private dashes = 0;
  private turretPts: THREE.Vector3[] = [];
  /** Demo: the POI it's heading for and what it's doing. */
  private demoGoal: { x: number; z: number; id: string } | null = null;
  /** Spots stripped (all runs), and the count when the demo picked its POI. */
  private stripped = 0;
  /** Repair kits found in salvage (all runs). */
  kitsFound = 0;
  private demoFrom = 0;
  demoHold = false;
  demoAim: Aim | null = null;
  demoTrigger = false;
  /** Extraction pads: where they are, the call in progress, what the convoy has bought, their drawing. */
  readonly pads: PadField;
  readonly padCall: PadCaller;
  readonly unlocks = new Unlocks();
  readonly padDraw: PadDraw;
  private padList: Pad[] = [];
  private padMech = new THREE.Vector3();
  /** The nearest pad and what calling it would cost now (the HUD line), null when none is near. */
  nearPad: { pad: Pad; dist: number; quote: Quote; on: boolean } | null = null;
  /** Called when the mech should be put back aboard (recovered, lost). */
  onHome: (() => void) | null = null;

  constructor(
    readonly v: LoopValues & LootValues & { walkSpeed: number; sprintSpeed: number; boundTop: number; craneRange: number; craneMount: number; convoySpeed: number; camYaw: number; dashShoveRadius: number; dashShoveDamage: number; dashShove: number },
    field: DuneField, bf: Battlefield, scene: THREE.Scene, private camera: THREE.Camera,
    private route: ConvoyRoute, private convoy: Convoy, private carry: CraneCarry, private player: MechUnit,
    opts: LoopOptions = {},
  ) {
    // The road's corridor, cut or still to be cut by the plough (nothing is placed where the road will run).
    const blocked = (x: number, z: number) => route.corridor(x, z) > 0.02;
    this.exp = new Expedition(v);
    this.fuel = new Fuel(v);
    this.pads = new PadField(v);
    this.pads.depth = (x, z) => this.depth.depth(x, z);
    this.pads.blocked = (x, z) => blocked(x, z) || convoy.platforms.some((q) => Math.hypot(q.x - x, q.z - z) < 150);
    this.padCall = new PadCaller(v, this.exp);
    this.padDraw = new PadDraw(field, scene);
    this.sites = new FieldSites(v, field, bf, scene, blocked);
    this.depth = new DepthField(route, v);
    this.camps = new CampField(v);
    this.camps.danger = this.depth.danger;
    this.swarms = new SwarmCamps(v, field, bf, scene, this.camps, player, blocked);
    // Robots spawned out deep are at the area's level (one curve with the items: docs/proposal-balance.md).
    this.swarms.power = (x, z) => (v.enemyLevels > 0 ? levelPower(1 + this.depth.depth(x, z) / Math.max(1, v.levelMetres), v.enemyGrowth) : 1);
    // The raider faction: bandit camps at POIs and wrecks (never at the wreckage a clash leaves), war band columns.
    this.bandits = new BanditField(v, (x0, z0, x1, z1) => this.sites.poisIn(x0, z0, x1, z1).filter((q) => !q.id.startsWith("clash:")));
    this.bandits.danger = this.depth.danger;
    this.banditCamps = new BanditCamps(v, field, bf, scene, this.bandits, player, opts.vat ?? null, blocked);
    this.columns = new WarColumns(v, 31, (x, z) => blocked(x, z) || convoy.platforms.some((q) => Math.hypot(q.x - x, q.z - z) < 150));
    this.columns.danger = this.depth.danger;
    this.bands = new WarBands(v, bf, scene, this.columns);
    this.contact = new BodyContact(player, bf);
    this.bands.riders = this.banditCamps.sw;
    this.relations = new Relations(v);
    this.director = new FightDirector(v, this.relations);
    this.skirmish = new Skirmishes(v, this.relations, [
      (x, z, r, out) => this.swarms.abstractGroups(x, z, r, out, v),
      (x, z, r, out) => (this.packSrc ??= packSource(this.threats, v, v))(x, z, r, out),
      (x, z, r, out) => this.banditCamps.abstractGroups(x, z, r, out),
      (x, z, r, out) => this.bands.abstractGroups(x, z, r, out),
    ]);
    this.forts = new Fortresses(v, field, bf, scene, this.sites.walls, player, opts.vat ?? null,
      (x0, z0, x1, z1) => this.sites.poisIn(x0, z0, x1, z1), opts.groundChanged ?? (() => {}));
    this.forts.onKill = (i, gen, x, z) => { if (this.exp.state === "out") this.loot.drops.fromKill(`f${i}.${gen}`, 0, x, z, this.dropCtx(x, z)); this.quests?.killed("bandit", x, z); };
    this.forts.onAlert = (poi) => {
      this.sound.alarm();
      // The war bands that gather there send a column out after the first alarm (once per fortress per expedition).
      if (v.fortReinforce > 0 && !this.fortCalls.has(poi)) this.fortCalls.set(poi, v.fortReinforceAfter);
    };
    this.forts.onGate = (e) => { if (e.type === "gateDown") this.hud.note("Gate down", "#ffb347", 3); };
    this.banditCamps.onKill = (_i, _gen, x, z) => { if (this.exp.state === "out") this.loot.drops.fromKill(`b${_i}.${_gen}`, banditThreat(v), x, z, this.dropCtx(x, z)); this.quests?.killed("bandit", x, z); };
    this.sites.onLoot = (label, scrap, s) => {
      this.stripped++; this.exp.add({ kind: "scrap", amount: scrap, label }); this.loot.spotDone(s, scrap); this.quests?.stripped(s.poi);
      // Now and then a repair kit in the wreck (Keith 2026-10-31), by a hash of the spot (the same spot always does).
      if (kitRoll(s.id) < this.player.v.kitSalvage && this.player.kits.restock(1)) this.kitsFound++;
    };
    this.sites.onNoise = (x, z, r) => { this.swarms.noise(x, z, r); this.banditCamps.noise(x, z, r); this.forts.noise(x, z, r); this.columns.noise(x, z, r); };
    this.sites.salvage.danger = this.depth.danger;
    this.sites.salvage.onHeat = (what) => this.heatAnswer(what);
    player.onDash = (x, z, dx, dz) => { this.swarms.dashed(x, z, dx, dz, v.dashShoveRadius, v.dashShoveDamage); this.banditCamps.dashed(x, z, dx, dz, v.dashShoveRadius, v.dashShove, v.dashShoveDamage); this.forts.dashed(x, z, dx, dz, v.dashShoveRadius, v.dashShove, v.dashShoveDamage); };
    this.zoom = new RadarZoom(v);
    this.radar = new RadarDraw(v);
    this.hud = new ExpeditionHud(this.radar.canvas);
    // Loot rolls by where it drops: the live depth (level, danger: rarity) and the salvage heat (rarity).
    this.loot = new FieldLoot(v, scene, field, bf.sfx.ctx, this.hud.lootSlot, this.exp, (x, z) => this.dropCtx(x, z));
    this.sound = new RadarSound(bf.sfx.ctx);
    this.dashes = player.dash.dashes;
    this.loot.watch(this.swarms.sw);
    this.quests = new QuestLoop(v as never, {
      exp: this.exp, hud: this.hud, sites: this.sites, camps: this.camps, bandits: this.bandits, drops: this.loot.drops,
      dropCtx: (x, z) => this.dropCtx(x, z), depth: (x, z) => this.depth.depth(x, z),
      lead: () => { const b = convoy.bays[0]; return { x: b.x, z: b.z }; },
      blocked: (x, z) => blocked(x, z) || convoy.platforms.some((q) => Math.hypot(q.x - x, q.z - z) < 150),
    }, bf, scene, field, player);
    this.quests.watch(this.swarms.sw);
    // Nothing turns up on the road or within 150 m of the train.
    this.threats = new ThreatField(v, 17, (x, z) => blocked(x, z) || convoy.platforms.some((q) => Math.hypot(q.x - x, q.z - z) < 150));
    // Manufacturing hubs build robots into the swarm while awake; packs and raids lean to the nearest working one.
    this.hubs = new Hubs(v, field, bf, scene, this.sites.walls, this.swarms, (x0, z0, x1, z1) => this.sites.poisIn(x0, z0, x1, z1));
    this.hubs.onEvent = (e) => {
      if (e.type === "hubWoke") { this.hud.note("Manufacturing hub waking up", "#5ac8fa", 3); this.sound.alarm(); }
      else if (e.type === "fabDown") this.hud.note("Fabricator down", "#ffb347", 3);
      else if (e.type === "hubDead") this.hud.note("Hub silenced: no more robots from there", "#5ac8fa", 4);
    };
    this.threats.from = (x, z) => this.hubs.bearing(x, z);
    this.field = field;
    this.bf = bf;
  }
  private field: DuneField;
  private bf: Battlefield;

  /**
   * Hand the fortresses their warlord (a red Rampart the lab has loaded; the loop can't wait for a model). Killed, it
   * drops warlordDrops items rolled as if from deep, hot ground.
   */
  attachWarlord(unit: MechUnit, scene: THREE.Object3D) {
    const w = new Warlord(this.v, this.bf, scene, unit);
    this.forts.warlord = w;
    w.onEvent = (e) => {
      if (e.type !== "warlordDown") return;
      this.hud.note("Warlord down", "#ffb347", 4);
      if (this.exp.state !== "out") return;
      const c = this.dropCtx(e.x, e.z);
      for (let k = 0; k < Math.round(this.v.warlordDrops); k++)
        this.loot.drops.roll(`warlord:${e.poi}:${k}`, 1, e.x + Math.sin(k * 2.4) * 3, e.z + Math.cos(k * 2.4) * 3, { ...c, danger: Math.min(1, c.danger + 0.5), heat: 1 });
    };
  }

  /** Where a drop rolls (loot rolls by depth and salvage heat). */
  private dropCtx(x: number, z: number) {
    return { danger: this.depth.liveDanger(x, z), heat: Math.min(1, this.sites.salvage.heat / Math.max(0.05, this.v.heatMax)), depth: this.depth.liveDepth(x, z) };
  }

  /** Add the loop's own targets and owners to the battlefield's register (after the player's mech). */
  register(reg: Register) {
    reg.add(this.swarms.target);
    reg.add(this.banditCamps.target);
    reg.add(this.forts.target);
    reg.add({ name: "warlord", publish: (r) => this.forts.warlord?.publish(r) });
    reg.add({ name: "war bands", publish: (r) => this.bands.publish(r) });
    reg.add(mechOwner("hvt", () => this.quests.hvt.list()));
  }

  /** Start over where the lab put the convoy (POIs kept clear of the start; camps too). */
  restart(x: number, z: number) {
    this.camps.start = { x, z };
    this.padCall.reset();
    this.bandits.start = { x, z };
    this.columns.start = { x, z };
    this.swarms.reset();
    this.banditCamps.reset();
    this.forts.reset();
    this.fortCalls.clear();
    this.hubs.reset();
    this.bands.reset();
    this.columns.reset();
    this.skirmish.reset();
    this.threats.reset();
    this.blasts.length = 0;
    this.quests.reset();
    this.sites.keepClear(x, z, 190);
    this.fuel.refill();
    this.exp.state = "aboard";
    this.exp.atRisk.length = 0;
    this.slowT = 0;
  }

  /** Placement sliders changed. */
  rebuild(what: "sites" | "camps") { if (what === "sites") { this.sites.rebuild(); this.forts.reset(); this.hubs.reset(); this.banditCamps.reset(); this.bands.reset(); this.columns.reset(); this.skirmish.reset(); } else { this.swarms.reset(); this.banditCamps.reset(); this.bands.reset(); this.columns.reset(); this.skirmish.reset(); this.threats.reset(); } this.slowT = 0; }

  /** Salvage heat crossed a threshold: pull in the nearest pack, or send a small raid at the stripper. */
  private heatAnswer(what: "pack" | "raid") {
    const m = { x: this.at.x, z: this.at.z, out: true, loud: true, danger: this.depth.liveDanger(this.at.x, this.at.z) };
    if (what === "pack") {
      if (this.threats.pull(m)) this.hud.note("The noise is drawing a pack in", "#ffcf7a", 3);
    } else {
      const e = this.threats.heatRaid(m);
      if (e) this.pending.push(e);
      // The war bands hear it too.
      if (this.columns.pull({ x: m.x, z: m.z, out: true, loud: true })) this.hud.note("A war band is coming for the noise", "#ff7ad0", 3);
    }
  }

  /** Turret targets: awake robots near the train. */
  turretThreats(): THREE.Vector3[] {
    const mid = this.convoy.platforms[Math.floor(this.convoy.platforms.length / 2)];
    this.swarms.threats(mid.x, mid.z, 250, this.turretPts);
    this.banditCamps.threats(mid.x, mid.z, 250, this.turretPts);
    return this.bands.threats(mid.x, mid.z, 250, this.turretPts);
  }

  update(dt: number, inp: LoopInput) {
    if (this.route.count !== this.roadSeen) { this.roadSeen = this.route.count; this.sites.roadGrew(); }
    const { exp, fuel, carry, player, v, bf } = this, sim = player.sim, p = sim.pelvis;
    // Launched (on the sand), picked up (the crane has it: banked), or destroyed out there.
    const happened = exp.follow(carry.state, carry.attached, player.alive);
    if (happened === "launched") { fuel.refill(); this.demoGoal = null; this.demoFrom = this.stripped; }
    if (happened === "banked") this.sound.banked();
    // A dead mech isn't picked up.
    if (!player.alive && (carry.state === "inRange" || carry.state === "pickup")) carry.state = "walking";
    if (!player.alive) carry.armed = false;

    // The pilot killed on foot out there: the expedition is over, the at-risk list lost (Keith 2026-10-26).
    const pl = inp.pilot, foot = !!pl?.onFoot;
    if (foot && !pl!.alive && exp.state === "out") exp.pilotKilled();
    // Salvage: E while out, on the sand, alive; on foot from where the pilot stands (shorter reach, slower, quieter).
    const onSand = carry.state === "walking" || carry.state === "inRange";
    const holding = (inp.demo ? this.demoHold : inp.eHeld && !this.quests.usesE) && exp.state === "out" && player.alive && onSand && (!foot || pl!.alive);
    if (foot) this.sites.update(dt, pl!.x, pl!.z, holding, this.camera, pl!);
    else this.sites.update(dt, p.x, p.z, holding, this.camera);
    inp.mark?.("POIs and salvage");
    // The swarm goes for the mech, or the pilot when he's out and nearer (src/pilot/quarry.ts).
    const sw = this.swarms.sw;
    let mx = p.x, mz = p.z;
    if (foot) {
      let n = 0, sx = 0, sz = 0;
      for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN && !sw.frozen[i]) { sx += sw.px[i]; sz += sw.pz[i]; n++; }
      if (n) { mx = sx / n; mz = sz / n; }
    }
    const hunting = exp.state === "out" && player.alive && SAND.has(carry.state) && (!foot || pl!.alive);
    this.hubs.update(dt, hunting, foot && pl ? pl : p);
    this.swarms.update(dt, hunting, foot ? pl!.prey(mx, mz) : undefined, foot && pl!.alive ? { x: pl!.x, z: pl!.z, notice: pl!.notice } : null);
    inp.mark?.("swarm camps");
    this.updateHumans(dt, hunting, foot ? pl!.prey(mx, mz) : undefined, foot && pl!.alive ? { x: pl!.x, z: pl!.z, notice: pl!.notice } : null);
    inp.mark?.("raiders and fights");
    // The mech's body (Keith 2026-10-31): tramples bandits and scrappers, rams war band vehicles; bandits may dive out
    // of a charge or a telegraphed shot. Only while it walks the sand (not hanging from the crane or parked).
    const body = this.contact.step(dt);
    this.banditCamps.mechReach = body.reach;
    this.forts.mechReach = body.reach;
    if (SAND.has(carry.state) && player.alive) {
      const a = this.threatSource;
      const th = this.contact.threats(a?.arsenal ?? null, bf.shells, a?.wv ?? null);
      this.banditCamps.sw.dodge(th);
      this.contact.infantry(this.banditCamps.sw, this.banditCamps.target);
      this.forts.sw.dodge(th);
      this.contact.infantry(this.forts.sw, this.forts.target);
      this.contact.robots(this.swarms.sw, this.swarms.target);
      this.contact.vehicles(this.bands.raiders(this.raiderList), dt);
    }
    this.updateThreats(dt, hunting, inp.canvas, foot && pl!.alive ? { x: pl!.x, z: pl!.z } : null);
    inp.mark?.("packs and raids");

    // Fuel: burns only out in the field, and only while it's on (fuelOn; off for now, Keith 2026-11-01).
    const fuelOn = v.fuelOn > 0;
    const dash = player.dash;
    if (fuelOn && dash.dashes > this.dashes && exp.state === "out") fuel.dash();
    this.dashes = dash.dashes;
    if (!fuelOn) fuel.refill();
    else if (exp.state === "out" && player.alive) {
      const speed = Math.hypot(sim.vel.x, sim.vel.z) + (dash.phase === "glide" ? 0 : Math.hypot(dash.vx, dash.vz));
      fuel.burn(dt, { speed, walkSpeed: v.walkSpeed, sprintSpeed: v.sprintSpeed, bounding: player.bound.on, stripping: !!this.sites.salvage.active });
    } else if (exp.state === "aboard" && !SAND.has(carry.state)) fuel.refill();

    this.updatePads(dt, inp, foot ? pl! : null);
    inp.mark?.("extraction pads");

    // The state machine: recall held, out of fuel; at the bottom of a fade the lab puts the mech home.
    const ev = exp.update(dt, inp.recallHeld && !inp.demo && player.alive, fuelOn && fuel.empty);
    if (ev === "home") { this.onHome?.(); fuel.refill(); this.demoGoal = null; }

    // The way home: the return point and the warning.
    this.homeT -= dt;
    if (this.homeT <= 0) {
      this.homeT = 0.1;
      craneTracks(this.convoy.bays, v.craneMount, this.tracks);
      returnPoint(v, this.route, this.tracks, p.x, p.z, v.walkSpeed, v.convoySpeed, v.craneRange, this.home);
      // Sprinting home instead (Keith 2026-10-26): at about the legs' top speed, for the fuel per metre.
      returnPoint(v, this.route, this.tracks, p.x, p.z, v.boundTop * 0.9, v.convoySpeed, v.craneRange, this.homeSprint);
    }
    const eta = this.home.reachable ? this.home.eta : Infinity;
    const warn = exp.state === "out" && fuelOn ? fuelWarning(v, fuel.left, eta) : 0;
    inp.mark?.("way home");
    if (warn === 2 && this.warn < 2) this.sound.warn();
    this.warn = warn;

    // The radar: the slow lists a few times a second, the rest every frame.
    this.slowT -= dt;
    const w = this.world;
    w.mech.x = p.x; w.mech.z = p.z;
    w.convoy = this.convoy.platforms.map((q) => ({ x: q.x, z: q.z, length: q.spec.length, width: q.spec.width, heading: q.heading }));
    w.home = exp.state === "out" ? { x: this.home.x, z: this.home.z } : null;
    w.quests = this.quests.radar;
    if (this.slowT <= 0) {
      this.slowT = 0.25;
      const R = v.convoyRadar * 1.1;
      w.pois = this.sites.poisIn(p.x - R, p.z - R, p.x + R, p.z + R).map((q) => ({ id: q.id, x: q.x, z: q.z, tier: q.tier, kind: q.kind, stripped: this.sites.stripped(q) }));
      this.swarms.blobs(p.x, p.z, R, w.blobs);
      for (const b of this.banditCamps.blobs(p.x, p.z, R, this.humanBlobs)) w.blobs.push({ ...b, faction: 1 });
      w.unknown = this.camps.unknownNear(p.x, p.z, R);
      w.pads = this.pads.near(p.x, p.z, R).map((q) => ({ id: q.id, x: q.x, z: q.z, fee: padQuote(v, true, convoyDepth(this.route, q.x, q.z, v.depthTrain) / 1000, 0, 0).fee, live: this.padCall.pad?.id === q.id }));
      w.route = [];
      const head = this.route.s, out = { x: 0, z: 0, heading: 0 };
      for (let s = -100; s <= v.convoyRadar * 1.6; s += 50) { this.route.ahead(head + s, out); w.route.push({ x: out.x, z: out.z }); }
      // The road a good way back too, and the depth rings round it.
      w.band = []; w.rings = v.depthRings > 0 ? [v.depthNear, v.depthOut, v.depthDeep] : [];
      if (w.rings.length) for (let s = -v.convoyRadar * 1.6; s <= v.convoyRadar * 1.6; s += 100) { this.route.ahead(head + s, out); w.band.push({ x: out.x, z: out.z }); }
    }
    this.swarms.contacts(p.x, p.z, v.mechRadar * 1.1, w.contacts);
    for (const c of this.banditCamps.contacts(p.x, p.z, v.mechRadar * 1.1, this.humanContacts.splice(0))) w.contacts.push({ ...c, id: c.id + 1e9, faction: 1 });
    for (const c of this.bands.contacts(p.x, p.z, v.mechRadar * 1.1, this.humanContacts.splice(0))) w.contacts.push({ ...c, id: c.id + 2e9, faction: 1 });
    // Moving danger as heat: packs and raids (hotter hunting), and blasts for a few seconds.
    const heat = (w.heat ??= []);
    heat.length = 0;
    for (const q of this.threats.packs) heat.push({ id: q.id, x: q.x, z: q.z, guess: q.kind === "raid" ? q.n * 1.5 : q.n, awake: q.state !== "roam" });
    for (const b of this.blasts) heat.push({ id: b.id, x: b.x, z: b.z, guess: 20 * Math.max(0, 1 - b.t / 6), awake: true });
    // War band columns (their own heat colour) and the fights going on out of view (a flicker).
    for (const c of this.columns.cols) if (c.state !== "live") heat.push({ id: c.id, x: c.x, z: c.z, guess: c.kinds.length * 2.5, awake: c.state !== "roam", faction: 1 });
    for (const f of this.skirmish.fighting()) heat.push({ id: "fight:" + f.id, x: f.x, z: f.z, guess: 10 + Math.sqrt(f.power) * 2, awake: true, faction: 1, fighting: true });
    inp.mark?.("radar lists");
    const aboard = !SAND.has(carry.state);
    const zev = this.zoom.update(dt, linked(v, w, aboard));
    if (zev) this.sound.zoom(zev === "out");
    const range = this.zoom.range;
    const mode = range > Math.sqrt(v.mechRadar * v.convoyRadar) ? "convoy" : "mech";
    const sm = this.seeker.mode, seek = sm ? seekNearest(sm, v, w) : null;
    // The scope redraws at radarHz (perf pass 2026-10-31): its picture and drawing are the dear part.
    this.radarDt += dt;
    if (this.radarDt >= 1 / Math.max(1, v.radarHz)) {
      const pic = radarPicture(v, w, mode);
      pic.seek = seek;
      this.radar.draw(this.radarDt, pic, range, (v.camYaw * Math.PI) / 180, sim.heading, warn);
      this.radarDt = 0;
    }
    inp.mark?.("radar draw");

    // HUD.
    const s = this.sites.salvage;
    let prompt = this.padPrompt() || (exp.state === "out" && onSand ? this.quests.prompt : "");
    if (!prompt && exp.state === "out" && onSand) {
      if (s.active) prompt = `Stripping ${s.active.label}… ${Math.round(s.active.progress * 100)}%  (${foot ? "by hand: slower, quieter" : "loud"})`;
      else if (s.inReach) prompt = `Hold E: strip ${s.inReach.label}${foot ? " by hand" : ""} (+${s.pay(s.inReach)} scrap, at risk until the crane has you)`;
    }
    this.hud.update(dt, {
      exp, fuelOn, fuelLeft: fuel.left, fuelShare: fuel.share, eta: exp.state === "out" ? eta : null, warn, prompt,
      sprint: exp.state === "out" && this.homeSprint.reachable
        ? { eta: this.homeSprint.eta, fuel: this.homeSprint.walk * v.boundTop * 0.9 * v.homePace * v.fuelBound } : null,
      canRecall: exp.state === "out" && player.alive,
      pad: this.padHud(), depth: exp.state === "out" ? { m: this.depth.depth(p.x, p.z), live: this.depth.liveDepth(p.x, p.z), ring: this.depth.ring(p.x, p.z) } : null,
      heat: { v: this.sites.salvage.heat, max: v.heatMax, pack: v.heatPack, raid: v.heatRaid }, bankShow: v.bankShow, seek: this.seeker.label(seek),
    });
    inp.mark?.("expedition hud");
    // Contracts and HVTs (before the loot panel drains the expedition's events: they deliver and fail on them).
    this.quests.update(dt, {
      out: exp.state === "out", onSand, eHeld: inp.eHeld && !inp.demo, jHeld: !!inp.jHeld && !inp.demo,
      mech: { x: p.x, z: p.z, alive: player.alive }, pilot: foot && pl!.alive ? { x: pl!.x, z: pl!.z } : null, expEvents: exp.events,
    });
    inp.mark?.("contracts");
    // Loot: drops picked up, clumps flying in, the loot panel (after the HUD, which holds its slot).
    const pa = foot && pl!.alive ? pl! : null;
    this.loot.update(dt, {
      mech: { x: p.x, y: p.y + 1.5, z: p.z, grabs: !foot && player.alive && onSand },
      pilot: pa ? { x: pa.x, y: this.field.height(pa.x, pa.z) + 1.2, z: pa.z } : null,
    });
    inp.mark?.("loot");
  }

  /**
   * Extraction pads: hold E on one to call the pickup (pads.ts has the rules); here the beacon's effects on the camps,
   * packs and war bands, the messages, the sounds, and what the HUD and the drawing are told.
   */
  private updatePads(dt: number, inp: LoopInput, pilot: LoopPilot | null) {
    const { v, player, exp, padCall: call } = this, p = player.sim.pelvis;
    const who = pilot ?? { x: p.x, z: p.z, alive: player.alive };
    const on = this.pads.nearest(who.x, who.z, v.padRadius);
    const unlocked = this.unlocks.has("pickup");
    call.update(dt, on, {
      x: who.x, z: who.z, alive: who.alive, eHeld: inp.eHeld && !inp.demo, unlocked,
      convoyM: convoyDepth(this.route, who.x, who.z, v.depthTrain),
    });
    for (const e of call.events) {
      if (e.type === "called") {
        this.hud.note(`Pickup called · ${e.quote.fee} scrap · hold the pad ${clock(e.quote.wait)}`, "#8fd0ff", 5);
      } else if (e.type === "refused") {
        this.hud.note(e.reason === "locked" ? "Extraction pickups are not bought yet (convoy terminal)" : `Not enough scrap for the fee${v.padBankTopUp >= 0.5 ? " (carried plus bank)" : " (carried scrap only)"}`, "#ffb09a", 4);
      } else if (e.type === "cancelled") {
        this.hud.note(`Call cancelled · ${e.refundCarried + e.refundBank} scrap refunded`, "#ffcf7a", 4);
      } else if (e.type === "beacon") {
        const { x, z } = e.pad;
        this.swarms.noise(x, z, v.padWake); this.banditCamps.noise(x, z, v.padWake);
        this.columns.noise(x, z, v.padPull);
        const n = this.threats.pullNear(x, z, v.padPull);
        if (e.first) { this.hud.note(`Beacon lit: it carries${n ? ` · ${n} pack${n > 1 ? "s" : ""} turning your way` : ""}`, "#ff9a7a", 4); this.sound.alarm(); }
      } else if (e.type === "raid") {
        this.heatAnswer("raid");
      } else if (e.type === "extracted") {
        this.sound.banked();
      }
    }
    call.events.length = 0;
    // The nearest pad, and the price of calling it now.
    const q = this.pads.nearest(who.x, who.z, 3000);
    this.nearPad = q ? { pad: q, dist: Math.hypot(q.x - who.x, q.z - who.z), quote: padQuote(v, unlocked, convoyDepth(this.route, q.x, q.z, v.depthTrain) / 1000, exp.scrapAtRisk, exp.bank.scrap), on: q === on } : null;
    // Drawing.
    this.padList = this.pads.near(who.x, who.z, 760, this.padList);
    const mid = this.convoy.platforms[Math.floor(this.convoy.platforms.length / 2)];
    this.padMech.set(who.x, this.field.height(who.x, who.z) + 4.4, who.z);
    this.padDraw.update(dt, v, this.padList, inp.night ?? 0, call, this.padMech, mid);
  }

  /** The pickup prompt for the top of the screen ("" when there is nothing to say). */
  padPrompt(): string {
    const c = this.padCall, n = this.nearPad;
    if (c.state === "waiting") return `Pickup in ${clock(c.remaining)} · stay on the pad · the beacon is loud`;
    if (c.state === "lifting") return "Lifting off…";
    if (!n || !n.on || this.exp.state !== "out") return "";
    const q = n.quote;
    if (c.hold > 0) return `Calling… ${Math.round(c.hold * 100)}%`;
    if (q.reason === "locked") return "Extraction pad · pickups not bought yet (convoy terminal)";
    const short = q.reason === "short" ? ` · NOT ENOUGH SCRAP${this.v.padBankTopUp >= 0.5 ? "" : " CARRIED"}` : "";
    return `Hold E: call the pickup · ${quoteText(q)} · wait ${clock(q.wait)}${short}`;
  }

  /** The HUD column's pad line. */
  private padHud() {
    const n = this.nearPad;
    if (!n || this.exp.state !== "out") return null;
    return { dist: n.dist, quote: n.quote, state: this.padCall.state as CallState, remaining: this.padCall.remaining, text: quoteText(n.quote) };
  }

  /**
   * The raider faction and the meetings between factions (Keith 2026-10-28): bandit camps stream and stir, war band
   * columns wander, hear and come onto the field, the fight director points every live group at its enemies through
   * the register, and groups off the field that meet fight by the numbers and leave wreckage and loot.
   */
  private updateHumans(dt: number, hunting: boolean, prey: Prey | undefined, pilot: { x: number; z: number; notice: number } | null) {
    const { v, player, bf } = this, sim = player.sim;
    const m = pilot ?? sim.pelvis;
    this.banditCamps.update(dt, hunting, prey, pilot);
    this.forts.update(dt, hunting, prey);
    for (const [poi, t] of this.fortCalls) {
      if (t < 0) continue;
      const left = t - dt;
      this.fortCalls.set(poi, left);
      const f = this.forts.live.get(poi);
      if (left > 0 || !f || !hunting) { if (!f) this.fortCalls.set(poi, -1); continue; }
      // Out of the fortress on the mech's side, a little round from it, hunting the mech.
      const a = Math.atan2(m.x - f.L.x, m.z - f.L.z) + 0.9, R = f.L.reach + 30;
      this.columns.place(f.L.x + Math.sin(a) * R, f.L.z + Math.cos(a) * R, Math.round(v.fortReinforce), m.x, m.z, this.depth.liveDanger(f.L.x, f.L.z));
      this.hud.note("War band out of the fortress", "#ff7ad0", 4);
      this.fortCalls.set(poi, -1);
    }
    const evs = this.columns.update(dt, { x: m.x, z: m.z, out: hunting, loud: this.loud });
    for (const e of evs) { this.bands.bring(e.col); this.hud.note(`War band · ${e.col.kinds.length} vehicles`, "#ff7ad0", 4); this.sound.alarm(); }
    this.bands.update(dt, prey ?? player, hunting, m);
    // Who fights whom in view.
    const gl = this.groupList;
    gl.length = 0;
    for (const g of this.swarms.groups()) gl.push(g);
    for (const g of this.banditCamps.groups()) gl.push(g);
    for (const g of this.bands.groups()) gl.push(g);
    this.director.update(dt, gl, bf.register);
    // Off the field: numbers, wreckage and loot.
    this.skirmish.update(dt, m.x, m.z);
    for (const ev of this.skirmish.events) {
      this.clashes++;
      const n = this.clashSeq++;
      this.sites.addExtra(aftermathSite(ev, v, n));
      for (let k = 0, d = clashDrops(ev, v); k < d; k++) this.loot.drops.roll(`clash:${ev.id}:${n}:${k}`, 1, ev.x + (k - d / 2) * 2.5, ev.z, this.dropCtx(ev.x, ev.z));
      const dist = Math.round(Math.hypot(ev.x - m.x, ev.z - m.z));
      if (dist < 1500) this.hud.note(`A fight out there is over · ${ev.lostRobots + ev.lostRaiders} lost · wreckage ${dist} m`, "#ffe9a8", 4);
    }
    this.skirmish.events.length = 0;
  }

  /**
   * Packs, raids and blasts (threats.ts): step them against the mech, or the pilot when he's out on foot (loud while
   * firing, stripping, sprinting or dashing; once in, the robots go for the swarm's prey like the camps), bring the ones that engage in as robots, keep the live ones' centre and count, hand them back when left
   * far behind; dust plumes over the moving ones, blasts out there, the raid warning, marks at the screen's edge.
   */
  private updateThreats(dt: number, hunting: boolean, canvas?: HTMLCanvasElement, pilot?: { x: number; z: number } | null) {
    const { player, v, swarms, threats, bf, field } = this, sim = player.sim;
    // Packs and raids home on whoever is out there: the mech, or the pilot on foot (quiet, unless stripping by hand).
    const p = pilot ?? sim.pelvis;
    const loud = !!this.sites.salvage.active || (!pilot && (player.upper.guns.some((g) => g.firing || g.spin > 0.3)
      || sim.speed > v.walkSpeed + 0.5 || player.dash.active || player.bound.on));
    this.loud = loud;
    if (swarms.anyAwake || this.banditCamps.anyAlert || this.forts.anyAlert) threats.engaged = true;
    this.at.x = p.x; this.at.z = p.z;
    this.events = threats.update(dt, { x: p.x, z: p.z, out: hunting, loud, danger: hunting ? this.depth.liveDanger(p.x, p.z) : 0 }, this.events);
    if (this.pending.length) { if (hunting) this.events.push(...this.pending); this.pending.length = 0; }
    for (const e of this.events) {
      if (e.type === "engage") {
        const q = e.pack;
        const raid = q.kind === "raid";
        swarms.addGroup(q.id, q.n, q.x, q.z, raid ? { mid: v.raidMidShare + q.mid, big: v.raidBigShare + q.big, bigMin: q.bigMin }
          : q.mid > 0 || q.big > 0 || q.bigMin ? { mid: v.robotMidShare + q.mid, big: v.robotBigShare + q.big, bigMin: q.bigMin } : undefined, q.hurt ?? 0, q.goal);
      } else if (e.type === "raid") {
        this.hud.note(`Raid coming · ${e.pack.n} robots · ${Math.round(Math.hypot(e.pack.x - p.x, e.pack.z - p.z))} m`, "#ff9a7a", 4);
        this.sound.alarm();
      } else {
        // Something going off out there: a burst of sand and smoke, a far bang, heat on the radar.
        const y = field.height(e.x, e.z);
        bf.dust.stomp(e.x, y, e.z, 6);
        bf.dust.smoke(e.x, y + 2, e.z, 0, 4, 0, 8, 6, 1, 0.8);
        bf.sfx.playSound("blast", new THREE.Vector3(e.x, y, e.z), 0.9, 0.7);
        bf.waves?.post("default", e.x, y + 1, e.z, 6);
        this.blasts.push({ id: `blast:${this.blastSeq++}`, x: e.x, z: e.z, t: 0 });
      }
    }
    // Live ones: where they are and how many are left; left far behind, back to wandering.
    for (const q of threats.packs) {
      if (q.state !== "live") continue;
      const g = swarms.group(q.id);
      if (!g) { q.n = 0; continue; }
      if (Math.hypot(g.x - p.x, g.z - p.z) > v.campDrop) threats.setAbstract(q, swarms.dropGroup(q.id));
      else threats.setLive(q, g.x, g.z, g.n);
    }
    for (let k = this.blasts.length - 1; k >= 0; k--) if ((this.blasts[k].t += dt) > 6) this.blasts.splice(k, 1);
    // Dust plumes over packs on the move (on screen or near it).
    this.plumeT -= dt;
    if (this.plumeT <= 0) {
      this.plumeT = 0.25;
      for (const q of threats.packs) {
        if (q.state === "live" || q.speed < 0.5) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > Math.min(v.plumeRange, 260)) continue;
        const k = Math.min(2.5, 0.6 + Math.sqrt(q.n) * 0.3) * (q.state === "hunt" ? 1.5 : 1);
        bf.dust.stomp(q.x, field.height(q.x, q.z), q.z, k, Math.sin(q.heading) * q.speed, Math.cos(q.heading) * q.speed);
      }
    }
    // Marks at the screen's edge.
    if (!canvas) return;
    const marks: Mark[] = [];
    for (const q of threats.packs) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > v.plumeRange) continue;
      // Live ones keep their mark until they're on screen (the mark hides itself then).
      const raid = q.kind === "raid", coming = q.state !== "roam";
      marks.push({ id: q.id, x: q.x, y: field.height(q.x, q.z) + 3, z: q.z, text: raid ? "RAID" : q.state === "live" ? "CONTACT" : coming ? "DUST · COMING" : "DUST",
        color: raid ? "#ff7a5a" : coming ? "#ffb347" : "#e8d6b0", strength: raid || coming ? 1 : 1 - d / (v.plumeRange * 1.2) });
    }
    for (const b of this.blasts) marks.push({ id: b.id, x: b.x, y: field.height(b.x, b.z) + 3, z: b.z, text: "BLAST", color: "#ffd27a", strength: 1 - b.t / 6 });
    for (const m of this.quests.marks) marks.push(m);
    this.marks.update(this.camera, canvas, marks, p);
  }

  /**
   * The demo out in the field: walk to the nearest unstripped POI ahead of the convoy, strip a couple of spots
   * (shooting anything that comes), then head for the return point. Null when done (the lab's demo walks to the crane).
   */
  demoField(): MoveCommand | null {
    const sim = this.player.sim, p = sim.pelvis, v = this.v, s = this.sites.salvage;
    this.demoHold = false;
    this.demoTrigger = false;
    this.demoAim = null;
    // Shoot the nearest awake robot within 40 m.
    const sw = this.swarms.sw;
    let best = 40, bi = -1;
    for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN && !sw.frozen[i]) { const d = Math.hypot(sw.px[i] - p.x, sw.pz[i] - p.z); if (d < best) { best = d; bi = i; } }
    if (bi >= 0) { this.demoAim = { x: sw.px[bi], y: sw.hubY[bi], z: sw.pz[bi] }; this.demoTrigger = true; }
    if (this.exp.state !== "out" || this.stripped - this.demoFrom >= 2) { this.demoGoal = null; return null; }
    if (!this.demoGoal) {
      const lead = this.convoy.bays[0], R = 500;
      let bd = Infinity;
      for (const q of this.sites.poisIn(p.x - R, p.z - R, p.x + R, p.z + R)) {
        const dx = q.x - lead.x, dz = q.z - lead.z, ahead = dx * lead.fwd.x + dz * lead.fwd.z;
        if (ahead < 0 || this.sites.stripped(q)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd && d < 420) { bd = d; this.demoGoal = { x: q.x, z: q.z, id: q.id }; }
      }
      if (!this.demoGoal) return null;
      this.demoFrom = this.stripped;
    }
    const g = this.demoGoal;
    // At the POI: strip its nearest spot; when it has none left, done.
    let spot = null, sd = Infinity;
    for (const q of s.spots) if (q.poi === g.id && !q.done) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < sd) { sd = d; spot = q; } }
    const near = Math.hypot(g.x - p.x, g.z - p.z) < 45;
    if (near && !spot && s.spots.some((q) => q.poi === g.id)) { this.demoFrom = -99; return null; }
    const tx = spot && near ? spot.x : g.x, tz = spot && near ? spot.z : g.z;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (spot && near && d < v.salvageReach * 0.6) {
      this.demoHold = true;
      if (!this.demoAim) this.demoAim = { x: spot.x, y: 1, z: spot.z };
      return { x: 0, z: 0, sprint: false };
    }
    return { x: dx / Math.max(1e-6, d), z: dz / Math.max(1e-6, d), sprint: d > 60 };
  }

  /** The demo heading home: toward the return point while it's far (null near: the lab walks up to the crane). */
  demoHome(): MoveCommand | null {
    const p = this.player.sim.pelvis, h = this.home;
    const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
    if (this.exp.state !== "out" || d < 50 || !h.reachable) return null;
    return { x: dx / d, z: dz / d, sprint: false };
  }

  /** Debug line for the frame HUD. */
  get line() {
    const e = this.exp, sw = this.swarms;
    return `expedition ${e.state}${e.state === "out" ? ` ${Math.round(e.outFor)} s` : ""} · fuel ${this.v.fuelOn > 0 ? `${Math.round(this.fuel.left)} s` : "off"} · home ${this.home.reachable ? Math.round(this.home.eta) + " s" : "unreachable"} (${this.home.crane ? "rear" : "front"} crane) · radar ${this.zoom.mode} ${Math.round(this.zoom.range)} m · POIs built ${this.sites.count} · camps & packs on the field ${sw.campsLive}, robots ${sw.count} (${sw.awake} awake) · raiders: bandit camps ${this.banditCamps.campsLive} (${this.banditCamps.count} up, ${this.banditCamps.alert} alert), war bands ${this.bands.columnsLive} (${this.bands.count} vehicles), columns ${this.columns.cols.length} · fortresses ${this.forts.live.size} (${this.forts.count} up${this.forts.anyAlert ? ", alert" : ""}, gates ${this.forts.gates.list.filter((g) => g.down).length}/${this.forts.gates.list.length} down) · hubs ${this.hubs.live.size} (fabricators ${this.hubs.fabs.list.filter((s) => !s.down).length}/${this.hubs.fabs.list.length} up) · fights: ${this.director.count} engaged in view, ${this.skirmish.clashes.length} off view, ${this.clashes} resolved · packs ${this.threats.packs.filter((q) => q.kind !== "raid").length} (${this.threats.packs.filter((q) => q.state === "hunt").length} hunting), raids ${this.threats.packs.filter((q) => q.kind === "raid").length}, next raid ${Math.round(this.threats.raidT)} s, first fight ${this.threats.engaged ? "had" : "not yet"} · banked ${e.counts.banked}, recalled ${e.counts.recalled}, fuel ${e.counts.fuel}, lost ${e.counts.destroyed}, pilot killed ${e.counts.pilot}`;
  }
}

/** 0..1 from a spot's id (FNV-1a): whether stripping it finds a repair kit. */
function kitRoll(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
