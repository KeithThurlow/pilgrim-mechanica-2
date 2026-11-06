// Crushers (Keith 2026-11-01): the heavy quad, a robot tier between the weapon quads (3.6 m, 700 hp) and the tall
// terraforming walkers (15 m). Chunky and crab-like: a wide, low carapace on four thick legs splayed out to the sides,
// that scuttles sideways when it's far off and turns its front to you when it's near. It's there to crunch things up:
// the front is a turbine maw (a jet intake ringed with sandworm teeth) that spins up and sucks in whatever is in front
// of it, salvage heaps and mechs alike, and grinds what reaches the lip; two pincers either side of the maw snap at
// anything close. Red is how it seeks (the lamps over the maw), blue is how it hurts (the intake's glow).
//
// Counterplay: the suck is a cone in front and the body turns slowly, so circle out of it, or sprint out of the pull
// (it's slower than a walk at the edge and nearly a walk at the lip). The open maw takes double damage.
//
// The walk is the robots' walker stepping (src/combat/robots.ts stepWalker, legs from src/combat/robotLegs.ts) with
// its own crab spec: feet in diagonal pairs, planted feet stay put, a foot left behind swings to its spot.
//
// Pure: no three.js. Commands in (the prey and the food it can see), events out. Ownership: host (health, attacks,
// pull, damage, eating); the seeker lamps' sweep is cosmetic. Randomness seeded per crusher.
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import { walkHip, walkHome, walkLeg, type V3, type WalkSpec } from "./robotLegs";

export const CRUSHER_DEFAULTS = {
  crusherSize: 6,
  crusherHeight: 3.2,
  crusherHull: 2200,
  crusherArmour: 10,
  crusherSpeed: 2.6,
  crusherAccel: 2,
  crusherTurn: 45,
  crusherNear: 7,
  crusherScuttle: 0.45,
  crusherSidleFar: 30,
  crusherHunt: 70,
  crusherStepTime: 0.5,
  crusherStepLift: 0.8,
  crusherStepAt: 0.28,
  crusherLegDamage: 0.5,
  crusherMawDamage: 2,
  crusherBlast: 0.8,
  // The maw (blue)
  crusherSuckRange: 20,
  crusherSuckCone: 40,
  crusherSpinUp: 1.3,
  crusherSuckTime: 4,
  crusherSuckEvery: 7,
  crusherPull: 4.5,
  crusherPullEdge: 1,
  crusherGrindReach: 4.5,
  crusherGrindDps: 80,
  crusherGrindPierce: 0.5,
  // The pincers
  crusherClawReach: 7.5,
  crusherClawWindup: 0.55,
  crusherClawDamage: 90,
  crusherClawPierce: 0.3,
  crusherClawEvery: 3.5,
  // Eating salvage
  crusherEatReach: 12,
  crusherEatTime: 2.5,
  crusherEatHeal: 250,
  // Its death (Keith 2026-11-06: "a massive explosion ... that's essentially what should summon these swarms"): the
  // turbine core spits sparks a moment, then goes up, huge, slow and shattering (the tall walkers' nova, bigger).
  crusherDeathOn: 1,
  crusherDeathDelay: 1.6,
  crusherDeathRadius: 34,
  crusherDeathDamage: 140,
  crusherDeathOwnDamage: 900,
  crusherDeathPierce: 0.5,
  crusherDeathShove: 28,
  crusherDeathNova: 2,
  crusherDeathSlow: 1.9,
  crusherDeathShatter: 1.6,
  crusherDeathBoom: 2.6,
  crusherDeathCrater: 0.55,
  crusherDeathCraterDepth: 4.5,
  crusherDeathHeight: 4,
};
export type CrusherValues = typeof CRUSHER_DEFAULTS;

