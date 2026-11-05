// Round guns (Keith 2026-11-02: "a sniper rifle ... similar to a rail cannon, but just shoots", SMGs, rifles,
// shotguns, and flak cannons as "hull-mounted versions of shotguns"). Pure data: each fires rounds through the same path
// as the minigun (src/mech/upper.ts clocks the shots, src/game/mechUnit.ts fires them through Battlefield.fire as
// penetrating sheets), so penetration, armour, Protocols, feeds and magazines all work on them as they do on the
// minigun. What differs is in these numbers: no spin-up (the first round leaves on the click), pellets per shot (the
// shotgun and flak), splash per pellet (flak shrapnel), and the sound, kick and model the arsenal gives each shot.
//
//   SMG      held (Light): a fast, wide, short-range hose; cheap and light, quick in the hand.
//   Rifle    held (Light): an accurate semi-auto, medium rate, good penetration.
//   Shotgun  held (Light): a cone of pellets, deadly close, nothing at range.
//   Sniper   hull (Medium): one heavy, dead-straight round that punches through a line of bodies, slow, small magazine.
//   Flak     hull (Medium): the shotgun's hull-mounted big brother: more pellets, further, each bursting into shrapnel.
//
// A rolled item carries its own numbers (src/items/bases.ts takes its bases from these defaults); an unrolled one (the
// weapons lab's picker) runs on these sliders, live (src/weapons/arsenal.ts refreshes its gun record each frame).
import type { Param } from "../core/tweaks";

export type RoundGun = "smg" | "rifle" | "shotgun" | "sniper" | "flak" | FlameGun;
/** The flamers (Keith 2026-11-05, src/weapons/fire/fireTuning.ts): round guns whose invisible jets set things burning. */
export type FlameGun = "flamer" | "inferno";
export const ROUND_GUNS: readonly RoundGun[] = ["smg", "rifle", "shotgun", "sniper", "flak", "flamer", "inferno"];
export const isFlameGun = (cls: string | undefined | null): cls is FlameGun => cls === "flamer" || cls === "inferno";
/** A gun class that fires rounds on its clock through the minigun's path (not the minigun itself). */
export const isRoundGun = (cls: string | undefined | null): cls is RoundGun => !!cls && (ROUND_GUNS as readonly string[]).includes(cls);

export const GUN_DEFAULTS = {
  // SMG
  smgRate: 15,
  smgDamage: 12,
  smgSpread: 6,
  smgRange: 28,
  smgPierce: 1,
  smgAp: 0,
  smgMag: 50,
  smgReload: 1.5,
  // Rifle
  rifleRate: 4,
  rifleDamage: 30,
  rifleSpread: 0.6,
  rifleRange: 55,
  riflePierce: 3,
  rifleAp: 0.3,
  rifleMag: 24,
  rifleReload: 2.2,
  // Shotgun
  shotgunRate: 1.3,
  shotgunPellets: 10,
  shotgunDamage: 11,
  shotgunSpread: 8,
  shotgunRange: 22,
  shotgunPierce: 1,
  shotgunAp: 0,
  shotgunMag: 6,
  shotgunReload: 2.4,
  // Sniper rifle
  sniperRate: 0.6,
  sniperDamage: 340,
  sniperSpread: 0.05,
  sniperRange: 110,
  sniperPierce: 10,
  sniperAp: 0.85,
  sniperMag: 5,
  sniperReload: 3.5,
  // Flak cannon
  flakRate: 1,
  flakPellets: 14,
  flakDamage: 18,
  flakSpread: 7,
  flakRange: 38,
  flakPierce: 1,
  flakAp: 0.15,
  flakMag: 8,
  flakReload: 3,
  flakSplash: 2.5,
  flakSplashShare: 0.75,
  // Each pellet bursts where it ends (Keith 2026-11-03): a small blast's look (×) and its pop (sound level).
  flakBurstFx: 1,
  flakPopLevel: 0.8,
  // The pellets' explosions as a storm (Keith 2026-11-03: "a whole lot of missiles hitting"): each its own boom, spread
  // over this many seconds; at most this many a volley sound (the rest only show); the volley's loudness grows with
  // the square root of the count, not the count, so a big crowd doesn't clip.
  flakPopStagger: 0.14,
  flakPopMax: 10,
  // Every round gun: how a shot feels.
  gunKick: 0.12,
  gunShake: 0.03,
  sniperKick: 0.45,
  sniperShake: 0.22,
  shotgunKick: 0.3,
  shotgunShake: 0.1,
  // Sound levels
  smgLevel: 0.55,
  rifleLevel: 0.7,
  shotgunLevel: 0.85,
  sniperLevel: 1,
  flakLevel: 0.95,
};
export type GunValues = typeof GUN_DEFAULTS;

/** One round gun's numbers, as a weapon item's stats name them. */
export interface GunNumbers { fireRate: number; damage: number; spread: number; range: number; pierce: number; ap: number; magazine: number; reload: number; pellets: number; splash: number; splashShare: number;
  /** Flamers: what each jet sets alight (s, damage/s); 0 for the rest. */
  burnTime: number; burnDps: number }

/** A round gun's numbers from the sliders (the base table's values and an unrolled item's live values). */
export function gunNumbers(kind: RoundGun, v: GunValues): GunNumbers {
  const r = v as unknown as Record<string, number>;
  const k = (name: string) => r[`${kind}${name}`];
  return {
    fireRate: k("Rate"), damage: k("Damage"), spread: k("Spread"), range: k("Range"), pierce: k("Pierce"), ap: k("Ap"), magazine: k("Mag"), reload: k("Reload"),
    pellets: k("Pellets") ?? 1, splash: k("Splash") ?? 0, splashShare: k("SplashShare") ?? 0, burnTime: k("BurnTime") ?? 0, burnDps: k("BurnDps") ?? 0,
  };
}

