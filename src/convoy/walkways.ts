// The convoy as somewhere to walk (pure, no rendering): every car's deck, the tops of its furniture (as walls you
// can't climb, and the cab roof you can), the footbridge landings and the stairs up to them (train.ts landingLayout,
// the same shapes platformBody.ts draws), the bay terminal, and the footbridges between the cars, all registered as
// surfaces on src/world/walkable.ts. Each car's surfaces hang on the car as a moving frame; each footbridge is its own
// frame stretched between its two landings, and goes off (the pilot is put back on the nearer landing) when it lifts
// clear in a tight turn. The pilot walks them (src/pilot/pilot.ts); the decks' rails are his drop limit.
import type { Param } from "../core/tweaks";
import type { Frame, Surface, Vec3, Walkable } from "../world/walkable";
import type { Platform, Convoy } from "./platform";
import { outside } from "./outline";
import { furniture, furnBox } from "./furniture";
import { deckLayout, terminalSpot, TERMINAL_HALF, type DeckValues } from "./deck";
import { bridgeSpans, landingEnds, landingLayout, LANDING_HALF, CAB_ROOF, type Span, type TrainValues } from "./train";
import { carValues } from "../vehicles/car";

export const WALKWAY_DEFAULTS = {
  walkRailIn: 0.35,
  walkWallPad: 0.3,
  bridgeWalkHalf: 0.5,
};
export type WalkwayValues = typeof WALKWAY_DEFAULTS;
const G = "Pilot: walkways";
export const WALKWAY_PARAMS: Param[] = [
  { key: "walkRailIn", label: "Keep off the deck edge (m)", min: 0, max: 1.5, step: 0.05, group: G, tip: "How close to a deck's edge the pilot's middle gets (the rails)" },
  { key: "walkWallPad", label: "Keep off walls (m)", min: 0, max: 1, step: 0.05, group: G, tip: "Huts, machines and towers are this much bigger to the pilot's middle (his body's radius)" },
  { key: "bridgeWalkHalf", label: "Bridge walk half width (m)", min: 0.2, max: 1, step: 0.05, group: G, tip: "How far off a footbridge's middle line the pilot can walk" },
];

type Values = WalkwayValues & TrainValues & DeckValues & { craneMount: number };

/** A car as a frame: the flat (heading-only) transform the convoy uses for decks, so local and world round-trip. */
export function platformFrame(p: Platform): Frame {
  return {
    heading: () => p.heading,
    toLocal: (x, z, out) => p.toLocal(x, z, out),
    toWorld: (lx, lz, out) => {
      const s = Math.sin(p.heading), c = Math.cos(p.heading);
      out.x = p.x + c * lx + s * lz; out.z = p.z - s * lx + c * lz;
      return out;
    },
  };
}

/** The deck plane's height at world (x, z) (deck.ts DeckGround.deckHeight, for any car). */
export function deckPlane(p: Platform, x: number, z: number) {
  const u = p.up, o = p.toWorld(0, p.deck, 0, TMP);
  return o.y - (u.x * (x - o.x) + u.z * (z - o.z)) / u.y;
}
const TMP = { x: 0, y: 0, z: 0 };

/** A footbridge as a frame: local x across it (m), z the share of the way from the leading car's landing (0) to the following one's (1). */
class BridgeFrame implements Frame {
  constructor(public span: Span) {}
  heading() { const s = this.span; return Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z); }
  toLocal(x: number, z: number, out: { x: number; z: number }) {
    const { a, b } = this.span, dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, l = Math.sqrt(l2);
    out.z = ((x - a.x) * dx + (z - a.z) * dz) / l2;
    out.x = ((x - a.x) * dz - (z - a.z) * dx) / l;
    return out;
  }
  toWorld(lx: number, lz: number, out: { x: number; z: number }) {
    const { a, b } = this.span, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out.x = a.x + dx * lz + (dz / l) * lx; out.z = a.z + dz * lz - (dx / l) * lx;
    return out;
  }
}

