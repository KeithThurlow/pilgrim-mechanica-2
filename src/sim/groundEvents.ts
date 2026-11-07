// The ground's changes as plain events (main thread side), for the sim worker's copy of the ground
// (src/sim/groundMirror.ts; plan docs/proposal-simworker.md). The ground is a pure function of the values and a few
// objects' state (the road, the craters, the POI pads and fortress walls); this records every call that changes that
// state, in order, so another thread (or a co-op peer, docs/multiplayer.md) can make the same calls and get the same
// ground, bit for bit.
//
// It taps the objects' own methods (route.update, craters.add, walls.down.add...) rather than every call site, so a
// new caller can't be missed. Only the outermost call is recorded: a call made from inside a recorded one (blast's add,
// the road's patches invalidating crater hardness) happens again in the copy by itself. The values are diffed before
// every recorded call. Ownership: host (the ground is host state).
import type { DuneField } from "../world/terrain";
import type { ConvoyRoute } from "../convoy/route";
import type { CraterLayer } from "../world/craters";
import { SitesGround } from "../expedition/sitesGround";
import type { Convoy } from "../convoy/platform";

/** A plain value a values object holds (objects in the values are not mirrored). */
export type Prim = number | string | boolean;
export type Values = Record<string, Prim>;

/**
 * One change. t: what it acts on ("mirror" for the copy's own setup: values, sites). A call when m is set (m(...a)),
 * else a property set (p = v).
 */
export interface GroundEvent { t: GroundTarget; m?: string; a?: unknown[]; p?: string; v?: Prim }
export type GroundTarget = "mirror" | "field" | "route" | "wake" | "craters" | "sites" | "gates" | "convoy" | "escorts" | "robots" | "deaths";

/** What the copy is built from: the values as they are now and where the road started. */
export interface GroundInit {
  values: Values;
  /** The field's own values when they aren't the lab's (?flat), else null. */
  fieldValues: Values | null;
  routeAt: [number, number];
}

export function snapshot(v: object): Values {
  const out: Values = {};
  for (const k in v) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "number" || typeof x === "string" || typeof x === "boolean") out[k] = x;
  }
  return out;
}

export interface GroundParts {
  /** The lab's values (the object every ground part was given). */
  V: object;
  field: DuneField;
  route: ConvoyRoute;
  craters: CraterLayer;
  /** Where the route was made (new ConvoyRoute(V, x, z)); it must not have moved yet. */
  routeAt: [number, number];
}

export class GroundRecorder {
  readonly init: GroundInit;
  private events: GroundEvent[] = [];
  private depth = 0;
  private lastV: Values;
  private fieldV: object;
  private lastField: Values | null;
  /** Events recorded in all. */
  total = 0;
  /** Where the ground changed lately (crater blasts, protects): the parity check samples round them. */
  readonly spots: [number, number][] = [];

  constructor(readonly parts: GroundParts) {
    const { V, field, route, craters } = parts;
    if (route.s !== 0) console.warn("ground recorder: the route has moved before recording started");
    this.lastV = snapshot(V);
    this.fieldV = field.v;
    this.lastField = field.v === V ? null : snapshot(field.v);
    this.init = { values: { ...this.lastV }, fieldValues: this.lastField ? { ...this.lastField } : null, routeAt: parts.routeAt };
    this.tap(field, "field", ["update"]);
    this.tap(route, "route", ["reset", "jump", "update"]);
    this.tap(route.wake, "wake", ["clear"]);
    this.prop(route, "route", "bladeOffset");
    this.tap(craters, "craters", ["add", "blast", "invalidate", "protect", "clear", "update"], (m, a) => {
      if (m === "add" || m === "blast" || m === "protect") this.spot(a[0] as number, a[1] as number);
    });
    // The expedition's sites, whenever they're made on this field.
    SitesGround.made = (g, f) => { if (f === field) this.sites(g); };
  }

  /** The expedition's sites are in the ground (their pads and walls stacked on the road): from now on, mirrored. */
  private sites(g: SitesGround) {
    this.push({ t: "mirror", m: "sites", a: [] });
    this.tap(g, "sites", ["keepClear", "roadGrew", "rebuild"]);
    this.tap(g.walls.down, "gates", ["add", "delete", "clear"]);
    // Taken as the main thread worked it out, whenever (it is a lazy memo of the road's corridor).
    g.onSkip = (id, b) => { this.diff(false); this.events.push({ t: "sites", m: "setSkip", a: [id, b] }); this.total++; };
  }

