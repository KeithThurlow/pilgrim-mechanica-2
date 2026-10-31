// Bandits on foot, the sim (no drawing: infantryDraw.ts draws it). A swarm that runs at the mech over the dunes,
// stops in a firing band and shoots in loose bursts, keeps apart from its neighbours (spatial hash, no O(n²)),
// breaks and runs when too many die around it, gets knocked flat by a stomp and leaves bodies that sink away.
// Keith 2026-10-24: "a traditional swarm of bandits on foot ... you get to mow down swathes of bandits that are
// trying to take you out, shooting you with guns."
// Structure of arrays, INFANTRY_MAX slots; dead slots are reused once their body has sunk (or oldest body first).
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";
import { KIND, FLAG, type Register } from "../game/register";
import { closingSpeed, pairChance, threatOut, trampleFling, trampleHurt, type GroundThreat, type MechBody, type TrampleHit, type TrampleValues } from "./trample";

export const INFANTRY_DEFAULTS = {
  runSpeed: 4.5,
  banditPatrol: 0.4,
  speedJitter: 0.15,
  banditAccel: 6,
  banditTurn: 540,
  banditUphill: 1.4,
  downhillBoost: 0.3,
  flankAngle: 30,
  bandNear: 14,
  bandFar: 30,
  bandSlack: 6,
  backOff: 2,
  keepOut: 2,
  banditSpacing: 1.2,
  sepStrength: 3,
  bodyGap: 0.55,
  hp: 12,
  fireRange: 45,
  spreadDeg: 6,
  burstRounds: 4,
  roundInterval: 0.12,
  burstPause: 1.6,
  aimTime: 0.8,
  muzzleHeight: 1.35,
  moraleRadius: 9,
  fearPerDeath: 1,
  banditFleeAt: 3,
  bravery: 0.3,
  fearDecay: 0.35,
  dread: 0.4,
  dreadRange: 10,
  rallyAt: 0.35,
  rallyDist: 50,
  minFlee: 3,
  fleeSpeed: 5.5,
  downTime: 1.5,
  stompKill: 0.45,
  stompPush: 1.8,
  banditStompSpeed: 5,
  deathThrow: 3,
  bodyFriction: 6,
  bodyLife: 8,
  sinkTime: 2,
  banditHeight: 1.8,
  banditRadius: 0.35,
  diveChance: 0.33,
  diveNotice: 1.6,
  diveSpeed: 4.2,
  diveTime: 1.1,
  diveMargin: 0.8,
  evadeSpeed: 1.2,
};
export type InfantryValues = typeof INFANTRY_DEFAULTS;

