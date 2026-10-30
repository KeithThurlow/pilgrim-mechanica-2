// Shots as data (docs/proposal-scale.md, Keith approved 2026-10-26): one system every round goes through. A shot is a
// row (structure of arrays): where it flies from and which way, how far, its damage and team, and its Protocols as
// fields (split, fire rate, area, ricochets left, chain hops left, penetration). Protocols are data on the shot, not
// code in each weapon: split and fire rate expand at fire time into more rows (a seeded fan; rate copies wait a
// fraction of the gun's interval), area scales the splash, and ricochets and chains spawn child rows at the hit
// (one generation further, so nothing loops).
//
// Rows resolve once per frame, batched (step): direct fire as a sheet with a penetration budget (src/game/sheetFire.ts),
// other rounds as a ray, both culled through the register (only targets whose hit reach the line crosses are tested;
// the swarms cull their own units). What happened is written as events (plain data: hit, splash, ricochet, chain,
// miss) and damage is applied as each hit event is made; what to draw is written as draws (the tracer, flash and
// impact), which the battlefield hands to the effects (through the effects budget). Pure of drawing: the checks run it
// headless (tools/shots-check.ts).
//
// Multiplayer (rule 12): a player's fire is a command (ShotCmd: plain data with a seed); the host expands and resolves
// it and the events are what it would send. Every random choice (the fan's jitter, the rate copies' spread, the
// ricochet's bounce) comes from the command's seed, never Math.random, so a peer replaying a command gets the same rows.
// Ownership: rows and events are host state; draws are cosmetic and local.
// Not yet: events name their target by the battlefield's target list and the adapter's part key (host-local), not by
// register id; the mechs' own spread is still drawn with Math.random in mechUnit before the command is made.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "./battlefield";
import { UNSET_PIERCE } from "./armour";
import type { HitSurface } from "../fx/minigun";
import type { Ground } from "../mech/walker";
import { rayGround } from "../world/raycast";
import { makeSheet, resolveSheet, type SheetFire, type Steel } from "./sheetFire";
import { FLAG, MEASURE, RayHits, type Filter, type Register } from "./register";
import type { PenValues } from "./sheet";

/** A shot's Protocols (all optional; a plain round has none). */
export interface ShotProtocols {
  /** Rounds per shot, fanned across the aim (protoFan degrees apart). */
  split?: number;
  /** Fire rate ×: each round is fired this many times, the copies spread over one gun interval. */
  rate?: number;
  /** Splash radius × (a round with no splash of its own gets protoSplash). */
  area?: number;
  /** Bounces off what it hits (ground, steel or a body), on at protoRicochetKeep of the damage. */
  ricochet?: number;
  /** Hops from a struck enemy to the nearest others not yet hit by this shot, within protoChainRange. */
  chain?: number;
  /** Ignited (Keith 2026-10-30, the incendiary feed): what it hits burns for `time` seconds at `dps` (src/game/burn.ts). */
  burn?: { time: number; dps: number };
}

export const SHOT_DEFAULTS = {
  protoFan: 6,
  protoRateGap: 0.06,
  protoSplash: 0.6,
  protoSplashShare: 0.4,
  protoRicochetKeep: 0.5,
  protoRicochetRange: 25,
  protoRicochetScatter: 25,
  protoChainKeep: 0.6,
  protoChainRange: 12,
  protoMaxGen: 4,
  shotsPerFrame: 4000,
};
export type ShotValues = typeof SHOT_DEFAULTS;

