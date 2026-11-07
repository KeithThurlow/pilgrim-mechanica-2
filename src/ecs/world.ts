// The ECS core (docs/architecture-review.md §4.1, stage 2; Keith 2026-11-07: "a strong entity component system").
// Small and ours on purpose: columns are exactly what a snapshot or the network sends (typed arrays), and anything here
// can change in an afternoon (rule 1). Pure: no Three.js, no DOM, runs in a worker, a lab or Node.
//
// - Entities: a 32-bit id, 20 bits of index and 12 of generation. A destroyed entity's index is reused with the next
//   generation, so a kept id goes stale instead of naming the new thing. Ids are handed out by the host (rule 12).
// - Components: `defineComponent(name, { field: "f32" | "f64" | "i32" | "u32" | "u16" | "u8" }, opts)` describes SoA
//   columns, one typed array per field, indexed by entity index, grown by doubling. A definition holds no data: each
//   world keeps its own columns (`world.columns(C)`), so a host world and a view world can share one thread. A component says how it is shared:
//   "host" (sent to peers), "local" (this machine only: prediction, input) or "cosmetic" (each side makes its own).
//   Heavy sims that aren't flat (a walker's legs, a car, a ragdoll) go in an object component (`defineObjects`): an
//   array of objects by entity index, stepped by their kind's system; the rest of the game still sees flat components.
// - Queries: `world.query(A, B)` keeps a dense list of the entities that have all of them, updated as components are
//   added and removed (a sparse set: add, remove and membership are O(1); iteration is over a packed array).
// - Systems: `{ name, phase, every?, run(world, dt) }`, run by `world.step(dt)` in phase order (PHASES), then in the
//   order added; `every: n` runs one tick in n (rate groups, review §4.6), on the clock's tick count.
// - Events: plain data, `world.emit(type, data)`; the tick's events are kept until the next step starts (FX, sound and
//   the network read them after the tick).
// - Resources: world singletons by key (the ground, the register, config, RNG streams).
// - Fixed capacity and reserved blocks (stage 4.3): `new World({ capacity })` never grows, so its columns are never
//   replaced and a pool (the robot swarm) can keep `subarray` views of its block of them (`reserve(n)`: n contiguous
//   entity indices that `create` never hands out; `createAt(index)` makes the entity in one, `destroy` gives the index
//   back to its block with the next generation). A world without a capacity grows by doubling and can't reserve.
// Ownership: the world is host state when it is the host's; a view world on a peer holds copies.

export type Entity = number;
export const INDEX_BITS = 20;
export const MAX_ENTITIES = 1 << INDEX_BITS;
const INDEX_MASK = MAX_ENTITIES - 1;
const GEN_MASK = (1 << (32 - INDEX_BITS)) - 1;
export const entityIndex = (e: Entity) => e & INDEX_MASK;
export const entityGen = (e: Entity) => (e >>> INDEX_BITS) & GEN_MASK;
const makeId = (index: number, gen: number) => ((gen << INDEX_BITS) | index) >>> 0;

export type FieldType = "f32" | "f64" | "i32" | "u32" | "u16" | "u8";
export type Replicate = "host" | "local" | "cosmetic";
type Ctor = Float32ArrayConstructor | Float64ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor;
const CTORS: Record<FieldType, Ctor> = { f32: Float32Array, f64: Float64Array, i32: Int32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array };
type Column = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

export type Schema = Record<string, FieldType>;
export type Columns<S extends Schema> = { [K in keyof S]: S[K] extends "f32" ? Float32Array : S[K] extends "f64" ? Float64Array : S[K] extends "i32" ? Int32Array : S[K] extends "u32" ? Uint32Array : S[K] extends "u16" ? Uint16Array : Uint8Array };

/** A flat component's definition: its fields and how it is shared. Its data lives in each world (`world.columns`). */
export interface Component<S extends Schema = Schema> {
  readonly name: string;
  readonly schema: S;
  readonly replicate: Replicate;
  /** Default values for a new entity's fields (else 0). */
  readonly defaults: Partial<Record<keyof S, number>>;
}

/** An object component's definition: one object (a heavy sim) per entity index, in each world (`world.objects`). */
export interface ObjectComponent<T> {
  readonly name: string;
  readonly replicate: Replicate;
  /** Type marker only. */
  readonly _t?: T;
}