const G = "Crushers", GM = "Crushers: maw", GC = "Crushers: pincers", GE = "Crushers: eating", GD = "Crushers: death";
export const CRUSHER_PARAMS: Param[] = [
  { key: "crusherSize", label: "Body width (m)", min: 2, max: 14, step: 0.1, group: G, tip: "The carapace across; legs, maw and pincers scale with it. A weapon quad is 3.6" },
  { key: "crusherHeight", label: "Body height (m above the sand)", min: 1, max: 8, step: 0.1, group: G },
  { key: "crusherHull", label: "Hit points", min: 100, max: 20000, step: 50, group: G, tip: "A weapon quad has 700, a strider 4000" },
  { key: "crusherArmour", label: "Armour (flat per hit)", min: 0, max: 40, step: 0.5, group: G },
  { key: "crusherSpeed", label: "Walk speed (m/s)", min: 0.3, max: 10, step: 0.1, group: G },
  { key: "crusherAccel", label: "Acceleration (m/s²)", min: 0.2, max: 10, step: 0.1, group: G },
  { key: "crusherTurn", label: "Turn (°/s)", min: 5, max: 360, step: 5, group: G, tip: "Slow on purpose: circle out of the maw's cone" },
  { key: "crusherNear", label: "Closes to (m from the maw)", min: 1, max: 30, step: 0.5, group: G },
  { key: "crusherScuttle", label: "Scuttle sideways (share)", min: 0, max: 1, step: 0.05, group: G, tip: "Sideways crab steps while it closes, the side flipping now and then" },
  { key: "crusherSidleFar", label: "Sidles side-on beyond (m)", min: 0, max: 200, step: 1, group: G, tip: "Far off it walks like a crab, side-on to you, and turns its front to you inside this. 0: always faces you" },
  { key: "crusherHunt", label: "Hunts you within (m)", min: 0, max: 300, step: 1, group: G, tip: "Further off it goes for the nearest salvage and eats it" },
  { key: "crusherStepTime", label: "Step time (s)", min: 0.15, max: 2, step: 0.01, group: G },
  { key: "crusherStepLift", label: "Step lift (m)", min: 0, max: 3, step: 0.05, group: G },
  { key: "crusherStepAt", label: "Steps when a foot is off by (share of the stance)", min: 0.05, max: 0.7, step: 0.01, group: G },
  { key: "crusherLegDamage", label: "Leg hits take (share)", min: 0, max: 1, step: 0.05, group: G },
  { key: "crusherMawDamage", label: "Open maw hits take (×)", min: 0, max: 5, step: 0.1, group: G, tip: "Shoot into the maw while it spins: its weak spot" },
  { key: "crusherBlast", label: "Blasts take (share)", min: 0, max: 1.5, step: 0.05, group: G },
  { key: "crusherSuckRange", label: "Suck reach (m)", min: 3, max: 60, step: 0.5, group: GM },
  { key: "crusherSuckCone", label: "Suck cone (± °)", min: 5, max: 90, step: 1, group: GM },
  { key: "crusherSpinUp", label: "Spin-up (s)", min: 0.1, max: 5, step: 0.05, group: GM, tip: "The tell: the fan spins, the teeth flare, the intake glows blue. Get out of the cone" },
  { key: "crusherSuckTime", label: "Sucks for (s)", min: 0.5, max: 12, step: 0.1, group: GM },
  { key: "crusherSuckEvery", label: "At most every (s)", min: 1, max: 40, step: 0.5, group: GM },
  { key: "crusherPull", label: "Pull at the lip (m/s)", min: 0, max: 15, step: 0.1, group: GM, tip: "The mech walks 6 m/s and sprints 8.5" },
  { key: "crusherPullEdge", label: "Pull at the reach's edge (m/s)", min: 0, max: 15, step: 0.1, group: GM },
  { key: "crusherGrindReach", label: "Grinds within (m of the maw)", min: 0.5, max: 15, step: 0.1, group: GM },
  { key: "crusherGrindDps", label: "Grind damage per second", min: 0, max: 500, step: 5, group: GM },
  { key: "crusherGrindPierce", label: "Grind armour pierce", min: 0, max: 1, step: 0.05, group: GM },
  { key: "crusherClawReach", label: "Reach (m from the body's front)", min: 1, max: 20, step: 0.1, group: GC },
  { key: "crusherClawWindup", label: "Wind-up (s)", min: 0.1, max: 3, step: 0.05, group: GC, tip: "The pincer rears and opens, then snaps" },
  { key: "crusherClawDamage", label: "Damage", min: 0, max: 600, step: 5, group: GC },
  { key: "crusherClawPierce", label: "Armour pierce", min: 0, max: 1, step: 0.05, group: GC },
  { key: "crusherClawEvery", label: "At most every (s)", min: 0.5, max: 20, step: 0.1, group: GC },
  { key: "crusherEatReach", label: "Eats salvage within (m of the maw)", min: 1, max: 40, step: 0.5, group: GE },
  { key: "crusherEatTime", label: "Eating a heap takes (s)", min: 0.2, max: 15, step: 0.1, group: GE },
  { key: "crusherEatHeal", label: "A heap heals it (hp)", min: 0, max: 3000, step: 10, group: GE },
  { key: "crusherDeathOn", label: "Death blast on", min: 0, max: 1, step: 1, group: GD, tip: "Keith 2026-11-06: a massive explosion when it dies, the signal that calls the swarm (Crusher sites)" },
  { key: "crusherDeathDelay", label: "Goes up after (s)", min: 0, max: 6, step: 0.05, group: GD, tip: "Its core spits sparks and whines this long first: get clear" },
  { key: "crusherDeathRadius", label: "Blast radius (m)", min: 2, max: 80, step: 0.5, group: GD },
  { key: "crusherDeathDamage", label: "Damage to the mech", min: 0, max: 800, step: 5, group: GD, tip: "And anything else not a robot. Full at the centre, half at the edge" },
  { key: "crusherDeathOwnDamage", label: "Damage to robots", min: 0, max: 4000, step: 10, group: GD },
  { key: "crusherDeathPierce", label: "Armour pierce", min: 0, max: 1, step: 0.05, group: GD },
  { key: "crusherDeathShove", label: "Shove (m/s)", min: 0, max: 80, step: 0.5, group: GD },
  { key: "crusherDeathHeight", label: "Goes up at (m above the ground)", min: 0, max: 20, step: 0.1, group: GD, tip: "Where the nova sits: a little over the wreck" },
  { key: "crusherDeathNova", label: "Nova look (×)", min: 0, max: 3, step: 0.05, group: GD },
  { key: "crusherDeathSlow", label: "Nova slowed (×)", min: 0.3, max: 4, step: 0.05, group: GD },
  { key: "crusherDeathShatter", label: "Hull shatters (×)", min: 0, max: 3, step: 0.05, group: GD, tip: "Shards and sparks (Reactor nova: shatter)" },
  { key: "crusherDeathBoom", label: "Extra boom (volume)", min: 0, max: 4, step: 0.05, group: GD },
  { key: "crusherDeathCrater", label: "Crater radius (share of blast)", min: 0, max: 1.5, step: 0.05, group: GD },
  { key: "crusherDeathCraterDepth", label: "Crater depth (m)", min: 0, max: 8, step: 0.1, group: GD },
];

