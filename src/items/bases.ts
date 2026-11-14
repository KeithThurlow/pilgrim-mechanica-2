// The base table: every kind of part and weapon an item can be, as data. A base gives each stat a value and how far
// it rolls each way at Common (`spread`, a share of the value; rarity widens it, src/items/rarity.ts). The Rampart
// parts, the Medium minigun, the stand-in power pack and the ammo drums hold today's mech values exactly, so the
// default loadout runs the mech as it was (tools/loadout-check.ts holds them to it).
// The mounts (Keith 2026-10-26): each hull mount takes a hull weapon (Medium) or an arm, which holds a held weapon
// (Light, or a Heavy two-hander across both arms); a shoulder slot per side on the hull top whatever the mount holds
// (Keith 2026-10-30: launchers, feeds, power); a sensor, a pack (or a back launcher) and the waist mounts left and right. The hull item says which mounts it offers (`Base.mounts`).
import { WALKER_DEFAULTS } from "../mech/walkerTuning";
import { LEG_TYPES } from "../mech/legTypes";
import { UPPER_DEFAULTS } from "../mech/upper";
import { DASH_DEFAULTS } from "../mech/dash";
import { REACTOR_DEFAULTS } from "../mech/reactor";
import { WEAPON_DEFAULTS } from "../weapons/tuning";
import { gunNumbers, type RoundGun } from "../weapons/guns";
import { cannonNumbers } from "../weapons/cannon";
import type { GunClass } from "../mech/upper";
import type { ItemKind, Size, SeekerMode } from "./item";
import { ENERGY_BASES, ENERGY_STATS } from "../weapons/energy/energyBases";
import { traitsOf } from "./traits";

/** Shoulder gear (Keith 2026-10-25, widened 2026-10-30): on a hull's shoulder (keys 1 and 2, whatever its hull mount
 *  holds) or, for launchers, on the pack mount as a back weapon (key 3, in place of the pack). Every one has a key. */
export type ShoulderWeapon = "rpg" | "missiles" | "mortar" | "linemortar" | "napalm" | "beltfeed" | "incendiary" | "capacitor";
/** What a shoulder item is (Keith 2026-10-30): a launcher (its key paints and fires it), a feed (boosts its own side's
 *  gun; its key overdrives it or loads special rounds) or power (faster energy refill; its key discharges a bar). */
export type ShoulderFamily = "launcher" | "feed" | "power";
/** Special rounds a feed's key can load into its gun (only incendiary so far; armour-piercing and explosive come
 *  later: add the name here, its numbers in src/weapons/gear.ts and its effect in src/game/shots.ts). */
export type RoundType = "incendiary";
/** A shoulder weapon's family. */
export const SHOULDER_FAMILY: Record<ShoulderWeapon, ShoulderFamily> = {
  rpg: "launcher", missiles: "launcher", mortar: "launcher", linemortar: "launcher", napalm: "launcher", beltfeed: "feed", incendiary: "feed", capacitor: "power",
};

export interface StatInfo {
  label: string;
  /** +1: higher is better; -1: lower is better. */
  better: 1 | -1;
  decimals: number;
  /** Rolls round to a whole number. */
  whole?: boolean;
  /** Not shown in the stat lists (a kind, not a number to compare: a sword's rest stance). */
  hidden?: boolean;
}

