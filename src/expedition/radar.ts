// The radar (pure, docs/proposal-expedition.md): what the scope shows and how far it reaches. No drawing here.
//
// Two ranges (Keith 2026-10-25):
// - the convoy radar, big (convoyRadar, about 1.5 km): used while aboard or within convoyLink of the convoy. It shows
//   POIs as icons by tier, swarm camps as heat blobs (a rough guess of danger, no counts), unknown areas as static
//   (nothing known, no estimate; POIs and camps inside them aren't shown), the route ahead, the convoy, the mech;
// - the mech radar, small (mechRadar, about 150 m): only what is in range (robots as dots, POIs near), the convoy if
//   it's that close, and the arrow home at the edge.
// Crossing the link edge zooms between them over radarZoom seconds (RadarZoom: eased in log scale, an event for the
// sound). The picture is in world offsets from the mech (x, z); the drawer turns it to screen-up.
import type { Param } from "../core/tweaks";
import type { Unknown } from "./camps";
import type { SeekTarget } from "./seekers";

export const RADAR_DEFAULTS = {
  convoyRadar: 1500,
  convoyLink: 450,
  mechRadar: 150,
  radarZoom: 1,
  radarSweep: 2.4,
  radarGlow: 0.9,
  radarSize: 240,
  blobBase: 90,
  blobGrow: 22,
  blobHot: 30,
};
export type RadarValues = typeof RADAR_DEFAULTS;

const G = "Radar";
export const RADAR_PARAMS: Param[] = [
  { key: "convoyRadar", label: "Convoy radar range (m)", min: 300, max: 5000, step: 50, group: G, tip: "How far round the convoy its radar sees (upgradeable later)" },
  { key: "convoyLink", label: "Convoy range edge (m)", min: 50, max: 3000, step: 10, group: G, tip: "Within this of the convoy the mech gets the convoy's picture; past it the scope zooms in to the mech's own" },
  { key: "mechRadar", label: "Mech radar range (m)", min: 40, max: 600, step: 5, group: G, tip: "The mech's own sensors (a sensor part later)" },
  { key: "radarZoom", label: "Zoom time (s)", min: 0.1, max: 4, step: 0.05, group: G },
  { key: "radarSweep", label: "Sweep period (s)", min: 0.5, max: 8, step: 0.1, group: G, tip: "One turn of the sweep; contacts are painted as it passes and fade until the next" },
  { key: "radarGlow", label: "Contact fade (× sweep)", min: 0.2, max: 2, step: 0.05, group: G, tip: "How long a painted contact glows, as a share of the sweep" },
  { key: "radarSize", label: "Scope size (px)", min: 120, max: 480, step: 5, group: G },
  { key: "blobBase", label: "Heat blob size (m)", min: 5, max: 200, step: 1, group: G, tip: "A swarm's heat blob on the convoy radar: this plus the growth below" },
  { key: "blobGrow", label: "Blob growth (m per √robot)", min: 0, max: 60, step: 0.5, group: G },
  { key: "blobHot", label: "Hottest at (robots)", min: 1, max: 200, step: 1, group: G, tip: "A guess this big or more shows at full heat" },
];

export type RadarMode = "convoy" | "mech";

export interface RadarWorld {
  mech: { x: number; z: number };
  /** The convoy's cars (centres) and their size (m), for the link and the drawing. */
  convoy: { x: number; z: number; length: number; width: number; heading: number }[];
  /** The route ahead, as points. */
  route: { x: number; z: number }[];
  /** The road behind and ahead, further than `route`, and the depth ring distances (m) to shade round it (empty: none). */
  band?: { x: number; z: number }[];
  rings?: number[];
  /** The return point (null aboard). */
  home: { x: number; z: number } | null;
  pois: { id: string; x: number; z: number; tier: number; kind?: string; stripped?: boolean }[];
  /** faction: 0 robots (the default), 1 raiders (bandit camps, war band columns); each has its own heat colour. */
  blobs: { id: string; x: number; z: number; guess: number; awake: boolean; faction?: number }[];
  unknown: Unknown[];
  /** Live robots (only the mech radar shows them). */
  contacts: { id: number; x: number; z: number; kind: number; faction?: number }[];
  /** Moving danger (roaming packs, raids, a blast just now): heat on both scopes, seen through unknown areas too
   *  (the ground shakes; Keith 2026-10-26: show the danger on the radar as heat). */
  heat?: { id: string; x: number; z: number; guess: number; awake: boolean; faction?: number; fighting?: boolean }[];
}