/**
 * The crab's legs (× body width for the hips, × body height for the reach): splayed out to the sides, front and rear
 * pairs, the front left clear for the maw and pincers; long thighs rising to knees well over the carapace.
 */
export const CRUSHER_SPEC: WalkSpec = { angles: [58, 122, 238, 302].map((d) => (d * Math.PI) / 180), hipR: 0.42, hipDrop: 0.05, footR: 1.7, L1: 0.95, L2: 1.05, toe: 0.04, bendUp: 1.0 };
const LEGS = 4;

/** Body frame (× body width): the maw's centre ahead of and below the body centre, its radius; the pincers' tips. */
export const CRUSHER_FRAME = { mawZ: 0.44, mawY: -0.04, mawR: 0.2, clawX: 0.3, clawZ: 0.62, clawY: -0.12, bodyDeep: 0.8, bodyTall: 0.32 };

export const WALK = 0, SPIN = 1, SUCK = 2, CLAW = 3, EAT = 4, DOWNED = 5;
export const PART_BODY = 0, PART_LEG = 1, PART_MAW = 2;

export type CrusherEvent =
  | { type: "spin"; id: number }
  | { type: "grind"; id: number; damage: number; pierce: number; x: number; y: number; z: number }
  | { type: "clawWindup"; id: number; side: number }
  | { type: "claw"; id: number; side: number; x: number; y: number; z: number; hit: boolean; damage: number; pierce: number }
  | { type: "ate"; id: number; food: number; heal: number; x: number; y: number; z: number }
  | { type: "footfall"; id: number; x: number; y: number; z: number; k: number }
  | { type: "down"; id: number; x: number; y: number; z: number };

