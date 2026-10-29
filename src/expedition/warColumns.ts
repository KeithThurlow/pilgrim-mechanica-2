// War band columns roaming the sand (pure, seeded; Keith 2026-10-28, docs/proposal-factions.md): the nomad half of the
// raider faction. Columns of raider vehicles wander the desert; noise (the mech firing, sprinting, stripping salvage,
// and the salvage heat's pull) draws them in and they hunt, coming onto the field (src/expedition/humans.ts brings them
// in as the war band, which keeps its present behaviour: circling and gun runs) when they close with whoever they
// hunt. Where a column starts is a function of its cell and the seed, scaled by depth; from then on it is host state.
// Away from the player they are points here (where, heading, what vehicles, how hurt); the glue reports back its
// survivors when it hands one back.
import type { Param } from "../core/tweaks";
import { hash4, rng } from "../world/pois";
import { DEPTH_GROUP, scaled, type DangerFn } from "./depth";
import type { CarKind } from "../vehicles/car";

export const COLUMN_DEFAULTS = {
  colSeed: 9,
  colCell: 800,
  colChance: 0.5,
  colClear: 300,
  colMin: 3,
  colMax: 7,
  colSpeed: 6,
  colHuntSpeed: 11,
  colHear: 420,
  colLoud: 1.8,
  colNoise: 1.2,
  colEngage: 170,
  colSpawn: 1500,
  colDrop: 1800,
  colChanceFar: 1.8,
  colSizeFar: 2,
  colHeavyFar: 0.5,
  colBusFrom: 5,
};
export type ColumnValues = typeof COLUMN_DEFAULTS;

const G = "War band columns";
export const COLUMN_PARAMS: Param[] = [
  { key: "colSeed", label: "Seed", min: 1, max: 999, step: 1, group: G, onRelease: true },
  { key: "colCell", label: "Cell size (m)", min: 300, max: 3000, step: 10, group: G, tip: "At most one column starts per cell", onRelease: true },
  { key: "colChance", label: "Chance per cell", min: 0, max: 1, step: 0.01, group: G, onRelease: true },
  { key: "colClear", label: "None within (m) of the start", min: 0, max: 1500, step: 10, group: G, onRelease: true },
  { key: "colMin", label: "Smallest column (vehicles)", min: 1, max: 12, step: 1, group: G, onRelease: true },
  { key: "colMax", label: "Biggest column (vehicles)", min: 1, max: 20, step: 1, group: G, onRelease: true },
  { key: "colSpeed", label: "Wander speed (m/s)", min: 0, max: 20, step: 0.5, group: G },
  { key: "colHuntSpeed", label: "Hunting speed (m/s)", min: 0, max: 25, step: 0.5, group: G },
  { key: "colHear", label: "Hears the mech within (m)", min: 0, max: 1500, step: 10, group: G },
  { key: "colLoud", label: "Loud: hearing ×", min: 1, max: 4, step: 0.05, group: G },
  { key: "colNoise", label: "Drawn to salvage noise (× radius)", min: 0, max: 3, step: 0.05, group: G, tip: "A column within this × the noise radius turns toward the stripping" },
  { key: "colEngage", label: "Comes onto the field within (m)", min: 40, max: 500, step: 5, group: G },
  { key: "colSpawn", label: "Columns exist within (m)", min: 500, max: 4000, step: 50, group: G },
  { key: "colDrop", label: "Forgotten past (m)", min: 600, max: 5000, step: 50, group: G },
  { key: "colChanceFar", label: "Columns × at full depth (chance)", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP, onRelease: true },
  { key: "colSizeFar", label: "Column size × at full depth", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP, onRelease: true },
  { key: "colHeavyFar", label: "Heavy vehicles at full depth (share)", min: 0, max: 1, step: 0.01, group: DEPTH_GROUP, tip: "Share of a column that is gun trucks, six-wheelers, a War Rig and a turret truck rather than technicals", onRelease: true },
  { key: "colBusFrom", label: "Party bus in columns of (vehicles)", min: 1, max: 21, step: 1, group: G, tip: "Columns this big or bigger bring a party bus that drops bandits on foot (21: never)", onRelease: true },
];

