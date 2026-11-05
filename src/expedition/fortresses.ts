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
import { fenced, flowStep, gateBox, regionOf, routeVia, wallHeight, type SiegeWalls } from "../pois/fortressGround";
import { ringR, ringSpan } from "../pois/fortress";
import type { Layout } from "../pois/fortress";
import { Gates, GATE_DEFAULTS, GATE_PARAMS, type GateEvent, type GateValues, type GateState } from "../pois/gates";
import { GatesDraw } from "../pois/gatesDraw";
import { Spawners, SPAWNER_DEFAULTS, SPAWNER_PARAMS, type SpawnerEvent, type SpawnerState, type SpawnerValues } from "../pois/spawners";
import { SpawnersDraw } from "../pois/spawnersDraw";
import { Towers, TOWER_DEFAULTS, TOWER_PARAMS, type CrewKind, type TowerEvent, type TowerState, type TowerValues } from "../pois/towers";
import { TowersDraw } from "../pois/towersDraw";
import { WARLORD_DEFAULTS, WARLORD_PARAMS, type Warlord } from "./warlord";

export const FORT_LIFE_DEFAULTS = {
  ...GATE_DEFAULTS,
  ...SPAWNER_DEFAULTS,
  ...TOWER_DEFAULTS,
  ...WARLORD_DEFAULTS,
  fortGuardsOuter: 30,
  fortGuardsInner: 22,
  fortGuardsKeep: 14,
  fortAlarmAll: 1,
  fortVaultItems: 4,
  fortTrickle: 6,
  fortTrickleEvery: 12,
  fortTrickleMax: 60,
  fortSentries: 0.35,
  fortSpawn: 700,
  fortDrop: 1000,
  fortActive: 320,
  fortWake: 110,
  fortGiveUp: 420,
  fortSally: 60,
  fortReinforce: 4,
  fortReinforceAfter: 20,
  fortHear: 1,
  fortHurt: 1.5,
  fortDamage: 1,
  fortFlowNear: 28,
};
export type FortLifeValues = typeof FORT_LIFE_DEFAULTS & GateValues & SpawnerValues & TowerValues;

const G = "Fortress: garrison";
export const FORT_LIFE_PARAMS: Param[] = [
  ...GATE_PARAMS,
  ...SPAWNER_PARAMS,
  ...TOWER_PARAMS,
  ...WARLORD_PARAMS,
  { key: "fortGuardsOuter", label: "Bandits in the outer yard", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortGuardsInner", label: "Bandits in the inner yard", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortGuardsKeep", label: "Bandits in the keep", min: 0, max: 120, step: 1, group: G, onRelease: true },
  { key: "fortSentries", label: "Share on the walls as sentries", min: 0, max: 1, step: 0.01, group: G, tip: "Posted on their yard's outer wall, shooting down at the mech outside", onRelease: true },
  { key: "fortHurt", label: "Bandit health × (garrison)", min: 0.2, max: 6, step: 0.05, group: G, tip: "Fortress bandits are picked fighters", onRelease: true },
  { key: "fortDamage", label: "Damage per round", min: 0, max: 10, step: 0.05, group: G },
  { key: "fortFlowNear", label: "Path round the shacks past (m)", min: 0, max: 120, step: 1, group: G, tip: "Alert bandits further than this from the mech in its yard find their way round the shacks; nearer they come straight" },
  { key: "fortWake", label: "Outer yard wakes within (m of its wall)", min: 0, max: 500, step: 5, group: G },
  { key: "fortActive", label: "Stir within (m)", min: 50, max: 1500, step: 10, group: G },
  { key: "fortSally", label: "Comes out after the mech within (m of the wall)", min: 0, max: 400, step: 5, group: G, tip: "An alert yard leaves through an open gate to chase the mech this close outside; further off it holds" },
  { key: "fortVaultItems", label: "Items in the vault", min: 0, max: 12, step: 1, group: G, tip: "Rolled hot and deep when the vault is stripped" },
  { key: "fortAlarmAll", label: "One alarm wakes every yard", min: 0, max: 1, step: 1, group: G, tip: "1: the inner walls' sentries open up as soon as the outer yard fights" },
  { key: "fortTrickle", label: "Bandits out of the spawners per wave", min: 0, max: 30, step: 1, group: G, tip: "While it's alert, fresh bandits pour out of the nearest spawner shacks in the mech's yard (0: none); shoot a spawner to shut it" },
  { key: "fortTrickleEvery", label: "A wave every (s)", min: 2, max: 120, step: 1, group: G },
  { key: "fortTrickleMax", label: "Waves bring at most (bandits per fortress)", min: 0, max: 200, step: 1, group: G },
  { key: "fortReinforce", label: "War band sent when it's attacked (vehicles)", min: 0, max: 12, step: 1, group: G, tip: "Once per fortress per expedition, a column rolls out from it after the first alarm (0: none)" },
  { key: "fortReinforceAfter", label: "War band rolls out after (s)", min: 0, max: 180, step: 1, group: G },
  { key: "fortGiveUp", label: "Stand down past (m from the centre)", min: 100, max: 2000, step: 10, group: G },
  { key: "fortHear", label: "Hears stripping (× noise radius)", min: 0, max: 3, step: 0.05, group: G },
  { key: "fortSpawn", label: "Stream in within (m)", min: 200, max: 3000, step: 10, group: G },
  { key: "fortDrop", label: "Stream out past (m)", min: 300, max: 4000, step: 10, group: G },
];

