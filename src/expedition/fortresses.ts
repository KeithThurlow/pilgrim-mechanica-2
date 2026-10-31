// Bandit fortresses brought to life (glue; Keith 2026-10-31, docs/proposal-fortresses.md). For every fortress near the
// mech: its gates as targets (src/pois/gates.ts) and a garrison per yard, on the infantry swarm. Phased: each yard is
// a section that sleeps until you come for it.
// - Streams in within fortSpawn of the mech, asleep (frozen); stirs within fortActive (back to their posts).
// - A yard's garrison holds posts: some on its outer wall's top as sentries, the rest spread round the yard. Posted
//   bandits fight from where they stand (the swarm's `hold`): sentries shoot down at the mech outside; the yard waits
//   behind its wall.
// - Alarms: the outer yard and its sentries when the mech comes within fortWake of the outer wall; a yard when one of
//   its own is hit, when a gate in its wall is hit (the yard outside it too), when salvage noise reaches it, or when
//   the mech gets into the yard outside it. Alert, a yard's garrison leaves its posts and fights once the mech is in its
//   yard or at a gate into it; never over a wall (the swarm's `fence`: nobody on foot climbs one).
// - A gate at zero health is down: the gap opens in the ground (the walls' `down`, rebuilt by `rebuildGround`), a
//   blast, both yards either side on alert.
// - Streams out past fortDrop unless alert; what's left of each yard, every gate's health and the gates down are kept.
// Ownership: host (garrison, gates, alarms); the drawing (swarm draw, gate slabs) is cosmetic.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import { InfantrySwarm, DOWN, DEAD, type InfantryValues } from "../combat/infantry";
import { InfantryDraw, type BanditLookValues } from "../combat/infantryDraw";
import type { BanditVatData } from "../combat/banditVat";
import { InfantryTarget } from "../combat/infantryTarget";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { Prey } from "../pilot/quarry";
import { TEAM } from "../game/factions";
import { hash4, rng, type PoiPlacement } from "../world/pois";
import { fenced, gateBox, regionOf, routeVia, wallHeight, type SiegeWalls } from "../pois/fortressGround";
import type { Layout } from "../pois/fortress";
import { Gates, GATE_DEFAULTS, GATE_PARAMS, type GateEvent, type GateValues, type GateState } from "../pois/gates";
import { GatesDraw } from "../pois/gatesDraw";

export const FORT_LIFE_DEFAULTS = {
  ...GATE_DEFAULTS,
  fortGuardsOuter: 22,
  fortGuardsInner: 16,
  fortGuardsKeep: 10,
  fortSentries: 0.35,
  fortSpawn: 700,
  fortDrop: 1000,
  fortActive: 320,
  fortWake: 110,
  fortGiveUp: 420,
  fortSally: 60,
  fortHear: 1,
  fortHurt: 1.5,
  fortDamage: 0.6,
};
export type FortLifeValues = typeof FORT_LIFE_DEFAULTS & GateValues;