export interface Column {
  id: string;
  x: number; z: number;
  heading: number; speed: number;
  kinds: CarKind[];
  /** Share of hull left across the column (1 fresh). */
  health: number;
  /** roam: wandering; hunt: closing on a target; live: on the field (the glue moves it); busy: fighting off view. */
  state: "roam" | "hunt" | "live" | "busy";
  turn: number;
  tx: number; tz: number;
  /** Pulled to this place by noise until the time runs out. */
  lure: number;
  danger: number;
}

export interface ColumnMe { x: number; z: number; out: boolean; loud: boolean }
export type ColumnEvent = { type: "engage"; col: Column };

/**
 * The vehicles of a column of n: technicals mostly, more of the heavy kinds (and a War Rig lead, a turret truck at the
 * back) deeper out; a party bus second from the back in columns of busFrom or more (Keith 2026-10-29: no tanks, those
 * are the rival military's).
 */
export function columnKinds(n: number, danger: number, heavyFar: number, r: () => number, busFrom = COLUMN_DEFAULTS.colBusFrom): CarKind[] {
  const heavy = Math.min(0.9, 0.12 + heavyFar * danger);
  const kinds: CarKind[] = [];
  for (let k = 0; k < n; k++) {
    const x = r();
    kinds.push(x >= heavy ? "technical" : x < heavy * 0.5 ? "gunTruck" : "sixWheeler");
  }
  if (n >= 6 && danger > 0.4) kinds[0] = "warRig";
  if (n >= 5 && danger > 0.6) kinds[kinds.length - 1] = "turretTruck";
  if (n >= busFrom) kinds[Math.max(0, kinds.length - 2)] = "partyBus";
  return kinds;
}

export class WarColumns {
  readonly cols: Column[] = [];
  /** Cells that have had their column (alive or not): a beaten column does not come back. */
  private made = new Set<string>();
  private rs: number;
  start = { x: 0, z: 0 };
  danger: DangerFn | null = null;

  constructor(public v: ColumnValues, seed = 29,
    /** Where nothing should drive (the road, the train). */
    private avoid: (x: number, z: number) => boolean = () => false) {
    this.rs = (seed >>> 0) || 1;
  }

  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  reset() { this.cols.length = 0; this.made.clear(); }

  /** The column cell (i, j) starts with, or null: a function of the seed, the cell and the depth there. */
  static initial(v: ColumnValues, i: number, j: number, start: { x: number; z: number }, danger: DangerFn | null): Column | null {
    const r = rng(hash4(v.colSeed, 43, i, j)), C = v.colCell;
    const roll = r();
    const x = i * C + C * 0.15 + r() * C * 0.7, z = j * C + C * 0.15 + r() * C * 0.7;
    const d = danger ? danger(x, z) : 0;
    if (roll >= Math.min(0.95, v.colChance * scaled(v.colChanceFar, d))) return null;
    if (Math.hypot(x - start.x, z - start.z) < v.colClear) return null;
    const lo = Math.min(v.colMin, v.colMax), hi = Math.max(v.colMin, v.colMax);
    const n = Math.max(1, Math.round((lo + (hi - lo) * r() * r()) * scaled(v.colSizeFar, d)));
    const heading = r() * Math.PI * 2;
    return { id: `col:${i}:${j}`, x, z, heading, speed: v.colSpeed, kinds: columnKinds(n, d, v.colHeavyFar, r, v.colBusFrom), health: 1, state: "roam", turn: 6 + r() * 10, tx: x, tz: z, lure: 0, danger: d };
  }

  private placed = 0;
  /** A column by hand (the lab's ?warband): n vehicles at (x, z) heading toward (tx, tz), hunting it. */
  place(x: number, z: number, n: number, tx: number, tz: number, danger = 0): Column {
    const r = rng(hash4(this.v.colSeed, 77, this.placed, 1));
    const c: Column = { id: `col:test:${this.placed++}`, x, z, heading: Math.atan2(tx - x, tz - z), speed: this.v.colHuntSpeed, kinds: columnKinds(n, danger, this.v.colHeavyFar, r, this.v.colBusFrom),
      health: 1, state: "hunt", turn: 10, tx, tz, lure: 600, danger };
    this.cols.push(c);
    return c;
  }

