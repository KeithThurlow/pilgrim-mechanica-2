// A quick weapon pick (pure): which weapon on each mouse button and shoulder key, turned into a loadout through the
// fit rules, so the mech is what the bay would build. The weapons lab's picker and the convoy lab's kit both use it.
import { defaultLoadout, fit, type Loadout, type SlotId } from "./loadout";
import { makeItem } from "./generate";

export const SIDE = { minigun: "Minigun", rail: "Rail cannon", lightrail: "Light rail (hand)", autocannon: "Autocannon", rpg: "Rocket launcher" } as const;
export const SHOULDER = { none: "—", rpg: "Rocket", missiles: "Missile pod", mortar: "Big mortar", linemortar: "Line mortar" } as const;
export const BACK = { drums: "Ammo drums", ...SHOULDER } as const;
export type SidePick = keyof typeof SIDE;
export type ShoulderPick = keyof typeof SHOULDER;
export type BackPick = keyof typeof BACK;
export interface Pick { left: SidePick; right: SidePick; k1: ShoulderPick; k2: ShoulderPick; k3: BackPick }
/** Each pick's row: its key, its control, its options. */
export const ROWS = [["left", "LMB", SIDE], ["right", "RMB", SIDE], ["k1", "Key 1", SHOULDER], ["k2", "Key 2", SHOULDER], ["k3", "Key 3", BACK]] as const;

/** Overrides from URL flags (?left=, ?right=, ?k1=, ?k2=, ?k3=); true if any was given. */
export function pickFromParams(pick: Pick, params: URLSearchParams): boolean {
  let any = false;
  for (const [row, , opts] of ROWS) { const q = params.get(row); if (q && q in opts) { (pick as unknown as Record<string, string>)[row] = q; any = true; } }
  return any;
}

export function loadoutFor(p: Pick): Loadout {
  const lo = defaultLoadout();
  const put = (slot: SlotId, base: string) => fit(lo, slot, makeItem(base, "common", `range-${slot}-${base}`));
  for (const [side, arm, hand] of [["left", "armL", "handL"], ["right", "armR", "handR"]] as const) {
    const w = p[side];
    if (w === "rail") put(arm, "rail-medium");
    if (w === "autocannon") put(arm, "ac-medium");
    if (w === "rpg") put(arm, "rpg-medium");
    if (w === "lightrail") { put(arm, "arm-rampart"); put(hand, "rail-light"); }
  }
  const shoulderBase = { rpg: "sh-rpg", missiles: "sh-missiles", mortar: "sh-mortar", linemortar: "sh-linemortar" } as Record<string, string>;
  if (shoulderBase[p.k1]) put("shoulderL", shoulderBase[p.k1]);
  if (shoulderBase[p.k2]) put("shoulderR", shoulderBase[p.k2]);
  if (shoulderBase[p.k3]) put("back", shoulderBase[p.k3]);
  else if (p.k3 === "none") lo.back = null;
  return lo;
}
