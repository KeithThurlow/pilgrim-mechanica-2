// The stress lab's worst case (Keith 2026-10-26: 4-player co-op, each weapon with 3-6x today's effects, Protocols that
// split, multiply, speed up, widen, ricochet and chain; "the performance thresholds scale significantly from here").
// For measuring only, not a design: three more Ramparts on the player's team, AI-driven (slow loops round the player,
// both miniguns on the nearest enemy, always firing), and every team-1 round passed through max-Protocol stand-ins:
//   split x3 (two more rounds fanned out), fire rate x2 (each round again), area x1.5 (splash on every round, blasts
//   wider), ricochet (one bounce off what it hit), chain (three hops to the nearest enemies from what it hit).
// The stand-ins wrap this lab's own Battlefield.fire; nothing outside the lab changes. Effects are multiplied by
// scaling the effect-count sliders (dust sources, sparks, grit, smoke) by stressFx.
// URL: ?worst (on from the start), plus the usual ?run, ?norender, ?dt=0.033.
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import type { CombatLab } from "../../src/game/combatLab";
import type { TargetCandidate } from "../../src/game/targeting";
import type { Battlefield, FireOptions, Hittable } from "../../src/game/battlefield";
import { MechUnit } from "../../src/game/mechUnit";

export const WORST_DEFAULTS = {
  stressWorst: 0,
  stressAllies: 3,
  stressFx: 4,
  stressSplit: 3,
  stressRate: 2,
  stressArea: 1.5,
  stressRicochet: 1,
  stressChain: 3,
};
const G = "Stress worst case";
export const WORST_PARAMS: Param[] = [
  { key: "stressWorst", label: "Worst case on (0/1)", min: 0, max: 1, step: 1, group: G, tip: "Four player mechs with max-Protocol stand-ins and multiplied effects (Keith 2026-10-26: the co-op scale). Read it with Run" },
  { key: "stressAllies", label: "Allied mechs (AI)", min: 0, max: 3, step: 1, group: G, tip: "Besides yours: the other three players" },
  { key: "stressFx", label: "Effects ×", min: 1, max: 6, step: 0.5, group: G, tip: "Multiplies the effect counts (dust from steps and hits, plumes, spray, sparks, grit, smoke)" },
  { key: "stressSplit", label: "Protocol: split into", min: 1, max: 5, step: 1, group: G, tip: "Each round fans out into this many" },
  { key: "stressRate", label: "Protocol: fire rate ×", min: 1, max: 3, step: 1, group: G, tip: "Each round fires this many times" },
  { key: "stressArea", label: "Protocol: area ×", min: 1, max: 3, step: 0.1, group: G, tip: "Splash on every round, and the barrage's blasts, this much wider" },
  { key: "stressRicochet", label: "Protocol: ricochets", min: 0, max: 3, step: 1, group: G },
  { key: "stressChain", label: "Protocol: chains to", min: 0, max: 6, step: 1, group: G, tip: "Hops from a struck enemy to the nearest others" },
];
export type WorstValues = typeof WORST_DEFAULTS;

/** The effect-count sliders multiplied by stressFx (dust, minigun hits). */
const FX_KEYS = ["stompCloud", "stompClump", "kickCloud", "kickClump", "hitCloud", "hitClump", "plumePuffs", "sprayCount", "wheelDust", "wheelClump", "sandGrit", "metalSparks", "metalSmoke"];

type Lab = CombatLab<WorstValues & Record<string, number>>;

export class WorstCase {
  readonly allies: MechUnit[] = [];
  /** Rounds through Battlefield.fire since the last take(), by kind (for the HUD and the run's counts); shots: the guns' own. */
  private acc = { shots: 0, allyShots: 0, rounds: 0, ricochets: 0, chains: 0 };
  /** The last frame's counts (set by take()). */
  count = { shots: 0, allyShots: 0, rounds: 0, ricochets: 0, chains: 0 };
  /** Once a frame, after the whole tick: this frame's counts. */
  take() { this.count = this.acc; this.acc = { shots: 0, allyShots: 0, rounds: 0, ricochets: 0, chains: 0 }; return this.count; }
  private base: Record<string, number> = {};
  private fxOn = 1;
  private orig: Battlefield["fire"];
  private cands: TargetCandidate[] = [];
  private candsFrame = -1;
  private frame = 0;
  private hitAt: THREE.Vector3;
  private o = new THREE.Vector3(); private d = new THREE.Vector3(); private t = new THREE.Vector3();
  private slot = 2;

  constructor(private lab: Lab) {
    const bf = lab.bf;
    this.orig = bf.fire.bind(bf);
    // The round's end point: Battlefield keeps it in a private vector between calls (read just after each fire).
    this.hitAt = (bf as unknown as { hit: THREE.Vector3 }).hit;
    for (const k of FX_KEYS) if (k in lab.V) this.base[k] = lab.V[k];
    bf.fire = (slot, team, muzzle, dir, range, damage, o = {}) => this.fire(slot, team, muzzle, dir, range, damage, o);
  }

  get on() { return this.lab.V.stressWorst > 0.5; }

  /** Load the allied Ramparts (blue). */
  async load() {
    const { V, bf, toon } = this.lab;
    for (let i = 0; i < 3; i++) {
      const b = await this.lab.loadRampart();
      const m = new MechUnit(bf, V as never, b, toon, 1, 30 + i * 2, false);
      m.paint = 0x4a78c4; b.paint(toon, 0x4a78c4);
      m.reset(8 * Math.sin(i * 2.1), 8 * Math.cos(i * 2.1), 0);
      this.allies.push(m);
      bf.targets.push(m);
    }
  }

