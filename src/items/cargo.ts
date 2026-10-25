// Cargo and stash (Keith 2026-10-25: lists for now while scaffolding; a grid inventory is the long-term goal).
// Cargo rides on the mech with a weight capacity (the legs' carry plus the hull's racks) and is at risk: a destroyed
// mech loses all of it (Keith 2026-10-25). The stash lives on the convoy and has no limit.
import { itemWeight, type Item } from "./item";

export interface Bag {
  items: Item[];
  /** Tonnes; Infinity for the stash. */
  capacity: number;
}

export const newBag = (capacity = Infinity): Bag => ({ items: [], capacity });

export const bagWeight = (b: Bag) => b.items.reduce((w, i) => w + itemWeight(i), 0);

export const hasRoom = (b: Bag, item: Item) => bagWeight(b) + itemWeight(item) <= b.capacity + 1e-9;

/** Put an item in if it fits the weight; returns whether it went in. */
export function addTo(b: Bag, item: Item): boolean {
  if (!hasRoom(b, item)) return false;
  b.items.push(item);
  return true;
}

/** Take an item out by id (null if it isn't there). */
export function takeFrom(b: Bag, id: string): Item | null {
  const i = b.items.findIndex((x) => x.id === id);
  return i < 0 ? null : b.items.splice(i, 1)[0];
}

/** Move an item from one bag to another if the other has room; returns whether it moved. */
export function moveItem(from: Bag, to: Bag, id: string): boolean {
  const it = from.items.find((x) => x.id === id);
  if (!it || !hasRoom(to, it)) return false;
  takeFrom(from, id);
  to.items.push(it);
  return true;
}

/**
 * The mech was destroyed: the cargo is gone (returned, for a wreck or a report). What's fitted stays (it's not in
 * the cargo). `keep` is the hook for small safety pockets later (Keith 2026-10-25: maybe; not built): items it
 * returns true for stay.
 */
export function loseCargo(cargo: Bag, keep: (item: Item) => boolean = () => false): Item[] {
  const lost = cargo.items.filter((i) => !keep(i));
  cargo.items = cargo.items.filter(keep);
  return lost;
}
