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
import { blocksNear, fortLayout, ringR, ringSpan, type FortValues, type Gate, type Layout, type Ring } from "./fortress";
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
function ringHeight(ring: Ring, d: number, a: number, down: ReadonlySet<string>, steel = false) {
  const R = ringR(ring, a), e = Math.abs(d - R), span = ringSpan(ring);
  if (e >= span) return 0;
  const coreW = ring.top + ring.face;
  let core = e < coreW ? ring.h * (1 - smooth(ring.top, coreW, e)) : 0;
  // The drift: rolling along the wall, banked against the containers, falling away to the floor.
  let drift = ring.drift > 0 ? ring.drift * (0.75 + 0.25 * Math.sin(a * 7 + ring.r) * Math.sin(a * 3 + 1.7)) * (1 - smooth(ring.top, span, e)) : 0;
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
  return steel ? Math.max(core, plug) : Math.max(core, drift, plug);
}

/** Height a layout's walls and cover add at (x, z), with the gates in `down` open; `steel`: the containers alone, no sand drift. */
export function wallHeight(L: Layout, x: number, z: number, down: ReadonlySet<string>, steel = false): number {
  const dx = x - L.x, dz = z - L.z;
  if (Math.abs(dx) > L.reach || Math.abs(dz) > L.reach) return 0;
  const d = Math.hypot(dx, dz);
  if (d > L.reach) return 0;
  const a = Math.atan2(dx, dz);
  let best = 0;
  for (const ring of L.rings) best = Math.max(best, ringHeight(ring, d, a, down, steel));
  for (const n of blocksNear(L, x, z)) {
    const b = L.blocks[n];
    if (b.id && down.has(b.id)) continue; // a toppled tower
    const bx = x - b.x, bz = z - b.z;
    const ca = Math.cos(b.a), sa = Math.sin(b.a);
    // Box frame: long side along heading a.
    const ins = b.inset ?? 0.4, u = Math.abs(bx * sa + bz * ca) - (b.len / 2 - ins), w = Math.abs(bx * ca - bz * sa) - (b.dep / 2 - ins);
    const out = Math.hypot(Math.max(0, u), Math.max(0, w));
    if (out > b.driftW) continue;
    const core = b.h * (1 - smooth(0, 0.35, out));
    const drift = b.drift * (1 - smooth(0, b.driftW, out));
    best = Math.max(best, core, steel ? 0 : drift);
  }
  return best;
}

/** Whether a round landing at (x, z) strikes a container rather than the sand banked against it. */
export function wallMetal(L: Layout, x: number, z: number, down: ReadonlySet<string>): boolean {
  const steel = wallHeight(L, x, z, down, true);
  return steel > 0.3 && steel >= wallHeight(L, x, z, down) - 1e-6;
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
  if (L.streets.length && L.blocks.length) {
    // A fortress town: the flow field to just through the gate (round the shacks).
    const r = ringR(ring, best.a) + out * (ringSpan(ring) + 3);
    const tx = L.x + Math.sin(best.a) * r, tz = L.z + Math.cos(best.a) * r;
    const st = flowStep(L, x, z, tx, tz, down);
    if (st) return st;
  }
  if (arc < best.w / 2 - 1) {
    // In line with the gap: through it, to the far side.
    const r = ringR(ring, best.a) + out * span;
    return { x: L.x + Math.sin(best.a) * r, z: L.z + Math.cos(best.a) * r };
  }
  // Round the yard toward it, a step at a time (so the way never cuts across the next ring in), on this side of it.
  const step = Math.max(-0.5, Math.min(0.5, da)), Rn = ringR(ring, am + step);
  // A fortress town: along the foot of the wall, on its sand drift (no shacks stand there), so nobody snags on them.
  const town = L.streets.length > 0, half = ringSpan(ring) * 0.5;
  const r = town ? Rn + (out > 0 ? -half : half) : out > 0 ? Math.min(Rn - span, Math.max(d * (Rn / Math.max(1, ringR(ring, am))), Rn - span - 10)) : Math.max(Rn + span, d);
  return { x: L.x + Math.sin(am + step) * r, z: L.z + Math.cos(am + step) * r };
}

// ---- walking the town: flow fields on a 2 m grid (Keith 2026-11-05: shacks in the yards) ----

const FLOW_CELL = 2;
const FLOW_MAX = 8;

