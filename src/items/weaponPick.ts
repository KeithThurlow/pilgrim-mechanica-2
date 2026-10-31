// A quick weapon pick (pure): which weapon on each mouse button and shoulder key, turned into a loadout through the
// fit rules, so the mech is what the bay would build. The weapons lab's picker and the convoy lab's kit both use it.
// The mounts (src/items/loadout.ts): a side's shoulder slot (key 1 or 2) takes its pick whatever its gun is (Keith
// 2026-10-30: shoulders no longer need an arm, so a hull minigun keeps its place under a shoulder pick). The "Light"
// picks are an arm with that gun in its hand. Key 3 is the pack mount: the power pack, or a launcher in its place.
import { defaultLoadout, fit, MOUNTS, type Loadout, type SlotId } from "./loadout";
import { makeItem, protocolItem } from "./generate";
import { PROTOCOL_BY_ID, protocolFits } from "./protocols";

export const SIDE = { minigun: "Minigun", rail: "Rail cannon", lightmg: "Light minigun (arm)", lightrail: "Light rail (arm)", autocannon: "Autocannon", rpg: "Rocket launcher", rocketpod: "Rocket pod (arm)" } as const;
export const SHOULDER = { none: "—", rpg: "Rocket", missiles: "Missile pod", mortar: "Big mortar", linemortar: "Line mortar", beltfeed: "Belt feed (overdrive)", incendiary: "Incendiary feed", capacitor: "Capacitor bank" } as const;
export const BACK = { pack: "Power pack", none: "—", rpg: "Rocket", missiles: "Missile pod", mortar: "Big mortar", linemortar: "Line mortar" } as const;
export type SidePick = keyof typeof SIDE;
export type ShoulderPick = keyof typeof SHOULDER;
export type BackPick = keyof typeof BACK;
/** `protos`: Protocol ids (?proto=splitter,overclock) socketed into every picked weapon they fit, whatever its sockets
 *  (Keith 2026-10-31: try the priced Protocols in the labs without rolling items). Never saved with the pick. */
export interface Pick { left: SidePick; right: SidePick; k1: ShoulderPick; k2: ShoulderPick; k3: BackPick; protos?: string[] }
/** Each pick's row: its key, its control, its options. */
export const ROWS = [["left", "LMB", SIDE], ["right", "RMB", SIDE], ["k1", "Key 1", SHOULDER], ["k2", "Key 2", SHOULDER], ["k3", "Key 3", BACK]] as const;

/** Old picks still read (saved picks, URL flags): k3 "drums" was the back mount's drums, now the pack (drums sit on
 *  the waist). */
const OLD: Record<string, string> = { drums: "pack" };

/** Overrides from URL flags (?left=, ?right=, ?k1=, ?k2=, ?k3=); true if any was given. */
export function pickFromParams(pick: Pick, params: URLSearchParams): boolean {
  let any = false;
  // ?barrage (Keith 2026-10-31: lots of rockets at night): rockets everywhere, the single flags below still override.
  const barrage = params.get("barrage");
  if (barrage !== null) { Object.assign(pick, barragePick(barrage === "arms" ? "arms" : "hull")); any = true; }
  for (const [row, , opts] of ROWS) {
    let q = params.get(row);
    if (q && OLD[q]) q = OLD[q];
    if (q && q in opts) { (pick as unknown as Record<string, string>)[row] = q; any = true; }
  }
  // ?proto= entries without a colon are Protocol ids (the ones with one are raw round behaviour, src/game/combatLab.ts).
  const ids = (params.get("proto") ?? "").split(",").filter((x) => x && !x.includes(":") && PROTOCOL_BY_ID[x]);
  if (ids.length) pick.protos = ids;
  return any;
}

/**
 * The rocket barrage (Keith 2026-10-31): a rocket launcher on each hull mount ("hull") or an arm holding a rocket pod
 * on each ("arms"), the shoulder rocket on key 1, missile pods on key 2 and on the back (key 3, in place of the pack).
 * Add ?proto=splitter to split every rocket.
 */
export function barragePick(mode: "hull" | "arms"): Pick {
  const side: SidePick = mode === "arms" ? "rocketpod" : "rpg";
  return { left: side, right: side, k1: "rpg", k2: "missiles", k3: "missiles" };
}

/** Fix up a saved pick from before the mounts. */
export function cleanPick(pick: Pick): Pick {
  const p = pick as unknown as Record<string, string>;
  for (const [row, , opts] of ROWS) { if (OLD[p[row]]) p[row] = OLD[p[row]]; if (!(p[row] in opts)) p[row] = Object.keys(opts)[0]; }
  return pick;
}

/** Set one row. Shoulder picks are independent of the gun picks since shoulders no longer need an arm (2026-10-30). */
export function choose(pick: Pick, row: keyof Pick, id: string): Pick {
  (pick as unknown as Record<string, string>)[row] = id;
  return pick;
}

const HULL_BASE: Partial<Record<SidePick, string>> = { minigun: "mg-medium", rail: "rail-medium", autocannon: "ac-medium", rpg: "rpg-medium" };
const HELD_BASE: Record<SidePick, string> = { minigun: "mg-light", lightmg: "mg-light", rail: "rail-light", lightrail: "rail-light", autocannon: "mg-light", rpg: "mg-light", rocketpod: "rpg-light" };
const SHOULDER_BASE: Record<string, string> = { rpg: "sh-rpg", missiles: "sh-missiles", mortar: "sh-mortar", linemortar: "sh-linemortar", beltfeed: "sh-beltfeed", incendiary: "sh-incendiary", capacitor: "sh-capacitor" };

export function loadoutFor(p: Pick): Loadout {
  const lo = defaultLoadout();
  const put = (slot: SlotId, base: string) => {
    const it = makeItem(base, "common", `range-${slot}-${base}`);
    for (const id of p.protos ?? []) if (protocolFits(PROTOCOL_BY_ID[id], it.tags)) it.socketed.push(protocolItem(PROTOCOL_BY_ID[id], 1));
    fit(lo, slot, it);
  };
  for (const [side, s, key] of [["left", "L", p.k1], ["right", "R", p.k2]] as const) {
    const w = p[side], m = MOUNTS[s], shoulder = SHOULDER_BASE[key];
    if (HULL_BASE[w]) put(m.mount, HULL_BASE[w]!);
    else { put(m.mount, "arm-rampart"); put(m.held, HELD_BASE[w]); }
    // The default mech's own shoulder gear is replaced by the pick (none: bare).
    lo[m.shoulder] = null;
    if (shoulder) put(m.shoulder, shoulder);
  }
  if (SHOULDER_BASE[p.k3]) put("pack", SHOULDER_BASE[p.k3]);
  else if (p.k3 === "none") lo.pack = null;
  return lo;
}