/** Its prey: where it is (the hull's middle), velocity, alive or not. */
export interface CrusherPrey { x: number; y: number; z: number; vx: number; vz: number; alive: boolean }
/** Salvage it can eat (stable ids; the caller owns the list and removes a heap on "ate"). */
export interface CrusherFood { id: number; x: number; y: number; z: number }

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const D2R = Math.PI / 180;
const v3 = (): V3 => ({ x: 0, y: 0, z: 0 });

export class Crusher {
  x: number; z: number; y: number;
  vx = 0; vz = 0;
  heading: number;
  /** Body centre height (world) and its lean (radians: pitch nose down, roll left down), eased. */
  bodyY: number;
  pitch = 0; roll = 0;
  health: number; maxHealth: number;
  alive = true;
  mode = WALK;
  modeT = 0;
  /** The pull on the prey this frame (m/s, world), toward the maw; zero when it isn't sucking it. */
  pullX = 0; pullZ = 0;
  /** The prey is at the lip, being ground. */
  grinding = false;
  /** Fan speed 0..1 (the drawer spins it; also the intake's glow). */
  spin = 0;
  /** The pincer striking (+1 its left, -1 its right) and how far through (0..1 wind-up, then 1..2 the snap). */
  clawSide = 1; clawT = 0;
  /** The heap it's eating (id, or -1) and how far through (0..1). */
  food = -1; eatShare = 0;
  /** Seeker lamps' sweep (radians, cosmetic) and whether it's hunting the prey (lamps hold steady). */
  seek = 0; hunting = false;
  hurt = 0;
  readonly footX = new Float32Array(LEGS); readonly footY = new Float32Array(LEGS); readonly footZ = new Float32Array(LEGS);
  /** Step progress per foot (-1 planted). */
  readonly stepT = new Float32Array(LEGS).fill(-1);
  private s0 = new Float32Array(LEGS * 3); private s1 = new Float32Array(LEGS * 3);
  private wait = new Uint8Array(LEGS);
  private suckClock: number;
  private clawClock = 0;
  private grindAcc = 0;
  private sideClock: number;
  private side: number;
  private seekClock = 0;
  readonly rand: () => number;

  constructor(readonly id: number, public v: CrusherValues, readonly ground: Ground, x: number, z: number, heading: number, seed = id * 7919 + 17) {
    this.rand = rng(seed);
    this.x = x; this.z = z; this.heading = heading;
    this.y = ground.height(x, z);
    this.bodyY = this.y + v.crusherHeight;
    this.health = this.maxHealth = v.crusherHull;
    this.suckClock = v.crusherSuckEvery * (0.2 + this.rand() * 0.4);
    this.side = this.rand() < 0.5 ? -1 : 1;
    this.sideClock = 4 + this.rand() * 5;
    const h = v3();
    for (let k = 0; k < LEGS; k++) {
      walkHome(CRUSHER_SPEC, x, z, v.crusherHeight, heading, k, h);
      this.footX[k] = h.x; this.footZ[k] = h.z; this.footY[k] = ground.height(h.x, h.z);
    }
  }

  get W() { return this.v.crusherSize; }
  get H() { return this.v.crusherHeight; }

  /** The maw's centre (world). */
  maw(out: V3 = v3()): V3 {
    const F = CRUSHER_FRAME, W = this.W, s = Math.sin(this.heading), c = Math.cos(this.heading);
    out.x = this.x + s * F.mawZ * W; out.z = this.z + c * F.mawZ * W;
    out.y = this.bodyY + F.mawY * W - Math.sin(this.pitch) * F.mawZ * W;
    return out;
  }
  /** A pincer's tip at rest (side 1: its left, +X at heading 0; world). */
  clawTip(side: number, out: V3 = v3()): V3 {
    const F = CRUSHER_FRAME, W = this.W, s = Math.sin(this.heading), c = Math.cos(this.heading);
    const lx = side * F.clawX * W, lz = F.clawZ * W;
    out.x = this.x + c * lx + s * lz; out.z = this.z - s * lx + c * lz; out.y = this.bodyY + F.clawY * W;
    return out;
  }
  /** Leg k's hip, knee and foot (world) for the drawer and the hits. */
  leg(k: number, hip: V3, knee: V3, tip: V3, foot: V3): number {
    walkHip(CRUSHER_SPEC, this.x, this.bodyY, this.z, this.W, this.heading, k, hip);
    foot.x = this.footX[k]; foot.y = this.footY[k]; foot.z = this.footZ[k];
    return walkLeg(CRUSHER_SPEC, hip, foot, this.H, this.heading, k, knee, tip);
  }
  /** The maw is open (spinning): hits on it take crusherMawDamage. */
  get open() { return this.alive && (this.mode === SPIN || this.mode === SUCK || this.mode === EAT); }
  partShare(part: number) { return part === PART_LEG ? this.v.crusherLegDamage : part === PART_MAW ? (this.open ? this.v.crusherMawDamage : 1) : 1; }