export class ConvoyWalkways {
  /** Every surface this registers (also in the Walkable's list). */
  readonly surfaces: Surface[] = [];
  spans: Span[] = [];
  private bridges: Surface[] = [];
  private frames: Frame[];
  private bounds: { x: number; z: number; r: number }[];
  private built = "";
  private l = { x: 0, z: 0 };

  constructor(readonly convoy: Convoy, readonly walk: Walkable, public v: Values) {
    this.frames = convoy.platforms.map(platformFrame);
    this.bounds = convoy.platforms.map(() => ({ x: 0, z: 0, r: 0 }));
  }

  /** After the convoy moves (each step): bridges re-hung, bounds moved, surfaces rebuilt if a layout slider changed. */
  update() {
    const v = this.v, ps = this.convoy.platforms;
    const key = [v.bridgeCount, v.bridgeRise, v.walkRailIn, v.walkWallPad, v.bridgeWalkHalf, v.deckParkZ, v.deckParkX, v.craneMount, v.craneSetDown, ...ps.map((p) => p.deck)].join("|");
    if (key !== this.built) { this.build(); this.built = key; }
    ps.forEach((p, i) => { const b = this.bounds[i]; b.x = p.x; b.z = p.z; b.r = Math.hypot(p.spec.length / 2, p.halfW) + 3; });
    this.spans = bridgeSpans(ps, v, this.spans);
    // One bridge surface per span (they come and go with the bridge count).
    while (this.bridges.length < this.spans.length) this.addBridge(this.bridges.length);
    while (this.bridges.length > this.spans.length) this.drop(this.bridges.pop()!);
    this.spans.forEach((s, i) => {
      const b = this.bridges[i];
      (b.frame as BridgeFrame).span = s;
      b.off = s.lifted;
      const bd = b.bound!;
      bd.x = (s.a.x + s.b.x) / 2; bd.z = (s.a.z + s.b.z) / 2; bd.r = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) / 2 + 2;
    });
  }

  /** Push a body of radius r on the sand out of every car's footprint (crawler tracks included). */
  pushOut(x: number, z: number, r: number): { x: number; z: number } | null {
    let out: { x: number; z: number } | null = null;
    for (const p of this.convoy.platforms) { const o = p.pushOut(out?.x ?? x, out?.z ?? z, r); if (o) out = o; }
    return out;
  }

  /** The bay terminals: world position (on the deck) for each mech bay, and which car. */
  terminals(out: { x: number; y: number; z: number; platform: Platform }[] = []) {
    out.length = 0;
    for (const p of this.convoy.bays) {
      const t = terminalSpot(p, this.v), w = this.frames[this.convoy.platforms.indexOf(p)].toWorld(t.x, t.z - t.facing * 0, { x: 0, z: 0 });
      out.push({ x: w.x, y: deckPlane(p, w.x, w.z), z: w.z, platform: p });
    }
    return out;
  }

  private drop(s: Surface) {
    const k = this.walk.surfaces.indexOf(s);
    if (k >= 0) this.walk.surfaces.splice(k, 1);
    const j = this.surfaces.indexOf(s);
    if (j >= 0) this.surfaces.splice(j, 1);
  }

  private add(s: Surface) { this.surfaces.push(s); this.walk.surfaces.push(s); return s; }

  private addBridge(i: number) {
    const v = this.v, frame = new BridgeFrame(this.spans[i]);
    const s: Surface = {
      name: `footbridge ${i + 1}`, frame, solid: false, bound: { x: 0, z: 0, r: 0 },
      top: (x, z) => {
        const l = frame.toLocal(x, z, this.l);
        if (l.z < 0 || l.z > 1 || Math.abs(l.x) > v.bridgeWalkHalf) return NaN;
        const { a, b } = frame.span;
        return a.y + (b.y - a.y) * l.z;
      },
      evict: (x, z): Vec3 => {
        const { a, b } = frame.span;
        return Math.hypot(x - a.x, z - a.z) < Math.hypot(x - b.x, z - b.z) ? { ...a } : { ...b };
      },
    };
    this.bridges.push(this.add(s));
  }

  /** Every car's surfaces from its layout (bridges stay). */
  private build() {
    for (const s of [...this.surfaces]) if (!this.bridges.includes(s)) this.drop(s);
    const v = this.v, ps = this.convoy.platforms, ends = landingEnds(ps), pad = v.walkWallPad, l = this.l;
    ps.forEach((p, i) => {
      const frame = this.frames[i], bound = this.bounds[i], D = p.deck, name = p.spec.name;
      const plane = (x: number, z: number) => deckPlane(p, x, z);
      // The deck, inside its rails.
      this.add({ name: `${name} deck`, frame, solid: true, bound, top: (x, z) => { const q = p.toLocal(x, z, l); return outside(p.outline, q.x, q.z) <= -v.walkRailIn ? plane(x, z) : NaN; } });
      // A local box on the deck (centre, half sizes) with its top h above the deck; solid boxes grow by the pad.
      const box = (what: string, cx: number, cz: number, hx: number, hz: number, h: number, solid = true) => {
        const ex = hx + (solid ? pad : 0), ez = hz + (solid ? pad : 0);
        this.add({ name: `${name} ${what}`, frame, solid, bound, top: (x, z) => { const q = p.toLocal(x, z, l); return Math.abs(q.x - cx) <= ex && Math.abs(q.z - cz) <= ez ? plane(x, z) + h : NaN; } });
      };
      // Furniture: walls (the cab's roof is walkable at roof height; huts and machines too high to step on anyway).
      const { items, cars } = furniture(p.spec, D);
      items.forEach((f, k) => { const b = furnBox(f); box(k === 0 ? "cab" : "furniture", b.x, b.z, b.hx, b.hz, k === 0 ? CAB_ROOF : b.y + b.hy - D); });
      for (const c of cars) { const cv = carValues(c.kind); box("vehicle", c.x, c.z, cv.track / 2 + 0.3, cv.wheelbase / 2 + 1.1, 2); }
      // A mech bay's crane ring, service tower and terminal.
      if (p.spec.kind === "bay") {
        const lay = deckLayout(p, v);
        for (const b of lay.blocks) {
          if (b.r !== undefined) {
            const r = b.r + pad;
            this.add({ name: `${name} crane ring`, frame, solid: true, bound, top: (x, z) => { const q = p.toLocal(x, z, l); return Math.hypot(q.x - b.x, q.z - b.z) <= r ? plane(x, z) + 6 : NaN; } });
          }
        }
        const t = terminalSpot(p, v);
        box("terminal", t.x, t.z, TERMINAL_HALF, TERMINAL_HALF, 1.1);
        const tz = v.deckParkZ * p.craneEnd;
        box("service tower", 0, tz, 0.8, 1.9, 4.6);
      }
      // Footbridge landings and their stairs.
      const lay = landingLayout(p.spec, ends[i], v.bridgeCount, v.bridgeRise);
      for (const g of lay.landings) box("landing", g.x, g.z, LANDING_HALF, LANDING_HALF, g.top);
      for (const s of lay.stairs) {
        const dx = s.x1 - s.x0, dz = s.z1 - s.z0, run = Math.hypot(dx, dz), ux = dx / run, uz = dz / run, hw = s.w / 2 - 0.12;
        this.add({
          name: `${name} stair`, frame, solid: true, bound,
          top: (x, z) => {
            const q = p.toLocal(x, z, l), rx = q.x - s.x0, rz = q.z - s.z0;
            const along = rx * ux + rz * uz, across = rx * uz - rz * ux;
            if (along < 0 || along > run || Math.abs(across) > hw) return NaN;
            return plane(x, z) + s.y0 + (s.y1 - s.y0) * (along / run);
          },
        });
      }
    });
  }
}
