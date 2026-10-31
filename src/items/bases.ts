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
import { WEAPON_DEFAULTS } from "../weapons/tuning";
import type { GunClass } from "../mech/upper";
import type { ItemKind, Size, SeekerMode } from "./item";

/** Shoulder gear (Keith 2026-10-25, widened 2026-10-30): on a hull's shoulder (keys 1 and 2, whatever its hull mount
 *  holds) or, for launchers, on the pack mount as a back weapon (key 3, in place of the pack). Every one has a key. */
export type ShoulderWeapon = "rpg" | "missiles" | "mortar" | "linemortar" | "beltfeed" | "incendiary" | "capacitor";
/** What a shoulder item is (Keith 2026-10-30): a launcher (its key paints and fires it), a feed (boosts its own side's
 *  gun; its key overdrives it or loads special rounds) or power (faster energy refill; its key discharges a bar). */
export type ShoulderFamily = "launcher" | "feed" | "power";
/** Special rounds a feed's key can load into its gun (only incendiary so far; armour-piercing and explosive come
 *  later: add the name here, its numbers in src/weapons/gear.ts and its effect in src/game/shots.ts). */
export type RoundType = "incendiary";
/** A shoulder weapon's family. */
export const SHOULDER_FAMILY: Record<ShoulderWeapon, ShoulderFamily> = {
  rpg: "launcher", missiles: "launcher", mortar: "launcher", linemortar: "launcher", beltfeed: "feed", incendiary: "feed", capacitor: "power",
};

export interface StatInfo {
  label: string;
  /** +1: higher is better; -1: lower is better. */
  better: 1 | -1;
  decimals: number;
  /** Rolls round to a whole number. */
  whole?: boolean;
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
  carry: { label: "Carries (t)", better: 1, decimals: 1 },
  hull: { label: "Hull points", better: 1, decimals: 0 },
  torsoTurnRate: { label: "Torso turn (°/s)", better: 1, decimals: 0 },
  carryBonus: { label: "Cargo racks (t)", better: 1, decimals: 1 },
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
  shellSpeed: { label: "Shell speed (m/s)", better: 1, decimals: 0 },
  splash: { label: "Splash (m)", better: 1, decimals: 1 },
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
  refill: { label: "Energy refill + (passive)", better: 1, decimals: 2 },
  boost: { label: "Overdrive fire rate +", better: 1, decimals: 2 },
  effectTime: { label: "Key effect lasts (s)", better: 1, decimals: 1 },
  burnTime: { label: "Burns for (s)", better: 1, decimals: 1 },
  burnDps: { label: "Burn damage/s", better: 1, decimals: 0 },
  dischargeBars: { label: "Bars refilled by the key", better: 1, decimals: 0, whole: true },
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
  /** Shoulder items: launcher, feed or power (Keith 2026-10-30). */
  family?: ShoulderFamily;
  /** Feeds: the special round their key loads (none: the key overdrives the gun's fire rate). */
  round?: RoundType;
}

const R = LEG_TYPES.rampart.values;
const W = { ...WALKER_DEFAULTS, ...R };
const U = UPPER_DEFAULTS;
const WD = WEAPON_DEFAULTS;
const s = (base: number, spread: number): StatRange => ({ base, spread });

// Today's mech values that live in src/game/mechUnit.ts (MECH_DEFAULTS; not imported, it pulls in the renderer).
const HULL_POINTS = 3000, HULL_ARMOUR = 8, ROUND_DAMAGE = 12, ROUND_PIERCE = 2, ROUND_AP = 0.1;
/** An ammo drum's magazine bonus: the default loadout (a drum per side) gives the Medium minigun the slider's magazine. */
const DRUM_BONUS = 0.5;

