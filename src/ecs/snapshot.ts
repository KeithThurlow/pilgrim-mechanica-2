// A world's flat components as plain typed arrays (docs/architecture-review.md §4.3): what the host worker sends the
// main thread each tick and, quantised later, what peers get. This first form sends whole columns 0..high of the
// components shared as "host" (or those asked for); dirty-column deltas come with stage 7. Pure.
import type { Component, World } from "./world";

export interface WorldSnapshot {
  tick: number;
  high: number;
  /** The live flag and generation of each entity index, 0..high. */
  live: Uint8Array;
  gens: Uint16Array;
  /** By component name, then field: a copy of the column 0..high. */
  columns: Record<string, Record<string, ArrayBufferView>>;
}

export function packWorld(world: World, comps?: Component[]): WorldSnapshot {
  const w = world as unknown as { live: Uint8Array; gens: Uint16Array };
  const columns: WorldSnapshot["columns"] = {};
  for (const comp of comps ?? (world.components.filter((c) => "schema" in c && c.replicate === "host") as Component[])) {
    const out: Record<string, ArrayBufferView> = {};
    const c = world.columns(comp) as unknown as Record<string, Float32Array>;
    for (const k in comp.schema) out[k] = c[k].slice(0, world.high);
    columns[comp.name] = out;
  }
  return { tick: world.tick, high: world.high, live: w.live.slice(0, world.high), gens: w.gens.slice(0, world.high), columns };
}

/** The buffers to transfer with postMessage. */
export function snapshotBuffers(s: WorldSnapshot): ArrayBuffer[] {
  const out: ArrayBuffer[] = [s.live.buffer as ArrayBuffer, s.gens.buffer as ArrayBuffer];
  for (const c of Object.values(s.columns)) for (const a of Object.values(c)) out.push(a.buffer as ArrayBuffer);
  return out;
}