const G = "Protocols", GP = "Performance";
export const SHOT_PARAMS: Param[] = [
  { key: "protoFan", label: "Split: degrees between rounds", min: 0, max: 30, step: 0.5, group: G, tip: "A split shot's rounds fan out across the aim this far apart" },
  { key: "protoRateGap", label: "Fire rate: copies over (s)", min: 0, max: 0.5, step: 0.005, group: G, tip: "A fire-rate Protocol's extra copies of a round follow it, spread over this long (a gun that doesn't say its own interval)" },
  { key: "protoSplash", label: "Area: splash on a plain round (m)", min: 0, max: 4, step: 0.05, group: G, tip: "An area Protocol on a round with no splash of its own gives it this much, times the Protocol" },
  { key: "protoSplashShare", label: "Area: splash share of damage", min: 0, max: 1, step: 0.01, group: G },
  { key: "protoRicochetKeep", label: "Ricochet: damage kept", min: 0, max: 1, step: 0.01, group: G },
  { key: "protoRicochetRange", label: "Ricochet: range (m)", min: 2, max: 80, step: 1, group: G },
  { key: "protoRicochetScatter", label: "Ricochet: scatter (°)", min: 0, max: 90, step: 1, group: G, tip: "How far off the mirror bounce a ricochet may fly (seeded)" },
  { key: "protoChainKeep", label: "Chain: damage kept per hop", min: 0, max: 1, step: 0.01, group: G },
  { key: "protoChainRange", label: "Chain: reach (m)", min: 1, max: 40, step: 0.5, group: G },
  { key: "protoMaxGen", label: "Protocols: generations at most", min: 1, max: 8, step: 1, group: G, tip: "Ricochets and chain hops spawn further shots; past this many generations they stop (so nothing loops)" },
  { key: "shotsPerFrame", label: "Shots resolved per frame at most", min: 100, max: 20000, step: 100, group: GP, tip: "Rows past this wait for the next frame (they keep their order); a safety cap, not a budget" },
];

/** A shot as fired: plain data (the command a peer would send). Vectors are copied in. */
export interface ShotCmd {
  team: number;
  /** Who fired it (a unit number; 0 the local player for now) and with which weapon (a small id; 0 the minigun). */
  owner?: number;
  weapon?: number;
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  range: number;
  damage: number;
  /** Seeds every random choice the shot makes (else the system's own sequence). */
  seed?: number;
  /** Direct fire as a sheet (src/game/sheet.ts) rather than a thin ray. */
  sheet?: SheetFire;
  splash?: number;
  splashShare?: number;
  proto?: ShotProtocols;
  /** The gun's time between rounds (s): fire-rate copies spread over it (else protoRateGap). */
  interval?: number;
  /** Armour pierce 0..1 of every round and child (src/game/armour.ts; none: armour-ignoring). */
  pierce?: number;
}

/** How a shot looks (cosmetic, local, never sent). Copied in. */
export interface ShotLook {
  slot: number;
  eject?: THREE.Vector3 | null;
  outboard?: THREE.Vector3 | null;
  flashScale?: number;
  hitScale?: number;
  voice?: "player" | "other" | "none";
  tracer?: boolean;
  /** The local player's own (its effects are never merged, thinned or trimmed). */
  own?: boolean;
  /** A co-op ally's (Keith 2026-10-27): shown before others' but after yours (FxBudget.admit). */
  ally?: boolean;
  /** Ignited rounds: the tracer glows orange-red. */
  hot?: boolean;
}

/** What happened (plain data, host-made; what the host would send). */
export interface ShotEvent {
  kind: "hit" | "splash" | "ricochet" | "chain" | "miss" | "ignite";
  /** The shot (row id) and the command it came from (family). */
  shot: number;
  family: number;
  /** For hits: the target (its place in the battlefield's target list) and the adapter's part key (-1 none). */
  target: number;
  key: number;
  damage: number;
  x: number; y: number; z: number;
  /** Splash: how many units it reached. */
  count: number;
}

/** What to draw for a resolved row (cosmetic). */
export interface ShotDraw {
  look: ShotLook;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  to: THREE.Vector3;
  surface: HitSurface;
  normal: THREE.Vector3;
  /** Where a sheet went through bodies (sparks). */
  exits: THREE.Vector3[];
  /** The flash, eject and voice belong to the first row of a command; children and split rounds are quiet. */
  first: boolean;
}

/** What the system needs from the battlefield. */
export interface ShotWorld {
  field: Ground;
  targets: readonly Hittable[];
  wrecks: Steel | null;
  register: Register;
  v: PenValues & ShotValues;
  /** An ignited round hit a target (key = the part): set it burning (src/game/burn.ts). */
  ignite?: (target: Hittable, key: number, time: number, dps: number, x: number, y: number, z: number) => void;
}

const CAP = 16384;
const F_SHEET = 1, F_FLAT = 2, F_AIM = 4, F_FIRST = 8, F_TRACER = 16;
const K_ROUND = 0, K_RICOCHET = 1, K_CHAIN = 2;