/** How hard a shot kicks the gun back (m) and shakes the camera (per kind; the arsenal applies it). */
export function gunFeel(kind: RoundGun, v: GunValues) {
  if (kind === "sniper") return { kick: v.sniperKick, shake: v.sniperShake };
  if (kind === "shotgun") return { kick: v.shotgunKick, shake: v.shotgunShake };
  if (kind === "flak") return { kick: v.shotgunKick * 1.3, shake: v.shotgunShake * 1.4 };
  if (isFlameGun(kind)) { const f = v as unknown as { flameKick: number; flameShake: number }; return { kick: f.flameKick ?? 0.02, shake: (f.flameShake ?? 0.01) * (kind === "inferno" ? 1.5 : 1) }; }
  return { kick: v.gunKick, shake: v.gunShake };
}

export const SMG_GROUP = "SMG", RIFLE_GROUP = "Rifle", SHOTGUN_GROUP = "Shotgun", SNIPER_GROUP = "Sniper rifle", FLAK_GROUP = "Flak cannon", GUN_FEEL_GROUP = "Round guns: feel";
export const GUN_GROUPS = [SMG_GROUP, RIFLE_GROUP, SHOTGUN_GROUP, SNIPER_GROUP, FLAK_GROUP, GUN_FEEL_GROUP];

const common = (p: string, group: string, o: { rate: number; dmg: number; range: number; mag: number }): Param[] => [
  { key: `${p}Rate`, label: "Shots/s", min: 0.1, max: o.rate, step: 0.05, group },
  { key: `${p}Damage`, label: p === "shotgun" || p === "flak" ? "Damage per pellet" : "Damage per round", min: 0, max: o.dmg, step: 1, group },
  { key: `${p}Spread`, label: "Spread (°)", min: 0, max: 20, step: 0.05, group, tip: "Each round (or pellet) leaves up to this far off the aim line" },
  { key: `${p}Range`, label: "Range (m)", min: 5, max: o.range, step: 1, group },
  { key: `${p}Pierce`, label: "Penetration (as minigun pierce)", min: 0, max: 20, step: 0.5, group, tip: "Read against the minigun's: 2 is the hull minigun's penetration budget, 10 goes through a line of bodies" },
  { key: `${p}Ap`, label: "Armour pierce", min: 0, max: 1, step: 0.01, group },
  { key: `${p}Mag`, label: "Magazine (shots)", min: 1, max: o.mag, step: 1, group },
  { key: `${p}Reload`, label: "Reload (s)", min: 0.2, max: 8, step: 0.1, group },
];

export const GUN_PARAMS: Param[] = [
  ...common("smg", SMG_GROUP, { rate: 40, dmg: 60, range: 80, mag: 200 }),
  ...common("rifle", RIFLE_GROUP, { rate: 15, dmg: 200, range: 120, mag: 80 }),
  ...common("shotgun", SHOTGUN_GROUP, { rate: 6, dmg: 80, range: 60, mag: 30 }),
  { key: "shotgunPellets", label: "Pellets per shot", min: 1, max: 30, step: 1, group: SHOTGUN_GROUP },
  ...common("sniper", SNIPER_GROUP, { rate: 4, dmg: 2000, range: 200, mag: 20 }),
  ...common("flak", FLAK_GROUP, { rate: 6, dmg: 100, range: 90, mag: 30 }),
  { key: "flakPellets", label: "Pellets per shot", min: 1, max: 40, step: 1, group: FLAK_GROUP },
  { key: "flakSplash", label: "Pellet blast (m)", min: 0, max: 8, step: 0.1, group: FLAK_GROUP, tip: "Each pellet explodes where it ends (sand, body or the end of its range): everything this close takes a share, as a blast (big robots take it too)" },
  { key: "flakSplashShare", label: "Pellet blast share", min: 0, max: 1.5, step: 0.01, group: FLAK_GROUP, tip: "Share of the pellet's damage at the blast's centre (half that at its edge)" },
  { key: "flakBurstFx", label: "Pellet blast look (×)", min: 0, max: 3, step: 0.05, group: FLAK_GROUP, tip: "Size of each pellet's flash, sparks, smoke and blast wave (0: none)" },
  { key: "flakPopLevel", label: "Pellet blast sound", min: 0, max: 1.5, step: 0.01, group: FLAK_GROUP },
  { key: "flakPopStagger", label: "Pellet blasts spread (s)", min: 0, max: 0.5, step: 0.01, group: FLAK_GROUP, tip: "The volley's explosions land over this long, each its own boom (0: all at once)" },
  { key: "flakPopMax", label: "Pellet blasts heard", min: 1, max: 20, step: 1, group: FLAK_GROUP, tip: "At most this many of a volley's explosions sound; the volley's loudness grows with √count" },
  { key: "gunKick", label: "SMG and rifle: gun kick (m)", min: 0, max: 1, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "gunShake", label: "SMG and rifle: camera shake", min: 0, max: 1, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "shotgunKick", label: "Shotgun: gun kick (m; flak ×1.3)", min: 0, max: 1, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "shotgunShake", label: "Shotgun: camera shake (flak ×1.4)", min: 0, max: 1, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "sniperKick", label: "Sniper: gun kick (m)", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "sniperShake", label: "Sniper: camera shake", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "smgLevel", label: "SMG sound", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "rifleLevel", label: "Rifle sound", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "shotgunLevel", label: "Shotgun sound", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "sniperLevel", label: "Sniper sound", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
  { key: "flakLevel", label: "Flak firing sound", min: 0, max: 1.5, step: 0.01, group: GUN_FEEL_GROUP },
];