  /** Strength-relevant count. */
  static size(c: Column) { return c.kinds.length; }

  /** Salvage noise at (x, z) heard within radius: columns near it turn toward it for a while. */
  noise(x: number, z: number, radius: number) {
    const r = radius * this.v.colNoise;
    for (const c of this.cols) {
      if (c.state === "live" || c.state === "busy") continue;
      if (Math.hypot(c.x - x, c.z - z) < r) { c.state = "hunt"; c.tx = x; c.tz = z; c.lure = 40; }
    }
  }

  /** Salvage heat past its threshold: the nearest column hunts the mech. Null if none is out there. */
  pull(m: ColumnMe): Column | null {
    let best: Column | null = null, bd = Infinity;
    for (const c of this.cols) {
      if (c.state === "live" || c.state === "busy") continue;
      const d = Math.hypot(c.x - m.x, c.z - m.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.state = "hunt"; best.tx = m.x; best.tz = m.z; best.lure = 60; }
    return best;
  }

  /** A live column handed back (the player got far): survivors wander on from where they are. */
  setAbstract(c: Column, kinds: CarKind[], health: number, x: number, z: number) {
    c.kinds = kinds; c.health = health; c.x = x; c.z = z; c.state = "roam"; c.speed = this.v.colSpeed;
  }

  /** One frame: columns come into being near the player, wander, hear and hunt, and come onto the field. */
  update(dt: number, m: ColumnMe, out: ColumnEvent[] = []): ColumnEvent[] {
    out.length = 0;
    const v = this.v, C = v.colCell, R = v.colSpawn;
    // Cells near the player that have not had their column yet.
    for (let j = Math.floor((m.z - R) / C); j <= Math.floor((m.z + R) / C); j++)
      for (let i = Math.floor((m.x - R) / C); i <= Math.floor((m.x + R) / C); i++) {
        const key = i + ":" + j;
        if (this.made.has(key)) continue;
        this.made.add(key);
        const c = WarColumns.initial(v, i, j, this.start, this.danger);
        if (c && !this.avoid(c.x, c.z) && Math.hypot(c.x - m.x, c.z - m.z) <= R) this.cols.push(c); else if (c) this.made.delete(key);
      }
    for (let k = this.cols.length - 1; k >= 0; k--) {
      const c = this.cols[k];
      if (c.kinds.length === 0) { this.cols.splice(k, 1); continue; }
      if (c.state !== "live" && c.state !== "busy" && Math.hypot(c.x - m.x, c.z - m.z) > v.colDrop) this.cols.splice(k, 1);
    }
    for (const c of this.cols) {
      if (c.state === "live" || c.state === "busy") continue;
      const d = Math.hypot(m.x - c.x, m.z - c.z);
      if (c.lure > 0) { c.lure -= dt; if (c.lure <= 0 && c.state === "hunt") c.state = "roam"; }
      if (m.out && d < v.colHear * (m.loud ? v.colLoud : 1)) { c.state = "hunt"; c.tx = m.x; c.tz = m.z; c.lure = Math.max(c.lure, 4); }
      else if (c.state === "hunt" && c.lure <= 0) c.state = "roam";
      if (c.state === "hunt") { c.heading = Math.atan2(c.tx - c.x, c.tz - c.z); c.speed = v.colHuntSpeed; }
      else {
        c.speed = v.colSpeed;
        c.turn -= dt;
        if (c.turn <= 0) { c.turn = 8 + 14 * this.rand(); c.heading += (this.rand() - 0.5) * 1.6; }
      }
      const nx = c.x + Math.sin(c.heading) * c.speed * dt, nz = c.z + Math.cos(c.heading) * c.speed * dt;
      if (this.avoid(nx, nz)) { c.heading += Math.PI * (0.6 + 0.4 * this.rand()); continue; }
      c.x = nx; c.z = nz;
      if (m.out && c.state === "hunt" && Math.hypot(m.x - c.x, m.z - c.z) < v.colEngage) {
        c.state = "live";
        out.push({ type: "engage", col: c });
      }
    }
    return out;
  }
}