export const BASES: Base[] = [
  // Legs: walk, sprint, stride, stomp, turn and what they carry.
  {
    id: "legs-rampart", name: "Rampart legs", kind: "legs", tags: ["legs"], weight: 6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { walkSpeed: s(W.walkSpeed, 0.06), sprintSpeed: s(W.sprintSpeed, 0.06), accel: s(W.accel, 0.1), strideBase: s(W.strideBase, 0.04), stridePerSpeed: s(W.stridePerSpeed, 0.06), impact: s(W.impact, 0.1), turnRate: s(W.turnRate, 0.08), carry: s(12, 0.1), trample: s(1, 0.06), crush: s(1, 0.1) },
  },
  {
    id: "legs-stilt", name: "Stilt legs", kind: "legs", tags: ["legs"], weight: 4.5, makers: ["Novus-Lux"], look: "rampart-stilt", drop: 1,
    stats: { walkSpeed: s(7.2, 0.06), sprintSpeed: s(10, 0.06), accel: s(3.8, 0.1), strideBase: s(2.5, 0.04), stridePerSpeed: s(0.45, 0.06), impact: s(1.4, 0.1), turnRate: s(140, 0.08), carry: s(8, 0.1), trample: s(0.8, 0.06), crush: s(0.75, 0.1) },
  },
  {
    id: "legs-siege", name: "Siege legs", kind: "legs", tags: ["legs"], weight: 8.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1,
    stats: { walkSpeed: s(5, 0.06), sprintSpeed: s(7, 0.06), accel: s(2.2, 0.1), strideBase: s(2.1, 0.04), stridePerSpeed: s(0.36, 0.06), impact: s(3.6, 0.1), turnRate: s(95, 0.08), carry: s(18, 0.1), trample: s(1.3, 0.06), crush: s(1.5, 0.1) },
  },
  // Hulls: hull points, torso turn, mounts.
  {
    id: "hull-rampart", name: "Rampart hull", kind: "hull", tags: ["hull"], weight: 7, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["hullWeapon", "arm"] }], sensor: ["front", "top"], pack: true, waist: ["L", "R"] }, stats: { hull: s(HULL_POINTS, 0.08), armour: s(HULL_ARMOUR, 0.1), torsoTurnRate: s(U.torsoTurnRate, 0.08) },
  },
  {
    id: "hull-siege", name: "Siege hull", kind: "hull", tags: ["hull"], weight: 9.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1,
    // Armoured all over the front: sensors only up on top.
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["hullWeapon", "arm"] }], sensor: ["top"], pack: true, waist: ["L", "R"] }, stats: { hull: s(4200, 0.08), armour: s(12, 0.1), torsoTurnRate: s(110, 0.08) },
  },
  {
    id: "hull-salvager", name: "Salvager hull", kind: "hull", tags: ["hull"], weight: 5.5, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-salvager", drop: 1,
    // A utility hull: its right mount takes only an arm (a working arm for stripping), no hull weapon; a head at the
    // front to see what it strips, no top mount (the crane rail runs over it).
    mounts: { hull: [{ side: "L", takes: ["hullWeapon", "arm"] }, { side: "R", takes: ["arm"] }], sensor: ["front"], pack: true, waist: ["L", "R"] }, stats: { hull: s(2400, 0.08), armour: s(5, 0.1), torsoTurnRate: s(190, 0.08), carryBonus: s(4, 0.15) },
  },
  // Sensors (optional mount, Keith 2026-10-26): the mech radar's range and the seekers (rarer: more modes, longer).
  // Two styles (Keith 2026-10-26): heads at the front follow the aim and help it a little (a wider soft-lock cone, a
  // touch more gun tracking) on a shorter radar; clusters on top reach further on the radar and don't help the aim
  // (Claude's call, small on purpose). The Rampart's default is the visor head at today's radar range.
  {
    id: "sensor-visor", name: "Rampart visor head", kind: "sensor", tags: ["sensor", "head"], weight: 0.5, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    sensor: { style: "head" }, seekers: ["scrap", "wreck", "rare", "legendary"], stats: { radarRange: s(150, 0.08), lockAssist: s(2, 0.25) },
  },
  {
    id: "sensor-optic", name: "Twin-optic head", kind: "sensor", tags: ["sensor", "head"], weight: 0.6, makers: ["Novus-Lux"], look: "rampart-wildcat", drop: 0.8,
    sensor: { style: "head" }, seekers: ["rare", "scrap", "wreck", "legendary"], stats: { radarRange: s(120, 0.08), lockAssist: s(4, 0.25), trackAssist: s(0.12, 0.25) },
  },
  {
    id: "sensor-mast", name: "Rampart mast", kind: "sensor", tags: ["sensor", "cluster"], weight: 0.4, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    sensor: { style: "cluster" }, seekers: ["scrap", "wreck", "rare", "legendary"], stats: { radarRange: s(180, 0.08) },
  },
  {
    id: "sensor-dish", name: "Survey dish", kind: "sensor", tags: ["sensor", "cluster"], weight: 0.7, makers: ["Novus-Lux"], look: "rampart-salvager", drop: 0.8,
    sensor: { style: "cluster", sweep: 40 }, seekers: ["wreck", "scrap", "rare", "legendary"], stats: { radarRange: s(210, 0.08) },
  },
  {
    id: "sensor-array", name: "Long array", kind: "sensor", tags: ["sensor", "cluster"], weight: 1.1, makers: ["Suzaku", "Novus-Lux"], look: "rampart-railgun", drop: 0.5,
    sensor: { style: "cluster" }, seekers: ["rare", "legendary", "wreck", "scrap"], stats: { radarRange: s(280, 0.08) },
  },
  // Arms: on a hull mount in place of a hull weapon; hold a held weapon (their tracking and arc are its) and carry
  // a shoulder weapon on the same mount. Hands strip salvage faster (Keith: arms might make salvaging faster).
  {
    id: "arm-rampart", name: "Rampart arm", kind: "arm", tags: ["arm"], weight: 1.4, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { track: s(18, 0.1), arc: s(40, 0.1), salvage: s(0.25, 0.2) },
  },
  {
    id: "arm-wildcat", name: "Wildcat arm", kind: "arm", tags: ["arm"], weight: 1.1, makers: ["Novus-Lux"], look: "rampart-wildcat", drop: 0.7,
    stats: { track: s(24, 0.1), arc: s(48, 0.1), salvage: s(0.15, 0.2) },
  },
  {
    id: "arm-loader", name: "Loader arm", kind: "arm", tags: ["arm"], weight: 1.8, makers: ["Suzaku"], look: "rampart-salvager", drop: 0.7,
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
  // Power (Keith 2026-10-30): for the energy builds. The passive refills the energy bars faster; the key refills bars at once.
  {
    id: "sh-capacitor", name: "Capacitor bank", kind: "shoulder", shoulder: "capacitor", tags: ["shoulder", "power", "energy"], weight: 1.6, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-railgun", drop: 0.9,
    stats: { refill: s(WD.capRefill, 0.15), dischargeBars: s(WD.capBars, 0.5), cooldown: s(WD.capCooldown, 0.1) },
  },
  // Power packs (the pack mount, high on the back): dash charges and recharge for now (energy weapons later). Charges are
  // energy bars (Keith 2026-10-27: 4 by default, recharge 30% faster; every pack scaled the same).
  {
    id: "pack-standin", name: "Stand-in power pack", kind: "pack", tags: ["power"], weight: 1.6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { dashCharges: s(DASH_DEFAULTS.dashCharges, 0.2), dashRecharge: s(DASH_DEFAULTS.dashRecharge, 0.1) },
  },
  {
    id: "pack-capacitor", name: "Capacitor pack", kind: "pack", tags: ["power"], weight: 2.2, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.8,
    stats: { dashCharges: s(6, 0.15), dashRecharge: s(3.1, 0.1) },
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
    stats: { carryBonus: s(2.5, 0.15) },
  },
  {
    id: "waist-kit", name: "Cutting kit", kind: "waist", tags: ["waist", "salvage"], weight: 0.5, makers: ["Suzaku"], look: "rampart-salvager", drop: 0.6,
    stats: { salvage: s(0.3, 0.2) },
  },
];

// Every shoulder item has a family (launcher unless it says otherwise: the older four).
for (const b of BASES) if (b.shoulder) b.family = SHOULDER_FAMILY[b.shoulder];

/** Bases renamed since saves were written (src/ui/bay.ts loadBay migrates them). */
export const RENAMED_BASES: Record<string, string> = { "back-drums": "waist-drums", "back-fulldrums": "waist-fulldrums" };

export const BASE_BY_ID: Record<string, Base> = Object.fromEntries(BASES.map((b) => [b.id, b]));