  /** The tell's share (0..1) for the attack under way. */
  charge() {
    const v = this.v;
    return this.mode === SPIN ? clamp(this.modeT / v.crusherSpinUp, 0, 1) : this.mode === CLAW ? clamp(this.modeT / v.crusherClawWindup, 0, 1) : this.mode === SUCK ? 1 : 0;
  }

  update(dt: number, prey: CrusherPrey | null, food: readonly CrusherFood[], emit: (e: CrusherEvent) => void) {
    const v = this.v;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.modeT += dt;
    this.pullX = this.pullZ = 0;
    this.grinding = false;
    if (!this.alive) {
      // Down: it settles onto its belly, the fan running down.
      this.spin = Math.max(0, this.spin - dt * 0.5);
      const g = this.ground.height(this.x, this.z) + this.H * 0.3;
      this.bodyY += (g - this.bodyY) * Math.min(1, dt * 2.5);
      this.vx = this.vz = 0;
      return;
    }
    this.suckClock -= dt; this.clawClock -= dt;
    const mw = this.maw(M0);
    const has = !!prey && prey.alive;
    const dx = has ? prey!.x - this.x : 0, dz = has ? prey!.z - this.z : 0, dist = Math.hypot(dx, dz) || 1;
    const mdx = has ? prey!.x - mw.x : 0, mdz = has ? prey!.z - mw.z : 0, mawDist = Math.hypot(mdx, mdz) || 1;
    this.hunting = has && dist < v.crusherHunt;
    const off = has ? Math.abs(wrap(Math.atan2(dx, dz) - this.heading)) : Math.PI;
    let wantFace = this.heading, mx = 0, mz = 0, turnK = 1;

    // What it goes for: the prey when it's within the hunt, else the nearest heap.
    let meal: CrusherFood | null = null;
    if (!this.hunting && this.mode !== EAT) {
      let best = Infinity;
      for (const f of food) { const d = Math.hypot(f.x - this.x, f.z - this.z); if (d < best) { best = d; meal = f; } }
    }
    if (this.mode === EAT) {
      meal = food.find((f) => f.id === this.food) ?? null;
      if (!meal || this.hunting) { this.mode = WALK; this.modeT = 0; this.food = -1; this.eatShare = 0; meal = null; }
    }

    if (this.mode === WALK) {
      this.spin = Math.max(0, this.spin - dt * 0.8);
      if (this.hunting) {
        const ux = dx / dist, uz = dz / dist;
        this.sideClock -= dt;
        if (this.sideClock <= 0) { this.sideClock = 4 + this.rand() * 6; this.side = -this.side; }
        const close = clamp((mawDist - v.crusherNear) / 6, -0.6, 1);
        if (v.crusherSidleFar > 0 && dist > v.crusherSidleFar) {
          // Far off: a crab, side-on to the prey (the side it's been scuttling), walking straight at it.
          wantFace = Math.atan2(dx, dz) + this.side * Math.PI / 2;
          mx = ux; mz = uz;
        } else {
          wantFace = Math.atan2(dx, dz);
          const s = v.crusherScuttle * this.side * (1 - Math.abs(close) * 0.4);
          mx = ux * close - uz * s; mz = uz * close + ux * s;
        }
        if (mawDist < v.crusherSuckRange && off < v.crusherSuckCone * D2R && this.suckClock <= 0 && dist <= v.crusherSidleFar + 1) {
          this.mode = SPIN; this.modeT = 0;
          emit({ type: "spin", id: this.id });
        } else if (mawDist < v.crusherClawReach + 2 && off < 80 * D2R && this.clawClock <= 0) {
          this.mode = CLAW; this.modeT = 0;
          // The pincer on the prey's side.
          const sx = Math.cos(this.heading) * dx - Math.sin(this.heading) * dz;
          this.clawSide = sx >= 0 ? 1 : -1;
          emit({ type: "clawWindup", id: this.id, side: this.clawSide });
        }
      } else if (meal) {
        const fx = meal.x - this.x, fz = meal.z - this.z, fd = Math.hypot(fx, fz) || 1;
        const md = Math.hypot(meal.x - mw.x, meal.z - mw.z);
        const foff = Math.abs(wrap(Math.atan2(fx, fz) - this.heading));
        wantFace = Math.atan2(fx, fz);
        const close = clamp((md - v.crusherEatReach * 0.5) / 4, 0, 1) * (foff < 0.6 ? 1 : 0.3);
        mx = (fx / fd) * close; mz = (fz / fd) * close;
        if (md < v.crusherEatReach && foff < v.crusherSuckCone * D2R) {
          this.mode = EAT; this.modeT = 0; this.food = meal.id; this.eatShare = 0;
          emit({ type: "spin", id: this.id });
        }
      }
    } else if (this.mode === SPIN) {
      this.spin = Math.min(1, this.spin + dt / Math.max(0.05, v.crusherSpinUp));
      if (has) wantFace = Math.atan2(dx, dz);
      turnK = 0.5;
      if (this.modeT >= v.crusherSpinUp) { this.mode = SUCK; this.modeT = 0; }
    } else if (this.mode === SUCK) {
      this.spin = 1;
      if (has) wantFace = Math.atan2(dx, dz);
      turnK = 0.35;
      if (has && mawDist < v.crusherSuckRange * 1.15 && off < v.crusherSuckCone * 1.3 * D2R) {
        const k = clamp(mawDist / v.crusherSuckRange, 0, 1);
        const pull = v.crusherPull + (v.crusherPullEdge - v.crusherPull) * k;
        // Toward the maw, but never into it: the pull fades out as the hull (about 2 m round) meets the lip.
        const near = clamp((mawDist - 2.2) / 1.5, 0, 1);
        this.pullX = (-mdx / mawDist) * pull * near; this.pullZ = (-mdz / mawDist) * pull * near;
        if (mawDist < v.crusherGrindReach) {
          this.grinding = true;
          this.grindAcc += v.crusherGrindDps * dt;
          if (this.grindAcc >= v.crusherGrindDps * 0.25 && this.grindAcc > 0) {
            emit({ type: "grind", id: this.id, damage: this.grindAcc, pierce: v.crusherGrindPierce, x: mw.x, y: mw.y, z: mw.z });
            this.grindAcc = 0;
          }
        }
      }
      if (this.modeT >= v.crusherSuckTime) {
        this.mode = WALK; this.modeT = 0; this.grindAcc = 0;
        this.suckClock = v.crusherSuckEvery * (0.85 + this.rand() * 0.3);
        this.clawClock = Math.max(this.clawClock, 1);
      }
    } else if (this.mode === CLAW) {
      this.clawT = Math.min(1, this.modeT / Math.max(0.05, v.crusherClawWindup));
      if (has) wantFace = Math.atan2(dx, dz);
      if (this.modeT >= v.crusherClawWindup) {
        const tip = this.clawTip(this.clawSide, M1);
        // The snap reaches out ahead of the rest pose.
        const s = Math.sin(this.heading), c = Math.cos(this.heading), reach = v.crusherClawReach - CRUSHER_FRAME.clawZ * this.W;
        const hx = tip.x + s * reach * 0.6, hz = tip.z + c * reach * 0.6;
        const hit = has && Math.hypot(prey!.x - hx, prey!.z - hz) < Math.max(2.5, reach * 0.8) + 1;
        emit({ type: "claw", id: this.id, side: this.clawSide, x: hx, y: tip.y, z: hz, hit, damage: v.crusherClawDamage, pierce: v.crusherClawPierce });
        this.mode = WALK; this.modeT = 0; this.clawT = 0;
        this.clawClock = v.crusherClawEvery * (0.85 + this.rand() * 0.3);
      }
    } else if (this.mode === EAT) {
      this.spin = Math.min(1, this.spin + dt / Math.max(0.05, v.crusherSpinUp));
      turnK = 0.5;
      if (meal) {
        wantFace = Math.atan2(meal.x - this.x, meal.z - this.z);
        this.eatShare = clamp(this.modeT / Math.max(0.05, v.crusherEatTime), 0, 1);
        if (this.eatShare >= 1) {
          this.health = Math.min(this.maxHealth, this.health + v.crusherEatHeal);
          emit({ type: "ate", id: this.id, food: meal.id, heal: v.crusherEatHeal, x: meal.x, y: meal.y, z: meal.z });
          this.mode = WALK; this.modeT = 0; this.food = -1; this.eatShare = 0;
        }
      }
    }
    if (this.mode !== CLAW) this.clawT = Math.max(0, this.clawT - dt * 3);

    // Seeker lamps sweep while it isn't hunting.
    this.seekClock += dt;
    const sweep = this.hunting ? 0 : Math.sin(this.seekClock * 1.7) * 0.5;
    this.seek += (sweep - this.seek) * Math.min(1, dt * 3);

    // Turn, then move (attacks root it).
    const turn = v.crusherTurn * D2R * turnK * dt;
    this.heading = wrap(this.heading + clamp(wrap(wantFace - this.heading), -turn, turn));
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    const moving = this.mode === WALK;
    const tvx = moving ? mx * v.crusherSpeed : 0, tvz = moving ? mz * v.crusherSpeed : 0;
    const a = v.crusherAccel * dt, ex = tvx - this.vx, ez = tvz - this.vz, el = Math.hypot(ex, ez);
    if (el <= a) { this.vx = tvx; this.vz = tvz; } else { this.vx += (ex / el) * a; this.vz += (ez / el) * a; }
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.y = this.ground.height(this.x, this.z);
    this.stepLegs(dt, emit);
  }