/** Every stat an item can carry. */
export const STATS: Record<string, StatInfo> = {
  walkSpeed: { label: "Walk speed (m/s)", better: 1, decimals: 2 },
  sprintSpeed: { label: "Sprint speed (m/s)", better: 1, decimals: 2 },
  accel: { label: "Speed up (m/s²)", better: 1, decimals: 2 },
  strideBase: { label: "Stride (m)", better: 1, decimals: 2 },
  stridePerSpeed: { label: "Stride per m/s", better: 1, decimals: 2 },
  impact: { label: "Stomp", better: 1, decimals: 2 },
  trample: { label: "Trample reach ×", better: 1, decimals: 2 },
  crush: { label: "Trample damage ×", better: 1, decimals: 2 },
  turnRate: { label: "Turn rate (°/s)", better: 1, decimals: 0 },
  /** Hover legs (src/mech/hover.ts): 1 flies on the hover drive instead of walking. */
  hover: { label: "Hovers", better: 1, decimals: 0, whole: true, hidden: true },
  /** Leg load (Keith 2026-11-14, soft limits): the weight above the legs they carry at full speed (t), and how hard
   *  going over bites (×; src/items/loadout.ts legLoad). */
  carry: { label: "Best load (t)", better: 1, decimals: 1 },
  strain: { label: "Overload strain ×", better: -1, decimals: 2 },
  hull: { label: "Hull points", better: 1, decimals: 0 },
  torsoTurnRate: { label: "Torso turn (°/s)", better: 1, decimals: 0 },
  /** Cargo racks (waist): extra rows on the cargo grid (src/items/cargoSpace.ts). */
  carryBonus: { label: "Cargo rack rows", better: 1, decimals: 0, whole: true },
  track: { label: "Gun tracking", better: 1, decimals: 1 },
  arc: { label: "Gun arc (°)", better: 1, decimals: 0 },
  handling: { label: "Handling ×", better: 1, decimals: 2 },
  fireRate: { label: "Rounds/s", better: 1, decimals: 1 },
  damage: { label: "Damage per round", better: 1, decimals: 1 },
  spread: { label: "Spread (°)", better: -1, decimals: 2 },
  spinUp: { label: "Spin-up (s)", better: -1, decimals: 2 },
  range: { label: "Range (m)", better: 1, decimals: 0 },
  pierce: { label: "Penetration", better: 1, decimals: 0, whole: true },
  ap: { label: "Armour pierce", better: 1, decimals: 2 },
  armour: { label: "Armour", better: 1, decimals: 1 },
  dashCharges: { label: "Dash charges", better: 1, decimals: 0, whole: true },
  dashRecharge: { label: "Dash recharge (s)", better: -1, decimals: 2 },
  boostFuel: { label: "Boost fuel (s)", better: 1, decimals: 1 },
  ammoPerGun: { label: "Rounds per gun (old drum)", better: 1, decimals: 0, whole: true },
  // Magazines and reloads (Keith 2026-10-31): munition weapons fire from a magazine and reload when it's empty.
  magazine: { label: "Magazine (rounds)", better: 1, decimals: 0, whole: true },
  reload: { label: "Reload (s)", better: -1, decimals: 2 },
  magBonus: { label: "Magazine +", better: 1, decimals: 2 },
  reloadSpeed: { label: "Reload speed +", better: 1, decimals: 2 },
  charge: { label: "Charge (s)", better: -1, decimals: 2 },
  cooldown: { label: "Cooldown (s)", better: -1, decimals: 1 },
  rockets: { label: "Rockets per salvo", better: 1, decimals: 0, whole: true },
  shells: { label: "Shells per volley", better: 1, decimals: 0, whole: true },
  blast: { label: "Blast radius (m)", better: 1, decimals: 1 },
  reach: { label: "Reach (m)", better: 1, decimals: 1 },
  swing: { label: "Swing arc (°)", better: 1, decimals: 0 },
  windup: { label: "Wind-up (s)", better: -1, decimals: 2 },
  slash: { label: "Slash (s)", better: -1, decimals: 2 },
  recover: { label: "Recover (s)", better: -1, decimals: 2 },
  cleave: { label: "Cleave (m)", better: 1, decimals: 1 },
  parry: { label: "Parry window ×", better: 1, decimals: 2 },
  heft: { label: "Blade heft ×", better: 1, decimals: 2 },
  stance: { label: "Rest stance", better: 1, decimals: 0, whole: true, hidden: true },
  shellSpeed: { label: "Shell speed (m/s)", better: 1, decimals: 0 },
  splash: { label: "Splash (m)", better: 1, decimals: 1 },
  splashShare: { label: "Splash share", better: 1, decimals: 2 },
  pellets: { label: "Pellets per shot", better: 1, decimals: 0, whole: true },
  stripLength: { label: "Strip length (m)", better: 1, decimals: 0 },
  radarRange: { label: "Mech radar (m)", better: 1, decimals: 0 },
  salvage: { label: "Salvage speed +", better: 1, decimals: 2 },
  arcBonus: { label: "Arc + (°)", better: 1, decimals: 0 },
  lockAssist: { label: "Lock cone + (°)", better: 1, decimals: 1 },
  trackAssist: { label: "Gun tracking +", better: 1, decimals: 2 },
  // Shoulder gear (feeds and power; Keith 2026-10-30): shares are fractions (0.1 is +10%).
  feedRate: { label: "Fire rate + (passive)", better: 1, decimals: 2 },
  feedSpin: { label: "Spin-up cut (passive)", better: 1, decimals: 2 },
  feedAmmo: { label: "Rounds + (passive)", better: 1, decimals: 2 },
  refill: { label: "Reactor regen + (passive)", better: 1, decimals: 2 },
  reactorCap: { label: "Reactor (bars)", better: 1, decimals: 1 },
  reactorRegen: { label: "Reactor regen (bars/s)", better: 1, decimals: 2 },
  boost: { label: "Overdrive fire rate +", better: 1, decimals: 2 },
  effectTime: { label: "Key effect lasts (s)", better: 1, decimals: 1 },
  burnTime: { label: "Burns for (s)", better: 1, decimals: 1 },
  burnDps: { label: "Burn damage/s", better: 1, decimals: 0 },
  // Fire (Keith 2026-11-05): the napalm launcher's pools.
  poolRadius: { label: "Pool radius (m)", better: 1, decimals: 1 },
  chill: { label: "Chill per hit", better: 1, decimals: 3 },
  coldDps: { label: "Cold damage/s", better: 1, decimals: 0 },
  poolTime: { label: "Pool burns (s)", better: 1, decimals: 1 },
  poolDps: { label: "Pool damage/s", better: 1, decimals: 0 },
  dischargeBars: { label: "Reactor bars refilled by the key", better: 1, decimals: 0, whole: true },
  // Summoner gear (Keith 2026-11-02, src/summon/gear.ts): the pack builds mech replicas, the shoulders carry drones and
  // the scrap swarm.
  replicas: { label: "Mech replicas", better: 1, decimals: 0, whole: true },
  replicaBuild: { label: "Builds one every (s)", better: -1, decimals: 1 },
  drones: { label: "Attack drones", better: 1, decimals: 0, whole: true },
  scrappers: { label: "Scrappers", better: 1, decimals: 0, whole: true },
  summonRebuild: { label: "Rebuilt after (s)", better: -1, decimals: 1 },
  // Energy weapons (Keith 2026-11-02): src/weapons/energy/energyBases.ts.
  ...ENERGY_STATS,
};

/** A hull mount's side. Two today; a hull with more mounts adds a side here (and its slots in loadout.ts MOUNTS). */
export type MountSide = "L" | "R";
/** What a hull mount can take: a hull weapon, or an arm (with its held and shoulder weapons). */
export type MountTake = "hullWeapon" | "arm";

export interface StatRange { base: number; spread: number }

/** A sensor's style (Keith 2026-10-26): a head at the front of the hull that turns to follow the aim (socket
 *  `Sensor_Front`), or a cluster of sensors up on top (socket `Sensor_Top`). */
export type SensorStyle = "head" | "cluster";
/** The sensor sockets a hull offers: the front (a head) and/or the top (a cluster). */
export type SensorSocket = "front" | "top";
export const SENSOR_SOCKET: Record<SensorStyle, SensorSocket> = { head: "front", cluster: "top" };

