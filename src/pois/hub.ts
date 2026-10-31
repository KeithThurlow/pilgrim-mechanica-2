// Tier 5, Siege: a robot manufacturing hub (Keith 2026-10-31, docs/proposal-fortresses.md): where the robots come
// from. A pit of machinery inside a ring of slag and wreckage with a few wide openings (no gates: the robots come and
// go), fabricator towers round a core at the centre. The towers will build robots while the hub is awake until
// they're destroyed (the glue, later); then the core is the big strip.
//
// Pure and seeded: `hubLayout` (the ring the ground reads, the fabricators) and `buildHub` (the POI site).
import type { Param } from "../core/tweaks";
import { rng, type PoiPlacement } from "../world/pois";
import type { Layout } from "./fortress";
import { SiteBuilder, type PoiSite } from "./site";

export const HUB_DEFAULTS = {
  hubWall: 60,
  hubWallH: 5,
  hubOpenings: 3,
  hubOpenW: 18,
  hubFabs: 4,
  hubFabR: 32,
  hubFabH: 14,
  hubFabValue: 70,
  hubFabTime: 5,
  hubCoreValue: 520,
  hubCoreTime: 12,
  hubClutter: 60,
};
export type HubValues = typeof HUB_DEFAULTS & { hubPad: number };

const G = "Manufacturing hub: layout", S = "Manufacturing hub: salvage";
export const HUB_PARAMS: Param[] = [
  { key: "hubPad", label: "Pad radius (m)", min: 30, max: 160, step: 1, group: G, tip: "The levelled ground it stands on; keep it past the wall", onRelease: true },
  { key: "hubWall", label: "Wall radius (m)", min: 20, max: 150, step: 1, group: G, onRelease: true },
  { key: "hubWallH", label: "Wall height (m)", min: 1, max: 14, step: 0.1, group: G, onRelease: true },
  { key: "hubOpenings", label: "Openings in the wall", min: 1, max: 8, step: 1, group: G, onRelease: true },
  { key: "hubOpenW", label: "Opening width (m)", min: 6, max: 40, step: 0.5, group: G, onRelease: true },
  { key: "hubFabs", label: "Fabricators", min: 1, max: 8, step: 1, group: G, tip: "The towers that build robots", onRelease: true },
  { key: "hubFabR", label: "Fabricators at radius (m)", min: 8, max: 120, step: 1, group: G, onRelease: true },
  { key: "hubFabH", label: "Fabricator height (m)", min: 4, max: 30, step: 0.5, group: G, onRelease: true },
  { key: "hubClutter", label: "Clutter", min: 0, max: 300, step: 1, group: G, onRelease: true },
  { key: "hubFabValue", label: "Scrap per fabricator", min: 1, max: 600, step: 1, group: S, onRelease: true },
  { key: "hubFabTime", label: "Fabricator strip time (s)", min: 0.5, max: 30, step: 0.1, group: S, onRelease: true },
  { key: "hubCoreValue", label: "Scrap in the core", min: 1, max: 4000, step: 1, group: S, onRelease: true },
  { key: "hubCoreTime", label: "Core strip time (s)", min: 1, max: 60, step: 0.5, group: S, onRelease: true },
];

export interface Fabricator { id: string; x: number; z: number; a: number }
export interface HubLayout extends Layout { fabs: Fabricator[] }

export function hubLayout(p: PoiPlacement, v: HubValues): HubLayout {
  const r = rng(p.seed ^ 0x4b0b);
  const n = Math.max(1, Math.round(v.hubOpenings)), a0 = p.yaw + r() * Math.PI * 2;
  const R = v.hubWall, top = 2.5, face = 2.2;
  const gates = Array.from({ length: n }, (_, g) => {
    const a = a0 + (g / n) * Math.PI * 2;
    return { id: `${p.id}/o${g}`, ring: 0, a, x: p.x + Math.sin(a) * R, z: p.z + Math.cos(a) * R, w: v.hubOpenW, t: 0, barred: false };
  });
  const nf = Math.max(1, Math.round(v.hubFabs)), f0 = a0 + Math.PI / n;
  const fabs = Array.from({ length: nf }, (_, i) => {
    const a = f0 + (i / nf) * Math.PI * 2;
    return { id: `${p.id}/f${i}`, a, x: p.x + Math.sin(a) * v.hubFabR, z: p.z + Math.cos(a) * v.hubFabR };
  });
  return { poi: p.id, x: p.x, z: p.z, rings: [{ r: R, h: v.hubWallH, top, face, gates }], reach: R + top + face, fabs };
}

export function buildHub(p: PoiPlacement, v: HubValues): PoiSite {
  const b = new SiteBuilder(p);
  const L = hubLayout(p, v), ring = L.rings[0];
  const at = (a: number, d: number): [number, number] => [Math.sin(a - p.yaw) * d, Math.cos(a - p.yaw) * d];
  // Slag and plating along the wall, clear of the openings.
  const n = Math.max(8, Math.floor((Math.PI * 2 * ring.r) / 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (ring.gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * ring.r < g.w / 2 + 1.5)) continue;
    const [lx, lz] = at(a, ring.r + b.jit(1));
    if (b.r() < 0.6) b.prop("box", lx, lz, ring.h - 0.8, [b.range(3, 5), b.range(1.2, 2), b.range(1.5, 2.5)], b.one(["dark", "steel", "burnt"] as const), a - p.yaw + b.jit(0.3), b.jit(0.2), b.jit(0.2));
    else b.prop("rock", lx, lz, ring.h - 1.5, [b.range(2.5, 4), b.range(1.5, 2.5), b.range(2.5, 4)], "rockDark", b.r() * 6.28);
  }
  // The fabricators' plinths and their strip spots, a section each.
  for (const f of L.fabs) {
    const [lx, lz] = at(f.a, v.hubFabR);
    const sec = b.section("fabricator");
    // The tower itself is a target, drawn apart so it can fall (src/pois/fabricators.ts, fabricatorsDraw.ts); a plinth here.
    b.prop("box", lx, lz, 0.3, [8, 0.6, 8], "steel", f.a - p.yaw, 0, 0);
    const [sx, sz] = at(f.a, v.hubFabR - 4.5);
    b.spot(sec, sx, sz, 1.5, v.hubFabValue, v.hubFabTime, "fabricator");
  }
  // The core: a squat drum in a ring of conduits.
  const core = b.section("core");
  b.prop("cyl", 0, 0, 2.5, [6, 5, 6], "steel", 0, 0, 0);
  b.prop("cyl", 0, 0, 5.4, [4.2, 0.8, 4.2], "hazard", 0, 0, 0);
  for (const f of L.fabs) {
    const [lx, lz] = at(f.a, v.hubFabR * 0.5);
    b.prop("cyl", lx, lz, 0.4, [0.5, v.hubFabR - 9, 0.5], "rust", f.a - p.yaw, Math.PI / 2, 0);
  }
  b.spot(core, 0, 6.5, 1.5, v.hubCoreValue, v.hubCoreTime, "core");
  b.debris(Math.round(v.hubClutter), 10, ring.r - 6, ["dark", "steel", "burnt", "rust"]);
  return b.done();
}