  /**
   * The convoy is mirrored too (step 3: the worker's escorts drive beside its own copy of it), from just after it was
   * made, before its first reset: its reset, jump and update are recorded as the outermost calls, so the road's own
   * update inside them replays through them.
   */
  convoy(c: Convoy) {
    this.push({ t: "mirror", m: "convoy", a: [] });
    this.tap(c, "convoy", ["reset", "jump", "update"]);
  }

  /**
   * A command to a system that runs in the worker (step 3: the escorts' steps, resets and planning-memo invalidations),
   * in order with the ground's changes. Recorded at any depth: the worker's copy doesn't make these calls by itself.
   */
  command(t: GroundTarget, m: string, a: unknown[]) { this.push({ t, m, a }); }

  /**
   * The events since the last take (values diffed first). frameEnd false: a take mid-frame (a chunk build going out):
   * the values are diffed only if they haven't been since the frame began (perf 2026-11-07: a full diff on every one of
   * a frame's several takes was ~0.3 ms a frame in a siege).
   */
  take(frameEnd = true): GroundEvent[] {
    this.diff(frameEnd);
    if (frameEnd) this.diffed = false;
    const e = this.events;
    this.events = [];
    return e;
  }

  private spot(x: number, z: number) {
    this.spots.push([x, z]);
    if (this.spots.length > 16) this.spots.shift();
  }

  private push(e: GroundEvent) {
    this.diff(false);
    this.events.push(e);
    this.total++;
  }

  /** Diffed since the last take; takes since the values' key list was read. */
  private diffed = false;
  private takes = 0;
  private keysV: string[] = [];
  private keysField: string[] = [];

  /**
   * Values changed since the last look: one event per values object. Perf (2026-11-06): the lab's values hold ~3000
   * keys, and a diff on every recorded call cost ~0.3 ms each (several a substep once the escorts' commands came), so
   * a diff runs at the first event after each take (catching the panel's changes, made between frames, in order) and
   * at the take itself; a value code changes mid-frame goes at the frame's end. The key lists are read again every
   * 30 takes (new keys only come in at setup).
   */
  private diff(atTake: boolean) {
    if (!atTake && this.diffed) return;
    this.diffed = true;
    const { V, field } = this.parts;
    if (atTake && ++this.takes % 30 === 1 || !this.keysV.length) this.keysV = Object.keys(V);
    const d = diffInto(V, this.lastV, this.keysV);
    if (d) this.events.push({ t: "mirror", m: "values", a: [d] });
    if (field.v !== this.fieldV) {
      this.fieldV = field.v;
      this.lastField = field.v === V ? null : snapshot(field.v);
      this.keysField = Object.keys(field.v);
      this.events.push({ t: "mirror", m: "fieldValues", a: [this.lastField ? { ...this.lastField } : null] });
    } else if (this.lastField) {
      if (!this.keysField.length || this.takes % 30 === 1) this.keysField = Object.keys(field.v);
      const f = diffInto(field.v, this.lastField, this.keysField);
      if (f) this.events.push({ t: "mirror", m: "fieldSet", a: [f] });
    }
  }

  private tap(obj: object, t: GroundTarget, methods: string[], seen?: (m: string, a: unknown[]) => void) {
    const o = obj as Record<string, (...a: unknown[]) => unknown>;
    for (const m of methods) {
      const orig = o[m];
      if (typeof orig !== "function") throw new Error(`ground recorder: ${t}.${m} is not a method`);
      o[m] = (...args: unknown[]) => {
        if (this.depth === 0) {
          // Callbacks (craters.update's changed) aren't the ground's business: cut the args there.
          const i = args.findIndex((x) => typeof x === "function");
          const a = i < 0 ? args : args.slice(0, i);
          this.push({ t, m, a });
          seen?.(m, a);
        }
        this.depth++;
        try { return orig.apply(obj, args); } finally { this.depth--; }
      };
    }
  }

  private prop(obj: object, t: GroundTarget, p: string) {
    const o = obj as Record<string, Prim>;
    let val = o[p];
    Object.defineProperty(obj, p, {
      get: () => val,
      set: (x: Prim) => { val = x; this.push({ t, p, v: x }); },
      configurable: true, enumerable: true,
    });
  }
}

/** Keys of v that differ from last (last updated to match), or null. */
function diffInto(v: object, last: Values, keys: string[]): Values | null {
  let d: Values | null = null;
  const o = v as Record<string, unknown>;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], x = o[k];
    if (typeof x !== "number" && typeof x !== "string" && typeof x !== "boolean") continue;
    if (last[k] !== x && !(Number.isNaN(x) && Number.isNaN(last[k]))) { (d ??= {})[k] = x; last[k] = x; }
  }
  return d;
}