export interface Blip { id: string; x: number; z: number; kind: "poi" | "robot"; tier: number; size: number; stripped?: boolean; faction?: number }
export interface Blob { id: string; x: number; z: number; r: number; heat: number; awake: boolean; faction: number; fighting?: boolean }

export interface RadarPicture {
  mode: RadarMode;
  /** The range the content is for (m). */
  range: number;
  blips: Blip[];
  blobs: Blob[];
  fog: { x: number; z: number; r: number }[];
  route: { x: number; z: number }[];
  /** Depth rings round the road: its points offset from the mech and the ring distances, widest first. */
  band?: { pts: { x: number; z: number }[]; rings: number[] };
  convoy: { x: number; z: number; length: number; width: number; heading: number }[];
  /** The return point, offset from the mech; its distance and bearing (world radians, 0 = +Z). */
  home: { x: number; z: number; dist: number; bearing: number } | null;
  /** Where the link edge is: offset of the convoy's nearest car and the edge radius (convoy mode). */
  edge: { x: number; z: number; r: number } | null;
  /** What the active seeker points at (offset from the mech), if anything (src/expedition/seekers.ts). */
  seek?: SeekTarget | null;
}

/** Distance from the mech to the nearest car of the convoy. */
export function convoyDistance(w: RadarWorld): { d: number; i: number } {
  let d = Infinity, i = -1;
  w.convoy.forEach((c, k) => { const e = Math.hypot(c.x - w.mech.x, c.z - w.mech.z); if (e < d) { d = e; i = k; } });
  return { d, i };
}

/** Is the mech inside the convoy's range edge (aboard counts)? */
export function linked(v: RadarValues, w: RadarWorld, aboard: boolean) { return aboard || convoyDistance(w).d <= v.convoyLink; }