  /**
   * The feet (robots.ts stepWalker, crab spec): planted feet stay; the worst foot off its spot (led along the walk)
   * swings there, diagonal pairs at once, never with a neighbour. The body rides at its height over the sand and its
   * feet, leaning with the feet's plane.
   */
  private stepLegs(dt: number, emit: (e: CrusherEvent) => void) {
    const v = this.v, H = this.H, spec = CRUSHER_SPEC, spread = spec.footR * H;
    const T = Math.max(0.05, v.crusherStepTime), lift = v.crusherStepLift;
    const together = 2, turns = LEGS / together;
    const speed = Math.hypot(this.vx, this.vz);
    const thr = Math.min(spread * 0.6, Math.max(v.crusherStepAt * spread, turns * speed * T * 1.05));
    const lead = speed > 1e-3 ? ((speed * T + thr) / (2 * speed)) * Math.min(1, speed / 0.5) : 0;
    const home = M2, ix = IX, iz = IZ;
    let stepping = 0, sumY = 0;
    for (let k = 0; k < LEGS; k++) {
      walkHome(spec, this.x, this.z, H, this.heading, k, home);
      ix[k] = home.x + this.vx * lead; iz[k] = home.z + this.vz * lead;
      if (this.stepT[k] >= 0) {
        const t = Math.min(1, this.stepT[k] + dt / T), e = t * t * (3 - 2 * t), s0 = this.s0, s1 = this.s1, b = k * 3;
        this.stepT[k] = t;
        this.footX[k] = s0[b] + (s1[b] - s0[b]) * e;
        this.footZ[k] = s0[b + 2] + (s1[b + 2] - s0[b + 2]) * e;
        const gy = s0[b + 1] + (s1[b + 1] - s0[b + 1]) * e;
        this.footY[k] = gy + 4 * lift * t * (1 - t);
        sumY += gy;
        if (t >= 1) {
          this.stepT[k] = -1; this.wait[k] = 1;
          this.footY[k] = this.ground.height(this.footX[k], this.footZ[k]);
          emit({ type: "footfall", id: this.id, x: this.footX[k], y: this.footY[k], z: this.footZ[k], k: 1 });
        } else stepping++;
      } else sumY += this.footY[k];
    }
    let worst = -1, worstE = 0;
    for (let k = 0; k < LEGS; k++) {
      if (this.stepT[k] >= 0) continue;
      if (this.stepT[(k + 1) % LEGS] >= 0 || this.stepT[(k + LEGS - 1) % LEGS] >= 0) continue;
      const err = Math.hypot(this.footX[k] - ix[k], this.footZ[k] - iz[k]);
      if (this.wait[k] && err < thr * 2) continue;
      if (err > worstE) { worstE = err; worst = k; }
    }
    if (worst >= 0 && ((stepping < together && worstE > thr) || (stepping === together && worstE > thr * 1.6))) {
      const b = worst * 3;
      this.s0[b] = this.footX[worst]; this.s0[b + 1] = this.footY[worst]; this.s0[b + 2] = this.footZ[worst];
      this.s1[b] = ix[worst]; this.s1[b + 2] = iz[worst]; this.s1[b + 1] = this.ground.height(ix[worst], iz[worst]);
      this.stepT[worst] = 0; this.wait[worst] = 0;
      this.wait[(worst + 1) % LEGS] = 0; this.wait[(worst + LEGS - 1) % LEGS] = 0;
    }
    const want = (this.y + sumY / LEGS) * 0.5 + H;
    this.bodyY += (want - this.bodyY) * Math.min(1, dt * 4);
    // Lean with the feet: front pair against the back pair (pitch), left pair against the right (roll).
    const fy = (this.footY[0] + this.footY[3]) * 0.5, by = (this.footY[1] + this.footY[2]) * 0.5;
    const ly = (this.footY[0] + this.footY[1]) * 0.5, ry = (this.footY[2] + this.footY[3]) * 0.5;
    const len = spread * 2 * Math.cos(spec.angles[0]) || 1, wid = spread * 2 * Math.sin(spec.angles[0]);
    const wantPitch = clamp(Math.atan2(by - fy, len) * 0.6, -0.35, 0.35), wantRoll = clamp(Math.atan2(ry - ly, wid) * 0.6, -0.35, 0.35);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3);
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 3);
    // A planted foot the body has run away from is dragged along the sand rather than left out of reach.
    for (let k = 0; k < LEGS; k++) {
      if (this.stepT[k] >= 0) continue;
      const r = this.leg(k, LH, LK, LT, LF);
      if (r < 0.97) continue;
      const dx = this.footX[k] - LH.x, dz = this.footZ[k] - LH.z, dh = Math.hypot(dx, dz);
      if (dh < 1e-4) continue;
      const pull = Math.min(dh * 0.5, dh * (1 - 0.95 / r));
      this.footX[k] -= (dx / dh) * pull; this.footZ[k] -= (dz / dh) * pull;
      this.footY[k] = this.ground.height(this.footX[k], this.footZ[k]);
    }
  }

  hit(amount: number, emit: (e: CrusherEvent) => void) {
    if (!this.alive || !(amount > 0)) return;
    this.health -= amount;
    this.hurt = Math.min(1, this.hurt + amount / 300);
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.mode = DOWNED; this.modeT = 0;
      emit({ type: "down", id: this.id, x: this.x, y: this.bodyY, z: this.z });
    }
  }
}

