// Running bandits for the weapons lab's range (Keith 2026-11-06: "a swarm of humans down below moving left to right,
// maybe a 100 humans or so"): a band of bandits on foot running back and forth across the range behind the mech (below
// it on screen), never shooting, for tracking and spread on small fast targets. The bandit swarm's own sim
// (src/combat/infantry.ts) in calm, hurrying mode: each runner has a lane and runs to its end, turns and runs back. The
// dead come back from the band's ends after a while. Host-owned state (targets), seeded; the drawing is cosmetic.
import type { World } from "../ecs/world";
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_PARAMS, INFANTRY_MAX, DEAD, DOWN, type InfantryValues } from "../combat/infantry";
import { InfantryDraw, BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS, CLOTH } from "../combat/infantryDraw";
import { InfantryTarget } from "../combat/infantryTarget";
import { loadBanditVat } from "../combat/banditVat";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../physics/bodies";
import type { DeathPhysics } from "../physics/deaths";
import type { TargetCandidate } from "./targeting";
import type { Ground } from "../mech/walker";

export const RUNNER_DEFAULTS = {
  runCount: 100,
  runX: 0,
  runZ: -22,
  runHalfWidth: 32,
  runDepth: 8,
  runBack: 4,
  ...INFANTRY_DEFAULTS,
  ...BANDIT_LOOK_DEFAULTS,
};
export type RunnerValues = typeof RUNNER_DEFAULTS & InfantryValues;

const G = "Running bandits";
export const RUNNER_PARAMS: Param[] = [
  { key: "runCount", label: "Runners", min: 0, max: 400, step: 10, group: G, tip: "Bandits running back and forth behind the mech; 0 takes them away" },
  { key: "runX", label: "Band centre across (m, + left)", min: -60, max: 60, step: 1, group: G },
  { key: "runZ", label: "Band distance (m, − behind the mech)", min: -30, max: 60, step: 1, group: G },
  { key: "runHalfWidth", label: "Band half-width (m)", min: 5, max: 60, step: 1, group: G, tip: "They turn round at the band's ends" },
  { key: "runDepth", label: "Band depth (m)", min: 1, max: 30, step: 0.5, group: G },
  { key: "runBack", label: "The dead come back after (s)", min: 0.5, max: 30, step: 0.5, group: G },
  ...INFANTRY_PARAMS,
  ...BANDIT_LOOK_PARAMS,
];
export const RUNNER_GROUPS = [G, "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: dodge", "Bandits: look"];

export class RangeRunners {
  readonly sw: InfantrySwarm;
  readonly target: InfantryTarget;
  draw: InfantryDraw | null = null;
  /** The way each runner is going (+1 to the band's + end, −1 back). */
  private dir = new Int8Array(INFANTRY_MAX);
  private backClock = 0;
  /** The runner the demo follows (a slot), kept while it stands. */
  private followed = -1;

  constructor(private v: RunnerValues, ground: Ground, deaths: DeathPhysics | null, seed = 11, world?: World) {
    this.sw = new InfantrySwarm(v, ground, seed, world);
    this.target = new InfantryTarget(this.sw, 2);
    const s = this.sw;
    if (deaths) {
      s.hideDead = true;
      s.onDeath = (i, nx, nz, speed) => deaths.ragdoll(BANDIT_PARTS(CLOTH[s.look[i] & 3]), BANDIT_JOINTS, s.px[i], s.py[i], s.pz[i], s.heading[i],
        { x: s.vx[i] * 0.3, y: 0, z: s.vz[i] * 0.3 }, nx, nz, speed);
    }
    this.fill(false);
  }

  /** Load the baked bandit (boxes if it fails) and hang the drawing in the scene. */
  async show(scene: THREE.Object3D) {
    const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
    this.draw = new InfantryDraw(this.sw, this.v, vat);
    scene.add(this.draw.group);
  }

  private end(d: number) { return this.v.runX + d * this.v.runHalfWidth; }

  private lane(i: number, d: number) {
    this.dir[i] = d;
    this.sw.setTarget(i, this.end(d), 0, this.sw.pz[i], 0, true);
    this.sw.hurry[i] = 1;
  }

  /** Top the band up to runCount: spread across it (atEnds false) or in from its two ends. */
  private fill(atEnds: boolean) {
    const s = this.sw, v = this.v, want = Math.round(v.runCount) - s.count;
    for (let k = 0; k < want; k++) {
      const side = s.rand() < 0.5 ? -1 : 1;
      const x = atEnds ? this.end(side) - side * s.rand() * 3 : v.runX + (s.rand() * 2 - 1) * v.runHalfWidth;
      const z = v.runZ + (s.rand() - 0.5) * v.runDepth;
      const [i] = s.spawn(1, x, z, 0);
      if (i === undefined) return;
      this.lane(i, atEnds ? -side : side);
    }
  }

  /** Take every runner off and put a fresh band down (the sliders moved). */
  rebuild() {
    for (let i = 0; i < this.sw.hi; i++) this.sw.remove(i);
    this.followed = -1;
    this.fill(false);
  }

  update(dt: number, mech: { x: number; y: number; z: number }) {
    const s = this.sw, v = this.v;
    // Too many (the slider came down): the extra go.
    let extra = s.count - Math.round(v.runCount);
    for (let i = s.hi - 1; i >= 0 && extra > 0; i--) if (s.state[i] < DEAD) { s.remove(i); extra--; }
    if (s.count < Math.round(v.runCount)) {
      this.backClock += dt;
      if (this.backClock >= v.runBack) { this.backClock = 0; this.fill(true); }
    } else this.backClock = 0;
    for (let i = 0; i < s.hi; i++) {
      if (!(s.state[i] < DEAD)) continue;
      const d = this.dir[i] || 1;
      // At the end of its lane it turns; anything that knocked it out of calm (a hit) puts it back.
      if (Math.abs(s.px[i] - this.end(d)) < 2.5) this.lane(i, -d as -1 | 1);
      else if (!s.calm[i] || !s.hasT[i]) this.lane(i, d);
    }
    s.update(dt, { x: mech.x, y: mech.y, z: mech.z, radius: 3 }, () => { /* runners never shoot */ });
  }

  /** The demo's lock: one runner, kept while it stands (the live one nearest the band's centre otherwise). */
  lock(): TargetCandidate | null {
    const s = this.sw;
    const ok = (i: number) => i >= 0 && i < s.hi && s.state[i] < DOWN;
    if (!ok(this.followed)) {
      this.followed = -1;
      let best = Infinity;
      for (let i = 0; i < s.hi; i++) {
        if (!ok(i)) continue;
        const d = Math.abs(s.px[i] - this.v.runX) + Math.abs(s.pz[i] - this.v.runZ);
        if (d < best) { best = d; this.followed = i; }
      }
    }
    const i = this.followed;
    return i < 0 ? null : { x: s.px[i], y: s.py[i] + 1, z: s.pz[i], r: 0.5, key: s.uid[i], vx: s.vx[i], vz: s.vz[i] };
  }
}