export interface Base {
  id: string;
  name: string;
  kind: Exclude<ItemKind, "protocol">;
  size?: Size;
  tags: string[];
  weight: number;
  /** Who makes it (one is picked per roll). */
  makers: string[];
  /** Model variant (src/items/item.ts LOOKS). */
  look: string;
  /** Share of loot rolls among bases of its kind. */
  drop: number;
  stats: Record<string, StatRange>;
  /** Hulls: the mounts they offer (Keith 2026-10-26; the budget is per mount, so a hull with more simply carries
   *  more): each hull mount by side and what it takes, the optional sensor mount, the pack mount (a power pack or a
   *  back weapon, key 3), the waist mounts. `sensor`: the sensor sockets it has (front for a head, top for a cluster;
   *  empty: no sensor mount). */
  mounts?: { hull: { side: MountSide; takes: MountTake[] }[]; sensor: SensorSocket[]; pack: boolean; waist: MountSide[] };
  /** Sensors: the seeker modes in the order a roll gets them (a Common has the first, each rarity one more). */
  seekers?: SeekerMode[];
  /** Sensors: head or cluster, and how fast a cluster's `Sweep` node turns (°/s; 0 or none: still). */
  sensor?: { style: SensorStyle; sweep?: number };
  /** Weapons: what kind of gun (default minigun); src/weapons fires the others. Shoulder items: which shoulder weapon. */
  cls?: GunClass;
  shoulder?: ShoulderWeapon;
  /** Hulls: the arms they come with (Keith 2026-11-03: arms aren't items; each hull brings its own, so they always
   *  match). An arm base id; the arm is put on any hull mount that takes one and holds no hull weapon. */
  arm?: string;
  /** Hulls and packs: a timed ability (src/abilities/abilities.ts; Keith 2026-10-31): a pack's on key 3, a hull's on key 4. */
  ability?: import("../abilities/abilities").AbilityId;
  /** Shoulder items: launcher, feed or power (Keith 2026-10-30). */
  family?: ShoulderFamily;
  /** Feeds: the special round their key loads (none: the key overdrives the gun's fire rate). */
  round?: RoundType;
  /** Summoner gear (Keith 2026-11-02): a pack that builds mech replicas, a shoulder rack of drones, a shoulder hive of
   *  scrappers (its key sends the swarm and calls it back). No `shoulder` weapon: the arsenal leaves them alone. */
  summon?: SummonKind;
}

/** What a summoner item brings out. */
export type SummonKind = "replicas" | "drones" | "swarm";

const R = LEG_TYPES.rampart.values;
// Leg items roll their stride around their leg type's (Keith 2026-11-14: the items' own, shorter strides overrode the
// leg types' walk in every lab with a loadout).
const ST = LEG_TYPES["rampart-stilt"].values, SG = LEG_TYPES["rampart-siege"].values;
const W = { ...WALKER_DEFAULTS, ...R };
const U = UPPER_DEFAULTS;
const WD = WEAPON_DEFAULTS;
const s = (base: number, spread: number): StatRange => ({ base, spread });

// Today's mech values that live in src/game/mechUnit.ts (MECH_DEFAULTS; not imported, it pulls in the renderer).
const HULL_POINTS = 3000, HULL_ARMOUR = 8, ROUND_DAMAGE = 12, ROUND_PIERCE = 2, ROUND_AP = 0.1;
/** An ammo drum's magazine bonus: the default loadout (a drum per side) gives the Medium minigun the slider's magazine. */
const DRUM_BONUS = 0.5;

/** A round gun's base (src/weapons/guns.ts): its numbers from the sliders, plus how it sits in the hand or on the hull. */
function roundGun(id: string, name: string, size: Size, cls: RoundGun, tags: string[], weight: number, makers: string[], look: string, drop: number, extra: Record<string, StatRange>): Base {
  const g = gunNumbers(cls, WD);
  const stats: Record<string, StatRange> = {
    fireRate: s(g.fireRate, 0.08), damage: s(g.damage, 0.1), ap: s(g.ap, 0), magazine: s(g.magazine, 0.15), reload: s(g.reload, 0.1),
    spread: s(g.spread, 0.1), range: s(g.range, 0.06), pierce: s(g.pierce, 0.2), ...extra,
  };
  if (g.pellets > 1) stats.pellets = s(g.pellets, 0.1);
  if (g.splash > 0) { stats.splash = s(g.splash, 0.1); stats.splashShare = s(g.splashShare, 0); }
  if (g.burnDps > 0) { stats.burnTime = s(g.burnTime, 0.12); stats.burnDps = s(g.burnDps, 0.12); }
  if (g.chill > 0) { stats.chill = s(g.chill, 0.12); stats.coldDps = s(g.coldDps, 0.12); }
  return { id, name, kind: "weapon", size, cls, tags, weight, makers, look, drop, stats };
}

function breachCannon(): Base {
  const c = cannonNumbers(WD);
  return {
    id: "cannon-medium", name: "Breach cannon", kind: "weapon", size: "M", cls: "cannon", tags: ["weapon", "ballistic", "explosive", "cannon"], weight: 3, makers: ["Suzaku", "Stratford-Aegis"], look: "rampart-siege", drop: 0.9,
    stats: { fireRate: s(c.fireRate, 0.08), damage: s(c.damage, 0.1), ap: s(c.ap, 0), magazine: s(c.magazine, 0.15), reload: s(c.reload, 0.1), blast: s(c.blast, 0.08), shellSpeed: s(c.shellSpeed, 0.08), range: s(c.range, 0.06), spread: s(c.spread, 0.12), arc: s(24, 0.08), track: s(8, 0.08) },
  };
}

