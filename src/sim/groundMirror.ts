// The sim worker's own copy of the ground (plan docs/proposal-simworker.md): a DuneField with the convoy's road, the
// craters and the expedition's pads and walls, built from the same values and kept in step by replaying the main
// thread's ground events (src/sim/groundEvents.ts) in order. Same objects, same calls, so the same heights bit for
// bit; tools/groundmirror-check.ts and the convoy lab's parity sampling hold it to that. Pure: no scene, no DOM.
// Step 3: it also holds the worker's copy of the convoy (its reset, jump and update replayed the same way) and the
// escorts driving beside it (src/sim/escortsRemote.ts, stepped by the main thread's commands in the same stream).
import { DuneField } from "../world/terrain";
import { ConvoyRoute, type RouteValues } from "../convoy/route";
import { CraterLayer, type CraterValues } from "../world/craters";
import { SitesGround, roadBlocks } from "../expedition/sitesGround";
import { Convoy } from "../convoy/platform";
import type { TrainValues } from "../convoy/train";
import type { PlatformValues } from "../convoy/platform";
import type { EscortValues } from "../convoy/escort";
import { EscortsWorker } from "./escortsRemote";
import { RobotsWorker } from "./robotsRemote";
import { DeathsWorker } from "./deathsRemote";
import { InfantryWorker } from "./infantryRemote";
import type { InfantryValues } from "../combat/infantry";
import type { DeathValues, HoldValues } from "../physics/deaths";
import type { RobotValues } from "../combat/robots";
import type { SafeValues } from "../convoy/safeZone";
import type { GroundEvent, GroundInit, Values } from "./groundEvents";

export class GroundMirror {
  readonly V: Values;
  field: DuneField;
  readonly route: ConvoyRoute;
  readonly craters: CraterLayer;
  sites: SitesGround | null = null;
  convoy: Convoy | null = null;
  escorts: EscortsWorker | null = null;
  /** Step 4: the robot swarm (src/sim/robotsRemote.ts), made by the view's first command. */
  robots: RobotsWorker | null = null;
  /** Stage 7b: the infantry swarms (src/sim/infantryRemote.ts), made by a view's first command. */
  infantry: InfantryWorker | null = null;
  /** Death physics (src/sim/deathsRemote.ts), made by the view's first command. */
  deaths: DeathsWorker | null = null;
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

  convoyMade() { this.convoy = new Convoy(this.route, this.V as unknown as PlatformValues & TrainValues, this.field); }

  private target(e: GroundEvent): object {
    switch (e.t) {
      case "mirror": return e.m === "sites" ? { sites: () => this.sitesMade() } : e.m === "convoy" ? { convoy: () => this.convoyMade() } : this;
      case "convoy": if (!this.convoy) throw new Error(`ground mirror: convoy.${e.m} before the convoy was made`); return this.convoy;
      case "escorts":
        if (!this.convoy) throw new Error(`ground mirror: escorts.${e.m} before the convoy was made`);
        return (this.escorts ??= new EscortsWorker(this.V as unknown as EscortValues, this.convoy, this.field));
      case "robots": return (this.robots ??= new RobotsWorker(this.V as unknown as RobotValues & SafeValues, this.field, () => this.convoy));
      case "infantry": return (this.infantry ??= new InfantryWorker(this.V as unknown as InfantryValues & SafeValues, this.field, () => this.convoy));
      case "deaths": return (this.deaths ??= new DeathsWorker(this.V as unknown as DeathValues & HoldValues, this.field));
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