export const INFANTRY_PARAMS: Param[] = [
  { key: "runSpeed", label: "Run speed (m/s)", min: 0.5, max: 10, step: 0.1, group: "Bandits" },
  { key: "banditPatrol", label: "Patrol walk (× run speed)", min: 0.1, max: 1, step: 0.01, group: "Bandits", tip: "How fast calm bandits (camp patrols, walking home) go" },
  { key: "speedJitter", label: "Speed spread ±", min: 0, max: 0.5, step: 0.01, group: "Bandits", tip: "Each bandit's own speed, so the swarm strings out" },
  { key: "banditAccel", label: "Acceleration (1/s)", min: 0.5, max: 20, step: 0.1, group: "Bandits" },
  { key: "banditTurn", label: "Turn rate (°/s)", min: 30, max: 1440, step: 10, group: "Bandits" },
  { key: "banditUphill", label: "Uphill slows", min: 0, max: 4, step: 0.05, group: "Bandits", tip: "Speed lost per unit of slope climbed" },
  { key: "downhillBoost", label: "Downhill boost (max)", min: 0, max: 1, step: 0.01, group: "Bandits" },
  { key: "flankAngle", label: "Flank fan (°)", min: 0, max: 80, step: 1, group: "Bandits", tip: "How wide they fan out round the mech on the way in" },
  { key: "bandNear", label: "Firing band near (m)", min: 4, max: 40, step: 0.5, group: "Bandits", tip: "Closer than this they back off while shooting" },
  { key: "bandFar", label: "Firing band far (m)", min: 6, max: 60, step: 0.5, group: "Bandits", tip: "Each bandit stops somewhere between near and far" },
  { key: "bandSlack", label: "Chase again past (m)", min: 1, max: 20, step: 0.5, group: "Bandits", tip: "How far the mech must pull away before a shooter runs after it again" },
  { key: "backOff", label: "Back-off speed (m/s)", min: 0, max: 5, step: 0.1, group: "Bandits" },
  { key: "keepOut", label: "Keep clear of mech (m)", min: 0, max: 8, step: 0.1, group: "Bandits", tip: "Beyond the mech's radius" },
  { key: "banditSpacing", label: "Spacing (m)", min: 0.4, max: 3, step: 0.05, group: "Bandits", tip: "Neighbours closer than this steer apart" },
  { key: "sepStrength", label: "Separation push (m/s)", min: 0, max: 10, step: 0.1, group: "Bandits" },
  { key: "bodyGap", label: "Hard body gap (m)", min: 0.2, max: 1.2, step: 0.01, group: "Bandits", tip: "Never closer than this: pushed apart in place" },
  { key: "hp", label: "Health", min: 1, max: 200, step: 1, group: "Bandits" },
  { key: "banditHeight", label: "Hit height (m)", min: 1, max: 2.5, step: 0.05, group: "Bandits" },
  { key: "banditRadius", label: "Hit radius (m)", min: 0.15, max: 0.8, step: 0.01, group: "Bandits" },
  { key: "fireRange", label: "Fire range (m)", min: 5, max: 80, step: 1, group: "Bandits: guns" },
  { key: "spreadDeg", label: "Spread (°)", min: 0, max: 20, step: 0.1, group: "Bandits: guns" },
  { key: "burstRounds", label: "Rounds per burst", min: 1, max: 12, step: 1, group: "Bandits: guns" },
  { key: "roundInterval", label: "Time between rounds (s)", min: 0.03, max: 0.6, step: 0.01, group: "Bandits: guns" },
  { key: "burstPause", label: "Pause between bursts (s)", min: 0.2, max: 6, step: 0.05, group: "Bandits: guns" },
  { key: "aimTime", label: "Aim before first burst (s)", min: 0, max: 3, step: 0.05, group: "Bandits: guns" },
  { key: "muzzleHeight", label: "Muzzle height (m)", min: 0.5, max: 2, step: 0.01, group: "Bandits: guns" },
  { key: "moraleRadius", label: "Sees deaths within (m)", min: 1, max: 30, step: 0.5, group: "Bandits: morale" },
  { key: "fearPerDeath", label: "Fear per death", min: 0, max: 3, step: 0.05, group: "Bandits: morale", tip: "Full at the bandit, half at the edge of the radius" },
  { key: "banditFleeAt", label: "Flees at fear", min: 0.5, max: 20, step: 0.1, group: "Bandits: morale" },
  { key: "bravery", label: "Bravery spread ±", min: 0, max: 0.8, step: 0.01, group: "Bandits: morale" },
  { key: "fearDecay", label: "Fear fades (/s)", min: 0, max: 3, step: 0.01, group: "Bandits: morale" },
  { key: "dread", label: "Fear near the mech (/s)", min: 0, max: 3, step: 0.01, group: "Bandits: morale", tip: "Fear gained each second standing close to the mech" },
  { key: "dreadRange", label: "Near the mech (m)", min: 0, max: 30, step: 0.5, group: "Bandits: morale" },
  { key: "rallyAt", label: "Rallies below (× flee)", min: 0, max: 1, step: 0.01, group: "Bandits: morale" },
  { key: "rallyDist", label: "Rallies beyond (m)", min: 10, max: 120, step: 1, group: "Bandits: morale" },
  { key: "minFlee", label: "Runs at least (s)", min: 0, max: 15, step: 0.1, group: "Bandits: morale" },
  { key: "fleeSpeed", label: "Flee speed (m/s)", min: 0.5, max: 10, step: 0.1, group: "Bandits: morale" },
  { key: "downTime", label: "Down for (s)", min: 0.2, max: 6, step: 0.05, group: "Bandits: stomp & bodies" },
  { key: "stompKill", label: "Stomp kills within (× radius)", min: 0, max: 1, step: 0.01, group: "Bandits: stomp & bodies" },
  { key: "stompPush", label: "Stomp pushes within (× radius)", min: 1, max: 4, step: 0.05, group: "Bandits: stomp & bodies" },
  { key: "banditStompSpeed", label: "Stomp throw (m/s)", min: 0, max: 15, step: 0.1, group: "Bandits: stomp & bodies" },
  { key: "deathThrow", label: "Death throw (m/s)", min: 0, max: 12, step: 0.1, group: "Bandits: stomp & bodies" },
  { key: "bodyFriction", label: "Body slide friction", min: 0.5, max: 20, step: 0.1, group: "Bandits: stomp & bodies" },
  { key: "bodyLife", label: "Bodies stay (s)", min: 1, max: 60, step: 0.5, group: "Bandits: stomp & bodies" },
  { key: "sinkTime", label: "Sink at the end (s)", min: 0.1, max: 10, step: 0.1, group: "Bandits: stomp & bodies" },
  { key: "diveChance", label: "Dodge chance", min: 0, max: 1, step: 0.01, group: "Bandits: dodge", tip: "Keith 2026-10-31: each bandit in the way of a charge or a telegraphed shot has this chance (seeded, one roll per bandit per threat) to dive out; the rest don't react" },
  { key: "diveNotice", label: "Notices it (s before it lands)", min: 0, max: 5, step: 0.05, group: "Bandits: dodge", tip: "A ring or strip landing later than this is ignored for now; a charge is always seen" },
  { key: "diveSpeed", label: "Dive speed (m/s)", min: 0.5, max: 12, step: 0.1, group: "Bandits: dodge" },
  { key: "diveTime", label: "Dive lasts (s)", min: 0.2, max: 2.5, step: 0.05, group: "Bandits: dodge", tip: "The roll clip plays sped up to fit" },
  { key: "diveMargin", label: "Clears the edge by (m)", min: 0, max: 4, step: 0.05, group: "Bandits: dodge" },
  { key: "evadeSpeed", label: "Runs out at (× run speed)", min: 0.5, max: 2.5, step: 0.05, group: "Bandits: dodge", tip: "After the roll, still inside, it sprints out of the footprint" },
];