export const BASES: Base[] = [
  // Legs: walk, sprint, stride, stomp, turn and what they carry.
  {
    id: "legs-rampart", name: "Rampart legs", kind: "legs", tags: ["legs"], weight: 6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { walkSpeed: s(W.walkSpeed, 0.03), sprintSpeed: s(W.sprintSpeed, 0.03), accel: s(W.accel, 0.1), strideBase: s(R.strideBase!, 0.04), stridePerSpeed: s(R.stridePerSpeed!, 0.06), impact: s(W.impact, 0.1), turnRate: s(W.turnRate, 0.08), trample: s(1, 0.06), crush: s(1, 0.1), carry: s(20, 0.05), strain: s(1, 0) },
  },
  {
    id: "legs-stilt", name: "Stilt legs", kind: "legs", tags: ["legs"], weight: 4.5, makers: ["Novus-Lux"], look: "rampart-stilt", drop: 1,
    stats: { walkSpeed: s(5.2, 0.03), sprintSpeed: s(6.8, 0.03), accel: s(3.8, 0.1), strideBase: s(ST.strideBase!, 0.04), stridePerSpeed: s(ST.stridePerSpeed!, 0.06), impact: s(1.4, 0.1), turnRate: s(140, 0.08), trample: s(0.8, 0.06), crush: s(0.75, 0.1), carry: s(16, 0.05), strain: s(1.1, 0) },
  },
  {
    id: "legs-siege", name: "Siege legs", kind: "legs", tags: ["legs"], weight: 8.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1,
    stats: { walkSpeed: s(4.8, 0.03), sprintSpeed: s(6.2, 0.03), accel: s(2.2, 0.1), strideBase: s(SG.strideBase!, 0.04), stridePerSpeed: s(SG.stridePerSpeed!, 0.06), impact: s(3.6, 0.1), turnRate: s(95, 0.08), trample: s(1.3, 0.06), crush: s(1.5, 0.1), carry: s(27, 0.05), strain: s(0.8, 0) },
  },
  {
    // Hover legs (Keith 2026-11-02: "a floating leg that can't support heavy hulls... hovers instead of walking"): the
    // Stilt's legs on a hover drive, feet hanging; quick and floaty, no stomp, best with light hulls (the Cuirass, the
    // Salvager): heavier ones fit and crawl (Keith 2026-11-14, soft limits). A model of their own comes later: the Stilt's legs stand in.
    id: "legs-hover", name: "Hover legs", kind: "legs", tags: ["legs", "hover"], weight: 3, makers: ["Novus-Lux"], look: "rampart-stilt", drop: 0.7,
    stats: { walkSpeed: s(5.2, 0.03), sprintSpeed: s(6.8, 0.03), accel: s(4, 0.1), strideBase: s(ST.strideBase!, 0.04), stridePerSpeed: s(ST.stridePerSpeed!, 0.06), impact: s(0.6, 0.1), turnRate: s(160, 0.08), trample: s(0.5, 0.06), crush: s(0.4, 0.1), hover: s(1, 0), carry: s(15, 0.05), strain: s(1.5, 0) },
  },
  // Hulls: hull points, torso turn, mounts.
  {
    id: "hull-rampart", name: "Rampart hull", kind: "hull", arm: "arm-rampart", tags: ["hull"], weight: 7, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["hullWeapon", "arm"] }], sensor: ["front", "top"], pack: true, waist: ["L", "R"] }, stats: { hull: s(HULL_POINTS, 0.08), armour: s(HULL_ARMOUR, 0.1), torsoTurnRate: s(U.torsoTurnRate, 0.08), reactorCap: s(REACTOR_DEFAULTS.reactorCap, 0.1), reactorRegen: s(REACTOR_DEFAULTS.reactorRegen, 0.1) },
  },
  {
    id: "hull-siege", name: "Siege hull", kind: "hull", arm: "arm-loader", tags: ["hull"], weight: 9.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1, ability: "weld",
    // Armoured all over the front: sensors only up on top.
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["hullWeapon", "arm"] }], sensor: ["top"], pack: true, waist: ["L", "R"] }, stats: { hull: s(4200, 0.08), armour: s(12, 0.1), torsoTurnRate: s(110, 0.08), reactorCap: s(5.5, 0.1), reactorRegen: s(0.32, 0.1) },
  },
  {
    id: "hull-salvager", name: "Salvager hull", kind: "hull", arm: "arm-loader", tags: ["hull"], weight: 5.5, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-salvager", drop: 1, ability: "nanite",
    // A utility hull: its right mount takes only an arm (a working arm for stripping), no hull weapon; a head at the
    // front to see what it strips, no top mount (the crane rail runs over it).
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["arm"] }], sensor: ["front"], pack: true, waist: ["L", "R"] }, stats: { hull: s(2400, 0.08), armour: s(5, 0.1), torsoTurnRate: s(190, 0.08), reactorCap: s(3, 0.1), reactorRegen: s(0.45, 0.1) },
  },
  {
    // A light cuirass (Keith 2026-11-02: hover legs "could support really light cuirasses"): the Stilt's narrow torso,
    // thin plate, quick to turn; both mounts and a front head, no ability.
    id: "hull-cuirass", name: "Cuirass hull", kind: "hull", arm: "arm-wildcat", tags: ["hull", "light"], weight: 4, makers: ["Novus-Lux"], look: "rampart-stilt", drop: 0.8,
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["hullWeapon", "arm"] }], sensor: ["front"], pack: true, waist: ["L", "R"] }, stats: { hull: s(1900, 0.08), armour: s(4, 0.1), torsoTurnRate: s(230, 0.08), reactorCap: s(3, 0.1), reactorRegen: s(0.55, 0.1) },
  },
  // Sensors (optional mount, Keith 2026-10-26): the mech radar's range and the seekers (rarer: more modes, longer).
  // Two styles (Keith 2026-10-26): heads at the front follow the aim and help it a little (a wider soft-lock cone, a
  // touch more gun tracking) on a shorter radar; clusters on top reach further on the radar and don't help the aim
  // (Claude's call, small on purpose). The Rampart's default is the visor head at 500 m (Keith 2026-11-01: 150 m made
  // things too hard to find; every sensor scaled by the same ×3.3).
  {
    id: "sensor-visor", name: "Rampart visor head", kind: "sensor", tags: ["sensor", "head"], weight: 0.5, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    sensor: { style: "head" }, seekers: ["scrap", "wreck", "rare", "legendary"], stats: { radarRange: s(500, 0.08), lockAssist: s(2, 0.25) },
  },
  {
    id: "sensor-optic", name: "Twin-optic head", kind: "sensor", tags: ["sensor", "head"], weight: 0.6, makers: ["Novus-Lux"], look: "rampart-wildcat", drop: 0.8,
    sensor: { style: "head" }, seekers: ["rare", "scrap", "wreck", "legendary"], stats: { radarRange: s(400, 0.08), lockAssist: s(4, 0.25), trackAssist: s(0.12, 0.25) },
  },
  {
    id: "sensor-mast", name: "Rampart mast", kind: "sensor", tags: ["sensor", "cluster"], weight: 0.4, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    sensor: { style: "cluster" }, seekers: ["scrap", "wreck", "rare", "legendary"], stats: { radarRange: s(600, 0.08) },
  },
  {
    id: "sensor-dish", name: "Survey dish", kind: "sensor", tags: ["sensor", "cluster"], weight: 0.7, makers: ["Novus-Lux"], look: "rampart-salvager", drop: 0.8,
    sensor: { style: "cluster", sweep: 40 }, seekers: ["wreck", "scrap", "rare", "legendary"], stats: { radarRange: s(700, 0.08) },
  },
  {
    id: "sensor-array", name: "Long array", kind: "sensor", tags: ["sensor", "cluster"], weight: 1.1, makers: ["Suzaku", "Novus-Lux"], look: "rampart-railgun", drop: 0.5,
    sensor: { style: "cluster" }, seekers: ["rare", "legendary", "wreck", "scrap"], stats: { radarRange: s(900, 0.08) },
  },
  // Arms: on a hull mount in place of a hull weapon; hold a held weapon (their tracking and arc are its) and carry
  // a shoulder weapon on the same mount. Hands strip salvage faster (Keith: arms might make salvaging faster).
  {
    id: "arm-rampart", name: "Rampart arm", kind: "arm", tags: ["arm"], weight: 1.4, makers: ["Stratford-Aegis"], look: "rampart", drop: 0,
    stats: { track: s(18, 0.1), arc: s(40, 0.1), salvage: s(0.25, 0.2) },
  },
  {
    id: "arm-wildcat", name: "Wildcat arm", kind: "arm", tags: ["arm"], weight: 1.1, makers: ["Novus-Lux"], look: "rampart-wildcat", drop: 0,
    stats: { track: s(24, 0.1), arc: s(48, 0.1), salvage: s(0.15, 0.2) },
  },
  {
    id: "arm-loader", name: "Loader arm", kind: "arm", tags: ["arm"], weight: 1.8, makers: ["Suzaku"], look: "rampart-salvager", drop: 0,
    stats: { track: s(14, 0.1), arc: s(34, 0.1), salvage: s(0.5, 0.2) },
  },
  // Weapons: minigun sizes on the existing gun sim. Held weapons (Light) are smaller than hull weapons but swing
  // quicker in the hand (handling: the arm's tracking ×) and wider (arc +).
  {
    id: "mg-light", name: "Light minigun", kind: "weapon", size: "L", tags: ["weapon", "ballistic", "minigun"], weight: 0.9, makers: ["Suzaku", "Novus-Lux"], look: "rampart-wildcat", drop: 1.5,
    stats: { fireRate: s(15, 0.08), damage: s(9, 0.1), ap: s(0, 0), magazine: s(80, 0.12), reload: s(2, 0.1), spread: s(4, 0.1), spinUp: s(0.5, 0.1), range: s(38, 0.06), pierce: s(1, 0.3), handling: s(1.25, 0.08), arcBonus: s(6, 0.2) },
  },
  {
    id: "mg-medium", name: "Minigun", kind: "weapon", size: "M", tags: ["weapon", "ballistic", "minigun"], weight: 1.8, makers: ["Stratford-Aegis", "Suzaku"], look: "rampart", drop: 1.5,
    stats: { fireRate: s(U.fireRate, 0.08), damage: s(ROUND_DAMAGE, 0.1), ap: s(ROUND_AP, 0), magazine: s(Math.round(U.ammoPerGun / (1 + DRUM_BONUS)), 0.12), reload: s(U.reloadTime, 0.1), spread: s(U.spread, 0.1), spinUp: s(U.spinUp, 0.1), range: s(U.range, 0.06), pierce: s(ROUND_PIERCE, 0.2), arc: s(U.podYawMax, 0.08), track: s(U.podTrack, 0.08) },
  },
  {
    id: "mg-heavy", name: "Heavy minigun", kind: "weapon", size: "H", tags: ["weapon", "ballistic", "minigun", "heavy"], weight: 3.2, makers: ["Suzaku"], look: "rampart-turret", drop: 1,
    stats: { fireRate: s(14, 0.08), damage: s(20, 0.1), ap: s(0.25, 0), magazine: s(160, 0.12), reload: s(3.4, 0.1), spread: s(2.4, 0.1), spinUp: s(1.4, 0.1), range: s(55, 0.06), pierce: s(3, 0.2), handling: s(0.6, 0.1) },
  },
  // New weapons (docs/proposal-weapons.md, Keith 2026-10-25), each with its own targeting (src/weapons). Base values
  // come from the weapon sliders; the Light rail cannon from the Medium's by the Light-rail shares.
  {
    id: "rail-light", name: "Light rail cannon", kind: "weapon", size: "L", cls: "rail", tags: ["weapon", "energy", "rail"], weight: 1.3, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 1,
    stats: { damage: s(WD.railDamage * WD.railLightDamage, 0.1), ap: s(WD.railLightAp, 0), charge: s(WD.railCharge * WD.railLightCharge, 0.1), cooldown: s(WD.railCooldown, 0.1), range: s(WD.railRange * 0.85, 0.06), handling: s(1.1, 0.08), arcBonus: s(4, 0.2) },
  },
  // The arm's missile pod (Keith 2026-10-31: was a rocket pod firing like a hose; "missiles on arms ... should work like
  // [the shoulder battery], almost like a channelling weapon"): a Light launcher in the hand, held to ripple a clip of 8
  // small missiles onto what's under the cursor, then a clip swap. Base values from the arm missile pod sliders.
  {
    id: "rpg-light", name: "Arm missile pod", kind: "weapon", size: "L", cls: "rpg", tags: ["weapon", "explosive", "rocket"], weight: 1.2, makers: ["Stratford-Aegis", "Suzaku"], look: "rampart-rocket", drop: 1,
    stats: { damage: s(WD.rpgDamage * WD.podDamage, 0.1), ap: s(WD.rpgAp, 0), blast: s(WD.podBlast, 0.08), shellSpeed: s(WD.rpgSpeed, 0.08), cooldown: s(WD.podCooldown, 0.1), magazine: s(WD.podMag, 0.25), reload: s(WD.podReload, 0.1), handling: s(1.15, 0.08), arcBonus: s(4, 0.2) },
  },
  // The sword (Keith 2026-11-01: "a big chonky sword ... cleave through things"): a held weapon in an arm, swung on its
  // side's mouse button (src/weapons/sword.ts). Base values from the Sword sliders; `swing` is its arc (°).
  {
    id: "sword-light", name: "Breaker sword", kind: "weapon", size: "L", cls: "melee", tags: ["weapon", "melee", "blade"], weight: 1.6, makers: ["Suzaku", "Stratford-Aegis"], look: "rampart", drop: 0.7,
    stats: { damage: s(WD.swordDamage, 0.1), ap: s(WD.swordAp, 0), reach: s(WD.swordReach, 0.05), swing: s(WD.swordArc, 0.05), windup: s(WD.swordWindup, 0.08), slash: s(WD.swordSlash, 0.05), recover: s(WD.swordRecover, 0.08), cleave: s(WD.swordCleave, 0.15), parry: s(1, 0.05), heft: s(1, 0.03), stance: s(1, 0), handling: s(1.2, 0.08), arcBonus: s(10, 0.2), salvage: s(0.15, 0.3) },
  },
  // The sword line (Keith 2026-11-01: "a bigger, heavier sword, better for AoE clears ... but harder to use when
  // fighting other melee units"; the Breaker "feels like a katana ... buster swords, which are much slower but do have
  // more damage ... short swords, which are much faster, do less damage but better parry timings"). The Breaker sits in
  // the middle. The buster: longer and much thicker, hits far harder, cleaves deeper and nearly ignores armour, slow to
  // swing and recover, a narrow parry window. The short sword: quick, light, a wide parry window, armour stops more of it.
  {
    id: "sword-heavy", name: "Buster sword", kind: "weapon", size: "L", cls: "melee", tags: ["weapon", "melee", "blade"], weight: 2.8, makers: ["Stratford-Aegis"], look: "rampart", drop: 0.5,
    stats: { damage: s(WD.swordDamage * WD.swordBusterDamage, 0.1), ap: s(0.85, 0), reach: s(WD.swordReach * 1.15, 0.05), swing: s(WD.swordArc * 1.1, 0.05), windup: s(WD.swordWindup * 1.45, 0.08), slash: s(WD.swordSlash * 1.25, 0.05), recover: s(WD.swordRecover * 1.5, 0.08), cleave: s(WD.swordCleave * 1.9, 0.15), parry: s(0.5, 0.05), heft: s(2.1, 0.05), stance: s(2, 0), handling: s(0.85, 0.08), arcBonus: s(14, 0.2), salvage: s(0.15, 0.3) },
  },
  {
    id: "sword-short", name: "Short sword", kind: "weapon", size: "L", cls: "melee", tags: ["weapon", "melee", "blade"], weight: 1.0, makers: ["Suzaku"], look: "rampart", drop: 0.6,
    stats: { damage: s(WD.swordDamage * WD.swordShortDamage, 0.1), ap: s(0.25, 0), reach: s(WD.swordReach * 0.72, 0.05), swing: s(WD.swordArc * 0.9, 0.05), windup: s(WD.swordWindup * 0.65, 0.08), slash: s(WD.swordSlash * 0.75, 0.05), recover: s(WD.swordRecover * 0.65, 0.08), cleave: s(WD.swordCleave * 0.6, 0.15), parry: s(1.7, 0.05), heft: s(0.85, 0.05), stance: s(3, 0), handling: s(1.4, 0.08), arcBonus: s(8, 0.2), salvage: s(0.15, 0.3) },
  },
  {
    id: "rail-medium", name: "Rail cannon", kind: "weapon", size: "M", cls: "rail", tags: ["weapon", "energy", "rail"], weight: 2.6, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-railgun", drop: 1,
    stats: { damage: s(WD.railDamage, 0.1), ap: s(WD.railAp, 0), charge: s(WD.railCharge, 0.1), cooldown: s(WD.railCooldown, 0.1), range: s(WD.railRange, 0.06), arc: s(20, 0.08), track: s(8, 0.08) },
  },
  {
    id: "ac-medium", name: "Autocannon", kind: "weapon", size: "M", cls: "autocannon", tags: ["weapon", "ballistic", "explosive", "autocannon"], weight: 2.4, makers: ["Suzaku", "Stratford-Aegis"], look: "rampart-turret", drop: 1,
    stats: { fireRate: s(WD.acRate, 0.08), damage: s(WD.acDamage, 0.1), ap: s(WD.acAp, 0), magazine: s(WD.acMag, 0.12), reload: s(WD.acReload, 0.1), splash: s(WD.acSplash, 0.1), shellSpeed: s(WD.acSpeed, 0.08), range: s(WD.acRange, 0.06), spread: s(WD.acSpread, 0.12), spinUp: s(0.15, 0.1), arc: s(28, 0.08), track: s(10, 0.08) },
  },
  {
    id: "rpg-medium", name: "Rocket launcher", kind: "weapon", size: "M", cls: "rpg", tags: ["weapon", "explosive", "rocket"], weight: 2.2, makers: ["Suzaku", "Stratford-Aegis"], look: "rampart-rocket", drop: 1,
    stats: { damage: s(WD.rpgDamage, 0.1), ap: s(WD.rpgAp, 0), blast: s(WD.rpgBlast, 0.08), shellSpeed: s(WD.rpgSpeed, 0.08), cooldown: s(WD.rpgCooldown, 0.1), magazine: s(WD.rpgMag, 0.25), reload: s(WD.rpgReload, 0.1), arc: s(26, 0.08), track: s(10, 0.08) },
  },
  // Round guns (Keith 2026-11-02, src/weapons/guns.ts): an SMG, a rifle and a shotgun in the hand, a sniper rifle and a
  // flak cannon (the shotgun's hull-mounted big brother) on the hull. They fire rounds like the minigun, with no spin-up.
  // Base values from the round gun sliders.
  roundGun("smg-light", "SMG", "L", "smg", ["weapon", "ballistic", "smg"], 0.7, ["Novus-Lux", "Suzaku"], "rampart-wildcat", 1.2, { handling: s(1.4, 0.08), arcBonus: s(10, 0.2) }),
  roundGun("rifle-light", "Battle rifle", "L", "rifle", ["weapon", "ballistic", "rifle"], 1.1, ["Stratford-Aegis", "Suzaku"], "rampart", 1.2, { handling: s(1.15, 0.08), arcBonus: s(6, 0.2) }),
  roundGun("shotgun-light", "Scattergun", "L", "shotgun", ["weapon", "ballistic", "shotgun"], 1.2, ["Suzaku"], "rampart", 1, { handling: s(1.25, 0.08), arcBonus: s(8, 0.2) }),
  roundGun("sniper-medium", "Longshot rifle", "M", "sniper", ["weapon", "ballistic", "sniper"], 2.2, ["Novus-Lux", "Stratford-Aegis"], "rampart-railgun", 0.9, { arc: s(18, 0.08), track: s(7, 0.08) }),
  // The breach cannon (Keith 2026-11-02: cannons "that fire explosive rounds", src/weapons/cannon.ts): one big shell at a
  // time, leading a lock, bursting through the shared blast. Base values from the Breach cannon sliders.
  breachCannon(),
  // Flamers (Keith 2026-11-05, src/weapons/fire/): a held flamethrower and a hull one, dual nozzle (fuel and igniter).
  roundGun("flamer-light", "Flamer", "L", "flamer", ["weapon", "fire", "flamer"], 1.3, ["Suzaku", "Stratford-Aegis"], "rampart", 0.9, { handling: s(1.2, 0.08), arcBonus: s(10, 0.2) }),
  roundGun("inferno-medium", "Inferno projector", "M", "inferno", ["weapon", "fire", "flamer"], 2.4, ["Suzaku"], "rampart-turret", 0.8, { arc: s(32, 0.08), track: s(11, 0.08) }),
  // Freeze rays (Keith 2026-11-05): a held one and a hull one; the jets chill, slow and freeze (src/game/chill.ts).
  roundGun("frost-light", "Frost thrower", "L", "frost", ["weapon", "cold", "freeze"], 1.3, ["Novus-Lux"], "rampart", 0.7, { handling: s(1.2, 0.08), arcBonus: s(10, 0.2) }),
  roundGun("cryo-medium", "Cryo projector", "M", "cryo", ["weapon", "cold", "freeze"], 2.5, ["Novus-Lux", "Stratford-Aegis"], "rampart-turret", 0.6, { arc: s(32, 0.08), track: s(11, 0.08) }),
  roundGun("flak-medium", "Flak cannon", "M", "flak", ["weapon", "ballistic", "flak"], 2.6, ["Suzaku", "Stratford-Aegis"], "rampart-turret", 0.9, { arc: s(30, 0.08), track: s(10, 0.08) }),
  // Shoulder weapons (Keith 2026-10-25), keys 1-3: the RPG rocket, the missile pod, the big mortar, the line mortar.
  {
    id: "sh-rpg", name: "Shoulder rocket", kind: "shoulder", shoulder: "rpg", tags: ["shoulder", "explosive", "rocket"], weight: 1.8, makers: ["Suzaku"], look: "rampart-rocket", drop: 1,
    stats: { damage: s(WD.rpgDamage, 0.1), ap: s(WD.rpgAp, 0), blast: s(WD.rpgBlast, 0.08), shellSpeed: s(WD.rpgSpeed, 0.08), cooldown: s(WD.rpgShoulderCooldown, 0.1), magazine: s(WD.rpgShoulderMag, 0.3), reload: s(WD.rpgShoulderReload, 0.1) },
  },
  {
    id: "sh-missiles", name: "Missile pod", kind: "shoulder", shoulder: "missiles", tags: ["shoulder", "explosive", "missiles"], weight: 2.4, makers: ["Suzaku", "Novus-Lux"], look: "rampart-rocket", drop: 1,
    stats: { rockets: s(WD.swarmMissiles, 0.2), damage: s(WD.swarmDamage, 0.1), ap: s(WD.swarmAp, 0), blast: s(WD.swarmBlast, 0.08), cooldown: s(WD.swarmCooldown, 0.1) },
  },
  {
    id: "sh-mortar", name: "Big mortar", kind: "shoulder", shoulder: "mortar", tags: ["shoulder", "explosive", "mortar"], weight: 3.4, makers: ["Suzaku"], look: "rampart-siege", drop: 0.8,
    stats: { damage: s(WD.mortarDamage, 0.1), ap: s(WD.mortarAp, 0), blast: s(WD.mortarBlast, 0.08), cooldown: s(WD.mortarCooldown, 0.1) },
  },
  {
    id: "sh-linemortar", name: "Line mortar", kind: "shoulder", shoulder: "linemortar", tags: ["shoulder", "explosive", "mortar"], weight: 2.8, makers: ["Suzaku", "Stratford-Aegis"], look: "rampart-siege", drop: 0.8,
    stats: { shells: s(WD.salvoRockets, 0.2), damage: s(WD.salvoDamage, 0.1), ap: s(WD.salvoAp, 0), cooldown: s(WD.salvoCooldown, 0.1), stripLength: s(WD.salvoLength, 0.1), blast: s(WD.salvoBlast, 0.08) },
  },
  // The napalm launcher (Keith 2026-11-05: "a lot like line mortar ... shoulder mounted"): canisters up a painted strip,
  // each a small burst and a pool of burning gel (src/game/firePools.ts). Base values from the Napalm launcher sliders.
  {
    id: "sh-napalm", name: "Napalm launcher", kind: "shoulder", shoulder: "napalm", tags: ["shoulder", "fire", "mortar", "napalm"], weight: 2.6, makers: ["Suzaku"], look: "rampart-siege", drop: 0.8,
    stats: { shells: s(WD.napalmShells, 0.2), damage: s(WD.napalmDamage, 0.1), ap: s(WD.napalmAp, 0), cooldown: s(WD.napalmCooldown, 0.1), stripLength: s(WD.napalmLength, 0.1), blast: s(WD.napalmBlast, 0.08),
      poolRadius: s(WD.napalmPool, 0.1), poolTime: s(WD.napalmPoolTime, 0.12), poolDps: s(WD.napalmPoolDps, 0.12), burnTime: s(WD.napalmBurnTime, 0.12), burnDps: s(WD.napalmBurnDps, 0.12) },
  },
  // Feeds (Keith 2026-10-30): always boost their own side's gun (the passive), and their key (1 or 2) does more: the
  // belt feed overdrives it, the incendiary feed loads ignited rounds. Unrolled ones run on the "Shoulder gear" sliders.
  {
    id: "sh-beltfeed", name: "Belt feed", kind: "shoulder", shoulder: "beltfeed", tags: ["shoulder", "feed", "kinetic", "hose"], weight: 1.2, makers: ["Stratford-Aegis", "Suzaku"], look: "rampart", drop: 1,
    stats: { feedRate: s(WD.beltRate, 0.15), feedSpin: s(WD.beltSpin, 0.15), boost: s(WD.beltBoost, 0.12), effectTime: s(WD.beltTime, 0.12), cooldown: s(WD.beltCooldown, 0.1) },
  },
  {
    id: "sh-incendiary", name: "Incendiary feed", kind: "shoulder", shoulder: "incendiary", round: "incendiary", tags: ["shoulder", "feed", "kinetic", "hose", "fire"], weight: 1.4, makers: ["Suzaku", "Novus-Lux"], look: "rampart", drop: 0.8,
    stats: { feedRate: s(WD.incRate, 0.15), feedAmmo: s(WD.incAmmo, 0.15), effectTime: s(WD.incTime, 0.12), burnTime: s(WD.burnTime, 0.12), burnDps: s(WD.burnDps, 0.12), cooldown: s(WD.incCooldown, 0.1) },
  },
  // Power (Keith 2026-10-30): for the energy builds. Since the reactor (Keith 2026-11-02) it feeds the reactor, not the
  // dash's kinetic bars: the passive speeds its regen, the key refills reactor bars at once.
  {
    id: "sh-capacitor", name: "Capacitor bank", kind: "shoulder", shoulder: "capacitor", tags: ["shoulder", "power", "energy"], weight: 1.6, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-railgun", drop: 0.9,
    stats: { refill: s(WD.capRefill, 0.15), dischargeBars: s(WD.capBars, 0.5), cooldown: s(WD.capCooldown, 0.1) },
  },
  // Power packs (the pack mount, high on the back): dash charges and recharge for now (energy weapons later). Charges are
  // energy bars (Keith 2026-10-27: 4 by default, recharge 30% faster; every pack scaled the same).
  {
    id: "pack-standin", name: "Rampart power pack", kind: "pack", tags: ["power"], weight: 1.6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { dashCharges: s(DASH_DEFAULTS.dashCharges, 0.2), dashRecharge: s(DASH_DEFAULTS.dashRecharge, 0.1) },
  },
  {
    id: "pack-capacitor", name: "Capacitor pack", kind: "pack", tags: ["power"], weight: 2.2, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.8,
    stats: { dashCharges: s(6, 0.15), dashRecharge: s(3.1, 0.1) },
  },
  // A medic pack (Keith 2026-10-31: healers for co-op): fewer energy bars than the stand-in, and the Repair beacon on
  // key 3 (thrown at the cursor: a zone that repairs everyone friendly inside).
  {
    id: "pack-medic", name: "Medic pack", kind: "pack", tags: ["power", "repair"], weight: 2.0, makers: ["Stratford-Aegis"], look: "rampart", drop: 0.7, ability: "beacon",
    stats: { dashCharges: s(3, 0.15), dashRecharge: s(DASH_DEFAULTS.dashRecharge * 1.15, 0.1) },
  },
  // Summoner gear (Keith 2026-11-02: "the backpack is where the larger mech replicas come out of over time ... drone
  // summons come out of your shoulders, and ... the swarms come out of there too"). A replica bay builds its replicas
  // one at a time once you're out on the sand, fewer energy bars than the stand-in; a drone rack keeps its drones up,
  // two per shoulder; a swarm hive keeps its scrappers, its key throws them at the lock or cursor and calls them back.
  {
    id: "pack-replica", name: "Replica bay", kind: "pack", tags: ["power", "summon", "replicas"], weight: 3.2, makers: ["Novus-Lux", "Suzaku"], look: "rampart", drop: 0.6, summon: "replicas",
    stats: { dashCharges: s(3, 0.15), dashRecharge: s(DASH_DEFAULTS.dashRecharge * 1.1, 0.1), replicas: s(2, 0.2), replicaBuild: s(10, 0.15), summonRebuild: s(25, 0.15) },
  },
  {
    id: "sh-drones", name: "Drone rack", kind: "shoulder", tags: ["shoulder", "summon", "drones"], weight: 1.4, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart", drop: 0.7, summon: "drones",
    stats: { drones: s(2, 0.25), summonRebuild: s(6, 0.15) },
  },
  {
    id: "sh-hive", name: "Swarm hive", kind: "shoulder", tags: ["shoulder", "summon", "swarm"], weight: 1.8, makers: ["Suzaku"], look: "rampart", drop: 0.7, summon: "swarm",
    stats: { scrappers: s(8, 0.2), summonRebuild: s(3, 0.15) },
  },
  // A booster pack (Keith 2026-10-25: a boost item to slide around on): hold Space after a dash to keep thrusting.
  {
    id: "pack-booster", name: "Booster pack", kind: "pack", tags: ["power", "boost"], weight: 2.6, makers: ["Suzaku Dynamics"], look: "rampart-stilt", drop: 0.7,
    stats: { dashCharges: s(4, 0.15), dashRecharge: s(2.7, 0.1), boostFuel: s(2.5, 0.15) },
  },
  // Waist mounts, left and right (Keith 2026-10-26: ammo drums, cargo racks, small kit). A drum feeds its own side's
  // gun (a two-hander takes the bigger of the two): since the magazines (2026-10-31) it makes that gun's magazine
  // bigger; an autoloader reloads it faster (the reload-speed stat a tree node can grant later).
  {
    id: "waist-drums", name: "Ammo drum", kind: "waist", tags: ["waist", "ammo"], weight: 0.6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { magBonus: s(DRUM_BONUS, 0.15) },
  },
  {
    id: "waist-fulldrums", name: "Full drum", kind: "waist", tags: ["waist", "ammo"], weight: 1, makers: ["Suzaku"], look: "rampart", drop: 0.7,
    stats: { magBonus: s(0.9, 0.12) },
  },
  {
    id: "waist-autoloader", name: "Autoloader", kind: "waist", tags: ["waist", "loader"], weight: 0.8, makers: ["Novus-Lux", "Suzaku"], look: "rampart", drop: 0.8,
    stats: { reloadSpeed: s(0.35, 0.15) },
  },
  {
    id: "waist-rack", name: "Cargo rack", kind: "waist", tags: ["waist", "cargo"], weight: 0.8, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-salvager", drop: 0.8,
    stats: { carryBonus: s(2, 0.3) },
  },
  {
    id: "waist-kit", name: "Cutting kit", kind: "waist", tags: ["waist", "salvage"], weight: 0.5, makers: ["Suzaku"], look: "rampart-salvager", drop: 0.6,
    stats: { salvage: s(0.3, 0.2) },
  },
  // Energy weapons (Keith 2026-11-02): hull weapons on the energy bars, src/weapons/energy/energyBases.ts.
  ...ENERGY_BASES,
];

// Every shoulder item has a family (launcher unless it says otherwise: the older four).
for (const b of BASES) if (b.shoulder) b.family = SHOULDER_FAMILY[b.shoulder];

/** Bases renamed since saves were written (src/ui/bay.ts loadBay migrates them). */
export const RENAMED_BASES: Record<string, string> = { "back-drums": "waist-drums", "back-fulldrums": "waist-fulldrums" };

// Weapon traits join the tags (src/items/traits.ts): what Protocols fit.
for (const b of BASES) for (const t of traitsOf(b.id)) if (!b.tags.includes(t)) b.tags.push(t);
export const BASE_BY_ID: Record<string, Base> = Object.fromEntries(BASES.map((b) => [b.id, b]));
/** An item's tags as its base has them now (an item saved before a trait was added still gets it). */
export const tagsOf = (item: { base: string; tags: readonly string[] }): readonly string[] => BASE_BY_ID[item.base]?.tags ?? item.tags;