export type AnyComponent = Component | ObjectComponent<unknown>;
const isFlat = (c: AnyComponent): c is Component => "schema" in c;

export function defineComponent<S extends Schema>(name: string, schema: S, opts: { replicate?: Replicate; defaults?: Partial<Record<keyof S, number>> } = {}): Component<S> {
  return { name, schema, replicate: opts.replicate ?? "host", defaults: opts.defaults ?? {} };
}

export function defineObjects<T>(name: string, opts: { replicate?: Replicate } = {}): ObjectComponent<T> {
  return { name, replicate: opts.replicate ?? "local" };
}

/** The order systems run in within a tick (review §4.1). */
export const PHASES = ["input", "ai", "move", "contact", "shots", "damage", "status", "death", "spawn", "late"] as const;
export type Phase = (typeof PHASES)[number];

export interface System {
  readonly name: string;
  readonly phase: Phase;
  /** Run one tick in n (rate groups); 1 or unset: every tick. */
  readonly every?: number;
  /** Which tick of the n it runs on (spreads groups over ticks). */
  readonly offset?: number;
  run(world: World, dt: number): void;
}

export interface WorldEvent { type: string; tick: number; data: unknown }

/** A dense list of the entities with all of a set of components (a sparse set over entity indices). */
export class Query {
  /** The entities (ids), packed; iterate 0..count. Don't add or remove components while iterating forwards: iterate
   *  backwards, or collect first. */
  ids: Uint32Array = new Uint32Array(64);
  count = 0;
  private where: Int32Array = new Int32Array(64).fill(-1);
  constructor(readonly words: Uint32Array) {}

  has(index: number): boolean { return index < this.where.length && this.where[index] >= 0; }

  add(e: Entity) {
    const i = entityIndex(e);
    if (i >= this.where.length) { const w = new Int32Array(Math.max(i + 1, this.where.length * 2)).fill(-1); w.set(this.where); this.where = w; }
    if (this.where[i] >= 0) return;
    if (this.count === this.ids.length) { const a = new Uint32Array(this.ids.length * 2); a.set(this.ids); this.ids = a; }
    this.where[i] = this.count;
    this.ids[this.count++] = e;
  }

  remove(e: Entity) {
    const i = entityIndex(e);
    if (i >= this.where.length) return;
    const at = this.where[i];
    if (at < 0) return;
    const last = this.ids[--this.count];
    this.ids[at] = last;
    this.where[entityIndex(last)] = at;
    this.where[i] = -1;
  }

  /** The entities as a plain array (for checks and tools; allocates). */
  list(): Entity[] { return Array.from(this.ids.subarray(0, this.count)); }
}

export class World {
  /** The tick count, set by whoever steps the world (the clock's tick); systems' rate groups read it. */
  tick = 0;
  /** Entities alive now. */
  alive = 0;
  readonly components: AnyComponent[] = [];
  private ids = new Map<AnyComponent, number>();
  private cols: (Record<string, Column> | null)[] = [];
  private objs: (unknown[] | null)[] = [];
  private gens: Uint16Array;
  private live: Uint8Array;
  private free: number[] = [];
  private next = 0;
  private cap: number;
  /** Fixed capacity: never grows (columns stay put for views). */
  readonly fixed: boolean;
  /** 1 for indices in a reserved block (never on the free list). */
  private held: Uint8Array;
  /** Component membership: `words` u32 words per entity. */
  private words = 1;
  private masks: Uint32Array;
  private queries: Query[] = [];
  private systems: System[] = [];
  private resources = new Map<string, unknown>();
  /** This tick's events (plain data), kept until the next step starts. */
  events: WorldEvent[] = [];

  constructor(opts: { capacity?: number } = {}) {
    this.fixed = opts.capacity !== undefined;
    const cap = (this.cap = Math.min(MAX_ENTITIES, Math.max(1, opts.capacity ?? 1024)));
    this.gens = new Uint16Array(cap); this.live = new Uint8Array(cap); this.held = new Uint8Array(cap);
    this.masks = new Uint32Array(cap);
  }

