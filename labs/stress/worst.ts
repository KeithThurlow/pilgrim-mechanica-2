// The stress lab's worst case (Keith 2026-10-26: 4-player co-op, each weapon with 3-6x today's effects, Protocols that
// split, multiply, speed up, widen, ricochet and chain; "the performance thresholds scale significantly from here").
// For measuring only, not a design: three more Ramparts on the player's team, AI-driven (slow loops round the player,
// both miniguns on the nearest enemy, always firing), and every team-1 round carrying the max Protocols as fields on
// the shot (src/game/shots.ts, scale step 3; was stand-ins calling fire again): split x3 (fanned), fire rate x2 (a copy
// half a gun interval later), area x1.5 (splash on every round, blasts wider), ricochet (one bounce off what it hit),
// chain (three hops to the nearest enemies from what it hit). Effects are multiplied by scaling the effect-count
// sliders (dust sources, sparks, grit, smoke) by stressFx.
// URL: ?worst (on from the start), plus the usual ?run, ?norender, ?dt=0.033.
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import type { CombatLab } from "../../src/game/combatLab";
import { EntryList, type EntryView } from "../../src/game/register";
import type { Battlefield, FireOptions } from "../../src/game/battlefield";
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
  /** Once a frame, after the whole tick: this frame's counts (rounds, ricochets and chain hops from the shot system:
   *  every team's, as resolved this frame). */
  take() {
    const st = this.lab.bf.shots.last;
    this.acc.rounds = st.rounds; this.acc.ricochets = st.ricochets; this.acc.chains = st.chains;
    this.count = this.acc; this.acc = { shots: 0, allyShots: 0, rounds: 0, ricochets: 0, chains: 0 }; return this.count;
  }
  private base: Record<string, number> = {};
  private fxOn = 1;
  private orig: Battlefield["fire"];
  private enemyList: EntryList | null = null;
  private frame = 0;
  private t = new THREE.Vector3();

  constructor(private lab: Lab) {
    const bf = lab.bf;
    this.orig = bf.fire.bind(bf);
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
  private targets(): EntryView[] {
    // From the register (the lab's enemies filter), made once per rebuild.
    this.enemyList ??= new EntryList(this.lab.bf.register, this.lab.enemies);
    return this.enemyList.get();
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
      let e: EntryView | null = null, bd = Infinity;
      for (const c of this.targets()) { const dd = (c.x - p.x) ** 2 + (c.z - p.z) ** 2; if (dd < bd) { bd = dd; e = c; } }
      const aim = e ? { x: e.x, y: e.y, z: e.z } : null;
      m.step(dt, { x: cx, z: cz, sprint: false }, aim, aim ? true : false);
      if (m.upper.guns[0].ammo < 100) m.upper.resupply();
    });
  }

  /**
   * Every team-1 round, when on: the max Protocols as fields on the shot (src/game/shots.ts resolves them: split,
   * fire rate, area, ricochet, chain). Was a stand-in that called fire again for each (scale step 3).
   */
  private fire(slot: number, team: number, muzzle: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, o: FireOptions): number {
    if (!this.on || team !== 1) return this.orig(slot, team, muzzle, dir, range, damage, o);
    const V = this.lab.V;
    this.acc.shots++;
    if (slot >= 30) this.acc.allyShots++; // the allies' flash slots
    return this.orig(slot, team, muzzle, dir, range, damage, {
      ...o,
      splash: o.splash, splashShare: o.splashShare,
      proto: { split: V.stressSplit, rate: V.stressRate, area: V.stressArea, ricochet: V.stressRicochet, chain: V.stressChain },
    });
  }
}

