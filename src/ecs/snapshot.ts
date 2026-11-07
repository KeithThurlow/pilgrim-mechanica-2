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

/**
 * A block of a world's entity indices (a swarm's, src/ecs/swarmBlock.ts) as one buffer per component (stage 7a,
 * docs/proposal-stage7.md): the component's fields back to back in schema order, each `n` values from `base`, each field
 * starting on an 8-byte boundary. The one format every swarm crosses the worker in (and, later, the network).
 */
export interface BlockSnapshot {
  n: number;
  /** By component name: its fields' values for the block's first n indices. */
  comps: Record<string, ArrayBuffer>;
}

const align8 = (b: number) => (b + 7) & ~7;

/** Where each field of a component sits in its block buffer, and the buffer's size, for n entities. */
function layout(comp: Component, n: number): { fields: [string, number][]; bytes: number } {
  const fields: [string, number][] = [];
  let off = 0;
  for (const k in comp.schema) {
    const size = BYTES[comp.schema[k]];
    fields.push([k, off]);
    off = align8(off + size * n);
  }
  return { fields, bytes: off };
}

const BYTES = { f32: 4, f64: 8, i32: 4, u32: 4, u16: 2, u8: 1 } as const;

type Col = { subarray(a: number, b: number): Col; set(a: ArrayLike<number>, o?: number): void; length: number; constructor: unknown };

/** Entity indices base..base+n of these components, one buffer each. */
export function packBlock(world: World, base: number, n: number, comps: readonly Component[]): BlockSnapshot {
  const out: BlockSnapshot = { n, comps: {} };
  for (const comp of comps) {
    const { fields, bytes } = layout(comp, n), buf = new ArrayBuffer(bytes);
    const cols = world.columns(comp) as unknown as Record<string, Col>;
    for (const [k, off] of fields) {
      const col = cols[k], C = col.constructor as new (b: ArrayBuffer, o: number, n: number) => Col;
      new C(buf, off, n).set(col.subarray(base, base + n) as unknown as ArrayLike<number>);
    }
    out.comps[comp.name] = buf;
  }
  return out;
}

/** A block snapshot into entity indices base..base+s.n of another world (its components found by name in `comps`). */
export function applyBlock(world: World, base: number, s: BlockSnapshot, comps: readonly Component[]) {
  for (const comp of comps) {
    const buf = s.comps[comp.name];
    if (!buf) continue;
    const { fields } = layout(comp, s.n), cols = world.columns(comp) as unknown as Record<string, Col>;
    for (const [k, off] of fields) {
      const col = cols[k], C = col.constructor as new (b: ArrayBuffer, o: number, n: number) => Col;
      col.set(new C(buf, off, s.n) as unknown as ArrayLike<number>, base);
    }
  }
}

/** The buffers to transfer with postMessage. */
export const blockBuffers = (s: BlockSnapshot): ArrayBuffer[] => Object.values(s.comps);
