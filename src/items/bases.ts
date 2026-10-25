// The base table: every kind of part and weapon an item can be, as data. A base gives each stat a value and how far
// it rolls each way at Common (`spread`, a share of the value; rarity widens it, src/items/rarity.ts). The Rampart
// parts, the Medium minigun, the stand-in power pack and the ammo drums hold today's mech values exactly, so the
// default loadout runs the mech as it was (tools/loadout-check.ts holds them to it).
// Weapons start as minigun sizes on the existing gun sim (Light in a hand, Medium as a hull weapon, Heavy
// two-handed); new guns with their own feel come later (proposal step 2).
import { WALKER_DEFAULTS } from "../mech/walkerTuning";
import { LEG_TYPES } from "../mech/legTypes";
import { UPPER_DEFAULTS } from "../mech/upper";
import { DASH_DEFAULTS } from "../mech/dash";
import type { ItemKind, Size } from "./item";

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
  pierce: { label: "Pierce", better: 1, decimals: 0, whole: true },
  dashCharges: { label: "Dash charges", better: 1, decimals: 0, whole: true },
  dashRecharge: { label: "Dash recharge (s)", better: -1, decimals: 2 },
  ammoPerGun: { label: "Rounds per gun", better: 1, decimals: 0, whole: true },
};

export interface StatRange { base: number; spread: number }

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
  /** Hulls: arm mounts (left and right) and whether a power pack (with its back mount) fits. */
  mounts?: { arms: number; pack: boolean };
  /** Power packs: back mounts under the pack. */
  backMounts?: number;
}

const R = LEG_TYPES.rampart.values;
const W = { ...WALKER_DEFAULTS, ...R };
const U = UPPER_DEFAULTS;
const s = (base: number, spread: number): StatRange => ({ base, spread });

// Today's mech values that live in src/game/mechUnit.ts (MECH_DEFAULTS; not imported, it pulls in the renderer).
const HULL_POINTS = 1500, ROUND_DAMAGE = 9, ROUND_PIERCE = 2;