export const INFANTRY_MAX = 1024;
export const ADVANCE = 0, FIRING = 1, FLEEING = 2, DOWN = 3, DEAD = 4;
/** An unused slot. */
export const EMPTY = 255;

const DEG = Math.PI / 180;
/** The hard keep-out round the target past its radius (m): the soft keepOut steers them off further. */
const BODY_SKIN = 0.05;
const HASH_SIZE = 4096, HASH_MASK = HASH_SIZE - 1;
const EVENTS_MAX = 2048;

export interface InfantryTarget { x: number; y: number; z: number; radius: number }
export type ShotFn = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, shooter: number) => void;

export class InfantrySwarm {
  readonly px = new Float32Array(INFANTRY_MAX); readonly py = new Float32Array(INFANTRY_MAX); readonly pz = new Float32Array(INFANTRY_MAX);
  readonly vx = new Float32Array(INFANTRY_MAX); readonly vz = new Float32Array(INFANTRY_MAX);
  /** Facing (radians, 0 = +Z). */
  readonly heading = new Float32Array(INFANTRY_MAX);
  readonly hp = new Float32Array(INFANTRY_MAX);
  readonly state = new Uint8Array(INFANTRY_MAX).fill(EMPTY);
  /** Seconds in the current state (DEAD: since death; the drawer sinks and fades from it). */
  readonly stateTime = new Float32Array(INFANTRY_MAX);
  readonly fireClock = new Float32Array(INFANTRY_MAX);
  readonly burstLeft = new Uint8Array(INFANTRY_MAX);
  readonly fear = new Float32Array(INFANTRY_MAX);
  /** Per-bandit spreads: speed ×, flee threshold ×, stopping distance in the band, flank side (-1..1). */
  readonly speedK = new Float32Array(INFANTRY_MAX); readonly braveK = new Float32Array(INFANTRY_MAX);
  readonly range = new Float32Array(INFANTRY_MAX); readonly flank = new Float32Array(INFANTRY_MAX);
  /** Smoothed climb along the run (rise over run), and the way a downed or dead body fell (radians). */
  readonly slope = new Float32Array(INFANTRY_MAX); readonly fallYaw = new Float32Array(INFANTRY_MAX);
  /** Cloth variant 0..3 and a 0..1 seed, for the drawer. */
  readonly look = new Uint8Array(INFANTRY_MAX); readonly seed = new Float32Array(INFANTRY_MAX);
  /** Bumped every time a slot is (re)spawned, so the drawer can reset per-slot state. */
  readonly gen = new Uint32Array(INFANTRY_MAX);
  /** Serial per bandit, handed out at spawn and never reused (the register's ids, rule 12). */
  readonly uid = new Uint32Array(INFANTRY_MAX);
  private nextUid = 1;
  /** Asleep: skipped by the step (a camp that has not woken, or one the player left; bodies and the downed still settle). */
  readonly frozen = new Uint8Array(INFANTRY_MAX);
  /** Calm: walks to its target spot and stands there, never shooting or afraid (a patrol, or the way home to the camp). */
  readonly calm = new Uint8Array(INFANTRY_MAX);
  /** Its own target instead of the one update() is given (a fight with another faction, a patrol point): set with
   *  setTarget(), cleared by clearTarget(). */
  readonly hasT = new Uint8Array(INFANTRY_MAX);
  readonly tgx = new Float32Array(INFANTRY_MAX); readonly tgy = new Float32Array(INFANTRY_MAX);
  readonly tgz = new Float32Array(INFANTRY_MAX); readonly tgr = new Float32Array(INFANTRY_MAX);
  private slotT: InfantryTarget = { x: 0, y: 0, z: 0, radius: 0 };
  /** Live (not DEAD) bandits. */
  count = 0;
  /** One past the highest slot ever used: loops stop here. */
  hi = 0;
  /** Rounds fired since construction (for checks and HUDs). */
  shots = 0;

  // Spatial hash (counting sort, rebuilt every update) over live bandits.
  private cellStart = new Int32Array(HASH_SIZE + 1);
  private cellFill = new Int32Array(HASH_SIZE);
  private cellOf = new Int32Array(INFANTRY_MAX);
  private sorted = new Int32Array(INFANTRY_MAX);
  private inv = 1;
  private cx = new Float32Array(INFANTRY_MAX); private cz = new Float32Array(INFANTRY_MAX);
  private evX = new Float32Array(EVENTS_MAX); private evZ = new Float32Array(EVENTS_MAX);
  private evN = 0;
  private rs: number;
  /** The swarm's seed (dodge decisions hash it with each bandit's uid and the threat's id). */
  readonly seedN: number;
  /** Dive roll: seconds left (0: not rolling), its flat way; evading: seconds left of running out, its way. */
  readonly diveT = new Float32Array(INFANTRY_MAX);
  readonly diveX = new Float32Array(INFANTRY_MAX); readonly diveZ = new Float32Array(INFANTRY_MAX);
  readonly evadeT = new Float32Array(INFANTRY_MAX);
  readonly outX = new Float32Array(INFANTRY_MAX); readonly outZ = new Float32Array(INFANTRY_MAX);
  /** The last threat id this bandit rolled for (one roll per threat). */
  readonly rolledFor = new Int32Array(INFANTRY_MAX);
  /** Dive rolls started since construction (checks, HUD). */
  dives = 0;
  /** Seconds before the mech's body can hurt this one again (trample). */
  readonly trampleCd = new Float32Array(INFANTRY_MAX);