type YardState = "asleep" | "idle" | "alert";
interface Yard {
  k: number;
  slots: number[]; gens: number[];
  sentry: number[];
  state: YardState;
  hp: number;
  /** Inner and outer radius of its floor (m from the centre). */
  r0: number; r1: number;
}
interface LiveFort { p: PoiPlacement; L: Layout; floor: number; yards: Yard[]; gates: GateState[]; spawners: SpawnerState[]; towers: TowerState[]; wave: number; waved: number }
interface Kept { left: number[]; hp: Map<string, number>; waved: number }

export class Fortresses {
  readonly sw: InfantrySwarm;
  readonly draw: InfantryDraw;
  readonly target: InfantryTarget;
  readonly gates: Gates;
  readonly gatesDraw: GatesDraw;
  readonly spawners: Spawners;
  readonly spawnersDraw: SpawnersDraw;
  readonly towers: Towers;
  readonly towersDraw: TowersDraw;
  /** Tower hits and downs, plain data. */
  onTower: ((e: TowerEvent) => void) | null = null;
  /** Spawner hits and downs, plain data. */
  onSpawner: ((e: SpawnerEvent) => void) | null = null;
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
  /** The keep's warlord (a red Rampart the lab loads and hands over; null: no boss). */
  warlord: Warlord | null = null;
  private warlordHp = 0;
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
    this.spawners = new Spawners(v, TEAM.raiders);
    bf.targets.push(this.spawners);
    this.spawnersDraw = new SpawnersDraw(this.spawners);
    scene.add(this.spawnersDraw.group);
    this.spawners.onEvent = (e) => this.spawnerEvent(e);
    this.spawners.onPour = (s, x, z, a) => this.pour(s, x, z, a);
    this.towers = new Towers(v, TEAM.raiders);
    bf.targets.push(this.towers);
    this.towersDraw = new TowersDraw(this.towers);
    scene.add(this.towersDraw.group);
    this.towers.onEvent = (e) => this.towerEvent(e);
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
    this.warlord?.reset();
  }

  /** Salvage noise at (x, z) heard within radius: yards in it wake. */
  noise(x: number, z: number, radius: number) {
    const r = radius * this.v.fortHear;
    for (const f of this.live.values()) {
      const d = Math.hypot(x - f.L.x, z - f.L.z);
      const a = Math.atan2(x - f.L.x, z - f.L.z);
      for (const y of f.yards) if (d - y.r1 < r && (y.k === 0 || d < ringR(f.L.rings[y.k - 1], a))) this.alarm(f, y);
    }
  }

  /** A dash through them. */
  dashed(x: number, z: number, dx: number, dz: number, radius: number, speed: number, damage: number) {
    return this.sw.shove(x, z, radius, dx, dz, speed, damage);
  }

  /** Alert garrison (every yard that is alert) and the warlord within r of (x, z), as points (the convoy's turrets track them). */
  threats(x: number, z: number, r: number, out: THREE.Vector3[], max = 24) {
    const sw = this.sw;
    for (const f of this.live.values()) {
      for (const y of f.yards) {
        if (y.state !== "alert") continue;
        for (let m = 0; m < y.slots.length && out.length < max; m++) {
          const i = y.slots[m];
          if (sw.gen[i] !== y.gens[m] || sw.state[i] >= DOWN) continue;
          if (Math.hypot(sw.px[i] - x, sw.pz[i] - z) <= r) out.push(new THREE.Vector3(sw.px[i], sw.py[i] + 1.2, sw.pz[i]));
        }
      }
    }
    const w = this.warlord?.unit;
    if (w && w.alive && out.length < max && this.warlord!.poi && Math.hypot(w.sim.pelvis.x - x, w.sim.pelvis.z - z) <= r) out.push(w.sim.pelvis.clone());
    return out;
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
      const d = Math.hypot(p.x - f.L.x, p.z - f.L.z), rings = f.L.rings, am = Math.atan2(p.x - f.L.x, p.z - f.L.z);
      const R = (k: number) => ringR(rings[k], am);
      if (hunting) this.waves(dt, f, am);
      for (const y of f.yards) {
        const hp = this.hp(y);
        if (hp < y.hp - 1e-3) this.alarm(f, y);
        y.hp = hp;
        if (hunting) {
          if (y.k === 0 && d < R(0) + v.fortWake) this.alarm(f, y);
          if (y.k > 0 && d < R(y.k) + 25 && d < R(y.k - 1)) this.alarm(f, y);
        }
        if (y.state === "alert" && (!hunting || d > v.fortGiveUp)) y.state = "idle";
        if (y.state === "asleep" && d < v.fortActive) y.state = "idle";
        else if (y.state === "idle" && d > v.fortActive * 1.3) y.state = "asleep";
        const town = f.L.blocks.length > 0;
        const mr = regionOf(f.L, p.x, p.z), sallyOk = mr > 0 || d < R(0) + v.fortSally;
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
          if (br === mr) {
            sw.hold[i] = 0;
            // In a town, further off than a fight: down the flow field round the shacks to it (straight once near).
            if (town && mr > 0 && Math.hypot(sw.px[i] - p.x, sw.pz[i] - p.z) > v.fortFlowNear) {
              const st = flowStep(f.L, sw.px[i], sw.pz[i], p.x, p.z, this.walls.down);
              if (st) { sw.setTarget(i, st.x, sw.py[i], st.z, 0, true); sw.hurry[i] = 1; }
            }
            continue;
          }
          const via = Math.abs(br - mr) === 1 && sallyOk ? routeVia(f.L, sw.px[i], sw.pz[i], p.x, p.z, this.walls.down) : null;
          if (via) { sw.hold[i] = 0; sw.setTarget(i, via.x, sw.py[i], via.z, 0, true); sw.hurry[i] = 1; continue; }
          sw.hold[i] = 1;
        }
      }
    }
    this.gatesDraw.update();
    this.spawners.step(dt);
    this.spawnersDraw.update(dt);
    this.towers.step(dt);
    this.towersDraw.update(dt);
    const q: Prey = prey ?? { kind: "mech", alive: this.player.alive, at: p, radius: 2, unit: this.player, sim: this.player.sim };
    const T = q.at;
    this.stepWarlord(dt, hunting, q);
    if (hunting && q.alive) this.crewFire(dt, q.at);
    if (!sw.hi) return;
    const bf = this.bf;
    sw.update(dt, { x: T.x, y: T.y, z: T.z, radius: q.kind === "pilot" ? 1 : q.kind === "summon" ? q.radius + 1 : this.mechReach }, (fx, fy, fz, tx, ty, tz, i) => {
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

  /** The warlord fights when its keep is alerted; hitting it alerts the keep. */
  private stepWarlord(dt: number, hunting: boolean, q: Prey) {
    const w = this.warlord, m = w?.unit;
    if (!w || !m) return;
    // Stand it in the nearest live keep it hasn't died in.
    if (!w.poi || !this.live.has(w.poi)) {
      let best: LiveFort | null = null, bd = Infinity;
      const P = this.player.sim.pelvis;
      for (const f of this.live.values()) { const d = Math.hypot(f.L.x - P.x, f.L.z - P.z); if (d < bd && !w.isDead(f.p.id)) { bd = d; best = f; } }
      if (!best) { if (w.poi) w.leave(); return; }
      const keep = best.L.rings[best.L.rings.length - 1];
      w.place(best.p.id, best.L.x, best.L.z, keep.r * 0.8 - ringSpan(keep), best.p.yaw);
      this.warlordHp = m.health;
    }
    const f = this.live.get(w.poi!)!, keep = f.yards[f.yards.length - 1];
    if (m.alive && m.health < this.warlordHp - 1e-3) this.alarm(f, keep);
    this.warlordHp = m.health;
    w.update(dt, { x: q.at.x, y: q.at.y, z: q.at.z, alive: q.alive }, hunting && keep.state === "alert");
  }

  private alarm(f: LiveFort, y: Yard) {
    if (y.state === "alert") return;
    y.state = "alert";
    this.onAlert?.(f.p.id, y.k);
    if (this.v.fortAlarmAll > 0) for (const o of f.yards) this.alarm(f, o);
  }

  /**
   * While any yard is alert: every fortTrickleEvery s a wave pours out of the spawner shacks nearest the mech in its
   * yard (the outer yard while it's outside; the next yard if its own are all shot down), the doors swinging open
   * first, until fortTrickleMax came. No spawners left standing: no more waves.
   */
  private waves(dt: number, f: LiveFort, _am: number) {
    const v = this.v;
    if (!f.yards.some((y) => y.state === "alert") || v.fortTrickle <= 0 || f.waved >= v.fortTrickleMax) return;
    f.wave -= dt;
    if (f.wave > 0) return;
    f.wave = v.fortTrickleEvery;
    const p = this.player.sim.pelvis, k = Math.max(0, Math.min(f.yards.length - 1, regionOf(f.L, p.x, p.z) - 1));
    const up = f.spawners.filter((s) => !s.down);
    if (!up.length) return;
    // Its own yard's first, then the nearest yards'; within a yard the nearest, not right on top of the mech.
    const score = (s: SpawnerState) => Math.abs(s.sp.yard - k) * 1000 + Math.abs(Math.hypot(s.sp.x - p.x, s.sp.z - p.z) - 30);
    up.sort((a, b) => score(a) - score(b));
    const pick = up.slice(0, up.length > 1 && Math.abs(up[1].sp.yard - k) === Math.abs(up[0].sp.yard - k) ? 2 : 1);
    let n = Math.min(Math.round(v.fortTrickle), Math.round(v.fortTrickleMax - f.waved));
    f.waved += n;
    for (let i = 0; n > 0; i = (i + 1) % pick.length, n--) pick[i].want++;
  }

  /** One bandit out of a spawner's door, running out into the street and on at the mech. */
  private pour(s: SpawnerState, x: number, z: number, a: number) {
    const f = this.live.get(s.poi), sw = this.sw;
    if (!f) return;
    const y = f.yards[Math.min(s.sp.yard, f.yards.length - 1)];
    const [i] = sw.spawn(1, x, z, 0);
    if (i === undefined) return;
    sw.px[i] = x; sw.pz[i] = z; sw.py[i] = this.field.height(x, z);
    sw.hp[i] *= this.v.fortHurt;
    sw.hold[i] = 0; sw.frozen[i] = 0;
    sw.vx[i] = Math.sin(a) * this.v.runSpeed; sw.vz[i] = Math.cos(a) * this.v.runSpeed;
    sw.heading[i] = a;
    this.postX[i] = x + Math.sin(a) * 6; this.postZ[i] = z + Math.cos(a) * 6;
    y.slots.push(i); y.gens.push(sw.gen[i]); y.sentry.push(0);
    y.hp = this.hp(y);
  }

  /** Tower crews on alert: grenadiers lob, rocketeers fire (both telegraphed shells, dodgeable); riflemen are plain bandits. */
  private crewFire(dt: number, T: THREE.Vector3) {
    const v = this.v, sw = this.sw;
    for (const f of this.live.values()) for (const t of f.towers) {
      if (t.down || f.yards[Math.min(t.t.yard, f.yards.length - 1)].state !== "alert") continue;
      for (const c of t.crew) {
        if (c.kind === "gun" || sw.gen[c.i] !== c.gen || sw.state[c.i] >= DOWN) continue;
        if ((c.clock -= dt) > 0) continue;
        const from = this.from.set(sw.px[c.i], sw.py[c.i] + 1.6, sw.pz[c.i]);
        const d = Math.hypot(T.x - from.x, T.z - from.z);
        const range = c.kind === "grenade" ? v.towerGrenadeRange : v.towerRocketRange;
        if (d > range || !this.bf.canSee(from, T)) { c.clock = 0.5; continue; }
        c.clock = (c.kind === "grenade" ? v.towerGrenadeEvery : v.towerRocketEvery) * (0.8 + 0.4 * Math.random());
        if (c.kind === "grenade") this.bf.lob(TEAM.raiders, from, T.x, T.z, v.towerGrenadeFlight, 7, v.towerGrenadeRadius, v.towerGrenadeDamage);
        else this.bf.lob(TEAM.raiders, from, T.x, T.z, Math.max(0.3, d / Math.max(1, v.towerRocketSpeed)), 0.8, v.towerRocketRadius, v.towerRocketDamage);
      }
    }
  }

  private towerEvent(e: TowerEvent) {
    const f = this.live.get(e.poi);
    if (f) this.alarm(f, f.yards[Math.min(e.yard, f.yards.length - 1)]);
    if (e.type === "towerDown") {
      this.walls.down.add(e.id);
      const t = this.towers.list.find((s) => s.t.id === e.id);
      if (t) {
        this.rebuildGround(t.b.x - 8, t.b.z - 8, t.b.x + 8, t.b.z + 8);
        // The crew falls with it.
        for (const c of t.crew) if (this.sw.gen[c.i] === c.gen && this.sw.state[c.i] < DOWN) this.sw.damage(c.i, 1e9, Math.sin(t.fallA), Math.cos(t.fallA));
      }
      this.bf.blast(TEAM.raiders, new THREE.Vector3(e.x, e.y, e.z), 5, 0);
    }
    this.onTower?.(e);
  }

  private spawnerEvent(e: SpawnerEvent) {
    const f = this.live.get(e.poi);
    if (f) this.alarm(f, f.yards[Math.min(e.yard, f.yards.length - 1)]);
    if (e.type === "spawnerDown") this.bf.blast(TEAM.raiders, new THREE.Vector3(e.x, e.y, e.z), 5, 0);
    this.onSpawner?.(e);
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
    const f: LiveFort = { p, L, floor, yards: [], gates: [], spawners: [], towers: [], wave: 0, waved: kept?.waved ?? 0 };
    // Lookout towers (their crews after the yards).
    for (const tw of L.towers) {
      const b = L.blocks[tw.block];
      f.towers.push(this.towers.add(p.id, tw, b, this.field.height(b.x, b.z) - wallHeight(L, b.x, b.z, this.walls.down), kept?.hp.get(tw.id)));
    }
    // Spawner shacks (their health kept by id with the gates').
    for (const sp of L.spawners) {
      const b = L.blocks[sp.block];
      f.spawners.push(this.spawners.add(p.id, sp, b, this.field.height(b.x, b.z) - b.h, kept?.hp.get(sp.id)));
    }
    // Gates.
    for (const ring of rings) for (const g of ring.gates) {
      if (!g.barred) continue;
      const hp = kept?.hp.get(g.id);
      // Each gate on the ground under it (a fortress's ground rolls, Keith 2026-11-05).
      const gf = this.field.height(g.x, g.z) - wallHeight(L, g.x, g.z, this.walls.down);
      const s = this.gates.add(p.id, g, ring, gf, 1, this.walls.down.has(g.id));
      if (hp !== undefined) s.hp = hp;
      f.gates.push(s);
    }
    // Yards: ring k's floor runs from the next ring in (or the centre) out to ring k's inner face.
    const counts = rings.length === 3 ? [v.fortGuardsOuter, v.fortGuardsInner, v.fortGuardsKeep] : [v.fortGuardsOuter, v.fortGuardsKeep];
    const r = rng(hash4(p.seed, 11, 13, 17));
    for (let k = 0; k < rings.length; k++) {
      const ring = rings[k], next = rings[k + 1];
      const r1At = (a: number) => ringR(ring, a) - ringSpan(ring) - 2, r0At = (a: number) => (next ? ringR(next, a) + ringSpan(next) + 2 : 3);
      const r1 = ring.r - ringSpan(ring) - 2, r0 = next ? next.r + ringSpan(next) + 2 : 3;
      const n = Math.max(0, Math.round(kept?.left[k] ?? counts[k]));
      const slots = n > 0 ? sw.spawn(n, p.x, p.z, 1) : [];
      const sentry = slots.map(() => 0), ns = Math.round(slots.length * v.fortSentries);
      slots.forEach((i, m) => {
        let x: number, z: number;
        if (m < ns) {
          // On the wall's top, clear of its gates.
          let a = 0;
          for (let t = 0; t < 12; t++) {
            a = r() * Math.PI * 2;
            if (!ring.gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g.a), Math.cos(a - g.a))) * ring.r < g.w + 4)) break;
          }
          const d = ringR(ring, a) + (r() - 0.5) * ring.top;
          x = p.x + Math.sin(a) * d; z = p.z + Math.cos(a) * d;
          sentry[m] = 1;
        } else {
          // On the yard's floor, off the cover.
          x = p.x; z = p.z;
          for (let t = 0; t < 8; t++) {
            const a = r() * Math.PI * 2, R0 = r0At(a), d = R0 + (r1At(a) - R0) * Math.sqrt(0.1 + 0.9 * r());
            x = p.x + Math.sin(a) * d; z = p.z + Math.cos(a) * d;
            if (wallHeight(L, x, z, this.walls.down) < 0.5) break;
          }
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
    // Tower crews: one or two on top of each standing tower, holding there; a rocket launcher, grenades or a rifle each.
    const rt = rng(hash4(p.seed, 31, 37, 41));
    const KINDS: CrewKind[] = ["rocket", "grenade", "gun"];
    for (const t of f.towers) {
      const n = 1 + (rt() < 0.5 ? 1 : 0), kinds = [KINDS[Math.floor(rt() * 3)], KINDS[Math.floor(rt() * 3)]];
      if (t.down || kept) continue; // a fortress streamed back in keeps its yards' counts; its crews are in them
      const y = f.yards[Math.min(t.t.yard, f.yards.length - 1)], ux = Math.sin(t.b.a), uz = Math.cos(t.b.a);
      const slots = sw.spawn(n, t.b.x, t.b.z, 0);
      slots.forEach((i, m) => {
        const s2 = (m - (slots.length - 1) / 2) * 2.2, x = t.b.x + ux * s2, z = t.b.z + uz * s2;
        sw.px[i] = x; sw.pz[i] = z; sw.py[i] = this.field.height(x, z);
        sw.hp[i] *= v.fortHurt * v.towerCrewHurt;
        sw.frozen[i] = 1; sw.hold[i] = 1;
        this.postX[i] = x; this.postZ[i] = z;
        y.slots.push(i); y.gens.push(sw.gen[i]); y.sentry.push(1);
        t.crew.push({ i, gen: sw.gen[i], kind: kinds[m], clock: 1 + rt() * 2 });
      });
      y.hp = this.hp(y);
    }
    this.live.set(p.id, f);
  }

  private despawn(f: LiveFort, keep: boolean) {
    if (keep) this.kept.set(f.p.id, { left: f.yards.map((y) => this.alive(y)), hp: new Map([...f.gates.map((s) => [s.gate.id, s.hp] as [string, number]), ...f.spawners.map((s) => [s.sp.id, s.hp] as [string, number]), ...f.towers.map((s) => [s.t.id, s.hp] as [string, number])]), waved: f.waved });
    for (const y of f.yards) for (let n = 0; n < y.slots.length; n++) if (this.sw.gen[y.slots[n]] === y.gens[n]) this.sw.remove(y.slots[n]);
    this.gates.removePoi(f.p.id);
    this.spawners.removePoi(f.p.id);
    this.towers.removePoi(f.p.id);
    if (this.warlord?.poi === f.p.id) this.warlord.leave();
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
