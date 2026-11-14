// The convoy's guardian mechs (Keith 2026-11-01: "some mechs that are particularly lethal defending the Convoy";
// Keith 2026-11-06: more mechs than vehicles beside the convoy, vehicles read as bandits: 6 by default, was 2).
// Glue: Ramparts in the convoy's paint on the player's side, each holding a station beside a car (alternating sides,
// spread along the train) at the convoy's pace, turning on the nearest threat within guardRange: its guns on it, and
// stepping out toward it (to guardHold off) but never more than guardLeash from its station. Hit points, armour and
// a damage multiplier on their miniguns make them lethal; they walk round the cars (detour.ts), never through; one that's destroyed walks back out of the convoy after
// guardRespawn. Their bodies load in the background (one at a time) the first time they are wanted.
// Ownership: host (their health and brains; enemies' rounds can hit them). Not networked yet.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import { MechUnit, type MechUnitValues } from "../game/mechUnit";
import { TEAM } from "../game/factions";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import type { Convoy } from "./platform";
import { FRIENDLY } from "./platformBody";
import { detour } from "./detour";

export const GUARDIAN_DEFAULTS = {
  guardMechs: 6,
  guardHull: 6000,
  guardArmour: 16,
  guardDamage: 2.5,
  guardOut: 16,
  guardRange: 80,
  guardHold: 22,
  guardLeash: 45,
  guardRespawn: 40,
  /** Perf 2026-11-07: steps a second for a guardian off the screen (its legs, torso and guns; 120 on screen). */
  guardHz: 120,
  guardLodHz: 60,
};
export type GuardianValues = typeof GUARDIAN_DEFAULTS;

const G = "Guardian mechs";
export const GUARDIAN_PARAMS: Param[] = [
  { key: "guardMechs", label: "Guardian mechs", min: 0, max: 8, step: 1, group: G, tip: "Ramparts in the convoy's paint walking beside the cars" },
  { key: "guardHull", label: "Hit points", min: 100, max: 30000, step: 100, group: G },
  { key: "guardArmour", label: "Armour", min: 0, max: 60, step: 0.5, group: G },
  { key: "guardDamage", label: "Damage ×", min: 0, max: 10, step: 0.1, group: G, tip: "On their miniguns' rounds (the shared minigun sliders)" },
  { key: "guardOut", label: "Station out (m)", min: 10, max: 40, step: 0.5, group: G, tip: "How far from a car's middle line it walks" },
  { key: "guardRange", label: "Engage within (m)", min: 10, max: 200, step: 5, group: G },
  { key: "guardHold", label: "Holds off a target (m)", min: 5, max: 60, step: 1, group: G },
  { key: "guardLeash", label: "Leash from station (m)", min: 0, max: 150, step: 5, group: G, tip: "Never further than this from its station, whatever it is chasing" },
  { key: "guardRespawn", label: "Back out after (s)", min: 3, max: 300, step: 1, group: G, tip: "A destroyed guardian walks back out of the convoy this long after" },
  { key: "guardHz", label: "Steps a second on the screen", min: 30, max: 120, step: 30, group: G, tip: "A guardian's legs, torso and guns step this often (yours: 120). It is drawn between ticks either way, and walks the same line at 30 (walker probe 2026-11-14: same cadence, same place after 40 s); phones use 30" },
  { key: "guardLodHz", label: "Steps a second off the screen", min: 15, max: 120, step: 15, group: G, tip: "Perf 2026-11-07: a guardian off the screen steps its legs, torso and guns this often (120 on screen, the same as yours)" },
];
export const GUARDIAN_GROUPS = [G];

/** Push-out radius round a guardian against the cars (as the lab does for the player's mech). */
const PUSH_R = 2.2;

interface Guardian { unit: MechUnit; body: RampartBody; on: boolean; sx: number; sz: number; svx: number; svz: number; target: THREE.Vector3 | null; acc?: number }

export class Guardians {
  readonly list: Guardian[] = [];
  /** Where each one on the field stands (escorts keep clear of them). */
  readonly spots: { x: number; z: number }[] = [];
  private loading = false;
  private aim = { x: 0, y: 0, z: 0 };
  private via = { x: 0, z: 0 };

  constructor(private bf: Battlefield, readonly v: MechUnitValues & GuardianValues, private scene: THREE.Scene, private look: ToonLook,
    readonly convoy: Convoy, private load: () => Promise<RampartBody>) {}

  /** Live ones on the field. */
  units(): MechUnit[] { return this.list.filter((g) => g.on).map((g) => g.unit); }

  /** Station k: a car (spread along the train) and a side. */
  private station(k: number, out: { x: number; z: number }) {
    const ps = this.convoy.platforms, n = ps.length;
    const want = Math.max(1, Math.round(this.v.guardMechs));
    const pair = Math.floor(k / 2), pairs = Math.ceil(want / 2);
    const idx = Math.min(n - 1, Math.round(((pair + 0.5) / pairs) * (n - 1)));
    const p = ps[idx], side = k % 2 === 0 ? 1 : -1;
    out.x = p.x + p.left.x * side * this.v.guardOut;
    out.z = p.z + p.left.z * side * this.v.guardOut;
    return out;
  }

  private async add() {
    this.loading = true;
    try {
      const body = await this.load();
      this.scene.add(body.root);
      const k = this.list.length;
      const unit = new MechUnit(this.bf, this.v, body, this.look, TEAM.player, 30 + k * 2, false);
      unit.uid = `guardian:${k}`;
      unit.ally = true;
      unit.paint = FRIENDLY;
      const s = this.station(k, { x: 0, z: 0 });
      const g: Guardian = { unit, body, on: false, sx: s.x, sz: s.z, svx: 0, svz: 0, target: null };
      this.list.push(g);
      this.place(g, k);
    } catch (e) { console.warn("guardian body not loaded:", e); this.v.guardMechs = this.list.length; }
    this.loading = false;
  }

