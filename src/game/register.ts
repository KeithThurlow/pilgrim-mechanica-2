// The register (docs/proposal-register.md, Keith 2026-10-26): one place that knows every thing that can be hit, seen,
// salvaged or woken, and one uniform grid over it, so "what's near here / what does this shot hit" has one fast answer.
// Pure (no Three.js): structure of arrays, one entry per live thing, rebuilt from its owners every tick. The owners'
// own arrays stay the source of truth; the register copies position, size and a few tags in and indexes them. It never
// runs behaviour.
//
// - Owners (a swarm, the war band, the range's dummies) publish their live things each rebuild with put(). Each owner
//   gets a number by the order it was added; the host adds them in a fixed order.
// - Ids (rule 12): owner number * 2^32 + the owner's serial for that thing. Owners hand out serials when a thing is
//   made and never reuse one, so an id is stable while its thing lives and a dead thing's slot reused gets a new id.
// - The grid: cells of `cell` m hashed into BUCKETS buckets, filled by counting sort every rebuild. Things wider than
//   half a cell (vehicles, big walkers, by their reach: max of body radius and footprint) go on a short big list every
//   query also tests, so a grid query only needs to look half a cell past its own shape.
// - Queries hand back entry numbers (indices into the arrays below), valid until the next rebuild; keep ids, not
//   entries, across ticks. No objects are made per query.
//
// Ownership: the register is host state (it mirrors host-owned enemies; the player's own mech publishes too). It is
// rebuilt, never sent: every peer can build its own from what it has.

/** What a thing is (one per entry). Filter by kinds with a bit mask: kindBit(KIND.Unit) | kindBit(KIND.Mech). */
export const KIND = { Unit: 0, Vehicle: 1, Mech: 2, Prop: 3, Salvage: 4, Poi: 5 } as const;
export const kindBit = (k: number) => 1 << k;

/** Tags on an entry (bits). Light: rounds carry on through it. Asleep: a camp's sleeping robots. */
export const FLAG = { Hittable: 1, Detectable: 2, Salvageable: 4, Light: 8, Asleep: 16 } as const;

/** What a query keeps: kinds (bit mask, all if unset), flags it must all have, flags it must have none of, a team. */
export interface Filter { kinds?: number; all?: number; none?: number; team?: number; notTeam?: number }

/** Anything that puts things in the register. publish() calls reg.put() once per live thing. */
export interface Owner {
  readonly name: string;
  publish(reg: Register): void;
}

/** Results of a line query: entries crossed, in order along the line, with where each footprint is entered and left. */
export class RayHits {
  readonly e: number[] = [];
  /** Along the line (m from its start, clipped to 0..length): where the footprint starts and ends. Chord = t1 - t0. */
  readonly t0: number[] = [];
  readonly t1: number[] = [];
  n = 0;
  chord(k: number) { return this.t1[k] - this.t0[k]; }
}

const BUCKETS = 4096;
const TWO32 = 4294967296;
// Query modes for the cell visitor.
const M_NEAR = 0, M_RAY = 1, M_CONE = 2;

export class Register {
  // ---- Per entry (0..count-1) ----
  /** Centre of mass (y up), what aims and locks take. */
  x: Float32Array; y: Float32Array; z: Float32Array;
  /** Body radius (m, flat): what rounds, splash and the line of fire measure to. */
  r: Float32Array;
  /** Footprint (m, flat): a tall walker's planted feet; 0 when it's just the body. A cursor in here is on it. */
  foot: Float32Array;
  /** Ground velocity (m/s), for leads. */
  vx: Float32Array; vz: Float32Array;
  kind: Uint8Array; team: Uint8Array; flags: Uint8Array;
  /** Which owner (its number, 1..) and that owner's own index for the thing (a swarm slot, a list position). */
  owner: Uint8Array; index: Int32Array;
  /** Stable id: owner number * 2^32 + the owner's serial. */
  id: Float64Array;
  count = 0;
  /** Bumped every rebuild: anything cached from the register is stale when this moved on. */
  stamp = 0;
  /** Largest body radius this rebuild (callers size margins from it). */
  maxR = 0;
  readonly owners: Owner[] = [];
  /** Timing for the stress lab: when on, rebuildMs is the last rebuild and queryMs / queries add up until read. */
  timing = false;
  rebuildMs = 0;
  queryMs = 0;
  queries = 0;