const M0 = v3(), M1 = v3(), M2 = v3(), LH = v3(), LK = v3(), LT = v3(), LF = v3();
const IX = new Float32Array(LEGS), IZ = new Float32Array(LEGS);

/** The crushers on a field: stands them up, steps them, hands out ids. Host. */
export class Crushers {
  readonly list: Crusher[] = [];
  private nextId = 1;
  onEvent: ((e: CrusherEvent) => void) | null = null;
  /** Since construction (for the HUD and the check). */
  sucks = 0; claws = 0; clawHits = 0; ground = 0; eaten = 0; kills = 0;
  private emit = (e: CrusherEvent) => {
    if (e.type === "spin") this.sucks++;
    else if (e.type === "claw") { this.claws++; if (e.hit) this.clawHits++; }
    else if (e.type === "grind") this.ground += e.damage;
    else if (e.type === "ate") this.eaten++;
    else if (e.type === "down") this.kills++;
    this.onEvent?.(e);
  };

  constructor(public v: CrusherValues, public field: Ground, private seed = 1) {}

  spawn(x: number, z: number, heading: number): Crusher {
    const c = new Crusher(this.nextId++, this.v, this.field, x, z, heading, this.seed * 104729 + this.nextId * 7919);
    this.list.push(c);
    return c;
  }

  get alive() { let n = 0; for (const c of this.list) if (c.alive) n++; return n; }

  update(dt: number, prey: CrusherPrey | null, food: readonly CrusherFood[]) {
    for (const c of this.list) c.update(dt, prey, food, this.emit);
  }

  hit(c: Crusher, amount: number) { c.hit(amount, this.emit); }

  remove(c: Crusher) { const k = this.list.indexOf(c); if (k >= 0) this.list.splice(k, 1); }
}
