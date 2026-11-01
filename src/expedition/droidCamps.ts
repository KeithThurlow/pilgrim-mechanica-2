// Humanoid robots in the expedition (glue; Keith 2026-11-01): every robot camp, roaming pack and raid on the field
// (src/expedition/swarmCamps.ts) brings a humanoid squad with it (src/game/droidFight.ts: troopers, lancers, brutes),
// sized as a share of its robots. The squad sleeps and wakes with its camp (shooting one wakes the camp), gives up with
// it, and streams out with it, remembering how many are left. When its camp's robots are all gone the squad fights on
// while the mech is near, then is taken off past the give-up range.
// Ownership: host (squads, damage).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { DuneField } from "../world/terrain";
import type { BanditVatData } from "../combat/banditVat";
import type { DroidAllValues } from "../combat/droids";
import { DroidSquads, type DroidMember } from "../game/droidFight";
import { DEAD } from "../combat/infantry";
import type { SwarmCamps, SwarmCampValues } from "./swarmCamps";
import type { Prey } from "../pilot/quarry";
import type { KeepOut } from "../game/keepOut";
import { hash4 } from "../world/pois";

export const DROID_CAMP_DEFAULTS = { droidCampShare: 0, droidPackShare: 0, droidCampMax: 8, droidCampMin: 1 };
export type DroidCampValues = typeof DROID_CAMP_DEFAULTS;
const G = "Humanoid robots: in the field";
export const DROID_CAMP_GROUP = G;
export const DROID_CAMP_PARAMS: Param[] = [
  { key: "droidCampShare", label: "Squad per camp (× its robots)", min: 0, max: 1, step: 0.01, group: G, tip: "A camp of 20 robots brings 4 humanoids at 0.2" },
  { key: "droidPackShare", label: "Squad per pack or raid (× its robots)", min: 0, max: 1, step: 0.01, group: G },
  { key: "droidCampMin", label: "At least (per group)", min: 0, max: 10, step: 1, group: G },
  { key: "droidCampMax", label: "At most (per group)", min: 0, max: 40, step: 1, group: G },
];

interface Squad { members: DroidMember[]; awake: boolean; hp: number; x: number; z: number; orphan: boolean; spawned: boolean }

export class DroidCamps {
  readonly squads: DroidSquads;
  private live = new Map<string, Squad>();
  private left = new Map<string, number>();
  private seen = new Set<string>();

  constructor(private v: DroidAllValues & DroidCampValues & SwarmCampValues, bf: Battlefield, scene: THREE.Scene, field: DuneField, vat: BanditVatData | null, private swarms: SwarmCamps) {
    this.squads = new DroidSquads(bf, scene, v, field, vat, null, false);
  }

  get count() { return this.squads.count; }
  set keepOut(k: KeepOut | null) { for (const f of this.squads.fights) f.sw.keepOut = k; }

  reset() {
    for (const s of this.live.values()) for (const m of s.members) this.squads.remove(m);
    this.live.clear(); this.left.clear();
  }

  /** Mech radar contacts (as the robot camps', faction robots). */
  contacts(x: number, z: number, r: number, out: { id: number; x: number; z: number; kind: number }[]) {
    this.squads.fights.forEach((f, k) => {
      const sw = f.sw;
      for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DEAD && Math.hypot(sw.px[i] - x, sw.pz[i] - z) < r) out.push({ id: 3e9 + k * 1e6 + sw.uid[i], x: sw.px[i], z: sw.pz[i], kind: 2 });
    });
  }

  /** One frame, after the swarm camps' (so their wake and calm are this frame's). p: the mech. */
  update(dt: number, hunting: boolean, p: { x: number; z: number }, prey: Prey) {
    const v = this.v, sq = this.squads;
    this.seen.clear();
    this.swarms.eachLive((id, x, z, n, awake, roam, radius) => {
      this.seen.add(id);
      let s = this.live.get(id);
      if (!s) {
        const share = roam ? v.droidPackShare : v.droidCampShare;
        const want = this.left.get(id) ?? Math.min(v.droidCampMax, Math.max(v.droidCampMin, Math.round(n * share)));
        if (want <= 0 || share <= 0) { this.live.set(id, { members: [], awake, hp: 0, x, z, orphan: false, spawned: false }); return; }
        const seed = (hash4(id.length, id.charCodeAt(0) | 0, id.charCodeAt(id.length - 1) | 0, n) >>> 0) / 4294967296;
        const a = seed * Math.PI * 2, off = radius * 0.6 + 6;
        s = { members: sq.spawn(want, x + Math.sin(a) * off, z + Math.cos(a) * off, seed), awake, hp: 0, x, z, orphan: false, spawned: true };
        s.hp = this.hp(s);
        this.live.set(id, s);
      }
      s.x = x; s.z = z;
      // Hit while its camp sleeps: the camp wakes.
      const hp = this.hp(s);
      if (!awake && hp < s.hp - 1e-3) { this.swarms.wake(id); awake = true; }
      s.hp = hp; s.awake = awake;
    });
    for (const [id, s] of this.live) {
      s.members = s.members.filter((m) => sq.alive(m));
      if (!this.seen.has(id)) {
        // Its camp left the field: streamed out (gone far) or all its robots dead. Fight on while the mech is near.
        const c = this.middle(s);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (s.members.length && s.awake && hunting && d < v.campGiveUp) { s.orphan = true; }
        else {
          if (s.spawned) this.left.set(id, s.members.length);
          for (const m of s.members) sq.remove(m);
          this.live.delete(id);
          continue;
        }
      }
      for (const m of s.members) {
        const sw = sq.fights[m.f].sw;
        sw.frozen[m.i] = s.awake ? 0 : sw.diveT[m.i] > 0 ? 0 : 1;
      }
    }
    sq.update(dt, prey);
  }

  private hp(s: Squad) { let h = 0; for (const m of s.members) if (this.squads.alive(m)) h += this.squads.fights[m.f].sw.hp[m.i]; return h; }
  private middle(s: Squad) {
    let x = 0, z = 0, n = 0;
    for (const m of s.members) { const sw = this.squads.fights[m.f].sw; x += sw.px[m.i]; z += sw.pz[m.i]; n++; }
    return n ? { x: x / n, z: z / n } : { x: s.x, z: s.z };
  }
}
