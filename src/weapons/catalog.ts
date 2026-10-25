// Every weapon model there is, by id. The id is the file stem in public/models/weapons/ (docs/asset-list.md): the
// library loads `<id>.glb` (+ `<id>.json`) when it exists, and otherwise builds the code stand-in named here, so a
// Blender model at the item's path replaces the stand-in with no code change. A `-left` id is the mirror for the
// left side: its own GLB if there is one, else the right one mirrored (or the stand-in built for the left).
//
// Scale (2026-10-25): the old kit's models are "metres at game size" for the old game's walker (mechHeight 5.2, head
// about 4.7 m), the Rampart's size here (hips 3.05 m, hood about 4.4 m, hull top 5.75 m): fit 1.0, not the old
// lab's 1 / 0.612. Stand-ins are built at Rampart scale. `weaponScale` in the armoury lab scales everything.
import type { ModelDef, HeatRule } from "./parts";
import { barrelHeat } from "./parts";
import { rocketLauncherHull, rocketLauncherShoulder, rocketProjectile, missileProjectile } from "./build/rpg";
import { mortarHeavy, mortarLine, mortarShellProjectile } from "./build/mortar";
import { railCannonHull, railCannon2h } from "./build/rail";
import { autocannonHull, cannonHull } from "./build/guns";
import { plasmaCannonHull, laserProjectorHull } from "./build/energy";

export type Mount = "hull" | "shoulder" | "back" | "hand" | "forearm" | "two_handed" | "belt" | "projectile";

export interface CatalogEntry {
  id: string;
  /** Minigun, HandCannon, MissilePod, AmmoDrum, AmmoBelt, RocketLauncher, Mortar, LineMortar, RailCannon,
   * Autocannon, Cannon, PlasmaCannon, LaserProjector, Projectile */
  cls: string;
  size: string;
  label: string;
  mount: Mount;
  /** Right (outboard -X), left (+X) or both (symmetric). */
  side: "right" | "left" | "both";
  /** The entry for the other side, if any. */
  mirror?: string;
  brand: string;
  /** The code stand-in, when no GLB exists at the path. sd: +1 left, -1 right. */
  build?: (sd: 1 | -1) => ModelDef;
  /** Which parts glow with heat on a model with no Glow_n sockets (the converted ones). */
  heat?: Record<string, HeatRule>;
  /** Code-built extras on a GLB that lacks them: a targeting laser under the barrels or on the side. */
  addon?: "laserUnder" | "laserSide";
  /** Scale onto the Rampart. */
  fit: number;
  /** Where the model came from, for the viewer. */
  note: string;
}

const KIT = "old kit (converted)";
type Row = [id: string, cls: string, size: string, label: string, mount: Mount, sided: boolean, extra?: Partial<CatalogEntry>];