/** The scope's content for a mode. */
export function radarPicture(v: RadarValues, w: RadarWorld, mode: RadarMode): RadarPicture {
  const mx = w.mech.x, mz = w.mech.z;
  const range = mode === "convoy" ? v.convoyRadar : v.mechRadar;
  const R = range * 1.05;
  const near = (x: number, z: number, r = 0) => Math.hypot(x - mx, z - mz) <= R + r;
  const inFog = (x: number, z: number) => w.unknown.some((u) => Math.hypot(u.x - x, u.z - z) < u.r);
  // The convoy radar's coverage: round the convoy's nearest car.
  const cd = convoyDistance(w), cc = cd.i >= 0 ? w.convoy[cd.i] : null;
  const covered = (x: number, z: number) => !!cc && Math.hypot(x - cc.x, z - cc.z) <= v.convoyRadar;
  const pic: RadarPicture = { mode, range, blips: [], blobs: [], fog: [], route: [], convoy: [], home: null, edge: null };
  for (const c of w.convoy) if (near(c.x, c.z, c.length)) pic.convoy.push({ ...c, x: c.x - mx, z: c.z - mz });
  if (w.home) {
    const dx = w.home.x - mx, dz = w.home.z - mz;
    pic.home = { x: dx, z: dz, dist: Math.hypot(dx, dz), bearing: Math.atan2(dx, dz) };
  }
  if (mode === "convoy") {
    for (const p of w.pois) if (near(p.x, p.z) && covered(p.x, p.z) && !inFog(p.x, p.z))
      pic.blips.push({ id: p.id, x: p.x - mx, z: p.z - mz, kind: "poi", tier: p.tier, size: p.tier, stripped: p.stripped });
    for (const b of w.blobs) {
      if (!covered(b.x, b.z) || inFog(b.x, b.z)) continue;
      const r = v.blobBase + v.blobGrow * Math.sqrt(Math.max(0, b.guess));
      if (!near(b.x, b.z, r)) continue;
      pic.blobs.push({ id: b.id, x: b.x - mx, z: b.z - mz, r, heat: Math.min(1, b.guess / Math.max(1, v.blobHot)), awake: b.awake, faction: b.faction ?? 0 });
    }
    for (const u of w.unknown) if (near(u.x, u.z, u.r)) pic.fog.push({ x: u.x - mx, z: u.z - mz, r: u.r });
    for (const p of w.route) pic.route.push({ x: p.x - mx, z: p.z - mz });
    if (w.band && w.rings && w.rings.length) pic.band = { pts: w.band.map((p) => ({ x: p.x - mx, z: p.z - mz })), rings: [...w.rings].sort((a, b) => b - a) };
    if (cc) pic.edge = { x: cc.x - mx, z: cc.z - mz, r: v.convoyLink };
  } else {
    for (const p of w.pois) if (near(p.x, p.z)) pic.blips.push({ id: p.id, x: p.x - mx, z: p.z - mz, kind: "poi", tier: p.tier, size: p.tier, stripped: p.stripped });
    for (const c of w.contacts) if (near(c.x, c.z)) pic.blips.push({ id: "r" + c.id, x: c.x - mx, z: c.z - mz, kind: "robot", tier: 0, size: c.kind === 1 ? 3 : c.kind === 2 ? 2 : 1, faction: c.faction ?? 0 });
  }
  // Moving danger: sized to the scope (the blob sizes are for the convoy's); on the mech's scope, heat out to three
  // times its range glows on the rim the way it lies, fainter with distance.
  const sk = mode === "convoy" ? 1 : Math.max(0.1, (1.5 * range) / v.convoyRadar);
  for (const b of w.heat ?? []) {
    const r = (v.blobBase + v.blobGrow * Math.sqrt(Math.max(0, b.guess))) * sk;
    let x = b.x - mx, z = b.z - mz, heat = Math.min(1, b.guess / Math.max(1, v.blobHot));
    const d = Math.hypot(x, z);
    if (mode === "mech" && d > range * 0.97) {
      if (d > range * 3) continue;
      heat *= 1 - (d - range) / (range * 2.4);
      x *= (range * 0.97) / d; z *= (range * 0.97) / d;
    } else if (!near(b.x, b.z, r)) continue;
    pic.blobs.push({ id: b.id, x, z, r, heat, awake: b.awake, faction: b.faction ?? 0, fighting: b.fighting });
  }
  return pic;
}

/**
 * The zoom between the two ranges: k goes 0 (mech) to 1 (convoy) over radarZoom seconds when the link changes;
 * update() returns "out" or "in" on the frame the change starts (for the sound).
 */
export class RadarZoom {
  k: number;
  mode: RadarMode;
  constructor(public v: RadarValues, start: RadarMode = "convoy") { this.mode = start; this.k = start === "convoy" ? 1 : 0; }

  update(dt: number, link: boolean): "out" | "in" | null {
    const want: RadarMode = link ? "convoy" : "mech";
    let ev: "out" | "in" | null = null;
    if (want !== this.mode) { this.mode = want; ev = want === "convoy" ? "out" : "in"; }
    const step = dt / Math.max(0.05, this.v.radarZoom);
    this.k = want === "convoy" ? Math.min(1, this.k + step) : Math.max(0, this.k - step);
    return ev;
  }

  /** The range on show now (m): eased, in log scale between the two. */
  get range() {
    const e = this.k * this.k * (3 - 2 * this.k);
    return Math.exp(Math.log(this.v.mechRadar) + (Math.log(this.v.convoyRadar) - Math.log(this.v.mechRadar)) * e);
  }
  get zooming() { return this.k > 0 && this.k < 1; }
}
