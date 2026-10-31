// Manufacturing hubs at work (Keith 2026-10-31: "manufacturing hubs would be where a lot of those robots would come
// from"; plan docs/proposal-fortresses.md). Each hub streamed in near the mech gets its fabricators as targets
// (src/pois/fabricators.ts). While a hub is awake (the mech came close, or a fabricator was hit) every standing
// fabricator rolls out a batch of robots into the robot swarm every so often, up to a cap alive from that hub, hunting
// the mech. A fabricator shot down builds nothing more; once all are down the hub is dead for the expedition, and the
// roaming packs and raids stop leaning to its side (`bearing`, for src/expedition/threats.ts).
//
// Ownership: host (fabricator health, batches, the dead set); drawing (fabricatorsDraw) is cosmetic.
// Ids: batch groups are `<hub id>/b<n>`, fabricators `<hub id>/f<n>` (stable from the seeded layout).
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { Battlefield } from "../game/battlefield";
import { TEAM } from "../game/factions";
import type { PoiPlacement } from "../world/pois";
import { wallHeight, type SiegeWalls } from "../pois/fortressGround";
import type { HubLayout } from "../pois/hub";
import { Fabricators, FAB_DEFAULTS, FAB_PARAMS, type FabEvent, type FabState } from "../pois/fabricators";
import { FabricatorsDraw } from "../pois/fabricatorsDraw";

export const HUB_LIFE_DEFAULTS = {
  ...FAB_DEFAULTS,
  hubSpawn: 700, hubDrop: 1000, hubWake: 200, hubSleep: 450,
  hubBuildEvery: 22, hubBatch: 4, hubCap: 28, hubFirst: 6,
  hubMidShare: 0.25, hubBigShare: 0.06, hubPull: 2000,
};
export type HubLifeValues = typeof HUB_LIFE_DEFAULTS & { hubFabH: number };
const G = "Manufacturing hub: production";
export const HUB_LIFE_PARAMS: Param[] = [
  ...FAB_PARAMS,
  { key: "hubWake", label: "Wakes within (m)", min: 30, max: 800, step: 10, group: G, tip: "From the hub's centre; a hit on a fabricator wakes it too" },
  { key: "hubSleep", label: "Sleeps again past (m)", min: 100, max: 1500, step: 10, group: G },
  { key: "hubFirst", label: "First batch after (s)", min: 0, max: 60, step: 0.5, group: G },
  { key: "hubBuildEvery", label: "A batch every (s)", min: 2, max: 120, step: 1, group: G, tip: "Per standing fabricator" },
  { key: "hubBatch", label: "Robots per batch", min: 1, max: 20, step: 1, group: G },
  { key: "hubCap", label: "Robots alive from a hub, at most", min: 0, max: 200, step: 1, group: G },
  { key: "hubMidShare", label: "Cutters in a batch (share)", min: 0, max: 1, step: 0.01, group: G },
  { key: "hubBigShare", label: "Excavators in a batch (share)", min: 0, max: 1, step: 0.01, group: G },
  { key: "hubPull", label: "Packs and raids lean to a hub within (m)", min: 0, max: 6000, step: 50, group: G, tip: "0: packs and raids come from anywhere" },
  { key: "hubSpawn", label: "Hub streamed in within (m)", min: 200, max: 2000, step: 10, group: G },
  { key: "hubDrop", label: "Hub streamed out past (m)", min: 300, max: 3000, step: 10, group: G },
];

/** What the hub needs from the robot swarm (src/expedition/swarmCamps.ts). */
export interface RobotSink {
  addGroup(id: string, n: number, x: number, z: number, shares?: { mid: number; big: number }, hurt?: number, goal?: { x: number; z: number }): void;
  group(id: string): { n: number } | null;
}

export type HubEvent = FabEvent | { type: "hubWoke"; poi: string } | { type: "hubBatch"; poi: string; fab: string; n: number; x: number; z: number } | { type: "hubDead"; poi: string };

interface LiveHub { p: PoiPlacement; L: HubLayout; floor: number; fabs: FabState[]; awake: boolean; t: number[]; groups: string[]; n: number }

export class Hubs {
  readonly fabs: Fabricators;
  readonly draw: FabricatorsDraw;
  readonly live = new Map<string, LiveHub>();
  private dead = new Set<string>();
  private kept = new Map<string, number>();
  private serial = new Map<string, number>();
  onEvent: ((e: HubEvent) => void) | null = null;

  constructor(
    readonly v: HubLifeValues, private field: DuneField, bf: Battlefield, scene: THREE.Scene,
    private walls: SiegeWalls, private robots: RobotSink,
    private placements: (x0: number, z0: number, x1: number, z1: number) => PoiPlacement[],
  ) {
    this.fabs = new Fabricators(v, TEAM.robots);
    bf.targets.push(this.fabs);
    this.draw = new FabricatorsDraw(this.fabs);
    scene.add(this.draw.group);
    this.fabs.onEvent = (e) => this.fabEvent(e);
  }

