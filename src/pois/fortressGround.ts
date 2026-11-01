// Fortress and hub walls as part of the ground (pure, like the POI pads; Keith 2026-10-31, containers 2026-11-01): along
// every ring's line a solid core the containers stand over (flat on top, its faces far steeper than the walker's wall
// grade so nothing walks up them), with a gentle sand drift banked either side; loose container stacks in the yards
// are solid boxes in the ground too (cover).
// Openings are gaps down to the pad's floor. A barred gate is a plug of the wall's height and the barricade's
// thickness filling its gap (the steel drawn over it) until its id is in `down`; then the gap is open. The host owns
// `down` (gate health and the gateDown event); after changing it, rebuild the ground over the gate (chunks.rebuildArea
// round `gateBox`).
//
// Stack it after the POI pads (addModifier), so the berms sit on the levelled floor.
import type { GroundModifier, ModifierSample } from "../world/terrain";
import type { PoiField, PoiPlacement } from "../world/pois";
import { fortLayout, ringR, ringSpan, type FortValues, type Gate, type Layout, type Ring } from "./fortress";
import { hubLayout, type HubValues } from "./hub";

const smooth = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type SiegeValues = FortValues & HubValues;

export const isSiege = (p: PoiPlacement | null | undefined): p is PoiPlacement => !!p && (p.kind === "fortress" || p.kind === "hub");

/** The wall layout of a fortress or hub placement. */
export function siegeLayout(p: PoiPlacement, v: SiegeValues): Layout {
  return p.kind === "hub" ? hubLayout(p, v) : fortLayout(p, v);
}

/** Height one ring adds at distance d from the centre at heading a (gates in `down` open). */
function ringHeight(ring: Ring, d: number, a: number, down: ReadonlySet<string>) {
  const R = ringR(ring, a), e = Math.abs(d - R), span = ringSpan(ring);
  if (e >= span) return 0;
  const coreW = ring.top + ring.face;
  let core = e < coreW ? ring.h * (1 - smooth(ring.top, coreW, e)) : 0;
  // The drift: rolling along the wall, banked against the containers, falling away to the floor.
  let drift = ring.drift > 0 ? ring.drift * (0.75 + 0.25 * Math.sin(a * 7.3 + ring.r) * Math.sin(a * 3.1 + 1.7)) * (1 - smooth(ring.top, span, e)) : 0;
  let plug = 0;
  for (const g of ring.gates) {
    const arc = Math.abs(wrap(a - g.a)) * R;
    if (arc >= g.w / 2 + ring.face + ring.driftW) continue;
    // The gap: the core cut clean, the drift swept back a drift's width either side.
    core *= smooth(g.w / 2, g.w / 2 + ring.face, arc);
    drift *= smooth(g.w / 2 - 1, g.w / 2 + ring.driftW, arc);
    // A standing barricade: a plug of the wall's height across the whole cut.
    if (g.barred && !down.has(g.id) && arc < g.w / 2 + ring.face) plug = Math.max(plug, ring.h * (1 - smooth(g.t / 2, g.t / 2 + 0.5, e)));
  }
  return Math.max(core, drift, plug);
}

/** Height a layout's walls and cover add at (x, z), with the gates in `down` open. */
export function wallHeight(L: Layout, x: number, z: number, down: ReadonlySet<string>): number {
  const dx = x - L.x, dz = z - L.z;
  if (Math.abs(dx) > L.reach || Math.abs(dz) > L.reach) return 0;
  const d = Math.hypot(dx, dz);
  if (d > L.reach) return 0;
  const a = Math.atan2(dx, dz);
  let best = 0;
  for (const ring of L.rings) best = Math.max(best, ringHeight(ring, d, a, down));
  for (const b of L.blocks) {
    const bx = x - b.x, bz = z - b.z;
    if (Math.abs(bx) > 8 || Math.abs(bz) > 8) continue;
    const ca = Math.cos(b.a), sa = Math.sin(b.a);
    // Box frame: long side along heading a.
    const u = Math.abs(bx * sa + bz * ca) - (b.len / 2 - 0.4), w = Math.abs(bx * ca - bz * sa) - (b.dep / 2 - 0.4);
    const out = Math.hypot(Math.max(0, u), Math.max(0, w));
    const core = b.h * (1 - smooth(0, 0.35, out));
    const drift = 0.9 * (1 - smooth(0, 3, out));
    best = Math.max(best, core, drift);
  }
  return best;
}

/**
 * Would a step on foot from (x0, z0) to (x1, z1) climb a wall? Any step rising on the walls at more than 0.8 m per
 * metre (the container faces are far steeper; the sand drift is gentler and walked). Walking a wall's top or dropping off it is fine.
 */
export function fenced(L: Layout, x0: number, z0: number, x1: number, z1: number, down: ReadonlySet<string>) {
  const rise = wallHeight(L, x1, z1, down) - wallHeight(L, x0, z0, down);
  return rise > 0.002 && rise > 0.8 * Math.hypot(x1 - x0, z1 - z0);
}

/** Which side of the walls a point is: 0 outside them all, k + 1 in yard k (inside ring k, outside ring k + 1). */
export function regionOf(L: Layout, x: number, z: number) {
  const d = Math.hypot(x - L.x, z - L.z), a = Math.atan2(x - L.x, z - L.z);
  let n = 0;
  for (const r of L.rings) if (d < ringR(r, a)) n++;
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
  const da = wrap(best.a - am), arc = Math.abs(da) * ringR(ring, am);
  const span = ringSpan(ring) + 4;
  if (arc < best.w / 2 - 1) {
    // In line with the gap: through it, to the far side.
    const r = ringR(ring, best.a) + out * span;
    return { x: L.x + Math.sin(best.a) * r, z: L.z + Math.cos(best.a) * r };
  }
  // Round the yard toward it, a step at a time (so the way never cuts across the next ring in), on this side of it.
  const step = Math.max(-0.5, Math.min(0.5, da)), Rn = ringR(ring, am + step);
  const r = out > 0 ? Math.min(Rn - span, Math.max(d * (Rn / Math.max(1, ringR(ring, am))), Rn - span - 10)) : Math.max(Rn + span, d);
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