const ROWS: Row[] = [
  // Converted from the old project's kit (tools/weapons-import.ts); left versions are their own files.
  ["minigun-l", "Minigun", "L", "Minigun L", "forearm", true, { brand: "Goliath Earthworks", note: KIT, heat: { Spin: barrelHeat(0.3) }, addon: "laserUnder" }],
  ["minigun-m", "Minigun", "M", "Minigun M (hull)", "hull", true, { brand: "Goliath Earthworks", note: KIT, heat: { Spin: barrelHeat(0.3) }, addon: "laserUnder" }],
  ["minigun-h", "Minigun", "H", "Minigun H (two-handed)", "two_handed", false, { brand: "Goliath Earthworks", note: KIT, heat: { Spin: barrelHeat(0.3) }, addon: "laserUnder" }],
  ["hand-cannon-l", "HandCannon", "L", "Hand cannon L", "hand", true, { brand: "Goliath Earthworks", note: KIT, heat: { Barrel: barrelHeat(0.4) } }],
  ["hand-cannon-m", "HandCannon", "M", "Hand cannon M", "hand", true, { brand: "Goliath Earthworks", note: KIT, heat: { Barrel: barrelHeat(0.4) } }],
  ["hand-cannon-h", "HandCannon", "H", "Hand cannon H", "hand", true, { brand: "Goliath Earthworks", note: KIT, heat: { Barrel: barrelHeat(0.4) } }],
  ["missile-pod-l", "MissilePod", "L", "Missile pod L", "forearm", true, { brand: "Stratford-Aegis", note: KIT, addon: "laserSide" }],
  ["missile-pod-m", "MissilePod", "M", "Missile pod M (shoulder)", "shoulder", true, { brand: "Stratford-Aegis", note: KIT, addon: "laserSide" }],
  ["missile-pod-h", "MissilePod", "H", "Missile pod H (shoulder)", "shoulder", true, { brand: "Stratford-Aegis", note: KIT, addon: "laserSide" }],
  ["ammo-drum-back-half", "AmmoDrum", "Back_Half", "Ammo drum, half", "back", true, { brand: "Goliath Earthworks", note: KIT }],
  ["ammo-drum-back-full", "AmmoDrum", "Back_Full", "Ammo drum, full", "back", false, { brand: "Goliath Earthworks", note: KIT }],
  ["ammo-belt-link", "AmmoBelt", "Link", "Belt link", "belt", false, { brand: "Goliath Earthworks", note: KIT }],
  ["ammo-belt-chute", "AmmoBelt", "Chute", "Belt chute", "belt", false, { brand: "Goliath Earthworks", note: KIT }],
  // Code stand-ins (src/weapons/build/) for docs/asset-list.md items, until the Blender models land at these paths.
  // W1-W3 (explosives first), W6-W8, then the energy guns (P3) and the projectiles.
  ["rocket-launcher-hull", "RocketLauncher", "Hull", "RPG launcher (hull)", "hull", true, { build: rocketLauncherHull, fit: 1.15 }],
  ["rocket-launcher-shoulder", "RocketLauncher", "Shoulder", "RPG launcher (shoulder)", "shoulder", true, { build: rocketLauncherShoulder, fit: 1.15 }],
  ["mortar-heavy", "Mortar", "H", "Heavy mortar (shoulder)", "shoulder", true, { build: mortarHeavy }],
  ["mortar-line", "LineMortar", "M", "Line mortar rack (shoulder)", "shoulder", true, { build: mortarLine }],
  ["rail-cannon-hull", "RailCannon", "Hull", "Rail cannon (hull)", "hull", true, { build: railCannonHull }],
  ["rail-cannon-2h", "RailCannon", "2H", "Rail cannon (two-handed)", "two_handed", false, { build: railCannon2h }],
  ["autocannon-hull", "Autocannon", "Hull", "Autocannon (hull)", "hull", true, { build: autocannonHull }],
  ["cannon-hull", "Cannon", "Hull", "Cannon (hull)", "hull", true, { build: cannonHull }],
  ["plasma-cannon-hull", "PlasmaCannon", "Hull", "Plasma cannon (hull)", "hull", true, { build: plasmaCannonHull }],
  ["laser-projector-hull", "LaserProjector", "Hull", "Laser projector (hull)", "hull", true, { build: laserProjectorHull }],
  ["rocket", "Projectile", "Rocket", "Rocket (projectile)", "projectile", false, { build: () => rocketProjectile() }],
  ["missile", "Projectile", "Missile", "Missile (projectile)", "projectile", false, { build: () => missileProjectile() }],
  ["mortar-shell", "Projectile", "MortarShell", "Mortar shell (projectile)", "projectile", false, { build: () => mortarShellProjectile() }],
];

export const CATALOG: CatalogEntry[] = ROWS.flatMap<CatalogEntry>(([id, cls, size, label, mount, sided, extra = {}]) => {
  const base = { cls, size, mount, brand: "Pilgrim kit", fit: 1, note: "code stand-in (no GLB at the path yet)", ...extra };
  if (!sided) return [{ ...base, id, label, side: "both" as const }];
  return [
    { ...base, id, label, side: "right" as const, mirror: `${id}-left` },
    { ...base, id: `${id}-left`, label: `${label}, left`, side: "left" as const, mirror: id },
  ];
});

export function entry(id: string) {
  const e = CATALOG.find((c) => c.id === id);
  if (!e) throw new Error(`no weapon model "${id}"`);
  return e;
}

/** The entry for a class and size on a side (falls back to the symmetric one). */
export function find(cls: string, size: string, side: "right" | "left" = "right") {
  const all = CATALOG.filter((c) => c.cls.toLowerCase() === cls.toLowerCase() && c.size.toLowerCase() === size.toLowerCase());
  return all.find((c) => c.side === side) ?? all.find((c) => c.side === "both") ?? all[0] ?? null;
}

/** Register another model (a new class) at run time. */
export function register(e: CatalogEntry) { CATALOG.push(e); }