/** Seeded random (mulberry32): one state per row. */
function rnd(s: Uint32Array, i: number): number {
  let t = (s[i] = (s[i] + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hash(a: number): number { a = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b); a ^= a >>> 13; a = Math.imul(a, 0xc2b2ae35); return (a ^ (a >>> 16)) >>> 0; }

export class Shots {
  // ---- Rows ----
  readonly ox = new Float32Array(CAP); readonly oy = new Float32Array(CAP); readonly oz = new Float32Array(CAP);
  readonly dx = new Float32Array(CAP); readonly dy = new Float32Array(CAP); readonly dz = new Float32Array(CAP);
  readonly range = new Float32Array(CAP); readonly damage = new Float32Array(CAP); readonly wait = new Float32Array(CAP);
  readonly splash = new Float32Array(CAP); readonly splashShare = new Float32Array(CAP);
  /** Sheet: half-width, height, line (NaN: none), penetration (m), knock speed; the aim point (F_AIM). */
  readonly half = new Float32Array(CAP); readonly height = new Float32Array(CAP); readonly line = new Float32Array(CAP);
  readonly pen = new Float32Array(CAP); readonly knock = new Float32Array(CAP);
  readonly ax = new Float32Array(CAP); readonly ay = new Float32Array(CAP); readonly az = new Float32Array(CAP);
  readonly team = new Uint8Array(CAP); readonly gen = new Uint8Array(CAP); readonly kind = new Uint8Array(CAP);
  readonly ric = new Uint8Array(CAP); readonly chain = new Uint8Array(CAP); readonly flags = new Uint8Array(CAP);
  readonly seed = new Uint32Array(CAP);
  /** Ignited rounds: burn time (s) and damage per second (0: plain). */
  readonly burnT = new Float32Array(CAP); readonly burnD = new Float32Array(CAP);
  /** Armour pierce (src/game/armour.ts; 1 for a command that names none). */
  readonly ap = new Float32Array(CAP);
  readonly id = new Float64Array(CAP); readonly family = new Float64Array(CAP);
  /** The look of each row's command (cosmetic, by family). */
  private look: (ShotLook | null)[] = new Array(CAP).fill(null);
  n = 0;

  /** This frame's events and draws (cleared by the next step). */
  readonly events: ShotEvent[] = [];
  readonly draws: ShotDraw[] = [];
  /** Per frame: commands, rows resolved, by kind; rows still waiting. Last frame's in `last`. */
  readonly stats = { cmds: 0, rows: 0, rounds: 0, ricochets: 0, chains: 0, hits: 0, waiting: 0 };
  readonly last = { cmds: 0, rows: 0, rounds: 0, ricochets: 0, chains: 0, hits: 0, waiting: 0 };

  private nextId = 1;
  private seq = 1;
  private evPool: ShotEvent[] = [];
  private drawPool: ShotDraw[] = [];
  /** Per family: the register ids it has already hit (chains skip them). */
  private hitBy = new Map<number, number[]>();
  private o = new THREE.Vector3(); private d = new THREE.Vector3(); private hit = new THREE.Vector3();
  private steelAt = new THREE.Vector3(); private steelN = new THREE.Vector3();
  private pt = new THREE.Vector3(); private nn = [0, 1, 0];
  private rayHits = new RayHits(); private crossed = new Set<unknown>();
  private filter: Filter = { all: FLAG.Hittable };
  private near: number[] = [];
  private sheetF: SheetFire = { half: 0, height: 0, pen: 0 };
  private splashO: SplashOpts = {};
  private aimV = { x: 0, y: 0, z: 0 };

  constructor(readonly world: ShotWorld) {}

  /**
   * Fire a command: one row per round after split and rate (seeded). Returns the command's family id. Rows resolve in
   * the next step().
   */
  fire(c: ShotCmd, look: ShotLook): number {
    const v = this.world.v, pr = c.proto;
    const family = this.nextId;
    const seed = (c.seed ?? hash(this.seq++)) >>> 0;
    this.stats.cmds++;
    const split = Math.max(1, Math.round(pr?.split ?? 1)), rate = Math.max(1, Math.round(pr?.rate ?? 1));
    let splash = c.splash ?? 0, share = c.splashShare ?? 0;
    const area = pr?.area ?? 1;
    if (area > 1 || splash > 0) { if (splash <= 0) { splash = v.protoSplash; share = v.protoSplashShare; } splash *= area; }
    const lk = this.copyLook(look);
    const gap = (c.interval ?? v.protoRateGap) / rate;
    const s0 = new Uint32Array([seed]);
    const fan = (v.protoFan * Math.PI) / 180;
    for (let r = 0; r < rate; r++) {
      for (let s = 0; s < split; s++) {
        // Fan the split rounds across the aim; a rate copy jitters a little (seeded) so it isn't the same line.
        const yaw = (s - (split - 1) / 2) * fan + (r > 0 ? (rnd(s0, 0) - 0.5) * 0.04 : 0);
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const dxr = c.dir.x * cs + c.dir.z * sn, dzr = -c.dir.x * sn + c.dir.z * cs;
        const i = this.row(family, K_ROUND, 0, c.team, c.origin.x, c.origin.y, c.origin.z, dxr, c.dir.y, dzr, c.range, c.damage, lk, hash(seed + r * 977 + s * 131));
        if (i < 0) return family;
        this.wait[i] = r * gap;
        this.burnT[i] = pr?.burn?.time ?? 0; this.burnD[i] = pr?.burn?.dps ?? 0;
        this.ap[i] = c.pierce ?? UNSET_PIERCE;
        this.splash[i] = splash; this.splashShare[i] = share;
        this.ric[i] = Math.max(0, Math.round(pr?.ricochet ?? 0)); this.chain[i] = Math.max(0, Math.round(pr?.chain ?? 0));
        let f = F_TRACER * (look.tracer === false ? 0 : 1) | (r === 0 && s === 0 ? F_FIRST : 0);
        if (c.sheet) {
          f |= F_SHEET | (c.sheet.flat ? F_FLAT : 0);
          this.half[i] = c.sheet.half; this.height[i] = c.sheet.height; this.pen[i] = c.sheet.pen;
          this.line[i] = c.sheet.line ?? NaN; this.knock[i] = c.sheet.knock ?? 0;
          if (c.sheet.aim) {
            f |= F_AIM;
            // A split round's aim point turns with it (round the muzzle), so its sheet lies along its own line.
            const ax = c.sheet.aim.x - c.origin.x, az = c.sheet.aim.z - c.origin.z;
            this.ax[i] = c.origin.x + ax * cs + az * sn; this.ay[i] = c.sheet.aim.y; this.az[i] = c.origin.z - ax * sn + az * cs;
          }
        }
        this.flags[i] = f;
      }
    }
    return family;
  }

  /** One look per command, shared by its rows (the caller's vectors are reused, so they're copied). */
  private copyLook(l: ShotLook): ShotLook {
    return { slot: l.slot, flashScale: l.flashScale ?? 1, hitScale: l.hitScale ?? 1, voice: l.voice, tracer: l.tracer, own: l.own, hot: l.hot,
      eject: l.eject ? l.eject.clone() : null, outboard: l.outboard ? l.outboard.clone() : null };
  }

  /** Add a row; returns its index (-1 when full). */
  private row(family: number, kind: number, gen: number, team: number, x: number, y: number, z: number, dx: number, dy: number, dz: number,
    range: number, damage: number, look: ShotLook, seed: number): number {
    if (this.n >= CAP) return -1;
    const i = this.n++;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.ox[i] = x; this.oy[i] = y; this.oz[i] = z; this.dx[i] = dx / l; this.dy[i] = dy / l; this.dz[i] = dz / l;
    this.range[i] = range; this.damage[i] = damage; this.wait[i] = 0; this.splash[i] = 0; this.splashShare[i] = 0;
    this.team[i] = team; this.gen[i] = gen; this.kind[i] = kind; this.ric[i] = 0; this.chain[i] = 0; this.flags[i] = 0; this.burnT[i] = 0; this.burnD[i] = 0; this.ap[i] = UNSET_PIERCE;
    this.seed[i] = seed; this.id[i] = this.nextId++; this.family[i] = family; this.look[i] = look;
    return i;
  }

  /** Resolve every row that's due (waits count down by dt); children made on the way resolve in the same step. */
  step(dt: number) {
    for (const e of this.events) this.evPool.push(e);
    this.events.length = 0;
    for (const d of this.draws) this.drawPool.push(d);
    this.draws.length = 0;
    const cap = Math.max(1, this.world.v.shotsPerFrame);
    let done = 0;
    let keep = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.wait[i] > 0 || done >= cap) {
        this.wait[i] = Math.max(0, this.wait[i] - dt);
        if (keep !== i) this.move(i, keep);
        keep++;
        continue;
      }
      done++;
      this.resolve(i);
    }
    this.n = keep;
    this.stats.waiting = keep;
    Object.assign(this.last, this.stats);
    this.stats.cmds = 0; this.stats.rows = 0; this.stats.rounds = 0; this.stats.ricochets = 0; this.stats.chains = 0; this.stats.hits = 0;
    this.hitBy.clear();
  }

  private move(a: number, b: number) {
    for (const arr of [this.ox, this.oy, this.oz, this.dx, this.dy, this.dz, this.range, this.damage, this.wait, this.splash, this.splashShare,
      this.half, this.height, this.line, this.pen, this.knock, this.ax, this.ay, this.az, this.team, this.gen, this.kind, this.ric, this.chain,
      this.flags, this.seed, this.burnT, this.burnD, this.ap, this.id, this.family] as Float32Array[]) arr[b] = arr[a];
    this.look[b] = this.look[a];
  }

  private event(kind: ShotEvent["kind"], i: number, target: number, key: number, damage: number, x: number, y: number, z: number, count = 0) {
    const e = this.evPool.pop() ?? ({} as ShotEvent);
    e.kind = kind; e.shot = this.id[i]; e.family = this.family[i]; e.target = target; e.key = key; e.damage = damage;
    e.x = x; e.y = y; e.z = z; e.count = count;
    this.events.push(e);
    return e;
  }

  /** One row: what it hits, its damage (as events), its draw, then its ricochet and chain children. */
  private resolve(i: number) {
    const w = this.world, v = w.v, team = this.team[i];
    const o = this.o.set(this.ox[i], this.oy[i], this.oz[i]), d = this.d.set(this.dx[i], this.dy[i], this.dz[i]);
    const range = this.range[i], damage = this.damage[i], f = this.flags[i];
    this.stats.rows++;
    if (this.kind[i] === K_RICOCHET) this.stats.ricochets++; else if (this.kind[i] === K_CHAIN) this.stats.chains++; else this.stats.rounds++;
    let struck: Hittable | null = null;
    let surface: HitSurface = "sand";
    const draw = this.drawPool.pop() ?? { look: null as unknown as ShotLook, from: new THREE.Vector3(), dir: new THREE.Vector3(), to: new THREE.Vector3(), surface: "sand" as HitSurface, normal: new THREE.Vector3(), exits: [] as THREE.Vector3[], first: false };
    draw.exits.length = 0;
    const end = draw.to, normal = draw.normal;
    if (f & F_SHEET) {
      const sf = this.sheetF;
      sf.half = this.half[i]; sf.height = this.height[i]; sf.pen = this.pen[i];
      sf.line = Number.isNaN(this.line[i]) ? undefined : this.line[i];
      sf.flat = (f & F_FLAT) !== 0; sf.knock = this.knock[i] || undefined; sf.pierce = this.ap[i];
      sf.aim = f & F_AIM ? Object.assign(this.aimV, { x: this.ax[i], y: this.ay[i], z: this.az[i] }) : null;
      const sheet = makeSheet(w.field, o, d, range, sf, v);
      const shot = resolveSheet(w.field, w.targets, w.wrecks, team, sheet, damage, sf, d, v, true, undefined, w.register);
      for (const st of shot.result.steps) {
        const h = st.hit;
        if (!h.target) continue;
        this.event("hit", i, w.targets.indexOf(h.target), h.key, damage * st.share, h.x, h.y, h.z);
        this.stats.hits++;
        this.setAlight(i, h.target, h.key, h.x, h.y, h.z);
      }
      for (const x of shot.exits) draw.exits.push(x);
      const last = shot.result.steps[shot.result.steps.length - 1];
      struck = last?.stopped ? last.hit.target : null;
      end.copy(shot.end);
      surface = shot.surface;
      if (struck?.normalAt) struck.normalAt(end, normal); else if (surface === "sand") this.groundNormal(end, normal); else normal.copy(d).negate();
      // The flat line the tracer takes to where it ended (the sheet's own floor, not the muzzle's pitch).
      d.copy(end).sub(o).normalize();
    } else {
      let reach = range;
      if (rayGround(o, d, w.field, range, this.hit)) { reach = o.distanceTo(this.hit); end.copy(this.hit); surface = "sand"; this.groundNormal(end, normal); }
      else { end.copy(o).addScaledVector(d, range); normal.set(0, 1, 0); }
      if (w.wrecks?.hit(o, d, reach, this.steelAt, this.steelN)) { reach = o.distanceTo(this.steelAt); end.copy(this.steelAt); surface = "metal"; normal.copy(this.steelN); }
      const near = this.nearestOnRay(team, o, d, reach);
      if (near) {
        const dist = this.nearD;
        near.hitRay(o, d, dist + 1e-3);
        this.pt.copy(o).addScaledVector(d, dist);
        near.damage(damage, this.pt, d, this.ap[i]);
        this.event("hit", i, w.targets.indexOf(near), -1, damage, this.pt.x, this.pt.y, this.pt.z);
        this.stats.hits++;
        this.setAlight(i, near, -1, this.pt.x, this.pt.y, this.pt.z);
        struck = near; end.copy(this.pt); surface = near.surface;
        if (near.normalAt) near.normalAt(end, normal); else normal.copy(d).negate();
      }
    }
    if (!struck) this.event("miss", i, -1, -1, 0, end.x, end.y, end.z);
    // Splash: everything of theirs near where it ended (the swarms cull their own units through the register).
    if (this.splash[i] > 0 && this.splashShare[i] > 0) {
      let count = 0;
      this.splashO.pierce = this.ap[i];
      for (const t of w.targets) if (t.alive && t.team !== team && t.splash) count += t.splash(end, this.splash[i], damage * this.splashShare[i], d, this.splashO);
      if (count) this.event("splash", i, -1, -1, damage * this.splashShare[i], end.x, end.y, end.z, count);
    }
    const look = this.look[i]!;
    if (f & F_TRACER) {
      draw.look = look; draw.from.copy(o); draw.dir.copy(d); draw.surface = surface; draw.first = (f & F_FIRST) !== 0;
      this.draws.push(draw);
    } else this.drawPool.push(draw);
    const struckE = struck ? this.markHit(i, end) : -1;
    // ---- Protocols at the hit ----
    const gen = this.gen[i];
    if (gen + 1 > v.protoMaxGen) return;
    if (this.ric[i] > 0) {
      // A ricochet: the mirror bounce off what it hit, scattered (seeded), never back into the ground.
      const dn = d.dot(normal);
      let rx = d.x - 2 * dn * normal.x, ry = d.y - 2 * dn * normal.y, rz = d.z - 2 * dn * normal.z;
      const sc = (v.protoRicochetScatter * Math.PI) / 180;
      const yaw = (rnd(this.seed, i) - 0.5) * 2 * sc, lift = rnd(this.seed, i) * sc * 0.5;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const nx = rx * cs + rz * sn; rz = -rx * sn + rz * cs; rx = nx;
      ry = Math.max(0.05, ry + lift);
      const j = this.row(this.family[i], K_RICOCHET, gen + 1, team, end.x + normal.x * 0.15, end.y + normal.y * 0.15, end.z + normal.z * 0.15, rx, ry, rz,
        v.protoRicochetRange, damage * v.protoRicochetKeep, look, hash(this.seed[i] + 7));
      if (j >= 0) {
        this.ric[j] = this.ric[i] - 1; this.chain[j] = 0; this.flags[j] = f & F_TRACER; this.ap[j] = this.ap[i];
        this.splash[j] = this.splash[i]; this.splashShare[j] = this.splashShare[i];
        this.event("ricochet", i, -1, -1, this.damage[j], end.x, end.y, end.z);
      }
    }
    if (struck && this.chain[i] > 0) this.chainFrom(i, end, struckE, damage, look, f);
  }

  /** An ignited round's hit: the target burns (an event, then the burn system). */
  private setAlight(i: number, t: Hittable, key: number, x: number, y: number, z: number) {
    const time = this.burnT[i];
    if (!(time > 0) || !this.world.ignite) return;
    this.event("ignite", i, this.world.targets.indexOf(t), key, this.burnD[i], x, y, z);
    this.world.ignite(t, key, time, this.burnD[i], x, y, z);
  }

  private nearD = 0;
  /** The nearest body of another team the ray meets within maxDist; objects only tested where the register says the
   *  line comes within their reach (the swarms cull their own units). */
  private nearestOnRay(team: number, o: THREE.Vector3, d: THREE.Vector3, maxDist: number): Hittable | null {
    const w = this.world, reg = w.register;
    const cull = reg.stamp > 0;
    if (cull) {
      this.crossed.clear();
      this.filter.notTeam = team;
      const fl = Math.hypot(d.x, d.z);
      if (fl > 1e-4) {
        reg.ray(o.x, o.z, d.x / fl, d.z / fl, maxDist * fl, reg.slack, this.filter, this.rayHits, MEASURE.Reach);
        for (let k = 0; k < this.rayHits.n; k++) { const ref = reg.ref[this.rayHits.e[k]]; if (ref) this.crossed.add(ref); }
      } else cullNear(reg, o.x, o.z, 2 + reg.slack, this.filter, this.near, this.crossed);
    }
    let near: Hittable | null = null, nearD = maxDist;
    for (const t of w.targets) {
      if (!t.alive || t.team === team) continue;
      if (cull && !this.crossed.has(t) && reg.published(t)) continue;
      const dist = t.hitRay(o, d, nearD);
      if (dist >= 0 && dist < nearD) { nearD = dist; near = t; }
    }
    this.nearD = nearD;
    return near;
  }

  /** Remember the register entry nearest the hit as hit by this family (a chain won't come back to it); returns it. */
  private markHit(i: number, at: THREE.Vector3): number {
    const reg = this.world.register;
    if (!(this.chain[i] > 0) || reg.stamp === 0) return -1;
    this.filter.notTeam = this.team[i];
    const e = reg.nearest(at.x, at.z, 3, this.filter);
    if (e < 0) return -1;
    const fam = this.family[i];
    let list = this.hitBy.get(fam);
    if (!list) { list = []; this.hitBy.set(fam, list); }
    list.push(reg.id[e]);
    return e;
  }

  /**
   * A chain hop: from the struck body (its register entry `from`, else the hit point) to the nearest other enemy within
   * reach that this shot hasn't hit. The hop starts just outside the struck body, toward the next, so it can't strike
   * the same body again on its way out.
   */
  private chainFrom(i: number, at: THREE.Vector3, from: number, damage: number, look: ShotLook, f: number) {
    const v = this.world.v, reg = this.world.register;
    if (reg.stamp === 0) return;
    this.filter.notTeam = this.team[i];
    const hit = this.hitBy.get(this.family[i]) ?? [];
    reg.near(at.x, at.z, v.protoChainRange, this.filter, this.near);
    let best = -1, bd = Infinity;
    for (const e of this.near) {
      if (hit.includes(reg.id[e])) continue;
      const q = (reg.x[e] - at.x) ** 2 + (reg.z[e] - at.z) ** 2;
      if (q > 0.25 && q < bd) { bd = q; best = e; }
    }
    if (best < 0) return;
    hit.push(reg.id[best]);
    if (!this.hitBy.has(this.family[i])) this.hitBy.set(this.family[i], hit);
    let sx = at.x, sy = at.y, sz = at.z;
    if (from >= 0) {
      const ux = reg.x[best] - reg.x[from], uz = reg.z[best] - reg.z[from], ul = Math.hypot(ux, uz) || 1, k = reg.reach[from] + 0.05;
      sx = reg.x[from] + (ux / ul) * k; sy = reg.y[from]; sz = reg.z[from] + (uz / ul) * k;
    }
    const tx = reg.x[best] - sx, ty = reg.y[best] - sy, tz = reg.z[best] - sz;
    const j = this.row(this.family[i], K_CHAIN, this.gen[i] + 1, this.team[i], sx, sy, sz, tx, ty, tz,
      Math.hypot(tx, ty, tz) + 2, damage * v.protoChainKeep, look, hash(this.seed[i] + 13));
    if (j < 0) return;
    this.chain[j] = this.chain[i] - 1; this.ric[j] = 0; this.flags[j] = f & F_TRACER; this.ap[j] = this.ap[i];
    this.event("chain", i, -1, -1, this.damage[j], reg.x[best], reg.y[best], reg.z[best]);
  }

  private groundNormal(at: THREE.Vector3, out: THREE.Vector3) {
    const n = this.world.field.normal(at.x, at.z, this.nn);
    out.set(n[0], n[1], n[2]);
  }
}

/** Objects the register has within R of a point (a ray straight down: nothing to cull along). */
function cullNear(reg: Register, x: number, z: number, R: number, f: Filter, buf: number[], out: Set<unknown>) {
  reg.near(x, z, R, f, buf, MEASURE.Reach);
  for (const e of buf) { const ref = reg.ref[e]; if (ref) out.add(ref); }
}
