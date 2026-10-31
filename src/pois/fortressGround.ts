// Fortress and hub walls as part of the ground (pure, like the POI pads; Keith 2026-10-31): every ring a berm of sand
// banked against wreckage, flat on top, its faces far steeper than the walker's wall grade so nothing walks up them.
// Openings are gaps down to the pad's floor. A barred gate is a plug of the wall's height and the barricade's
// thickness filling its gap (the steel drawn over it) until its id is in `down`; then the gap is open. The host owns
// `down` (gate health and the gateDown event); after changing it, rebuild the ground over the gate (chunks.rebuildArea
// round `gateBox`).
//
// Stack it after the POI pads (addModifier), so the berms sit on the levelled floor.
import type { GroundModifier, ModifierSample } from "../world/terrain";
import type { PoiField, PoiPlacement } from "../world/pois";
import { fortLayout, type FortValues, type Gate, type Layout } from "./fortress";
import { hubLayout, type HubValues } from "./hub";

const smooth = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type SiegeValues = FortValues & HubValues;

export const isSiege = (p: PoiPlacement | null | undefined): p is PoiPlacement => !!p && (p.kind === "fortress" || p.kind === "hub");

/** The wall layout of a fortress or hub placement. */
export function siegeLayout(p: PoiPlacement, v: SiegeValues): Layout {
  return p.kind === "hub" ? hubLayout(p, v) : fortLayout(p, v);
}

/** Height a layout's walls add at (x, z), with the gates in `down` open. */
export function wallHeight(L: Layout, x: number, z: number, down: ReadonlySet<string>): number {
  const dx = x - L.x, dz = z - L.z;
  if (Math.abs(dx) > L.reach || Math.abs(dz) > L.reach) return 0;
  const d = Math.hypot(dx, dz);
  if (d > L.reach) return 0;
  let best = 0;
  let a = NaN;
  for (const ring of L.rings) {
    const e = Math.abs(d - ring.r), span = ring.top + ring.face;
    if (e >= span) continue;
    let h = ring.h * (1 - smooth(ring.top, span, e));
    if (Number.isNaN(a)) a = Math.atan2(dx, dz);
    for (const g of ring.gates) {
      const arc = Math.abs(wrap(a - g.a)) * ring.r;
      if (arc >= g.w / 2 + ring.face) continue;
      // The sand is cut away through the gap (a face's width to blend back into the wall either side).
      h *= smooth(g.w / 2, g.w / 2 + ring.face, arc);
      if (g.barred && !down.has(g.id)) {
        // The plug runs the whole cut (into the sand either side), so no slot opens where the sand blends back.
        h = Math.max(h, ring.h * (1 - smooth(g.t / 2, g.t / 2 + 0.5, e)));
      }
    }
    if (h > best) best = h;
  }
  return best;
}

/**
 * Would a step on foot from (x0, z0) to (x1, z1) climb a wall? Any step rising on the walls at more than half a metre per
 * metre (the faces are far steeper; only their very toe is gentler). Walking a wall's top or dropping off it is fine.
 */
export function fenced(L: Layout, x0: number, z0: number, x1: number, z1: number, down: ReadonlySet<string>) {
  const rise = wallHeight(L, x1, z1, down) - wallHeight(L, x0, z0, down);
  return rise > 0.002 && rise > 0.5 * Math.hypot(x1 - x0, z1 - z0);
}

/** Which side of the walls a point is: 0 outside them all, k + 1 in yard k (inside ring k, outside ring k + 1). */
export function regionOf(L: Layout, x: number, z: number) {
  const d = Math.hypot(x - L.x, z - L.z);
  let n = 0;
  for (const r of L.rings) if (d < r.r) n++;
  return n;
}

/**
 * The next point to walk to on foot from (x, z) toward (tx, tz) when walls are in between (pure): round the yard to
 * the nearest open gate in the next ring to cross, then through it. Null when they're on the same side (go straight)
 * or no gate in that ring is open (stay put).
 */
export function routeVia(L: Layout, x: number, z: number, tx: number, tz: number, down: ReadonlySet<string>): { x: number; z: number } | null {
  const a = regionOf(L, x, z), b = regionOf(L, tx, tz);
  if (a === b) return null;
  const k = b < a ? a - 1 : a, ring = L.rings[k], out = b < a ? 1 : -1;
  const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz), am = Math.atan2(dx, dz);
  let best: Gate | null = null, bestA = Infinity;
  for (const g of ring.gates) {
    if (g.barred && !down.has(g.id)) continue;
    const da = Math.abs(wrap(g.a - am));
    if (da < bestA) { bestA = da; best = g; }
  }
  if (!best) return null;
  const da = wrap(best.a - am), arc = Math.abs(da) * ring.r;
  const span = ring.top + ring.face + 6;
  if (arc < best.w / 2 - 1) {
    // In line with the gap: through it, to the far side.
    const r = ring.r + out * span;
    return { x: L.x + Math.sin(best.a) * r, z: L.z + Math.cos(best.a) * r };
  }
  // Round the yard toward it, a step at a time (so the way never cuts across the next ring in), on this side of it.
  const step = Math.max(-0.7, Math.min(0.7, da));
  const r = out > 0 ? Math.min(ring.r - span, Math.max(d, ring.r - span - 10)) : Math.max(ring.r + span, d);
  return { x: L.x + Math.sin(am + step) * r, z: L.z + Math.cos(am + step) * r };
}

/** A box round a gate (x0, z0, x1, z1) to rebuild the ground over when it goes down. */
export function gateBox(g: Gate, margin = 6): [number, number, number, number] {
  const r = g.w / 2 + margin;
  return [g.x - r, g.z - r, g.x + r, g.z + r];
}

export class SiegeWalls implements GroundModifier {
  /** Gates blown down (host state). */
  readonly down = new Set<string>();
  private layouts = new Map<string, Layout>();
  private cells: (PoiPlacement | null)[] = [];
  /** Placements to leave out (the expedition's: ones the convoy's road runs into). */
  skip: ((p: PoiPlacement) => boolean) | null = null;

  constructor(readonly pois: PoiField, public v: SiegeValues) {}

  /** Values or placement changed: lay out again (gates down are kept by id). */
  reset() { this.layouts.clear(); }

  layout(p: PoiPlacement): Layout {
    let L = this.layouts.get(p.id);
    if (!L) { L = siegeLayout(p, this.v); this.layouts.set(p.id, L); }
    return L;
  }

  /** The fortresses and hubs whose walls could reach (x, z). */
  near(x: number, z: number, out: PoiPlacement[] = []): PoiPlacement[] {
    out.length = 0;
    this.pois.cellsAt(x, z, this.cells);
    for (const p of this.cells) if (isSiege(p) && !this.skip?.(p)) out.push(p);
    for (const p of this.pois.extra) if (isSiege(p) && !this.skip?.(p) && Math.abs(p.x - x) < 250 && Math.abs(p.z - z) < 250) out.push(p);
    return out;
  }

  private list: PoiPlacement[] = [];
  at(x: number, z: number, out: ModifierSample): boolean {
    let h = 0;
    for (const p of this.near(x, z, this.list)) h = Math.max(h, wallHeight(this.layout(p), x, z, this.down));
    if (h <= 0) return false;
    out.w = 0; out.berm = h; out.lift = 0; out.rough = 0;
    return true;
  }
}
