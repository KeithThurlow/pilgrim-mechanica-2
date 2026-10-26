// A quick weapon pick (pure): which weapon on each mouse button and shoulder key, turned into a loadout through the
// fit rules, so the mech is what the bay would build. The weapons lab's picker and the convoy lab's kit both use it.
// The mounts (Keith 2026-10-26, src/items/loadout.ts): a shoulder weapon rides on an arm, so a side with a shoulder
// pick becomes an arm holding the held version of its gun (a hull minigun -> a light minigun, a rail cannon -> the
// light rail; the autocannon and rocket launcher have no held version yet, so a light minigun). Key 3 is the pack
// mount: the power pack, or a back weapon in its place.
import { defaultLoadout, fit, MOUNTS, type Loadout, type SlotId } from "./loadout";
import { makeItem } from "./generate";

export const SIDE = { minigun: "Minigun", rail: "Rail cannon", lightmg: "Light minigun (arm)", lightrail: "Light rail (arm)", autocannon: "Autocannon", rpg: "Rocket launcher" } as const;
export const SHOULDER = { none: "—", rpg: "Rocket", missiles: "Missile pod", mortar: "Big mortar", linemortar: "Line mortar" } as const;
export const BACK = { pack: "Power pack", none: "—", rpg: "Rocket", missiles: "Missile pod", mortar: "Big mortar", linemortar: "Line mortar" } as const;
export type SidePick = keyof typeof SIDE;
export type ShoulderPick = keyof typeof SHOULDER;
export type BackPick = keyof typeof BACK;
export interface Pick { left: SidePick; right: SidePick; k1: ShoulderPick; k2: ShoulderPick; k3: BackPick }
/** Each pick's row: its key, its control, its options. */
export const ROWS = [["left", "LMB", SIDE], ["right", "RMB", SIDE], ["k1", "Key 1", SHOULDER], ["k2", "Key 2", SHOULDER], ["k3", "Key 3", BACK]] as const;

/** Old picks still read (saved picks, URL flags): k3 "drums" was the back mount's drums, now the pack (drums sit on
 *  the waist). */
const OLD: Record<string, string> = { drums: "pack" };

/** Overrides from URL flags (?left=, ?right=, ?k1=, ?k2=, ?k3=); true if any was given. */
export function pickFromParams(pick: Pick, params: URLSearchParams): boolean {
  let any = false;
  for (const [row, , opts] of ROWS) {
    let q = params.get(row);
    if (q && OLD[q]) q = OLD[q];
    if (q && q in opts) { (pick as unknown as Record<string, string>)[row] = q; any = true; }
  }
  return any;
}

/** Fix up a saved pick from before the mounts. */
export function cleanPick(pick: Pick): Pick {
  const p = pick as unknown as Record<string, string>;
  for (const [row, , opts] of ROWS) { if (OLD[p[row]]) p[row] = OLD[p[row]]; if (!(p[row] in opts)) p[row] = Object.keys(opts)[0]; }
  for (const [side, key] of SIDE_KEY) if (HULL_BASE[pick[side]] && pick[key] !== "none") pick[side] = HELD_PICK[pick[side]];
  return pick;
}

/** Set one row, the latest choice winning over the mount rule: a hull weapon on a side clears that side's shoulder
 *  key (no arm to carry it); a shoulder weapon turns that side's hull weapon into its held version. So the picker
 *  always shows what's fitted (a rail cannon with a shoulder pick used to come out a light rail, still lit as the
 *  rail cannon). */
export function choose(pick: Pick, row: keyof Pick, id: string): Pick {
  (pick as unknown as Record<string, string>)[row] = id;
  for (const [side, key] of SIDE_KEY) {
    if (row === side && HULL_BASE[pick[side]]) pick[key] = "none";
    if (row === key && id !== "none" && HULL_BASE[pick[side]]) pick[side] = HELD_PICK[pick[side]];
  }
  return pick;
}

const SIDE_KEY = [["left", "k1"], ["right", "k2"]] as const;
const HULL_BASE: Partial<Record<SidePick, string>> = { minigun: "mg-medium", rail: "rail-medium", autocannon: "ac-medium", rpg: "rpg-medium" };
/** A hull weapon's held version on an arm (the autocannon and rocket launcher have none yet: a light minigun). */
const HELD_PICK: Record<SidePick, SidePick> = { minigun: "lightmg", lightmg: "lightmg", rail: "lightrail", lightrail: "lightrail", autocannon: "lightmg", rpg: "lightmg" };
const HELD_BASE: Record<SidePick, string> = { minigun: "mg-light", lightmg: "mg-light", rail: "rail-light", lightrail: "rail-light", autocannon: "mg-light", rpg: "mg-light" };
const SHOULDER_BASE: Record<string, string> = { rpg: "sh-rpg", missiles: "sh-missiles", mortar: "sh-mortar", linemortar: "sh-linemortar" };

export function loadoutFor(p: Pick): Loadout {
  const lo = defaultLoadout();
  const put = (slot: SlotId, base: string) => fit(lo, slot, makeItem(base, "common", `range-${slot}-${base}`));
  for (const [side, s, key] of [["left", "L", p.k1], ["right", "R", p.k2]] as const) {
    const w = p[side], m = MOUNTS[s], shoulder = SHOULDER_BASE[key];
    if (HULL_BASE[w] && !shoulder) put(m.mount, HULL_BASE[w]!);
    else { put(m.mount, "arm-rampart"); put(m.held, HELD_BASE[w]); }
    if (shoulder) put(m.shoulder, shoulder);
  }
  if (SHOULDER_BASE[p.k3]) put("pack", SHOULDER_BASE[p.k3]);
  else if (p.k3 === "none") lo.pack = null;
  return lo;
}