  // ---- The grid ----
  readonly inv: number;
  private half: number;
  private cellX: Int32Array; private cellZ: Int32Array;
  private start = new Int32Array(BUCKETS + 1);
  private fill = new Int32Array(BUCKETS);
  private sorted: Int32Array;
  private bucketOf: Int32Array;
  private big: number[] = [];
  private cap: number;
  private publishing = 0;
  private byId: Map<number, number> | null = null;

  constructor(readonly cell = 4, max = 4096) {
    this.inv = 1 / cell;
    this.half = cell / 2;
    this.cap = max;
    this.x = new Float32Array(max); this.y = new Float32Array(max); this.z = new Float32Array(max);
    this.r = new Float32Array(max); this.foot = new Float32Array(max);
    this.vx = new Float32Array(max); this.vz = new Float32Array(max);
    this.kind = new Uint8Array(max); this.team = new Uint8Array(max); this.flags = new Uint8Array(max);
    this.owner = new Uint8Array(max); this.index = new Int32Array(max); this.id = new Float64Array(max);
    this.cellX = new Int32Array(max); this.cellZ = new Int32Array(max);
    this.sorted = new Int32Array(max); this.bucketOf = new Int32Array(max);
  }

  /** Add an owner; returns its number (1, 2, ...), the high part of its things' ids. */
  add(o: Owner): number {
    if (!this.owners.includes(o)) this.owners.push(o);
    return this.owners.indexOf(o) + 1;
  }

  remove(o: Owner) {
    // Keep the numbers of the others: leave a hole that publishes nothing.
    const k = this.owners.indexOf(o);
    if (k >= 0) this.owners[k] = { name: "-", publish() {} };
  }

  /** The id a thing of owner number `owner` with that serial has. */
  static idOf(owner: number, serial: number) { return owner * TWO32 + serial; }
  static ownerOf(id: number) { return Math.floor(id / TWO32); }
  static serialOf(id: number) { return id % TWO32; }

  /** Once per tick: every owner publishes, then the grid is rebuilt. */
  rebuild() {
    const t0 = this.timing ? performance.now() : 0;
    this.count = 0;
    this.stamp++;
    this.byId = null;
    this.maxR = 0;
    for (let k = 0; k < this.owners.length; k++) { this.publishing = k + 1; this.owners[k].publish(this); }
    this.publishing = 0;
    this.index_();
    if (this.timing) this.rebuildMs = performance.now() - t0;
  }

  /**
   * One live thing (called from an owner's publish). index: the owner's own index for it; serial: the owner's serial
   * for it (never reused); kind KIND.*, flags FLAG.*; centre of mass, body radius, footprint (0: none), ground velocity.
   */
  put(index: number, serial: number, kind: number, team: number, flags: number,
    x: number, y: number, z: number, r: number, foot = 0, vx = 0, vz = 0) {
    if (this.count >= this.cap) this.grow();
    const e = this.count++;
    this.x[e] = x; this.y[e] = y; this.z[e] = z; this.r[e] = r; this.foot[e] = foot;
    this.vx[e] = vx; this.vz[e] = vz;
    this.kind[e] = kind; this.team[e] = team; this.flags[e] = flags;
    this.owner[e] = this.publishing; this.index[e] = index;
    this.id[e] = this.publishing * TWO32 + serial;
    if (r > this.maxR) this.maxR = r;
  }

  private grow() {
    const n = this.cap * 2;
    const f32 = (a: Float32Array) => { const b = new Float32Array(n); b.set(a); return b; };
    const u8 = (a: Uint8Array) => { const b = new Uint8Array(n); b.set(a); return b; };
    const i32 = (a: Int32Array) => { const b = new Int32Array(n); b.set(a); return b; };
    this.x = f32(this.x); this.y = f32(this.y); this.z = f32(this.z); this.r = f32(this.r); this.foot = f32(this.foot);
    this.vx = f32(this.vx); this.vz = f32(this.vz);
    this.kind = u8(this.kind); this.team = u8(this.team); this.flags = u8(this.flags); this.owner = u8(this.owner);
    this.index = i32(this.index);
    const id = new Float64Array(n); id.set(this.id); this.id = id;
    this.cellX = new Int32Array(n); this.cellZ = new Int32Array(n);
    this.sorted = new Int32Array(n); this.bucketOf = new Int32Array(n);
    this.cap = n;
  }

  private static bucket(cx: number, cz: number) {
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & (BUCKETS - 1);
  }