  /** The candidates once per frame (the chain and the allies' aim read them). */
  private targets(): TargetCandidate[] {
    if (this.candsFrame !== this.frame) { this.cands = this.lab.targets(); this.candsFrame = this.frame; }
    return this.cands;
  }

  /** Each frame before the enemies: effect sliders, the allies' moves and fire. */
  update(dt: number, clock: number) {
    this.frame++;
    const V = this.lab.V, on = this.on;
    const fx = on ? V.stressFx : 1;
    if (fx !== this.fxOn) { for (const k in this.base) V[k] = this.base[k] * fx; this.fxOn = fx; }
    const n = on ? Math.round(V.stressAllies) : 0;
    const p0 = this.lab.player.sim.pos;
    this.allies.forEach((m, i) => {
      const active = i < n;
      m.body.root.visible = active;
      m.alive = active ? m.alive : false;
      if (!active) return;
      if (!m.alive) { m.reset(p0.x + 10 * Math.sin(i * 2.1), p0.z + 10 * Math.cos(i * 2.1), 0); m.alive = true; }
      m.health = m.maxHealth;
      // Slow loops round a point near the player, offset per ally.
      const a = clock * 0.12 + i * 2.1, home = this.t.set(p0.x + 14 * Math.sin(i * 2.1 + 0.5), 0, p0.z + 14 * Math.cos(i * 2.1 + 0.5));
      const p = m.sim.pos;
      let cx = Math.sin(a) + (home.x - p.x) * 0.05, cz = Math.cos(a) + (home.z - p.z) * 0.05;
      const l = Math.hypot(cx, cz); if (l > 1) { cx /= l; cz /= l; }
      let e: TargetCandidate | null = null, bd = Infinity;
      for (const c of this.targets()) { const dd = (c.x - p.x) ** 2 + (c.z - p.z) ** 2; if (dd < bd) { bd = dd; e = c; } }
      const aim = e ? { x: e.x, y: e.y, z: e.z } : null;
      m.step(dt, { x: cx, z: cz, sprint: false }, aim, aim ? true : false);
      if (m.upper.guns[0].ammo < 100) m.upper.resupply();
    });
  }

  /** Every round: through the Protocol stand-ins for team 1 when on, else straight through. */
  private fire(slot: number, team: number, muzzle: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, o: FireOptions): Hittable | null {
    if (!this.on || team !== 1) return this.orig(slot, team, muzzle, dir, range, damage, o);
    const V = this.lab.V;
    this.acc.shots++;
    if (slot >= 30) this.acc.allyShots++; // the allies' flash slots
    const area = V.stressArea, opts: FireOptions = { ...o, splash: (o.splash || 0.6) * area, splashShare: o.splashShare || 0.4 };
    const split = Math.max(1, Math.round(V.stressSplit)), rate = Math.max(1, Math.round(V.stressRate));
    let first: Hittable | null = null;
    for (let r = 0; r < rate; r++) for (let s = 0; s < split; s++) {
      // Fan the split rounds across the aim (6 degrees apart); a second shot of the rate a little off the first.
      const yaw = (s - (split - 1) / 2) * 0.105 + (r > 0 ? (Math.random() - 0.5) * 0.05 : 0);
      const d = this.d.copy(dir).applyAxisAngle(UP, yaw);
      const struck = this.round(slot, team, muzzle, d, range, damage, r === 0 && s === 0 ? opts : { ...opts, eject: undefined, voice: "none" });
      if (r === 0 && s === 0) first = struck;
    }
    return first;
  }

  /** One round, then its ricochets and chain hops from where it ended. */
  private round(slot: number, team: number, muzzle: THREE.Vector3, d: THREE.Vector3, range: number, damage: number, o: FireOptions): Hittable | null {
    const V = this.lab.V;
    this.acc.rounds++;
    const struck = this.orig(slot, team, muzzle, d, range, damage, o);
    const o2: FireOptions = { ...o, eject: undefined, voice: "none", flashScale: 0 };
    // Ricochet: off the ground (or the body) up and on, at half damage.
    let from = this.o.copy(this.hitAt), dd = this.t.copy(d);
    for (let k = 0; k < Math.round(V.stressRicochet); k++) {
      dd.y = Math.abs(dd.y) * 0.6 + 0.05; dd.applyAxisAngle(UP, (Math.random() - 0.5) * 0.8).normalize();
      from.addScaledVector(dd, 0.3);
      this.acc.ricochets++;
      this.orig(this.nextSlot(), team, from, dd, 25, damage * 0.5, o2);
      from = this.o.copy(this.hitAt);
    }
    // Chain: from a struck enemy to the nearest others not yet hit, within 12 m.
    if (struck && V.stressChain > 0) {
      let px = this.hitAt.x, py = this.hitAt.y, pz = this.hitAt.z;
      const used = new Set<unknown>();
      for (let k = 0; k < Math.round(V.stressChain); k++) {
        let best: TargetCandidate | null = null, bd = 144;
        for (const c of this.targets()) {
          if (used.has(c.key)) continue;
          const q = (c.x - px) ** 2 + (c.z - pz) ** 2;
          if (q > 0.5 && q < bd) { bd = q; best = c; }
        }
        if (!best) break;
        used.add(best.key);
        const fromC = this.o.set(px, py, pz), dc = this.t.set(best.x - px, best.y - py, best.z - pz).normalize();
        this.acc.chains++;
        this.orig(this.nextSlot(), team, fromC, dc, Math.sqrt(bd) + 2, damage * 0.6, o2);
        px = best.x; py = best.y; pz = best.z;
      }
    }
    return struck;
  }

  private nextSlot() { this.slot = this.slot >= 19 ? 2 : this.slot + 1; return this.slot; }
}

const UP = new THREE.Vector3(0, 1, 0);