  /** Reserve n contiguous entity indices for a pool (fixed worlds only); returns the first, or -1 if they don't fit. */
  reserve(n: number): number {
    if (!this.fixed) throw new Error("ecs: reserve needs a fixed-capacity world");
    if (this.next + n > this.cap) return -1;
    const base = this.next;
    this.next += n;
    this.held.fill(1, base, base + n);
    return base;
  }

  /** Make the entity at a reserved index (its current generation). The index must be held and not live. */
  createAt(index: number): Entity {
    if (index >= this.next || !this.held[index]) throw new Error(`ecs: index ${index} isn't reserved`);
    if (this.live[index]) throw new Error(`ecs: index ${index} is live`);
    this.live[index] = 1;
    this.alive++;
    return makeId(index, this.gens[index]);
  }

  /** The live entity at an index, or -1. */
  at(index: number): Entity | -1 { return index < this.next && this.live[index] ? makeId(index, this.gens[index]) : -1; }

  /** Give e these components without touching their fields (a pool that wrote them already). */
  attach(e: Entity, ...comps: AnyComponent[]): Entity { for (const c of comps) this.mark(e, c); return e; }

  /** Add a component type to this world (once, before entities use it). */
  register<C extends AnyComponent>(comp: C): number {
    const known = this.ids.get(comp);
    if (known !== undefined) return known;
    const id = this.components.length;
    this.ids.set(comp, id);
    this.components.push(comp);
    const words = Math.ceil(this.components.length / 32);
    if (words > this.words) {
      const m = new Uint32Array(this.cap * words);
      for (let i = 0; i < this.cap; i++) for (let w = 0; w < this.words; w++) m[i * words + w] = this.masks[i * this.words + w];
      this.masks = m; this.words = words;
      for (const q of this.queries) { const qw = new Uint32Array(words); qw.set(q.words); (q as { words: Uint32Array }).words = qw; }
    }
    if (isFlat(comp)) {
      const c: Record<string, Column> = {};
      for (const k in comp.schema) c[k] = new CTORS[comp.schema[k]](this.cap);
      this.cols.push(c); this.objs.push(null);
    } else { this.cols.push(null); this.objs.push([]); }
    return id;
  }

  /** A flat component's columns in this world (index them with entityIndex(e)). In a growing world they are replaced
   *  when it grows, so fetch them each tick rather than keeping them; a fixed world's stay put (views are safe). */
  columns<S extends Schema>(comp: Component<S>): Columns<S> {
    return this.cols[this.register(comp)] as unknown as Columns<S>;
  }

  /** An object component's items in this world, by entity index. */
  objects<T>(comp: ObjectComponent<T>): (T | undefined)[] {
    return this.objs[this.register(comp)] as (T | undefined)[];
  }

  create(): Entity {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else {
      if (this.next >= MAX_ENTITIES) throw new Error("ecs: out of entity indices");
      i = this.next++;
      if (i >= this.cap && this.fixed) { this.next--; throw new Error("ecs: world full"); }
      if (i >= this.cap) this.grow(Math.min(MAX_ENTITIES, this.cap * 2));
    }
    this.live[i] = 1;
    this.alive++;
    return makeId(i, this.gens[i]);
  }

  /** Is this id still the entity it named (not destroyed, its index not reused)? */
  exists(e: Entity): boolean {
    const i = entityIndex(e);
    return i < this.next && this.live[i] === 1 && this.gens[i] === entityGen(e);
  }

  destroy(e: Entity) {
    if (!this.exists(e)) return;
    const i = entityIndex(e);
    for (const q of this.queries) q.remove(e);
    for (let w = 0; w < this.words; w++) this.masks[i * this.words + w] = 0;
    for (const o of this.objs) if (o) o[i] = undefined;
    this.live[i] = 0;
    this.gens[i] = (this.gens[i] + 1) & GEN_MASK;
    if (!this.held[i]) this.free.push(i);
    this.alive--;
  }

  has(e: Entity, comp: AnyComponent): boolean {
    const id = this.ids.get(comp);
    if (id === undefined || !this.exists(e)) return false;
    return (this.masks[entityIndex(e) * this.words + (id >> 5)] & (1 << (id & 31))) !== 0;
  }

