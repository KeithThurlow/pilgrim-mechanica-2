// The bay's state (a loadout, the stash, the cargo, the next loot seed) and its save format (pure, so
// tools/loadout-check.ts can test the migration). The bay screen (src/ui/bay.ts) and the labs save it in localStorage.
// Ownership: the player's own gear (later, with co-op, the host checks fits; items carry stable ids).
import { BASE_BY_ID, RENAMED_BASES } from "./bases";
import { PROTOCOL_BY_ID } from "./protocols";
import type { Item } from "./item";
import { seekersFor } from "./generate";
import { SLOTS, V1_SLOTS, defaultLoadout, emptyLoadout, settle, type Loadout } from "./loadout";
import type { Bag } from "./cargo";

export interface BayState {
  loadout: Loadout;
  stash: Bag;
  cargo: Bag;
  /** Next loot seed. */
  seed: number;
  /** What a save migration did (shown once at the top of the bay). */
  notes?: string[];
}

export function itemName(it: Item) {
  if (it.kind === "protocol") return PROTOCOL_BY_ID[it.base]?.name ?? it.base;
  return BASE_BY_ID[it.base]?.name ?? it.base;
}

export const SAVE_VERSION = 2;

/** The bay as JSON-safe data (items are plain data). */
export const bayToJson = (st: BayState) => ({ v: SAVE_VERSION, loadout: st.loadout, stash: st.stash.items, cargo: st.cargo.items, seed: st.seed });

/**
 * A saved bay from its JSON, or null if it isn't one. Version 1 (before the mounts, Keith 2026-10-26) is migrated,
 * not dropped: arm mounts become hull mounts and hands held weapons; the back mount's drums go to the left waist (the
 * default drums to both waists, as the model always had a half drum per gun); a back shoulder weapon goes on the pack
 * mount if no pack was fitted; renamed bases are renamed; anything the new rules won't take (a shoulder weapon on a
 * side without an arm, a back weapon with a pack fitted) goes to the stash. `notes` say what moved.
 */
export function readBay(raw: unknown): BayState | null {
  const r = raw as { v?: number; loadout?: Record<string, Item | null>; stash?: Item[]; cargo?: Item[]; seed?: number } | null;
  if (!r || typeof r !== "object" || (r.v !== 1 && r.v !== SAVE_VERSION)) return null;
  const notes: string[] = [];
  let dropped = 0;
  // Bring an item up to today's base table: renamed bases, kind and size from the base (both changed for drums).
  const fix = (i: Item | null | undefined): Item | null => {
    if (!i || typeof i !== "object" || !Array.isArray(i.socketed)) return null;
    if (i.kind === "protocol") { if (PROTOCOL_BY_ID[i.base]) return i; dropped++; return null; }
    const renamed = RENAMED_BASES[i.base];
    const b = BASE_BY_ID[renamed ?? i.base];
    if (!b) { dropped++; return null; }
    if (renamed) {
      i.base = b.id; i.tags = [...b.tags]; i.weight = b.weight;
      if (i.id.startsWith("default-back-")) i.id = i.id.replace("default-back-", "default-waist-");
    }
    i.kind = b.kind; i.size = b.size;
    if (b.seekers && !i.seekers) i.seekers = seekersFor(b, i.rarity);
    // Saved before item levels (2026-10-28): level 1.
    if (i.level === undefined) i.level = 1;
    i.socketed = i.socketed.map(fix).filter((x): x is Item => !!x);
    return i;
  };
  const stash: Bag = { items: (r.stash ?? []).map(fix).filter((x): x is Item => !!x), capacity: Infinity };
  const cargo: Bag = { items: (r.cargo ?? []).map(fix).filter((x): x is Item => !!x), capacity: Infinity };
  const lo = emptyLoadout();
  const saved = r.loadout ?? {};
  if (r.v === 1) {
    notes.push("Your saved bay was moved onto the new mounts (Keith 2026-10-26): a hull mount takes a hull weapon or an arm; an arm holds a weapon and carries the shoulder weapon; drums sit on the waist.");
    for (const [old, now] of Object.entries(V1_SLOTS)) lo[now] = fix(saved[old]);
    const back = fix(saved.back);
    if (back?.kind === "waist") {
      lo.waistL = back;
      // The default drums fed both guns: the right waist gets its own default drum too.
      if (back.id === "default-waist-drums") { back.id = "default-waist-drums-L"; lo.waistR = defaultLoadout().waistR; }
      else notes.push(`${itemName(back)} moved from the back mount to the left waist (a drum now feeds its own side's gun).`);
    } else if (back) {
      if (!lo.pack) lo.pack = back;
      else { stash.items.push(back); notes.push(`${itemName(back)} was on the back mount; the pack mount takes a pack or a back weapon, so it went to the stash.`); }
    }
    // The old default mech had no sensor; today's carries the Rampart visor head.
    lo.sensor = defaultLoadout().sensor;
  } else for (const s of SLOTS) lo[s] = fix(saved[s]);
  const def = defaultLoadout();
  if (!lo.legs) lo.legs = def.legs;
  if (!lo.hull) lo.hull = def.hull;
  // Anything that no longer fits goes to the stash, never lost.
  const off = settle(lo);
  stash.items.push(...off);
  if (off.length) notes.push(`To the stash (the mount rules don't take them where they were): ${off.map(itemName).join(", ")}.`);
  if (dropped) notes.push(`${dropped} item${dropped > 1 ? "s" : ""} of a kind that no longer exists ${dropped > 1 ? "were" : "was"} dropped.`);
  return { loadout: lo, stash, cargo, seed: Number(r.seed) || 1, notes: notes.length ? notes : undefined };
}