  /** Put guardian k down at its station, whole. */
  private place(g: Guardian, k: number) {
    const u = g.unit, v = this.v;
    u.hullOverride = v.guardHull; u.armourOverride = v.guardArmour; u.damageScale = v.guardDamage;
    const s = this.station(k, { x: 0, z: 0 });
    u.reset(s.x, s.z, this.convoy.platforms[0].heading);
    u.upper.resupply();
    g.sx = s.x; g.sz = s.z; g.svx = 0; g.svz = 0;
    g.body.root.visible = true;
    g.on = true;
    if (!this.bf.targets.includes(u)) this.bf.targets.push(u);
  }

  private off(g: Guardian) {
    g.on = false;
    g.unit.goCold();
    g.body.root.visible = false;
    const i = this.bf.targets.indexOf(g.unit);
    if (i >= 0) this.bf.targets.splice(i, 1);
  }

  /** Back to their stations, whole (the lab starting over). */
  reset() { this.list.forEach((g, k) => { if (k < Math.round(this.v.guardMechs)) this.place(g, k); }); }

  update(dt: number, threats: readonly THREE.Vector3[]) {
    const v = this.v, want = Math.max(0, Math.min(8, Math.round(v.guardMechs)));
    if (this.list.length < want && !this.loading) void this.add();
    const st = { x: 0, z: 0 };
    this.spots.length = 0;
    this.list.forEach((g, k) => {
      if (k >= want) { if (g.on) this.off(g); return; }
      if (!g.on) this.place(g, k);
      const u = g.unit;
      // Off the screen it steps its legs and guns at a lower rate (nobody sees the gait): one step of 1/guardLodHz s
      // once that much time has gone by.
      const pp = u.sim.pos, hz = this.bf.view.sees(pp.x, pp.y + 2, pp.z, 7) ? Math.max(30, Math.min(120, v.guardHz)) : Math.max(15, Math.min(120, v.guardLodHz));
      u.subHz = hz;
      g.acc = (g.acc ?? 0) + dt;
      const due = hz >= 120 || g.acc >= 1 / hz - 1e-6, sdt = g.acc;
      if (due) g.acc = 0;
      u.hullOverride = v.guardHull; u.armourOverride = v.guardArmour; u.damageScale = v.guardDamage;
      // Its station and how fast it moves (the convoy's pace).
      this.station(k, st);
      if (dt > 0) { g.svx += ((st.x - g.sx) / dt - g.svx) * Math.min(1, dt * 4); g.svz += ((st.z - g.sz) / dt - g.svz) * Math.min(1, dt * 4); }
      g.sx = st.x; g.sz = st.z;
      if (!u.alive) {
        if (due) u.step(sdt, { x: 0, z: 0, sprint: false }, null, false);
        if (u.deadFor > v.guardRespawn) this.place(g, k);
        return;
      }
      if (!due) { this.spots.push({ x: u.sim.pos.x, z: u.sim.pos.z }); return; }
      const p = u.sim.pelvis;
      // The nearest threat in reach.
      let best: THREE.Vector3 | null = null, bd = v.guardRange;
      for (const q of threats) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }
      g.target = best;
      // Where to stand: its station, or out toward the target to holding range, leashed to the station.
      let gx = st.x, gz = st.z;
      if (best) {
        const dx = best.x - p.x, dz = best.z - p.z, d = Math.hypot(dx, dz) || 1;
        gx = best.x - (dx / d) * v.guardHold; gz = best.z - (dz / d) * v.guardHold;
        const lx = gx - st.x, lz = gz - st.z, l = Math.hypot(lx, lz);
        if (l > v.guardLeash) { gx = st.x + (lx / l) * v.guardLeash; gz = st.z + (lz / l) * v.guardLeash; }
      }
      // Round the cars, not through them: make for the corner of the one in the way (then through the gap).
      const round = detour(this.convoy.platforms, p.x, p.z, gx, gz, PUSH_R, this.via);
      // A stick toward it (full stride round a corner), plus the convoy's pace so it keeps up on station.
      const walk = Math.max(1, v.walkSpeed);
      const dx = this.via.x - p.x, dz = this.via.z - p.z, kk = round ? 1 / Math.max(1e-6, Math.hypot(dx, dz)) : 1 / 6;
      let mx = dx * kk + g.svx / walk, mz = dz * kk + g.svz / walk;
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      if (ml < 0.04) { mx = 0; mz = 0; }
      const aim = best ? (this.aim.x = best.x, this.aim.y = best.y, this.aim.z = best.z, this.aim) : null;
      u.step(sdt, { x: mx, z: mz, sprint: false }, aim, !!best && bd < v.range + 4);
      // Never inside a car or the plough.
      for (const c of this.convoy.platforms) { const o = c.pushOut(u.sim.pos.x, u.sim.pos.z, PUSH_R); if (o) { u.sim.pos.x = o.x; u.sim.pos.z = o.z; } }
      const o = this.convoy.plough.pushOut(u.sim.pos.x, u.sim.pos.z, PUSH_R);
      if (o) { u.sim.pos.x = o.x; u.sim.pos.z = o.z; }
      this.spots.push({ x: u.sim.pos.x, z: u.sim.pos.z });
    });
  }

  /** Their meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.list.filter((g) => g.on).map((g) => g.body.root); }
}