  /** Give e a flat component, its fields set to the defaults and then to `init`. */
  add<S extends Schema>(e: Entity, comp: Component<S>, init?: Partial<Record<keyof S, number>>): Entity {
    this.mark(e, comp);
    const i = entityIndex(e), c = this.columns(comp) as unknown as Record<string, Column>;
    for (const k in comp.schema) c[k][i] = init?.[k] ?? comp.defaults[k] ?? 0;
    return e;
  }

  /** Give e an object component holding `item`. */
  addObject<T>(e: Entity, comp: ObjectComponent<T>, item: T): Entity {
    this.mark(e, comp);
    this.objects(comp)[entityIndex(e)] = item;
    return e;
  }

  remove(e: Entity, comp: AnyComponent) {
    if (!this.has(e, comp)) return;
    const i = entityIndex(e), id = this.ids.get(comp)!;
    this.masks[i * this.words + (id >> 5)] &= ~(1 << (id & 31));
    const o = this.objs[id];
    if (o) o[i] = undefined;
    for (const q of this.queries) if (q.has(i) && (q.words[id >> 5] & (1 << (id & 31)))) q.remove(e);
  }

  /** The entities with all these components, kept up to date. The same set of components gives the same Query. */
  query(...comps: AnyComponent[]): Query {
    const idx = comps.map((c) => this.register(c));
    const want = new Uint32Array(this.words);
    for (const id of idx) want[id >> 5] |= 1 << (id & 31);
    for (const q of this.queries) if (q.words.length === want.length && q.words.every((v, k) => v === want[k])) return q;
    const q = new Query(want);
    for (let i = 0; i < this.next; i++) if (this.live[i] && this.matches(i, want)) q.add(makeId(i, this.gens[i]));
    this.queries.push(q);
    return q;
  }

  addSystem(s: System): System {
    if (!PHASES.includes(s.phase)) throw new Error(`ecs: unknown phase ${s.phase}`);
    this.systems.push(s);
    this.systems.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
    return s;
  }

  /** One tick: clears last tick's events, runs the systems due this tick in phase order, counts the tick. */
  step(dt: number) {
    this.events = [];
    for (const s of this.systems) {
      const n = s.every ?? 1;
      if (n > 1 && (this.tick + (s.offset ?? 0)) % n !== 0) continue;
      s.run(this, n > 1 ? dt * n : dt);
    }
    this.tick++;
  }

  emit(type: string, data: unknown) { this.events.push({ type, tick: this.tick, data }); }

  setResource<T>(key: string, value: T): T { this.resources.set(key, value); return value; }
  resource<T>(key: string): T {
    if (!this.resources.has(key)) throw new Error(`ecs: no resource ${key}`);
    return this.resources.get(key) as T;
  }

  /** Entity indices in use so far (columns hold data for 0..high). */
  get high(): number { return this.next; }

  private mark(e: Entity, comp: AnyComponent) {
    if (!this.exists(e)) throw new Error(`ecs: entity ${e} doesn't exist`);
    const id = this.register(comp);
    const i = entityIndex(e), w = id >> 5, bit = 1 << (id & 31);
    if (this.masks[i * this.words + w] & bit) return;
    this.masks[i * this.words + w] |= bit;
    for (const q of this.queries) if ((q.words[w] & bit) && this.matches(i, q.words)) q.add(e);
  }

  private matches(i: number, want: Uint32Array): boolean {
    for (let w = 0; w < this.words; w++) if ((this.masks[i * this.words + w] & want[w]) !== want[w]) return false;
    return true;
  }

  private grow(cap: number) {
    const g = new Uint16Array(cap); g.set(this.gens); this.gens = g;
    const l = new Uint8Array(cap); l.set(this.live); this.live = l;
    const hd = new Uint8Array(cap); hd.set(this.held); this.held = hd;
    const m = new Uint32Array(cap * this.words); m.set(this.masks); this.masks = m;
    this.components.forEach((comp, id) => {
      const c = this.cols[id];
      if (!c || !isFlat(comp)) return;
      for (const k in c) { const a = new CTORS[comp.schema[k]](cap); a.set(c[k] as never); c[k] = a; }
    });
    this.cap = cap;
  }
}