  /** Counting sort of the small entries into buckets; the wide ones onto the big list. */
  private index_() {
    const n = this.count, inv = this.inv, half = this.half;
    const start = this.start, fill = this.fill, bucketOf = this.bucketOf;
    start.fill(0);
    this.big.length = 0;
    for (let e = 0; e < n; e++) {
      if (this.r[e] > half || this.foot[e] > half) { this.big.push(e); bucketOf[e] = -1; continue; }
      const cx = Math.floor(this.x[e] * inv), cz = Math.floor(this.z[e] * inv);
      this.cellX[e] = cx; this.cellZ[e] = cz;
      const b = Register.bucket(cx, cz);
      bucketOf[e] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < BUCKETS; b++) start[b + 1] += start[b];
    fill.set(start.subarray(0, BUCKETS));
    for (let e = 0; e < n; e++) { const b = bucketOf[e]; if (b >= 0) this.sorted[fill[b]++] = e; }
  }

  // ---- Lookups ----

  /** The entry holding this id this tick, or -1 (gone: dead, removed, or not published). */
  find(id: number): number {
    if (!this.byId) {
      this.byId = new Map();
      for (let e = 0; e < this.count; e++) this.byId.set(this.id[e], e);
    }
    return this.byId.get(id) ?? -1;
  }

  /** Does entry e pass the filter? */
  passes(e: number, f: Filter): boolean {
    if (f.kinds !== undefined && !((f.kinds >> this.kind[e]) & 1)) return false;
    const fl = this.flags[e];
    if (f.all !== undefined && (fl & f.all) !== f.all) return false;
    if (f.none !== undefined && (fl & f.none) !== 0) return false;
    if (f.team !== undefined && this.team[e] !== f.team) return false;
    if (f.notTeam !== undefined && this.team[e] === f.notTeam) return false;
    return true;
  }

  /** Every entry that passes the filter (the radar, everything of a kind). */
  each(f: Filter, fn: (e: number) => void) {
    for (let e = 0; e < this.count; e++) if (this.passes(e, f)) fn(e);
  }

  // ---- Queries (the query's state lives in these fields while its cells are visited) ----
  private qf: Filter = {};
  private qout: number[] = [];
  private qmode = 0;
  private qx = 0; private qz = 0; private qR = 0; private qFoot = false;
  private qdx = 0; private qdz = 0; private qlen = 0; private qw = 0; private qtan = 0;
  private qhits: RayHits | null = null;

  /**
   * Entries whose body (or, with useFoot, footprint) overlaps the flat disc of radius R round (x, z): centre distance
   * <= R + r. With useFoot only things with a footprint count, measured to it.
   */
  near(x: number, z: number, R: number, f: Filter, out: number[], useFoot = false): number[] {
    const t0 = this.timing ? performance.now() : 0;
    out.length = 0;
    this.qmode = M_NEAR; this.qf = f; this.qout = out; this.qx = x; this.qz = z; this.qR = R; this.qFoot = useFoot;
    const pad = R + this.half, inv = this.inv;
    this.rect(Math.floor((x - pad) * inv), Math.floor((z - pad) * inv), Math.floor((x + pad) * inv), Math.floor((z + pad) * inv));
    for (const e of this.big) this.test(e);
    if (this.timing) { this.queryMs += performance.now() - t0; this.queries++; }
    return out;
  }

  private scratch: number[] = [];
  /** The entry whose centre is nearest (x, z) (flat), within maxR; -1 if none. Searches outward, doubling. */
  nearest(x: number, z: number, maxR: number, f: Filter): number {
    let R = Math.min(8, maxR);
    for (;;) {
      this.near(x, z, R, f, this.scratch);
      let best = -1, bd = Infinity;
      for (const e of this.scratch) {
        const d = Math.hypot(this.x[e] - x, this.z[e] - z);
        if (d < bd || (d === bd && e < best)) { bd = d; best = e; }
      }
      if (best >= 0 && bd <= R) return best;
      if (R >= maxR) return best >= 0 && bd <= maxR ? best : -1;
      R = Math.min(maxR, R * 2);
      if (R === Infinity || (R * this.inv) ** 2 > this.count * 4) {
        // Wider than the grid is worth: a straight scan.
        best = -1; bd = Infinity;
        for (let e = 0; e < this.count; e++) {
          if (!this.passes(e, f)) continue;
          const d = Math.hypot(this.x[e] - x, this.z[e] - z);
          if (d <= maxR && d < bd) { bd = d; best = e; }
        }
        return best;
      }
    }
  }

