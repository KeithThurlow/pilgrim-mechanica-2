// Striders in the expedition (glue; Keith 2026-11-01: "good enough to get put into the robot lab" once they can be
// hit): a big enough robot camp, roaming pack or raid on the field (src/expedition/swarmCamps.ts) brings striders with
// it, one per striderCampEvery (camps) or striderPackEvery (packs and raids) robots, up to striderCampMax. They sleep
// and wake with their group (shooting one wakes it), stream out with it, remembering how many are left, and fight on
// while the mech is near once their group's robots are all gone. As src/expedition/droidCamps.ts.
// Ownership: host (striders, damage).
import type { DeathPhysics } from "../physics/deaths";
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { DuneField } from "../world/terrain";
import type { Prey } from "../pilot/quarry";
import { STRIDER_DEFAULTS, STRIDER_PARAMS, type Strider } from "../combat/strider";
import { ROBOT_TEAR_DEFAULTS } from "../combat/robotTearFx";
import { StriderField, type StriderFieldValues } from "../combat/striderField";
import type { SwarmCamps, SwarmCampValues } from "./swarmCamps";
import { hash4 } from "../world/pois";

export const STRIDER_CAMP_DEFAULTS = { ...STRIDER_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, striderBeamReach: 5, stridersOn: 1, striderCampEvery: 30, striderPackEvery: 45, striderCampMax: 1 };
export type StriderCampValues = typeof STRIDER_CAMP_DEFAULTS;
const G = "Striders: in the field";
export const STRIDER_CAMP_GROUP = G;
export const STRIDER_CAMP_PARAMS: Param[] = [
  { key: "stridersOn", label: "Striders in the field (0 off, 1 on)", min: 0, max: 1, step: 1, group: G },
  { key: "striderCampEvery", label: "A camp brings one per (robots)", min: 1, max: 100, step: 1, group: G, tip: "A camp of 18-35 robots brings one strider at 18, 36+ two (up to the most)" },
  { key: "striderPackEvery", label: "A pack or raid brings one per (robots)", min: 1, max: 150, step: 1, group: G },
  { key: "striderCampMax", label: "At most (per group)", min: 0, max: 6, step: 1, group: G },
  { key: "striderBeamReach", label: "Beam burns up to (m above ground)", min: 1, max: 15, step: 0.5, group: "Striders: beam" },
  ...STRIDER_PARAMS,
];
export const STRIDER_CAMP_TOPIC = { id: "striders", label: "Striders", groups: [G, "Striders", "Striders: beam", "Striders: slam", "Striders: tearing"] };

interface Group { members: Strider[]; awake: boolean; hp: number; spawned: boolean }

export class StriderCamps {
  readonly sf: StriderField;
  private live = new Map<string, Group>();
  private left = new Map<string, number>();
  private seen = new Set<string>();

  constructor(private v: StriderFieldValues & StriderCampValues & SwarmCampValues, bf: Battlefield, scene: THREE.Scene, field: DuneField, mech: MechUnit, private swarms: SwarmCamps, shake?: (k: number) => void, deaths: DeathPhysics | null = null) {
    this.sf = new StriderField(v, bf, scene, field, mech, deaths, shake, 7, false);
  }

  get count() { return this.sf.pack.alive; }

  reset() {
    for (const g of this.live.values()) for (const s of g.members) this.sf.remove(s);
    this.live.clear(); this.left.clear();
  }

  /** Mech radar contacts (big robots). */
  contacts(x: number, z: number, r: number, out: { id: number; x: number; z: number; kind: number }[]) {
    for (const s of this.sf.pack.list) { if (!s.alive) continue; const p = s.pos(); if (Math.hypot(p.x - x, p.z - z) < r) out.push({ id: 4e9 + s.id, x: p.x, z: p.z, kind: 2 }); }
  }

  /** Awake striders within r of (x, z), as points (the convoy's turrets track them). */
  threats(x: number, z: number, r: number, out: THREE.Vector3[], max = 24) {
    for (const s of this.sf.pack.list) {
      if (!s.alive || s.frozen || out.length >= max) continue;
      const p = s.pos();
      if (Math.hypot(p.x - x, p.z - z) <= r) out.push(new THREE.Vector3(p.x, s.up(5).y, p.z));
    }
    return out;
  }

  /** One frame, after the swarm camps' (so their wake and calm are this frame's). p: the mech. */
  update(dt: number, hunting: boolean, p: { x: number; z: number }, prey: Prey) {
    const v = this.v;
    if (v.stridersOn < 0.5) { if (this.live.size) this.reset(); return; }
    this.seen.clear();
    this.swarms.eachLive((id, x, z, n, awake, roam, radius) => {
      this.seen.add(id);
      let g = this.live.get(id);
      if (!g) {
        const every = Math.max(1, roam ? v.striderPackEvery : v.striderCampEvery);
        const want = this.left.get(id) ?? Math.min(v.striderCampMax, Math.floor(n / every));
        g = { members: [], awake, hp: 0, spawned: want > 0 };
        const seed = (hash4(id.length, id.charCodeAt(0) | 0, id.charCodeAt(id.length - 1) | 0, n + 17) >>> 0) / 4294967296;
        for (let k = 0; k < want; k++) {
          const a = (seed + k / Math.max(1, want)) * Math.PI * 2, off = radius * 0.7 + 12;
          const sx = x + Math.sin(a) * off, sz = z + Math.cos(a) * off;
          g.members.push(this.sf.spawn(sx, sz, Math.atan2(x - sx, z - sz)));
        }
        g.hp = this.hp(g);
        this.live.set(id, g);
      }
      // Hit while its group sleeps: the group wakes.
      const hp = this.hp(g);
      if (!awake && hp < g.hp - 1e-3) { this.swarms.wake(id); awake = true; }
      g.hp = hp; g.awake = awake;
    });
    for (const [id, g] of this.live) {
      g.members = g.members.filter((s) => s.alive);
      if (!this.seen.has(id)) {
        // Its group left the field (streamed out, or all its robots dead): fight on while the mech is near.
        const d = g.members.length ? Math.min(...g.members.map((s) => { const q = s.pos(); return Math.hypot(q.x - p.x, q.z - p.z); })) : Infinity;
        if (!(g.members.length && g.awake && hunting && d < v.campGiveUp)) {
          if (g.spawned) this.left.set(id, g.members.length);
          for (const s of g.members) this.sf.remove(s);
          this.live.delete(id);
          continue;
        }
      }
      for (const s of g.members) s.frozen = !g.awake;
    }
    this.sf.update(dt, hunting ? prey : null);
  }

  private hp(g: Group) { let h = 0; for (const s of g.members) if (s.alive) h += s.health; return h; }
}
