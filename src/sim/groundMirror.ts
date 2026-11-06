// The sim worker's own copy of the ground (plan docs/proposal-simworker.md): a DuneField with the convoy's road, the
// craters and the expedition's pads and walls, built from the same values and kept in step by replaying the main
// thread's ground events (src/sim/groundEvents.ts) in order. Same objects, same calls, so the same heights bit for
// bit; tools/groundmirror-check.ts and the convoy lab's parity sampling hold it to that. Pure: no scene, no DOM.
import { DuneField } from "../world/terrain";
import { ConvoyRoute, type RouteValues } from "../convoy/route";
import { CraterLayer, type CraterValues } from "../world/craters";
import { SitesGround, roadBlocks } from "../expedition/sitesGround";
import type { GroundEvent, GroundInit, Values } from "./groundEvents";

export class GroundMirror {
  readonly V: Values;
  field: DuneField;
  readonly route: ConvoyRoute;
  readonly craters: CraterLayer;
  sites: SitesGround | null = null;
  /** Events applied in all. */
  applied = 0;

  constructor(init: GroundInit) {
    this.V = { ...init.values };
    const fv = init.fieldValues ? { ...init.fieldValues } : this.V;
    this.field = new DuneField(fv as unknown as ConstructorParameters<typeof DuneField>[0]);
    this.route = new ConvoyRoute(this.V as unknown as RouteValues, init.routeAt[0], init.routeAt[1]);
    this.field.modifier = this.route;
    this.route.ground = this.field;
    this.craters = new CraterLayer(this.V as unknown as CraterValues, this.field);
    this.field.dents = this.craters;
    // What the convoy lab's route.onChange does to the ground (the rest of it is chunks and caches).
    this.route.onChange = (x0, z0, x1, z1) => { this.craters.invalidate(x0, z0, x1, z1); };
  }

  apply(events: GroundEvent[]) {
    for (const e of events) {
      const o = this.target(e) as Record<string, unknown>;
      if (e.m) (o[e.m] as (...a: unknown[]) => unknown).apply(o, e.a ?? []);
      else if (e.p) o[e.p] = e.v;
      this.applied++;
    }
  }

  /** Heights at (x, z) pairs. */
  heights(xz: Float64Array, out = new Float64Array(xz.length / 2)): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.field.height(xz[2 * i], xz[2 * i + 1]);
    return out;
  }

  // The copy's own setup, as events (t: "mirror").
  values(set: Values) { Object.assign(this.V, set); }
  fieldValues(v: Values | null) { this.field.v = (v ? { ...v } : this.V) as unknown as DuneField["v"]; }
  fieldSet(set: Values) { Object.assign(this.field.v, set); }
  sitesMade() {
    this.sites = new SitesGround(this.V as unknown as ConstructorParameters<typeof SitesGround>[0], this.field, roadBlocks(this.route));
  }

  private target(e: GroundEvent): object {
    switch (e.t) {
      case "mirror": return e.m === "sites" ? { sites: () => this.sitesMade() } : this;
      case "field": return this.field;
      case "route": return this.route;
      case "wake": return this.route.wake;
      case "craters": return this.craters;
      case "sites": case "gates": {
        if (!this.sites) throw new Error(`ground mirror: ${e.t}.${e.m} before the sites were made`);
        return e.t === "sites" ? this.sites : this.sites.walls.down;
      }
    }
  }
}