export const BASES: Base[] = [
  // Legs: walk, sprint, stride, stomp, turn and what they carry.
  {
    id: "legs-rampart", name: "Rampart legs", kind: "legs", tags: ["legs"], weight: 6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { walkSpeed: s(W.walkSpeed, 0.06), sprintSpeed: s(W.sprintSpeed, 0.06), accel: s(W.accel, 0.1), strideBase: s(W.strideBase, 0.04), stridePerSpeed: s(W.stridePerSpeed, 0.06), impact: s(W.impact, 0.1), turnRate: s(W.turnRate, 0.08), carry: s(12, 0.1) },
  },
  {
    id: "legs-stilt", name: "Stilt legs", kind: "legs", tags: ["legs"], weight: 4.5, makers: ["Novus-Lux"], look: "rampart-stilt", drop: 1,
    stats: { walkSpeed: s(4.8, 0.06), sprintSpeed: s(7.8, 0.06), accel: s(3.8, 0.1), strideBase: s(2.5, 0.04), stridePerSpeed: s(0.45, 0.06), impact: s(1.4, 0.1), turnRate: s(140, 0.08), carry: s(8, 0.1) },
  },
  {
    id: "legs-siege", name: "Siege legs", kind: "legs", tags: ["legs"], weight: 8.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1,
    stats: { walkSpeed: s(3.3, 0.06), sprintSpeed: s(5.2, 0.06), accel: s(2.2, 0.1), strideBase: s(2.1, 0.04), stridePerSpeed: s(0.36, 0.06), impact: s(3.6, 0.1), turnRate: s(95, 0.08), carry: s(18, 0.1) },
  },
  // Hulls: hull points, torso turn, mounts.
  {
    id: "hull-rampart", name: "Rampart hull", kind: "hull", tags: ["hull"], weight: 7, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    mounts: { arms: 2, pack: true }, stats: { hull: s(HULL_POINTS, 0.08), torsoTurnRate: s(U.torsoTurnRate, 0.08) },
  },
  {
    id: "hull-siege", name: "Siege hull", kind: "hull", tags: ["hull"], weight: 9.5, makers: ["Suzaku"], look: "rampart-siege", drop: 1,
    mounts: { arms: 2, pack: true }, stats: { hull: s(2100, 0.08), torsoTurnRate: s(110, 0.08) },
  },
  {
    id: "hull-salvager", name: "Salvager hull", kind: "hull", tags: ["hull"], weight: 5.5, makers: ["Novus-Lux", "Stratford-Aegis"], look: "rampart-salvager", drop: 1,
    mounts: { arms: 2, pack: true }, stats: { hull: s(1200, 0.08), torsoTurnRate: s(190, 0.08), carryBonus: s(4, 0.15) },
  },
  // Arms: hold a hand weapon; their tracking and arc are the hand gun's.
  {
    id: "arm-rampart", name: "Rampart arm", kind: "arm", tags: ["arm"], weight: 1.4, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { track: s(18, 0.1), arc: s(40, 0.1) },
  },
  {
    id: "arm-wildcat", name: "Wildcat arm", kind: "arm", tags: ["arm"], weight: 1.1, makers: ["Novus-Lux"], look: "rampart-wildcat", drop: 0.7,
    stats: { track: s(24, 0.1), arc: s(48, 0.1) },
  },
  // Weapons: minigun sizes on the existing gun sim.
  {
    id: "mg-light", name: "Light minigun", kind: "weapon", size: "L", tags: ["weapon", "ballistic", "minigun"], weight: 0.9, makers: ["Suzaku", "Novus-Lux"], look: "rampart-wildcat", drop: 1.5,
    stats: { fireRate: s(20, 0.08), damage: s(6, 0.1), spread: s(4, 0.1), spinUp: s(0.5, 0.1), range: s(38, 0.06), pierce: s(1, 0.3) },
  },
  {
    id: "mg-medium", name: "Minigun", kind: "weapon", size: "M", tags: ["weapon", "ballistic", "minigun"], weight: 1.8, makers: ["Stratford-Aegis", "Suzaku"], look: "rampart", drop: 1.5,
    stats: { fireRate: s(U.fireRate, 0.08), damage: s(ROUND_DAMAGE, 0.1), spread: s(U.spread, 0.1), spinUp: s(U.spinUp, 0.1), range: s(U.range, 0.06), pierce: s(ROUND_PIERCE, 0.2), arc: s(U.podYawMax, 0.08), track: s(U.podTrack, 0.08) },
  },
  {
    id: "mg-heavy", name: "Heavy minigun", kind: "weapon", size: "H", tags: ["weapon", "ballistic", "minigun", "heavy"], weight: 3.2, makers: ["Suzaku"], look: "rampart-turret", drop: 1,
    stats: { fireRate: s(22, 0.08), damage: s(14, 0.1), spread: s(2.4, 0.1), spinUp: s(1.4, 0.1), range: s(55, 0.06), pierce: s(3, 0.2), handling: s(0.6, 0.1) },
  },
  // Power packs: dash charges and recharge for now (energy weapons later); the back mount sits under the pack.
  {
    id: "pack-standin", name: "Stand-in power pack", kind: "pack", tags: ["power"], weight: 1.6, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    backMounts: 1, stats: { dashCharges: s(DASH_DEFAULTS.dashCharges, 0.2), dashRecharge: s(DASH_DEFAULTS.dashRecharge, 0.1) },
  },
  {
    id: "pack-capacitor", name: "Capacitor pack", kind: "pack", tags: ["power"], weight: 2.2, makers: ["Novus-Lux"], look: "rampart-railgun", drop: 0.8,
    backMounts: 1, stats: { dashCharges: s(3, 0.15), dashRecharge: s(4, 0.1) },
  },
  // Back mount: ammo for now (a rocket pod or mortar later).
  {
    id: "back-drums", name: "Ammo drums", kind: "back", tags: ["back", "ammo"], weight: 1.2, makers: ["Stratford-Aegis"], look: "rampart", drop: 1,
    stats: { ammoPerGun: s(U.ammoPerGun, 0.12) },
  },
  {
    id: "back-fulldrums", name: "Full drums", kind: "back", tags: ["back", "ammo"], weight: 2, makers: ["Suzaku"], look: "rampart", drop: 0.7,
    stats: { ammoPerGun: s(2000, 0.12) },
  },
];

export const BASE_BY_ID: Record<string, Base> = Object.fromEntries(BASES.map((b) => [b.id, b]));