  /** Dead for this expedition (every fabricator down)? */
  isDead(poi: string) { return this.dead.has(poi); }

  /** Robots alive that came out of a hub. */
  robotsFrom(poi: string) { const h = this.live.get(poi); return h ? this.count(h) : 0; }

  /** Everything forgotten (a new expedition, or the placement changed). */
  reset() {
    for (const h of [...this.live.values()]) this.despawn(h, false);
    this.dead.clear(); this.kept.clear(); this.serial.clear();
  }

  /** Bearing (the threats' `ring` angle) from (x, z) to the nearest working hub within hubPull, or undefined. */
  bearing(x: number, z: number): number | undefined {
    const R = this.v.hubPull;
    if (!(R > 0)) return undefined;
    let best = Infinity, a: number | undefined;
    for (const q of this.placements(x - R, z - R, x + R, z + R)) {
      if (q.kind !== "hub" || this.dead.has(q.id)) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < R && d < best) { best = d; a = Math.atan2(q.x - x, q.z - z); }
    }
    return a;
  }

  update(dt: number, hunting: boolean, m: { x: number; z: number }) {
    const v = this.v, R = v.hubSpawn;
    for (const q of this.placements(m.x - R, m.z - R, m.x + R, m.z + R)) {
      if (q.kind === "hub" && !this.live.has(q.id) && Math.hypot(q.x - m.x, q.z - m.z) < R) this.spawn(q);
    }
    for (const h of [...this.live.values()]) if (Math.hypot(h.L.x - m.x, h.L.z - m.z) > v.hubDrop) this.despawn(h, true);
    for (const h of this.live.values()) {
      const d = Math.hypot(h.L.x - m.x, h.L.z - m.z);
      if (!h.awake && hunting && d < v.hubWake) this.wake(h);
      if (h.awake && (!hunting || d > v.hubSleep)) h.awake = false;
      h.groups = h.groups.filter((id) => this.robots.group(id) !== null);
      if (!h.awake || this.dead.has(h.p.id)) continue;
      for (let k = 0; k < h.fabs.length; k++) {
        const s = h.fabs[k];
        if (s.down) continue;
        h.t[k] -= dt;
        if (h.t[k] > 0) continue;
        h.t[k] = v.hubBuildEvery;
        const room = Math.round(v.hubCap) - this.count(h);
        const n = Math.min(Math.round(v.hubBatch), room);
        if (n <= 0) continue;
        // Out of the fabricator's door (on its centre side), heading for the mech.
        const ox = h.L.x - s.fab.x, oz = h.L.z - s.fab.z, ol = Math.hypot(ox, oz) || 1;
        const x = s.fab.x + (ox / ol) * 8, z = s.fab.z + (oz / ol) * 8;
        const id = `${h.p.id}/b${h.n++}`;
        this.serial.set(h.p.id, h.n);
        this.robots.addGroup(id, n, x, z, { mid: v.hubMidShare, big: v.hubBigShare }, 0, { x: m.x, z: m.z });
        h.groups.push(id);
        this.onEvent?.({ type: "hubBatch", poi: h.p.id, fab: s.fab.id, n, x, z });
      }
    }
    this.draw.update();
  }

  private count(h: LiveHub) { let n = 0; for (const id of h.groups) n += this.robots.group(id)?.n ?? 0; return n; }

  private wake(h: LiveHub) {
    h.awake = true;
    this.onEvent?.({ type: "hubWoke", poi: h.p.id });
  }

  private fabEvent(e: FabEvent) {
    const h = this.live.get(e.poi);
    if (h && !h.awake) this.wake(h);
    if (e.type === "fabDown" && h && h.fabs.every((s) => s.down) && !this.dead.has(e.poi)) {
      this.onEvent?.(e);
      this.dead.add(e.poi);
      this.onEvent?.({ type: "hubDead", poi: e.poi });
      return;
    }
    this.onEvent?.(e);
  }

  private spawn(p: PoiPlacement) {
    const L = this.walls.layout(p) as HubLayout;
    if (!L.fabs) return;
    const floor = this.field.height(p.x, p.z) - wallHeight(L, p.x, p.z, this.walls.down);
    const h: LiveHub = { p, L, floor, fabs: [], awake: false, t: [], groups: [], n: this.serial.get(p.id) ?? 0 };
    for (const f of L.fabs) {
      h.fabs.push(this.fabs.add(p.id, f, floor, this.kept.get(f.id)));
      h.t.push(this.v.hubFirst + h.t.length * 1.5);
    }
    this.live.set(p.id, h);
  }

  private despawn(h: LiveHub, keep: boolean) {
    if (keep) for (const s of h.fabs) this.kept.set(s.fab.id, s.hp);
    this.fabs.removePoi(h.p.id);
    this.live.delete(h.p.id);
  }
}