/** Is (x, z) solid for anyone on foot (a container core: wall, shack, standing gate, with a metre's margin so paths keep off the faces), not the sand drifts? */
function solidAt(L: Layout, x: number, z: number, down: ReadonlySet<string>) {
  const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz), a = Math.atan2(dx, dz);
  for (const ring of L.rings) {
    const R = ringR(ring, a), e = Math.abs(d - R);
    if (e > ring.top + ring.face + 1.2) continue;
    let open = false;
    for (const g of ring.gates) if (Math.abs(wrap(a - g.a)) * R < g.w / 2 - 1 && (!g.barred || down.has(g.id))) open = true;
    if (!open) return true;
  }
  for (const n of blocksNear(L, x, z)) {
    const b = L.blocks[n], bx = x - b.x, bz = z - b.z, ca = Math.cos(b.a), sa = Math.sin(b.a);
    if (b.id && down.has(b.id)) continue;
    if (Math.abs(bx * sa + bz * ca) < b.len / 2 + 0.9 && Math.abs(bx * ca - bz * sa) < b.dep / 2 + 0.9) return true;
  }
  return false;
}

function flowGrid(L: Layout, down: ReadonlySet<string>) {
  const n = Math.ceil((2 * (L.reach + 10)) / FLOW_CELL) + 1;
  let f = L.flow;
  // Which of this fortress's gates are open (only changes when a gate goes down or everything is reset).
  if (!f || f.size !== down.size) {
    const key = [...L.rings.flatMap((r) => r.gates).map((g) => g.id), ...L.towers.map((t) => t.id)].filter((id) => down.has(id)).join(",");
    if (!f || f.downKey !== key) f = L.flow = { downKey: key, size: down.size, solid: null, fields: new Map() };
    else f.size = down.size;
  }
  if (!f.solid) {
    const s = new Uint8Array(n * n), o = L.reach + 10;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s[j * n + i] = solidAt(L, L.x - o + i * FLOW_CELL, L.z - o + j * FLOW_CELL, down) ? 1 : 0;
    f.solid = s;
  }
  return { f, n, o: L.reach + 10 };
}

/**
 * The next point on foot from (x, z) toward (tx, tz) round the shacks and walls (pure apart from its cache): a
 * breadth-first flow field out from the target's cell over the open ground (8 neighbours), a step two cells down it.
 * Null when outside the grid or no way there.
 */
export function flowStep(L: Layout, x: number, z: number, tx: number, tz: number, down: ReadonlySet<string>): { x: number; z: number } | null {
  const { f, n, o } = flowGrid(L, down);
  const cell = (px: number, pz: number) => {
    const i = Math.round((px - L.x + o) / FLOW_CELL), j = Math.round((pz - L.z + o) / FLOW_CELL);
    return i >= 0 && j >= 0 && i < n && j < n ? j * n + i : -1;
  };
  const t = cell(tx, tz), c = cell(x, z);
  if (t < 0 || c < 0) return null;
  let field = f.fields.get(t);
  if (!field) {
    field = new Int32Array(n * n).fill(-1);
    const solid = f.solid!, q = new Int32Array(n * n);
    let h = 0, e = 0;
    field[t] = 0; q[e++] = t;
    while (h < e) {
      const k = q[h++], ki = k % n, kj = (k / n) | 0, dk = field[k] + 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ki + di, j = kj + dj;
        if ((!di && !dj) || i < 0 || j < 0 || i >= n || j >= n) continue;
        const m = j * n + i;
        // No corner cutting past a solid cell.
        if (field[m] >= 0 || solid[m] || (di && dj && (solid[kj * n + i] || solid[j * n + ki]))) continue;
        field[m] = dk; q[e++] = m;
      }
    }
    if (f.fields.size >= FLOW_MAX) f.fields.delete(f.fields.keys().next().value!);
    f.fields.set(t, field);
  }
  // From this cell (or the best open one next to it, if it stands on a solid edge) two steps down the field.
  let k = c;
  if (field[k] < 0) {
    let best = -1;
    const ci = c % n, cj = (c / n) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const m = j * n + i;
      if (field[m] >= 0 && (best < 0 || field[m] < field[best])) best = m;
    }
    if (best < 0) return null;
    k = best;
  }
  for (let s = 0; s < 2 && field[k] > 0; s++) {
    const ki = k % n, kj = (k / n) | 0;
    let best = k;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ki + di, j = kj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const m = j * n + i;
      if (field[m] >= 0 && field[m] < field[best]) best = m;
    }
    if (best === k) break;
    k = best;
  }
  return { x: L.x - o + (k % n) * FLOW_CELL, z: L.z - o + ((k / n) | 0) * FLOW_CELL };
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

  metalAt(x: number, z: number) { return this.near(x, z, this.list).some((p) => wallMetal(this.layout(p), x, z, this.down)); }
}