const G = "Fortress: garrison";
export const FORT_LIFE_PARAMS: Param[] = [
  ...GATE_PARAMS,
  { key: "fortGuardsOuter", label: "Bandits in the outer yard", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortGuardsInner", label: "Bandits in the inner yard", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortGuardsKeep", label: "Bandits in the keep", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortSentries", label: "Share on the walls as sentries", min: 0, max: 1, step: 0.01, group: G, tip: "Posted on their yard's outer wall, shooting down at the mech outside", onRelease: true },
  { key: "fortHurt", label: "Bandit health × (garrison)", min: 0.2, max: 6, step: 0.05, group: G, tip: "Fortress bandits are picked fighters", onRelease: true },
  { key: "fortDamage", label: "Damage per round", min: 0, max: 10, step: 0.05, group: G },
  { key: "fortWake", label: "Outer yard wakes within (m of its wall)", min: 0, max: 500, step: 5, group: G },
  { key: "fortActive", label: "Stir within (m)", min: 50, max: 1500, step: 10, group: G },
  { key: "fortSally", label: "Comes out after the mech within (m of the wall)", min: 0, max: 400, step: 5, group: G, tip: "An alert yard leaves through an open gate to chase the mech this close outside; further off it holds" },
  { key: "fortGiveUp", label: "Stand down past (m from the centre)", min: 100, max: 2000, step: 10, group: G },
  { key: "fortHear", label: "Hears stripping (× noise radius)", min: 0, max: 3, step: 0.05, group: G },
  { key: "fortSpawn", label: "Stream in within (m)", min: 200, max: 3000, step: 10, group: G },
  { key: "fortDrop", label: "Stream out past (m)", min: 300, max: 4000, step: 10, group: G },
];

type YardState = "asleep" | "idle" | "alert";
interface Yard {
  k: number;
  slots: number[]; gens: number[];
  sentry: Uint8Array;
  state: YardState;
  hp: number;
  /** Inner and outer radius of its floor (m from the centre). */
  r0: number; r1: number;
}
interface LiveFort { p: PoiPlacement; L: Layout; floor: number; yards: Yard[]; gates: GateState[] }
interface Kept { left: number[]; hp: Map<string, number> }

export class Fortresses {
  readonly sw: InfantrySwarm;
  readonly draw: InfantryDraw;
  readonly target: InfantryTarget;
  readonly gates: Gates;
  readonly gatesDraw: GatesDraw;
  readonly live = new Map<string, LiveFort>();
  private kept = new Map<string, Kept>();
  private postX = new Float32Array(1024); private postZ = new Float32Array(1024);
  private from = new THREE.Vector3(); private dir = new THREE.Vector3(); private aimPt = new THREE.Vector3();
  private slot = 2;
  private near: PoiPlacement[] = [];
  /** The mech's body reach (the trample's). */
  mechReach = 3;
  /** A bandit died (slot, generation, where), for drops. */
  onKill: ((i: number, gen: number, x: number, z: number) => void) | null = null;
  /** Gate hits and gates down, plain data (after the ground and the yards have taken it). */
  onGate: ((e: GateEvent) => void) | null = null;
  /** A yard woke. */
  onAlert: ((poi: string, yard: number) => void) | null = null;

  constructor(
    readonly v: FortLifeValues & InfantryValues & BanditLookValues, private field: DuneField, private bf: Battlefield, scene: THREE.Scene,
    readonly walls: SiegeWalls, private player: MechUnit, vat: BanditVatData | null,
    /** Fortress placements in a box (the expedition's sites, without the ones the road has taken). */
    private placements: (x0: number, z0: number, x1: number, z1: number) => PoiPlacement[],
    /** Rebuild the ground's meshes over a box (a gate went down). */
    private rebuildGround: (x0: number, z0: number, x1: number, z1: number) => void,
  ) {
    this.sw = new InfantrySwarm(v, field, 41);
    this.draw = new InfantryDraw(this.sw, v, vat);
    scene.add(this.draw.group);
    this.target = new InfantryTarget(this.sw, TEAM.raiders);
    bf.targets.push(this.target);
    this.gates = new Gates(v, TEAM.raiders);
    bf.targets.push(this.gates);
    this.gatesDraw = new GatesDraw(this.gates);
    scene.add(this.gatesDraw.group);
    this.gates.onEvent = (e) => this.gateEvent(e);
    this.sw.onDeath = (i) => this.onKill?.(i, this.sw.gen[i], this.sw.px[i], this.sw.pz[i]);
    // Nobody on foot climbs a wall: a step that gains wall height is refused (sentries walk its top, anyone may drop off).
    this.sw.fence = (x0, z0, x1, z1) => {
      for (const f of this.live.values()) {
        if (Math.abs(x1 - f.L.x) > f.L.reach || Math.abs(z1 - f.L.z) > f.L.reach) continue;
        if (fenced(f.L, x0, z0, x1, z1, this.walls.down)) return true;
      }
      return false;
    };
    const prev = player.onStomp;
    player.onStomp = (x, z, k) => { prev?.(x, z, k); this.sw.stomp(x, z, 2.6 * Math.min(1.5, k)); };
  }

  get count() { return this.sw.count; }
  get anyAlert() { for (const f of this.live.values()) for (const y of f.yards) if (y.state === "alert") return true; return false; }

  /** Everything forgotten: garrisons back to full, gates up (a new expedition, or the placement changed). */
  reset() {
    for (const f of this.live.values()) this.despawn(f, false);
    this.live.clear(); this.kept.clear();
    this.walls.down.clear();
  }

  /** Salvage noise at (x, z) heard within radius: yards in it wake. */
  noise(x: number, z: number, radius: number) {
    const r = radius * this.v.fortHear;
    for (const f of this.live.values()) {
      const d = Math.hypot(x - f.L.x, z - f.L.z);
      for (const y of f.yards) if (d - y.r1 < r && (y.k === 0 || d < f.L.rings[y.k - 1].r)) this.alarm(f, y);
    }
  }

  /** A dash through them. */
  dashed(x: number, z: number, dx: number, dz: number, radius: number, speed: number, damage: number) {
    return this.sw.shove(x, z, radius, dx, dz, speed, damage);
  }

  /** Bandits alive in a fortress's yard (for HUDs and checks). */
  aliveIn(poi: string, yard: number) { const f = this.live.get(poi); return f ? this.alive(f.yards[yard]) : 0; }

  update(dt: number, hunting: boolean, prey?: Prey) {
    const p = this.player.sim.pelvis, v = this.v, sw = this.sw;
    // Stream in and out.
    const R = v.fortSpawn;
    this.near = this.placements(p.x - R, p.z - R, p.x + R, p.z + R).filter((q) => q.kind === "fortress");
    for (const q of this.near) if (!this.live.has(q.id) && Math.hypot(q.x - p.x, q.z - p.z) < R) this.spawn(q);
    for (const f of [...this.live.values()]) {
      if (Math.hypot(f.L.x - p.x, f.L.z - p.z) <= v.fortDrop || f.yards.some((y) => y.state === "alert")) continue;
      this.despawn(f, true);
    }
    // Alarms and behaviour per yard.
    for (const f of this.live.values()) {
      const d = Math.hypot(p.x - f.L.x, p.z - f.L.z), rings = f.L.rings;
      for (const y of f.yards) {
        const hp = this.hp(y);
        if (hp < y.hp - 1e-3) this.alarm(f, y);
        y.hp = hp;
        if (hunting) {
          if (y.k === 0 && d < rings[0].r + v.fortWake) this.alarm(f, y);
          if (y.k > 0 && d < y.r1 + rings[y.k].top + rings[y.k].face + 25 && d < rings[y.k - 1].r) this.alarm(f, y);
        }
        if (y.state === "alert" && (!hunting || d > v.fortGiveUp)) y.state = "idle";
        if (y.state === "asleep" && d < v.fortActive) y.state = "idle";
        else if (y.state === "idle" && d > v.fortActive * 1.3) y.state = "asleep";
        const mr = regionOf(f.L, p.x, p.z), sallyOk = mr > 0 || d < rings[0].r + v.fortSally;
        for (let n = 0; n < y.slots.length; n++) {
          const i = y.slots[n];
          if (sw.gen[i] !== y.gens[n] || sw.state[i] >= DOWN) continue;
          if (y.state === "asleep") { sw.frozen[i] = 1; sw.vx[i] = 0; sw.vz[i] = 0; sw.clearTarget(i); continue; }
          sw.frozen[i] = 0;
          sw.hurry[i] = 0;
          if (y.state === "idle") {
            // Back to its post, round by a gate if it ended up the other side of a wall.
            const via = routeVia(f.L, sw.px[i], sw.pz[i], this.postX[i], this.postZ[i], this.walls.down);
            sw.hold[i] = 0; sw.setTarget(i, via?.x ?? this.postX[i], sw.py[i], via?.z ?? this.postZ[i], 0, true);
            continue;
          }
          // Alert: fight. Sentries from their posts on the wall.
          sw.clearTarget(i);
          if (y.sentry[n] || !hunting) { sw.hold[i] = 1; continue; }
          // The rest: at the mech when it's on their side of the walls; round to an open gate and through it when it's
          // one wall away (and not far off outside); else they hold their posts.
          const br = regionOf(f.L, sw.px[i], sw.pz[i]);
          if (br === mr) { sw.hold[i] = 0; continue; }
          const via = Math.abs(br - mr) === 1 && sallyOk ? routeVia(f.L, sw.px[i], sw.pz[i], p.x, p.z, this.walls.down) : null;
          if (via) { sw.hold[i] = 0; sw.setTarget(i, via.x, sw.py[i], via.z, 0, true); sw.hurry[i] = 1; continue; }
          sw.hold[i] = 1;
        }
      }
    }
    this.gatesDraw.update();
    if (!sw.hi) return;
    const bf = this.bf;
    const q: Prey = prey ?? { kind: "mech", alive: this.player.alive, at: p, radius: 2, unit: this.player, sim: this.player.sim };
    const T = q.at;
    sw.update(dt, { x: T.x, y: T.y, z: T.z, radius: q.kind === "pilot" ? 1 : this.mechReach }, (fx, fy, fz, tx, ty, tz, i) => {
      const own = sw.hasT[i] === 1;
      if (!own && !q.alive) return;
      const from = this.from.set(fx, fy, fz);
      if (!bf.canSee(from, own ? this.aimPt.set(tx, ty, tz) : T)) return;
      this.dir.set(tx - fx, ty - fy, tz - fz).normalize();
      const drawn = Math.random() < 0.3;
      if (drawn) this.slot = this.slot >= 19 ? 2 : this.slot + 1;
      bf.fire(this.slot, TEAM.raiders, from, this.dir, v.fireRange + 5, v.fortDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
    });
    this.draw.update(dt);
  }

  private alarm(f: LiveFort, y: Yard) {
    if (y.state === "alert") return;
    y.state = "alert";
    this.onAlert?.(f.p.id, y.k);
  }

  private gateEvent(e: GateEvent) {
    const f = this.live.get(e.poi);
    if (f) {
      // A gate in ring k is the way into yard k from yard k - 1: both hear it.
      for (const y of f.yards) if (y.k === e.ring || y.k === e.ring - 1) this.alarm(f, y);
    }
    if (e.type === "gateDown") {
      this.walls.down.add(e.id);
      const s = this.gates.list.find((g) => g.gate.id === e.id);
      if (s) { const [x0, z0, x1, z1] = gateBox(s.gate); this.rebuildGround(x0, z0, x1, z1); }
      this.bf.blast(TEAM.raiders, new THREE.Vector3(e.x, e.y, e.z), 6, 0);
    }
    this.onGate?.(e);
  }

  private spawn(p: PoiPlacement) {
    const v = this.v, sw = this.sw, L = this.walls.layout(p);
    const rings = L.rings, kept = this.kept.get(p.id);
    const floor = this.field.height(p.x, p.z) - wallHeight(L, p.x, p.z, this.walls.down);
    const f: LiveFort = { p, L, floor, yards: [], gates: [] };
    // Gates.
    for (const ring of rings) for (const g of ring.gates) {
      if (!g.barred) continue;
      const hp = kept?.hp.get(g.id);
      const s = this.gates.add(p.id, g, ring, floor, 1, this.walls.down.has(g.id));
      if (hp !== undefined) s.hp = hp;
      f.gates.push(s);
    }
    // Yards: ring k's floor runs from the next ring in (or the centre) out to ring k's inner face.
    const counts = rings.length === 3 ? [v.fortGuardsOuter, v.fortGuardsInner, v.fortGuardsKeep] : [v.fortGuardsOuter, v.fortGuardsKeep];
    const r = rng(hash4(p.seed, 11, 13, 17));
    for (let k = 0; k < rings.length; k++) {
      const ring = rings[k], next = rings[k + 1];
      const r1 = ring.r - ring.top - ring.face - 2, r0 = next ? next.r + next.top + next.face + 2 : 3;
      const n = Math.max(0, Math.round(kept?.left[k] ?? counts[k]));
      const slots = n > 0 ? sw.spawn(n, p.x, p.z, 1) : [];
      const sentry = new Uint8Array(slots.length), ns = Math.round(slots.length * v.fortSentries);
      slots.forEach((i, m) => {
        let x: number, z: number;
        if (m < ns) {
          // On the wall's top, clear of its gates.
          let a = 0;
          for (let t = 0; t < 12; t++) {
            a = r() * Math.PI * 2;
            if (!ring.gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * ring.r < g.w + 4)) break;
          }
          const d = ring.r + (r() - 0.5) * ring.top;
          x = p.x + Math.sin(a) * d; z = p.z + Math.cos(a) * d;
          sentry[m] = 1;
        } else {
          const a = r() * Math.PI * 2, d = r0 + (r1 - r0) * Math.sqrt(0.1 + 0.9 * r());
          x = p.x + Math.sin(a) * d; z = p.z + Math.cos(a) * d;
        }
        sw.px[i] = x; sw.pz[i] = z; sw.py[i] = this.field.height(x, z);
        sw.hp[i] *= v.fortHurt;
        sw.frozen[i] = 1;
        sw.hold[i] = 1;
        this.postX[i] = x; this.postZ[i] = z;
      });
      const y: Yard = { k, slots, gens: slots.map((i) => sw.gen[i]), sentry, state: "asleep", hp: 0, r0, r1 };
      y.hp = this.hp(y);
      f.yards.push(y);
    }
    this.live.set(p.id, f);
  }

  private despawn(f: LiveFort, keep: boolean) {
    if (keep) this.kept.set(f.p.id, { left: f.yards.map((y) => this.alive(y)), hp: new Map(f.gates.map((s) => [s.gate.id, s.hp])) });
    for (const y of f.yards) for (let n = 0; n < y.slots.length; n++) if (this.sw.gen[y.slots[n]] === y.gens[n]) this.sw.remove(y.slots[n]);
    this.gates.removePoi(f.p.id);
    this.live.delete(f.p.id);
  }

  private alive(y: Yard) {
    let n = 0;
    for (let m = 0; m < y.slots.length; m++) { const i = y.slots[m]; if (this.sw.gen[i] === y.gens[m] && this.sw.state[i] < DEAD) n++; }
    return n;
  }

  private hp(y: Yard) {
    let s = 0;
    for (let m = 0; m < y.slots.length; m++) { const i = y.slots[m]; if (this.sw.gen[i] === y.gens[m] && this.sw.state[i] < DEAD) s += Math.max(0, this.sw.hp[i]); }
    return s;
  }
}