  /**
   * A flat line from (ox, oz) along (dx, dz) for len m, swept `width` m to each side: every entry whose body circle
   * (radius r + width) it crosses, in order along the line, with where it enters and leaves (t0, t1, clipped to
   * 0..len; the chord through the footprint is t1 - t0). Returns the count (also out.n). For sheet hits and
   * penetration (step 3 of the proposal), a cursor ray's ground shadow, a beam.
   */
  ray(ox: number, oz: number, dx: number, dz: number, len: number, width: number, f: Filter, out: RayHits): number {
    const t0 = this.timing ? performance.now() : 0;
    out.e.length = 0; out.t0.length = 0; out.t1.length = 0; out.n = 0;
    const l = Math.hypot(dx, dz);
    if (l < 1e-9 || !(len > 0)) return 0;
    this.qmode = M_RAY; this.qf = f; this.qhits = out;
    this.qx = ox; this.qz = oz; this.qdx = dx / l; this.qdz = dz / l; this.qlen = len; this.qw = width;
    this.band(width + this.half, 0);
    for (const e of this.big) this.test(e);
    // Insertion sort by entry point (few hits).
    for (let i = 1; i < out.n; i++) {
      const e = out.e[i], a = out.t0[i], b = out.t1[i];
      let j = i - 1;
      while (j >= 0 && (out.t0[j] > a || (out.t0[j] === a && out.e[j] > e))) { out.e[j + 1] = out.e[j]; out.t0[j + 1] = out.t0[j]; out.t1[j + 1] = out.t1[j]; j--; }
      out.e[j + 1] = e; out.t0[j + 1] = a; out.t1[j + 1] = b;
    }
    if (this.timing) { this.queryMs += performance.now() - t0; this.queries++; }
    return out.n;
  }

  /**
   * A widening line of fire from (x, z) along (dx, dz): entries whose centre lies ahead (0 < t <= range along it) and
   * within r + width + t * tan(halfAngle) of the line. In no order.
   */
  cone(x: number, z: number, dx: number, dz: number, range: number, width: number, halfAngle: number, f: Filter, out: number[]): number[] {
    const t0 = this.timing ? performance.now() : 0;
    out.length = 0;
    const l = Math.hypot(dx, dz);
    if (l < 1e-9 || !(range > 0)) return out;
    this.qmode = M_CONE; this.qf = f; this.qout = out;
    this.qx = x; this.qz = z; this.qdx = dx / l; this.qdz = dz / l; this.qlen = range; this.qw = width;
    this.qtan = Math.tan(Math.max(0, halfAngle));
    this.band(width + this.half, this.qtan);
    for (const e of this.big) this.test(e);
    if (this.timing) { this.queryMs += performance.now() - t0; this.queries++; }
    return out;
  }

  /** Visit every cell in a rectangle (cell coordinates, inclusive); a scan of everything when that's cheaper. */
  private rect(cx0: number, cz0: number, cx1: number, cz1: number) {
    const cells = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
    if (cells > this.count) { this.scanSmall(); return; }
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.visit(cx, cz);
  }

  private scanSmall() {
    for (let e = 0; e < this.count; e++) if (this.bucketOf[e] >= 0) this.test(e);
  }

  /**
   * Visit the cells a band covers: the line from (qx, qz) along (qdx, qdz) for qlen, half-thickness H0 + k * t (t
   * along it, plus the round ends). Walked one column (or row) of cells at a time along the major axis, each cell once.
   */
  private band(H0: number, k: number) {
    const ox = this.qx, oz = this.qz, len = this.qlen, inv = this.inv, cell = this.cell;
    const xMajor = Math.abs(this.qdx) >= Math.abs(this.qdz);
    // Swap so "a" is the major axis, "b" the minor.
    const oa = xMajor ? ox : oz, ob = xMajor ? oz : ox, da = xMajor ? this.qdx : this.qdz, db = xMajor ? this.qdz : this.qdx;
    const H = H0 + k * len;
    const a0 = Math.min(oa, oa + da * len) - H, a1 = Math.max(oa, oa + da * len) + H;
    const c0 = Math.floor(a0 * inv), c1 = Math.floor(a1 * inv);
    const b0all = Math.min(ob, ob + db * len) - H, b1all = Math.max(ob, ob + db * len) + H;
    if ((c1 - c0 + 1) * (Math.floor(b1all * inv) - Math.floor(b0all * inv) + 1) > this.count * 2) { this.scanSmall(); return; }
    for (let c = c0; c <= c1; c++) {
      const xa = c * cell, xb = xa + cell;
      // t along the line for which a point within H of it can be in this column.
      let ta = (xa - H - oa) / da, tb = (xb + H - oa) / da;
      if (da < 0) { const s = ta; ta = tb; tb = s; }
      if (!Number.isFinite(ta)) ta = 0;
      if (!Number.isFinite(tb)) tb = len;
      ta = Math.max(0, ta); tb = Math.min(len, tb);
      if (ta > tb) continue;
      const Hc = H0 + k * tb;
      const ba = ob + db * ta, bb = ob + db * tb;
      const r0 = Math.floor((Math.min(ba, bb) - Hc) * inv), r1 = Math.floor((Math.max(ba, bb) + Hc) * inv);
      for (let r = r0; r <= r1; r++) { if (xMajor) this.visit(c, r); else this.visit(r, c); }
    }
  }

