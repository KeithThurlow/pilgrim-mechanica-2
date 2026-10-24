// What a POI holds, as plain data: its sections (each a share of the value you can bank and leave), the salvage spots
// in them, and the set dressing as a list of props and vehicles for the drawer. Builders (src/pois/<kind>.ts) are
// pure and seeded: the same placement and values always give the same site.
import type { CarKind } from "../vehicles/car";
import { rng, type PoiPlacement } from "../world/pois";

/** Stand-in prop shapes the drawer knows (src/pois/poiDraw.ts). */
export type PropShape =
  | "rock"      // a lumpy boulder (stretched dodecahedron)
  | "box"       // a plain block: plates, crates, chunks
  | "cyl"       // a cylinder along its local y: struts, pipes, rams, tanks
  | "pod"       // a capsule along local y: the supply pod's shell
  | "cone"      // along local y: a pod's nose, an engine bell
  | "arc"       // a curved hull plate: size = [chord, thickness, length]; an arc of about 70 degrees
  | "rib"       // an I-beam (size = [width, height, length])
  | "disc"      // flat on the ground: a scorch, a rut (size = [x, z] radii, y unused)
  | "cloth";    // a thin draped sheet (a chute, a tarp)

export type Tone = "rock" | "rockDark" | "steel" | "hull" | "rust" | "dark" | "burnt" | "hazard" | "cloth" | "scorch" | "rut" | "olive";

export interface PropDef {
  shape: PropShape;
  /** World position; y is metres above the ground there (negative sinks it). */
  x: number; y: number; z: number;
  /** Euler angles (radians, order YXZ: yaw, then pitch, then roll). */
  yaw: number; pitch: number; roll: number;
  size: [number, number, number];
  tone: Tone;
}

export interface VehicleWreck {
  kind: CarKind;
  x: number; z: number;
  yaw: number; pitch: number; roll: number;
  /** Sunk into the sand (m), burnt tyres. */
  sink: number;
  /** Which section it belongs to. */
  section: number;
}

export interface SpotDef {
  id: string;
  section: number;
  x: number; z: number;
  /** Height above the ground where the cutting happens (sparks and the marker). */
  h: number;
  /** Scrap it gives when stripped. */
  value: number;
  /** Seconds of holding E to strip it. */
  time: number;
  label: string;
}

export interface SectionDef { name: string; spots: SpotDef[]; value: number }

export interface PoiSite {
  place: PoiPlacement;
  sections: SectionDef[];
  props: PropDef[];
  vehicles: VehicleWreck[];
  /** Sum of the sections' values. */
  value: number;
}

/** Helpers a builder works with: a seeded generator and the POI's own frame (local x across, z along its yaw). */
export class SiteBuilder {
  readonly r: () => number;
  readonly props: PropDef[] = [];
  readonly vehicles: VehicleWreck[] = [];
  readonly sections: SectionDef[] = [];
  private ca: number;
  private sa: number;
  private n = 0;

  constructor(readonly place: PoiPlacement) {
    this.r = rng(place.seed);
    this.ca = Math.cos(place.yaw); this.sa = Math.sin(place.yaw);
  }

  /** Random in [a, b). */
  range(a: number, b: number) { return a + this.r() * (b - a); }
  /** Random integer in [a, b]. */
  int(a: number, b: number) { return Math.floor(a + this.r() * (b - a + 1 - 1e-9)); }
  /** Random sign-symmetric jitter in [-a, a). */
  jit(a: number) { return (this.r() * 2 - 1) * a; }
  /** One of a list. */
  one<T>(list: readonly T[]): T { return list[Math.min(list.length - 1, Math.floor(this.r() * list.length))]; }

  /** Local (x across, z along the POI's heading) to world. Heading 0 faces +Z; +X is to the left. */
  world(lx: number, lz: number): [number, number] {
    const p = this.place;
    return [p.x + lx * this.ca + lz * this.sa, p.z - lx * this.sa + lz * this.ca];
  }

  /** A prop at local (lx, lz); yaw is relative to the POI's heading. */
  prop(shape: PropShape, lx: number, lz: number, y: number, size: [number, number, number], tone: Tone, yaw = 0, pitch = 0, roll = 0) {
    const [x, z] = this.world(lx, lz);
    this.props.push({ shape, x, y, z, yaw: yaw + this.place.yaw, pitch, roll, size, tone });
  }

  /** A burnt vehicle at local (lx, lz). */
  vehicle(kind: CarKind, lx: number, lz: number, yaw: number, section: number, pitch = 0, roll = 0, sink = 0.3) {
    const [x, z] = this.world(lx, lz);
    this.vehicles.push({ kind, x, z, yaw: yaw + this.place.yaw, pitch, roll, sink, section });
  }

  /** Start a new section; returns its index. */
  section(name: string) { this.sections.push({ name, spots: [], value: 0 }); return this.sections.length - 1; }

  /** A salvage spot at local (lx, lz) in a section. Value is rounded to whole scrap (at least 1). */
  spot(section: number, lx: number, lz: number, h: number, value: number, time: number, label: string) {
    const [x, z] = this.world(lx, lz);
    const s: SpotDef = { id: `${this.place.id}#${this.n++}`, section, x, z, h, value: Math.max(1, Math.round(value)), time: Math.max(0.2, time), label };
    const sec = this.sections[section];
    sec.spots.push(s);
    sec.value += s.value;
  }

  done(): PoiSite {
    return { place: this.place, sections: this.sections, props: this.props, vehicles: this.vehicles, value: this.sections.reduce((a, s) => a + s.value, 0) };
  }

  /** A scatter of small debris (chunks, plates, struts) in a ring between r0 and r1 (local), half sunk. */
  debris(n: number, r0: number, r1: number, tones: Tone[] = ["steel", "rust", "dark", "hull"]) {
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2, d = r0 + Math.sqrt(this.r()) * (r1 - r0);
      const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
      const k = this.r(), tone = this.one(tones), s = this.range(0.5, 1.4);
      if (k < 0.45) this.prop("box", lx, lz, -0.1 * s, [s * this.range(0.6, 1.6), s * this.range(0.15, 0.5), s * this.range(0.5, 1.4)], tone, this.r() * 6.28, this.jit(0.5), this.jit(0.5));
      else if (k < 0.7) this.prop("box", lx, lz, 0.05, [s * this.range(1.2, 2.6), 0.08, s * this.range(0.8, 1.8)], tone, this.r() * 6.28, this.jit(0.25), this.jit(0.25));
      else if (k < 0.9) this.prop("cyl", lx, lz, 0.1, [0.09 * s, s * this.range(1.2, 3.2), 0.09 * s], tone, this.r() * 6.28, Math.PI / 2 + this.jit(0.3), 0);
      else this.prop("rib", lx, lz, 0.1, [0.25, 0.35, s * this.range(1.5, 3)], "dark", this.r() * 6.28, this.jit(0.2), this.jit(0.4));
    }
  }
}
