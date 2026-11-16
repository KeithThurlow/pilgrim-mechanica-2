// The mech-down riff (Keith 2026-11-16: "when you down an enemy mech... a little riff based on the rarity of the items
// the mech has"). Pure: the score only; LootSound.mechDown plays it on the item-drop guitar.
//
// One note per item on the downed mech (its salvageable parts and any drops that fall with it), lowest rarity first,
// at most `riffNotes` (the rarest kept). Commons chug on the low E (a gallop), anything better climbs the E minor
// pentatonic, higher the rarer: Uncommon a muted note, Rare a ringing one, Epic and up a fifth on top. The run gets
// quicker the better the best item, then a beat's rest and the best item's own drop sound lands as the finale (a chug,
// a power chord, the Epic bend, the Legendary dive). A mech of commons: a short chug-chug-chug; a Legendary on it: a
// climbing run into the squeal.
import type { Param } from "../core/tweaks";

export const MECH_RIFF_DEFAULTS = {
  riffVolume: 1,
  riffNotes: 6,
  riffStep: 0.12,
  riffRush: 0.35,
  riffRest: 1,
};
export type MechRiffValues = typeof MECH_RIFF_DEFAULTS;
export const MECH_RIFF_GROUP = "Mech down riff";
const G = MECH_RIFF_GROUP;
export const MECH_RIFF_PARAMS: Param[] = [
  { key: "riffVolume", label: "Riff volume", min: 0, max: 2, step: 0.05, group: G, tip: "The riff when an enemy mech goes down (× the loot sound volume); 0 is off" },
  { key: "riffNotes", label: "Most notes in the run", min: 0, max: 10, step: 1, group: G, tip: "One per item on the mech, the rarest kept; 0: only the finale" },
  { key: "riffStep", label: "Note step (s)", min: 0.04, max: 0.3, step: 0.005, group: G, tip: "Time between the run's notes for a mech of commons" },
  { key: "riffRush", label: "Quicker by rarity", min: 0, max: 0.8, step: 0.05, group: G, tip: "The step shrinks by this share at Mythic (in steps per tier): rarer mechs get a faster run" },
  { key: "riffRest", label: "Rest before the finale (steps)", min: 0, max: 4, step: 0.25, group: G, tip: "The gap before the best item's drop sound lands" },
];

/** E minor pentatonic in semitones over the low E. */
const PENTA = [0, 3, 5, 7, 10];

export interface RiffNote {
  /** Seconds after the start. */
  t: number;
  /** Semitones over the low E (E2). */
  semis: number;
  /** The item's rarity tier (0 Common .. 5 Mythic). */
  tier: number;
  /** "mute" a palm-muted chug, "ring" a ringing note, "fifth" a ringing note with its fifth. */
  voice: "mute" | "ring" | "fifth";
  /** Seconds it sounds. */
  len: number;
}

export interface RiffScore { notes: RiffNote[]; finale: { t: number; tier: number } }

/** The riff for a downed mech carrying items of these rarity tiers (null: nothing on it). */
export function mechRiff(tiers: readonly number[], v: MechRiffValues = MECH_RIFF_DEFAULTS): RiffScore | null {
  if (!tiers.length) return null;
  const sorted = tiers.map((t) => Math.max(0, Math.min(5, Math.round(t)))).sort((a, b) => a - b);
  const best = sorted[sorted.length - 1];
  const keep = Math.max(0, Math.round(v.riffNotes));
  const run = keep ? sorted.slice(-keep) : [];
  const step = Math.max(0.02, v.riffStep * (1 - v.riffRush * best / 5));
  const notes: RiffNote[] = [];
  let climb = 0;
  run.forEach((tier, i) => {
    // Commons stay on the root; each better item climbs a step plus its tier, so the run rises toward the rare ones.
    if (tier > 0) climb = Math.max(climb + 1, i + tier);
    const d = tier > 0 ? climb : 0;
    const semis = 12 * Math.floor(d / 5) + PENTA[d % 5];
    const voice = tier <= 1 ? "mute" : tier === 2 ? "ring" : "fifth";
    notes.push({ t: i * step, semis, tier, voice, len: voice === "mute" ? step * 0.9 : step * 1.6 });
  });
  const t = run.length ? (run.length + Math.max(0, v.riffRest)) * step : 0;
  return { notes, finale: { t, tier: best } };
}