  private visit(cx: number, cz: number) {
    const b = Register.bucket(cx, cz), s = this.start;
    for (let k = s[b], k1 = s[b + 1]; k < k1; k++) {
      const e = this.sorted[k];
      if (this.cellX[e] !== cx || this.cellZ[e] !== cz) continue; // another cell sharing the bucket
      this.test(e);
    }
  }

  /** The exact test for the query running now. */
  private test(e: number) {
    if (!this.passes(e, this.qf)) return;
    const px = this.x[e] - this.qx, pz = this.z[e] - this.qz;
    if (this.qmode === M_NEAR) {
      const reach = this.qFoot ? this.foot[e] : this.r[e];
      if (this.qFoot && reach <= 0) return;
      const R = this.qR + reach;
      if (px * px + pz * pz <= R * R) this.qout.push(e);
    } else if (this.qmode === M_RAY) {
      const t = px * this.qdx + pz * this.qdz, d = px * this.qdz - pz * this.qdx, R = this.r[e] + this.qw;
      if (d * d > R * R) return;
      const c = Math.sqrt(R * R - d * d);
      const a = Math.max(0, t - c), b = Math.min(this.qlen, t + c);
      if (a > b) return;
      const h = this.qhits!;
      h.e.push(e); h.t0.push(a); h.t1.push(b); h.n++;
    } else {
      const t = px * this.qdx + pz * this.qdz;
      if (t <= 0 || t > this.qlen) return;
      const d = Math.abs(px * this.qdz - pz * this.qdx);
      if (d <= this.r[e] + this.qw + t * this.qtan) this.qout.push(e);
    }
  }
}

/**
 * Serials for owners whose things are objects (raiders, mechs, dummies): one per object per life. An object that
 * wasn't published last rebuild (dead, or new) gets a fresh serial when it comes back, so a respawned dummy or a
 * reused bandit mech is a new id.
 */
export class ObjectSerials {
  private map = new WeakMap<object, { serial: number; stamp: number }>();
  private next = 1;
  serial(o: object, reg: Register): number {
    let s = this.map.get(o);
    if (!s || s.stamp < reg.stamp - 1) { s = { serial: this.next++, stamp: reg.stamp }; this.map.set(o, s); }
    s.stamp = reg.stamp;
    return s.serial;
  }
}

/** One soft-lock / lead candidate made from an entry (the lock's target, a demo aim): key is the stable id. */
export interface EntryView { x: number; y: number; z: number; r: number; key: number; vx: number; vz: number; foot?: number }
export function viewOf(reg: Register, e: number, out?: EntryView): EntryView {
  const v = out ?? { x: 0, y: 0, z: 0, r: 0, key: 0, vx: 0, vz: 0 };
  v.x = reg.x[e]; v.y = reg.y[e]; v.z = reg.z[e]; v.r = reg.r[e]; v.key = reg.id[e]; v.vx = reg.vx[e]; v.vz = reg.vz[e];
  if (reg.foot[e] > 0) v.foot = reg.foot[e]; else delete v.foot;
  return v;
}

/** Every entry passing a filter as a list (the weapons that want a list: the line mortar's snap, the missile picks),
 *  made once per rebuild however often it's asked for. */
export class EntryList {
  private list: EntryView[] = [];
  private at = -1;
  constructor(readonly reg: Register, readonly filter: Filter) {}
  get(): EntryView[] {
    if (this.at === this.reg.stamp) return this.list;
    this.at = this.reg.stamp;
    const out = this.list;
    out.length = 0;
    this.reg.each(this.filter, (e) => out.push(viewOf(this.reg, e)));
    return out;
  }
  /** Where the thing with this id is now (null: gone). */
  find(id: unknown): { x: number; z: number } | null {
    if (typeof id !== "number") return null;
    const e = this.reg.find(id);
    return e < 0 ? null : { x: this.reg.x[e], z: this.reg.z[e] };
  }
}