  constructor(public v: InfantryValues, private ground: Ground, seed = 1) {
    this.rs = (seed >>> 0) || 1;
    this.seedN = this.rs;
  }

  /** Seeded random 0..1 (mulberry32). */
  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A free slot: an empty one, else the oldest body, else -1 (full of live bandits). */
  private freeSlot(): number {
    for (let i = 0; i < this.hi; i++) if (this.state[i] === EMPTY) return i;
    if (this.hi < INFANTRY_MAX) return this.hi++;
    let best = -1, bestT = -1;
    for (let i = 0; i < INFANTRY_MAX; i++) if (this.state[i] === DEAD && this.stateTime[i] > bestT) { bestT = this.stateTime[i]; best = i; }
    return best;
  }

  /** A group of n around (cx, cz) within radius, spaced so they don't start on top of each other. */
  spawn(n: number, cx: number, cz: number, radius: number): number[] {
    const v = this.v, made: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = this.freeSlot();
      if (i < 0) return made;
      made.push(i);
      // Sunflower spiral fill plus jitter: even spacing whatever n is.
      const r = radius * Math.sqrt((k + 0.5) / n), a = k * 2.39996 + this.rand() * 0.5;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      this.px[i] = x; this.pz[i] = z; this.py[i] = this.ground.height(x, z);
      this.vx[i] = 0; this.vz[i] = 0;
      this.heading[i] = this.rand() * Math.PI * 2;
      this.hp[i] = v.hp;
      this.state[i] = ADVANCE; this.stateTime[i] = 0;
      this.fireClock[i] = 0; this.burstLeft[i] = 0; this.fear[i] = 0;
      this.speedK[i] = 1 + (this.rand() * 2 - 1) * v.speedJitter;
      this.braveK[i] = 1 + (this.rand() * 2 - 1) * v.bravery;
      this.range[i] = this.rand();
      this.flank[i] = this.rand() * 2 - 1;
      this.slope[i] = 0; this.fallYaw[i] = 0;
      this.frozen[i] = 0; this.calm[i] = 0; this.hasT[i] = 0;
      this.diveT[i] = 0; this.evadeT[i] = 0; this.rolledFor[i] = 0; this.trampleCd[i] = 0;
      this.look[i] = Math.floor(this.rand() * 4); this.seed[i] = this.rand();
      this.gen[i]++;
      this.uid[i] = this.nextUid++;
      this.count++;
    }
    return made;
  }

  /** Take bandit i off the field (its camp streamed out). */
  remove(i: number) {
    if (this.state[i] === EMPTY) return;
    if (this.state[i] < DEAD) this.count--;
    this.state[i] = EMPTY; this.frozen[i] = 0; this.hasT[i] = 0; this.calm[i] = 0;
  }

  /** Give bandit i its own target (position, aim height, radius); calm: walk there and stand instead of fighting. */
  setTarget(i: number, x: number, y: number, z: number, radius: number, calm = false) {
    this.hasT[i] = 1; this.tgx[i] = x; this.tgy[i] = y; this.tgz[i] = z; this.tgr[i] = radius; this.calm[i] = calm ? 1 : 0;
  }
  clearTarget(i: number) { this.hasT[i] = 0; this.calm[i] = 0; }
  private targetOf(i: number, base: InfantryTarget): InfantryTarget {
    if (!this.hasT[i]) return base;
    const t = this.slotT;
    t.x = this.tgx[i]; t.y = this.tgy[i]; t.z = this.tgz[i]; t.radius = this.tgr[i];
    return t;
  }

  private hashOf(x: number, z: number): number {
    const ix = Math.floor(x * this.inv), iz = Math.floor(z * this.inv);
    return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
  }

  private buildHash() {
    const { cellStart, cellFill, cellOf, sorted, state } = this;
    this.inv = 1 / Math.max(0.3, this.v.banditSpacing);
    cellStart.fill(0);
    for (let i = 0; i < this.hi; i++) {
      if (state[i] >= DEAD) continue;
      const h = this.hashOf(this.px[i], this.pz[i]);
      cellOf[i] = h; cellStart[h + 1]++;
    }
    for (let h = 0; h < HASH_SIZE; h++) cellStart[h + 1] += cellStart[h];
    cellFill.set(cellStart.subarray(0, HASH_SIZE));
    for (let i = 0; i < this.hi; i++) if (state[i] < DEAD) sorted[cellFill[cellOf[i]]++] = i;
  }

  /**
   * Visit live bandits that may be within r of (x, z) (cells covering the square; hash collisions give extras,
   * so callers still test the distance). Valid until the next update.
   */
  near(x: number, z: number, r: number, fn: (j: number) => void) {
    const inv = this.inv, x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const h = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
      for (let s = this.cellStart[h], e = this.cellStart[h + 1]; s < e; s++) fn(this.sorted[s]);
    }
  }

  update(dt: number, base: InfantryTarget, onShot: ShotFn): void {
    const v = this.v, { px, py, pz, vx, vz, state, stateTime } = this;
    if (dt <= 0) return;
    this.buildHash();

    // Deaths since the last step frighten whoever saw them.
    const mr2 = v.moraleRadius * v.moraleRadius;
    for (let e = 0; e < this.evN; e++) {
      const ex = this.evX[e], ez = this.evZ[e];
      for (let i = 0; i < this.hi; i++) {
        if (state[i] >= DOWN) continue;
        const dx = px[i] - ex, dz = pz[i] - ez, d2 = dx * dx + dz * dz;
        if (d2 < mr2) this.fear[i] += v.fearPerDeath * (1 - 0.5 * Math.sqrt(d2 / mr2));
      }
    }
    this.evN = 0;

    const sp = v.banditSpacing, sp2 = sp * sp, gap = v.bodyGap;
    const turn = v.banditTurn * DEG * dt;
    const steer = Math.min(1, v.banditAccel * dt);
    const spread = v.spreadDeg * DEG;
    const fleeAt = v.banditFleeAt;
    const cx = this.cx, cz = this.cz;

    for (let i = 0; i < this.hi; i++) {
      const s = state[i];
      cx[i] = 0; cz[i] = 0;
      if (s === EMPTY) continue;
      if (this.frozen[i] && s < DOWN) continue;
      stateTime[i] += dt;
      if (this.trampleCd[i] > 0) this.trampleCd[i] -= dt;
      if (this.evadeT[i] > 0) this.evadeT[i] -= dt;
      if (this.diveT[i] > 0 && (this.diveT[i] -= dt) <= 0) this.diveT[i] = 0;

      if (s === DEAD) {
        if (stateTime[i] >= v.bodyLife) { state[i] = EMPTY; continue; }
        const f = Math.max(0, 1 - v.bodyFriction * dt);
        vx[i] *= f; vz[i] *= f;
        if (vx[i] * vx[i] + vz[i] * vz[i] > 1e-6) {
          px[i] += vx[i] * dt; pz[i] += vz[i] * dt; py[i] = this.ground.height(px[i], pz[i]);
        }
        continue;
      }

      const target = this.targetOf(i, base), calm = this.calm[i] === 1;
      const keep = target.radius + v.keepOut;
      const tx = target.x - px[i], tz = target.z - pz[i];
      const dist = Math.hypot(tx, tz) || 1e-6;
      const ux = tx / dist, uz = tz / dist;

      // Fear: fades, and builds standing close to the mech.
      this.fear[i] = Math.max(0, this.fear[i] - v.fearDecay * dt);
      if (dist < v.dreadRange && !calm) this.fear[i] += v.dread * dt;
      const brave = fleeAt * this.braveK[i];

      let st = s;
      if (st === DOWN) {
        if (stateTime[i] >= v.downTime * (0.8 + 0.4 * this.seed[i])) { st = this.fear[i] > brave ? FLEEING : ADVANCE; }
      } else if (st !== FLEEING && this.fear[i] > brave && !calm) st = FLEEING;
      else if (st === FLEEING && stateTime[i] > v.minFlee && this.fear[i] < brave * v.rallyAt && dist > v.rallyDist) st = ADVANCE;
      const stop = v.bandNear + this.range[i] * Math.max(0, v.bandFar - v.bandNear);
      if (calm) { if (st === FIRING) st = ADVANCE; }
      else if (st === ADVANCE && dist <= stop) st = FIRING;
      else if (st === FIRING && dist > stop + v.bandSlack) st = ADVANCE;
      if (st !== s) {
        state[i] = st; stateTime[i] = 0;
        if (st === FIRING) { this.fireClock[i] = v.aimTime * (0.5 + this.rand()); this.burstLeft[i] = 0; }
      }

      // Desired velocity.
      let wx = 0, wz = 0, face = NaN;
      const climb = this.slope[i];
      const hill = Math.max(0.35, Math.min(1 + v.downhillBoost, 1 - climb * v.banditUphill));
      if (st === ADVANCE) {
        // Fan out round the mech on the way in; straight at it once close.
        const fa = this.flank[i] * v.flankAngle * DEG * Math.min(1, dist / 60);
        const c = Math.cos(fa), sn = Math.sin(fa);
        const spd = v.runSpeed * this.speedK[i] * hill * (calm ? v.banditPatrol : 1);
        // Calm ones (a patrol point, the way home) walk straight to the spot and stand there.
        if (calm) { if (dist > 1.2) { wx = ux * spd; wz = uz * spd; } }
        else { wx = (ux * c - uz * sn) * spd; wz = (uz * c + ux * sn) * spd; }
      } else if (st === FIRING) {
        face = Math.atan2(ux, uz);
        if (dist < v.bandNear) { wx = -ux * v.backOff; wz = -uz * v.backOff; }
      } else if (st === FLEEING) {
        const spd = v.fleeSpeed * this.speedK[i] * hill;
        const fa = this.flank[i] * 0.6;
        const c = Math.cos(fa), sn = Math.sin(fa);
        wx = -(ux * c - uz * sn) * spd; wz = -(uz * c + ux * sn) * spd;
      }
      // Out of the way of something coming down (dodge()): run out of its footprint, whatever else it was doing.
      const diving = this.diveT[i] > 0 && st < DOWN;
      if (this.evadeT[i] > 0 && st < DOWN) {
        const spd = v.runSpeed * v.evadeSpeed * this.speedK[i] * hill;
        wx = this.outX[i] * spd; wz = this.outZ[i] * spd; face = NaN;
      }

      if (st === DOWN) {
        const f = Math.max(0, 1 - v.bodyFriction * dt);
        vx[i] *= f; vz[i] *= f;
      } else {
        // Separation from neighbours (soft steer) and a hard gap (positional, applied after the loop).
        let sx = 0, sz = 0;
        const xi = px[i], zi = pz[i];
        const inv = this.inv, ix0 = Math.floor((xi - sp) * inv), iz0 = Math.floor((zi - sp) * inv);
        for (let ix = ix0; ix <= ix0 + 2; ix++) for (let iz = iz0; iz <= iz0 + 2; iz++) {
          const h = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HASH_MASK;
          for (let q = this.cellStart[h], e = this.cellStart[h + 1]; q < e; q++) {
            const j = this.sorted[q];
            if (j === i) continue;
            const dx = xi - px[j], dz = zi - pz[j], d2 = dx * dx + dz * dz;
            if (d2 >= sp2) continue;
            const d = Math.sqrt(d2);
            let nx: number, nz: number;
            if (d > 1e-5) { nx = dx / d; nz = dz / d; } else { const a = (i * 2.39996) % (Math.PI * 2); nx = Math.cos(a); nz = Math.sin(a); }
            const w = 1 - d / sp;
            sx += nx * w; sz += nz * w;
            if (d < gap) { const push = (gap - d) * 0.5; cx[i] += nx * push; cz[i] += nz * push; }
          }
        }
        wx += sx * v.sepStrength; wz += sz * v.sepStrength;
        // Don't press into the mech.
        if (dist < keep + 1.5) {
          const into = wx * ux + wz * uz;
          if (into > 0) { wx -= ux * into; wz -= uz * into; }
        }
        vx[i] += (wx - vx[i]) * steer; vz[i] += (wz - vz[i]) * steer;
        // A dive roll goes its own way at its own speed (the roll clip faces it).
        if (diving) { vx[i] = this.diveX[i] * v.diveSpeed; vz[i] = this.diveZ[i] * v.diveSpeed; face = Math.atan2(this.diveX[i], this.diveZ[i]); }
        // Facing: where it runs, or at the mech when shooting.
        const speed2 = vx[i] * vx[i] + vz[i] * vz[i];
        if (Number.isNaN(face) && speed2 > 0.25) face = Math.atan2(vx[i], vz[i]);
        if (!Number.isNaN(face)) {
          let dh = face - this.heading[i];
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.heading[i] += Math.max(-turn, Math.min(turn, dh));
        }
      }

      // Guns.
      if (st === FIRING && dist < v.fireRange && !diving && this.evadeT[i] <= 0) {
        this.fireClock[i] -= dt;
        if (this.fireClock[i] <= 0) {
          if (this.burstLeft[i] === 0) this.burstLeft[i] = v.burstRounds;
          this.fire(i, target, dist, spread, onShot);
          this.burstLeft[i]--;
          this.fireClock[i] += this.burstLeft[i] > 0 ? v.roundInterval : v.burstPause * (0.6 + 0.8 * this.rand());
        }
      }
    }

    // Move, apply the hard gaps, keep clear of the mech, stand on the sand.
    for (let i = 0; i < this.hi; i++) {
      const s = state[i];
      if (s >= DEAD || (this.frozen[i] && s < DOWN)) continue;
      const target = this.targetOf(i, base), calm = this.calm[i] === 1;
      const ox = px[i], oz = pz[i], oy = py[i];
      let x = ox + vx[i] * dt + cx[i], z = oz + vz[i] * dt + cz[i];
      // Never inside the mech's body (keepOut is a soft steer above, so the body can reach them: trample).
      const dx = x - target.x, dz = z - target.z, d = Math.hypot(dx, dz), m = calm ? 0 : target.radius + BODY_SKIN;
      if (d < m) {
        if (d > 1e-5) { x = target.x + (dx / d) * m; z = target.z + (dz / d) * m; } else { x = target.x + m; }
      }
      px[i] = x; pz[i] = z;
      const y = this.ground.height(x, z);
      py[i] = y;
      const run = Math.hypot(x - ox, z - oz);
      if (run > 1e-4) {
        const k = Math.min(1, dt * 4);
        this.slope[i] += ((y - oy) / run - this.slope[i]) * k;
      }
    }
  }

  private fire(i: number, t: InfantryTarget, dist: number, spread: number, onShot: ShotFn) {
    const v = this.v, h = this.heading[i];
    const fx = this.px[i] + Math.sin(h) * 0.45, fz = this.pz[i] + Math.cos(h) * 0.45, fy = this.py[i] + v.muzzleHeight;
    let dx = t.x - fx, dy = t.y - fy, dz = t.z - fz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // Random direction inside the spread cone (uniform over the disc).
    const r = spread * Math.sqrt(this.rand()), a = this.rand() * Math.PI * 2;
    // Basis perpendicular to the aim.
    let rx = dz, rz = -dx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl; // right (flat)
    const ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx; // up = dir × right
    const ul = Math.hypot(ux, uy, uz) || 1;
    const ca = Math.cos(a) * Math.tan(r), sa = Math.sin(a) * Math.tan(r);
    let ex = dx + rx * ca + (ux / ul) * sa, ey = dy + (uy / ul) * sa, ez = dz + rz * ca + (uz / ul) * sa;
    const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    const reach = Math.max(L, dist) * 1.5;
    this.shots++;
    onShot(fx, fy, fz, fx + ex * reach, fy + ey * reach, fz + ez * reach, i);
  }

  /** Nearest standing bandit hit by a ray (vertical cylinder of radius × height), or null. only: test just these (the
   *  register's candidates), else every one. */
  hitRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, only: readonly number[] | null = null): { index: number; dist: number } | null {
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return null;
    dx /= L; dy /= L; dz /= L;
    const r = this.v.banditRadius, r2 = r * r, H = this.v.banditHeight;
    const a = dx * dx + dz * dz;
    let best = -1, bestT = maxDist;
    for (let j = 0, n = only ? only.length : this.hi; j < n; j++) {
      const i = only ? only[j] : j;
      const s = this.state[i];
      if (s === DOWN || s >= DEAD) continue;
      const qx = ox - this.px[i], qz = oz - this.pz[i];
      // Cylinder side interval.
      let t0: number, t1: number;
      const c = qx * qx + qz * qz - r2;
      if (a < 1e-9) { if (c > 0) continue; t0 = -Infinity; t1 = Infinity; }
      else {
        const b = qx * dx + qz * dz, disc = b * b - a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        t0 = (-b - sq) / a; t1 = (-b + sq) / a;
      }
      // Height slab interval.
      const y0 = this.py[i], qy = oy - y0;
      let s0: number, s1: number;
      if (Math.abs(dy) < 1e-9) { if (qy < 0 || qy > H) continue; s0 = -Infinity; s1 = Infinity; }
      else { const ta = -qy / dy, tb = (H - qy) / dy; s0 = Math.min(ta, tb); s1 = Math.max(ta, tb); }
      const enter = Math.max(t0, s0, 0), exit = Math.min(t1, s1);
      if (enter <= exit && enter < bestT) { bestT = enter; best = i; }
    }
    return best < 0 ? null : { index: best, dist: bestT };
  }

  /** Called when a bandit dies: its index, the flat direction it was thrown and how hard (m/s). */
  onDeath: ((i: number, nx: number, nz: number, speed: number) => void) | null = null;
  /** True when something else draws the dead (the death physics' ragdolls): the drawer then hides them. */
  hideDead = false;

  private kill(i: number, dirX: number, dirZ: number, throwSpeed: number) {
    const l = Math.hypot(dirX, dirZ);
    const nx = l > 1e-6 ? dirX / l : Math.sin(this.heading[i]), nz = l > 1e-6 ? dirZ / l : Math.cos(this.heading[i]);
    const s = throwSpeed * (0.6 + 0.8 * this.rand());
    this.state[i] = DEAD; this.stateTime[i] = 0; this.hp[i] = 0;
    this.vx[i] = nx * s; this.vz[i] = nz * s;
    this.fallYaw[i] = Math.atan2(nx, nz);
    this.count--;
    if (this.evN < EVENTS_MAX) { this.evX[this.evN] = this.px[i]; this.evZ[this.evN] = this.pz[i]; this.evN++; }
    this.onDeath?.(i, nx, nz, s);
  }

  /** Into the register (src/game/register.ts): every standing bandit at its centre of mass, light (rounds carry on). */
  publish(reg: Register, team: number, ref: unknown = null): void {
    const y = this.v.banditHeight * 0.55, r = Math.max(0.6, this.v.banditRadius);
    const flags = FLAG.Hittable | FLAG.Detectable | FLAG.Light;
    for (let i = 0; i < this.hi; i++) {
      if (this.state[i] >= DOWN) continue; // down, dead, empty (rounds pass over the downed too)
      reg.put(i, this.uid[i], KIND.Unit, team, this.frozen[i] ? flags | FLAG.Asleep : flags, this.px[i], this.py[i] + y, this.pz[i], r, 0, this.vx[i], this.vz[i], 0, ref);
    }
  }

  /** Damage a live bandit; returns true if this killed it. Death throws the body along (dirX, dirZ). */
  damage(i: number, amount: number, dirX: number, dirZ: number, throwSpeed = this.v.deathThrow): boolean {
    if (i < 0 || i >= this.hi || this.state[i] >= DEAD) return false;
    this.hp[i] -= amount;
    if (this.hp[i] > 0) return false;
    this.kill(i, dirX, dirZ, throwSpeed);
    return true;
  }

  /** A mech foot landing: closest killed, within radius knocked down, a little further pushed away. */
  /** A dashing mech ploughs through: standing bandits within radius are hurt and knocked flying along and away. */
  shove(x: number, z: number, radius: number, dirX: number, dirZ: number, speed: number, damage: number): number {
    let n = 0;
    for (let i = 0; i < this.hi; i++) {
      if (this.state[i] >= DOWN) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z, d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      const nx = d > 1e-5 ? dx / d : dirX, nz = d > 1e-5 ? dz / d : dirZ;
      const ox = dirX + nx, oz = dirZ + nz, ol = Math.hypot(ox, oz) || 1;
      n++;
      if (this.damage(i, damage, ox / ol, oz / ol)) continue;
      this.state[i] = DOWN; this.stateTime[i] = 0;
      this.fallYaw[i] = Math.atan2(ox, oz);
      this.vx[i] = (ox / ol) * speed; this.vz[i] = (oz / ol) * speed;
      this.fear[i] += this.v.fearPerDeath;
    }
    return n;
  }

  /**
   * The mech's body running into them (Keith 2026-10-31, src/combat/trample.ts): every bandit (standing or down)
   * within its reach takes damage by the closing speed through hurt(i, damage, dirX, dirZ) (the caller's hit adapter:
   * InfantryTarget, so kills count) and is knocked down and flung along the mech's way; a slow body only nudges.
   * Hits go into out as plain data. Returns how many it touched.
   */
  trample(b: MechBody, tv: TrampleValues, hurt: (i: number, damage: number, dx: number, dz: number, fling: number) => boolean, out: TrampleHit[] | null = null): number {
    const v = this.v, R = b.reach + v.banditRadius;
    let n = 0;
    for (let i = 0; i < this.hi; i++) {
      const s = this.state[i];
      if (s >= DEAD || this.trampleCd[i] > 0) continue;
      const dx = this.px[i] - b.x, dz = this.pz[i] - b.z;
      if (dx * dx + dz * dz >= R * R) continue;
      const c = closingSpeed(b, this.px[i], this.pz[i], this.vx[i], this.vz[i]);
      if (c.closing < tv.trampleDown) continue;
      n++;
      this.trampleCd[i] = 0.35;
      // Flung along the mech's way and out to its side.
      const sp = Math.hypot(b.vx, b.vz) || 1, ox = b.vx / sp + c.nx, oz = b.vz / sp + c.nz, ol = Math.hypot(ox, oz) || 1;
      const fx = ox / ol, fz = oz / ol, fling = trampleFling(c.rel, tv);
      const dmg = trampleHurt(c.rel, tv, b.crush);
      const x = this.px[i], z = this.pz[i];
      const killed = dmg > 0 && hurt(i, dmg, fx, fz, fling);
      if (!killed) {
        this.state[i] = DOWN; this.stateTime[i] = 0; this.diveT[i] = 0; this.evadeT[i] = 0;
        this.fallYaw[i] = Math.atan2(fx, fz);
        this.vx[i] = fx * fling; this.vz[i] = fz * fling;
        this.fear[i] += v.fearPerDeath;
      }
      out?.push({ kind: "bandit", id: this.uid[i], damage: dmg, closing: c.rel, killed, x, z });
    }
    return n;
  }

  /**
   * Threats on the ground (the player's rings and strips, the charging mech's line): each standing bandit inside
   * one decides once, seeded by its uid and the threat's id, whether it noticed (diveChance); those that did dive roll
   * out of it (once per threat) and run on out while still inside. Rings and strips are only seen within diveNotice
   * of landing. Keith 2026-10-31: "enemies only have a chance to dive roll out of / dodge your targeted abilities".
   */
  dodge(threats: readonly GroundThreat[]): void {
    if (!threats.length) return;
    const v = this.v, m = v.diveMargin + v.banditRadius;
    for (let i = 0; i < this.hi; i++) {
      if (this.state[i] >= DOWN || this.frozen[i]) continue;
      for (const t of threats) {
        if (t.t > v.diveNotice) continue;
        const o = threatOut(t, this.px[i], this.pz[i], m);
        if (!o.inside) continue;
        if (pairChance(this.seedN, this.uid[i], t.id) >= v.diveChance) continue;
        this.evadeT[i] = 0.25; this.outX[i] = o.ox; this.outZ[i] = o.oz;
        if (this.rolledFor[i] !== t.id && this.diveT[i] <= 0) {
          this.rolledFor[i] = t.id;
          this.diveT[i] = v.diveTime; this.diveX[i] = o.ox; this.diveZ[i] = o.oz;
          this.heading[i] = Math.atan2(o.ox, o.oz);
          this.dives++;
        }
        break;
      }
    }
  }

  stomp(x: number, z: number, radius: number): void {
    const v = this.v, kill = radius * v.stompKill, push = radius * v.stompPush;
    for (let i = 0; i < this.hi; i++) {
      const s = this.state[i];
      if (s >= DEAD) continue;
      const dx = this.px[i] - x, dz = this.pz[i] - z, d = Math.hypot(dx, dz);
      if (d >= push) continue;
      const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
      if (d < kill) { this.kill(i, nx, nz, v.banditStompSpeed); continue; }
      const k = 1 - d / push;
      if (d < radius) {
        this.state[i] = DOWN; this.stateTime[i] = 0;
        this.fallYaw[i] = Math.atan2(nx, nz);
        this.vx[i] = nx * v.banditStompSpeed * (0.5 + k); this.vz[i] = nz * v.banditStompSpeed * (0.5 + k);
        this.fear[i] += v.fearPerDeath;
      } else {
        this.vx[i] += nx * v.banditStompSpeed * k; this.vz[i] += nz * v.banditStompSpeed * k;
      }
    }
  }
}
