// The test swarm (Keith 2026-11-04: "a respawning swarm that sits off to the side, to test damage across area, with
// weaker and stronger kinds"): a pen of still bodies standing off to the side of the weapon review lab's range, for
// measuring clear rather than single-target DPS. Each body is a Hittable (rounds, sheets, blasts, beams all reach it
// as they reach the range's dummies). It counts useful damage (capped at each body's health, so overkill isn't
// clear), kills, bodies hurt per impact, and the time to clear a wave; the whole wave stands up again after a pause
// (or each body after `tsRespawn` s). Pure sim and maths; drawing in testSwarmDraw.ts. Lab-only, cosmetic ownership.
// Layout is seeded (tsSeed), so a tier lays out the same every time.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable, SplashOpts } from "./battlefield";
import { armourHit } from "./armour";
import type { HitSurface } from "../fx/minigun";
import { rayCapsule, capsuleNormal } from "./mechUnit";
import { inBand, sheetCircle, type PenMaterial, type Sheet, type SheetHit } from "./sheet";

export const TEST_SWARM_DEFAULTS = {
  tsCount: 36,
  tsHp: 12,
  tsArmour: 0,
  tsDensity: 0.2,
  tsRadius: 0.5,
  tsHeight: 1,
  tsMaterial: 0,
  tsShape: 0,
  tsDist: 25,
  tsAngle: 50,
  tsRespawn: 0,
  tsPause: 1,
  tsWindow: 5,
  tsSeed: 1,
};
export type TestSwarmValues = typeof TEST_SWARM_DEFAULTS;

const G = "Test swarm";
export const TEST_SWARM_PARAMS: Param[] = [
  { key: "tsCount", label: "Bodies", min: 0, max: 200, step: 1, group: G, onRelease: true, tip: "0 takes the pen away" },
  { key: "tsHp", label: "Health each", min: 1, max: 2000, step: 1, group: G },
  { key: "tsArmour", label: "Armour each", min: 0, max: 20, step: 0.5, group: G, tip: "Flat armour per hit (src/game/armour.ts)" },
  { key: "tsDensity", label: "Density (bodies per m²)", min: 0.02, max: 1, step: 0.01, group: G, onRelease: true, tip: "0.2 is the balance model's camp swarm; spacing about 1/√density" },
  { key: "tsRadius", label: "Body hit radius (m)", min: 0.2, max: 2, step: 0.05, group: G, onRelease: true },
  { key: "tsHeight", label: "Body height (m)", min: 0.4, max: 4, step: 0.1, group: G },
  { key: "tsMaterial", label: "Made of (0 scrapper, 1 cutter, 2 excavator, 3 flesh)", min: 0, max: 3, step: 1, group: G, tip: "What a piercing round loses going through one (the Penetration sliders)" },
  { key: "tsShape", label: "Shape (0 blob, 1 column at you, 2 line across)", min: 0, max: 2, step: 1, group: G, onRelease: true, tip: "Blob: the model's round camp. Column: deep and 3 wide, pointing at the mech (pierce runs down it). Line: 2 deep across your view" },
  { key: "tsDist", label: "Distance to its centre (m)", min: 6, max: 90, step: 1, group: G, onRelease: true, tip: "The model's swarm stands at 25 m (or 90% of a shorter gun's range: the lab moves it in for those)" },
  { key: "tsAngle", label: "Off to the side (°, + left)", min: -90, max: 90, step: 1, group: G, onRelease: true },
  { key: "tsRespawn", label: "Each stands up after (s; 0: the whole wave together)", min: 0, max: 20, step: 0.5, group: G, tip: "0: waves, timed to clear. Above 0: a steady trickle for kills a second" },
  { key: "tsPause", label: "Next wave after (s)", min: 0.2, max: 10, step: 0.1, group: G },
  { key: "tsWindow", label: "Rates measured over (s)", min: 1, max: 20, step: 0.5, group: G },
  { key: "tsSeed", label: "Layout seed", min: 1, max: 99, step: 1, group: G, onRelease: true },
];

/** Tiers: slider sets for the preset buttons. Fodder is the balance model's swarm (targets() "swarm": 36 scrappers
 *  at 0.2 a m², 12 hp, no armour), so the lab's model column and the live numbers measure the same thing. */
export const TEST_SWARM_TIERS: { id: string; name: string; tip: string; set: Partial<TestSwarmValues> }[] = [
  { id: "fodder", name: "Fodder", tip: "Scrappers as the balance model's swarm: 36, 12 hp, no armour, 0.2 a m²", set: { tsCount: 36, tsHp: 12, tsArmour: 0, tsDensity: 0.2, tsRadius: 0.5, tsHeight: 1, tsMaterial: 0, tsShape: 0 } },
  { id: "spread", name: "Fodder, spread", tip: "The same scrappers loose: 24 at 0.05 a m² (about 4.5 m apart)", set: { tsCount: 24, tsHp: 12, tsArmour: 0, tsDensity: 0.05, tsRadius: 0.5, tsHeight: 1, tsMaterial: 0, tsShape: 0 } },
  { id: "horde", name: "Horde", tip: "Dense chaff: 80 at 0.5 a m², 6 hp", set: { tsCount: 80, tsHp: 6, tsArmour: 0, tsDensity: 0.5, tsRadius: 0.4, tsHeight: 0.8, tsMaterial: 0, tsShape: 0 } },
  { id: "armoured", name: "Armoured", tip: "A tough pack: 24 at 0.15 a m², 60 hp, armour 6 (light rounds lose most)", set: { tsCount: 24, tsHp: 60, tsArmour: 6, tsDensity: 0.15, tsRadius: 0.6, tsHeight: 1.2, tsMaterial: 1, tsShape: 0 } },
  { id: "cutters", name: "Cutters", tip: "Cutter-sized: 12 at 0.06 a m², 220 hp, armour 3", set: { tsCount: 12, tsHp: 220, tsArmour: 3, tsDensity: 0.06, tsRadius: 1.2, tsHeight: 2.2, tsMaterial: 1, tsShape: 0 } },
  { id: "column", name: "Column", tip: "Fodder in a deep column pointing at you, for pierce and line weapons", set: { tsCount: 36, tsHp: 12, tsArmour: 0, tsDensity: 0.2, tsRadius: 0.5, tsHeight: 1, tsMaterial: 0, tsShape: 1 } },
];

const MATERIALS: PenMaterial[] = ["scrapper", "cutter", "excavator", "flesh"];

/** A seeded random 0..1 (mulberry32). */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Where the bodies stand, as offsets from the pen's centre in its own frame (x across the mech's view, z away). */
export function testSwarmLayout(v: TestSwarmValues): { x: number; z: number }[] {
  const n = Math.max(0, Math.round(v.tsCount)), rho = Math.max(0.01, v.tsDensity), r = v.tsRadius;
  const rnd = rand(v.tsSeed * 7919 + 13), out: { x: number; z: number }[] = [];
  const cell = 1 / Math.sqrt(rho);
  if (v.tsShape >= 1) {
    // Column (3 across, deep, pointing at the mech) or line (2 deep, across).
    const across = v.tsShape === 1 ? 3 : Math.ceil(n / 2), deep = Math.ceil(n / across);
    for (let i = 0; i < n; i++) {
      const a = i % across, d = Math.floor(i / across);
      out.push({ x: (a - (across - 1) / 2) * cell + (rnd() - 0.5) * 0.3 * cell, z: (d - (deep - 1) / 2) * cell + (rnd() - 0.5) * 0.3 * cell });
    }
    return out;
  }
  // A round blob of the set density with a minimum spacing (darts thrown, too-close ones thrown again).
  const R = Math.sqrt(n / rho / Math.PI), minGap = Math.max(2 * r * 1.05, 0.55 * cell);
  for (let i = 0; i < n; i++) {
    let best = { x: 0, z: 0 }, bestGap = -1;
    for (let k = 0; k < 60; k++) {
      const a = rnd() * Math.PI * 2, d = R * Math.sqrt(rnd());
      const p = { x: Math.sin(a) * d, z: Math.cos(a) * d };
      let gap = Infinity;
      for (const q of out) gap = Math.min(gap, Math.hypot(p.x - q.x, p.z - q.z));
      if (gap >= minGap) { best = p; bestGap = gap; break; }
      if (gap > bestGap) { best = p; bestGap = gap; }
    }
    out.push(best);
  }
  return out;
}

interface Ground { height(x: number, z: number): number }

export class TestBody implements Hittable {
  team = 2;
  alive = true;
  surface: HitSurface = "metal";
  health: number;
  deadFor = 0;
  y = 0;
  flash = 0;
  fallYaw = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private sw: TestSwarm, readonly index: number, public x: number, public z: number) { this.health = sw.v.tsHp; }

  get radius() { return this.sw.v.tsRadius; }
  get height() { return this.sw.v.tsHeight; }
  get material(): PenMaterial { return MATERIALS[Math.round(this.sw.v.tsMaterial)] ?? "scrapper"; }
  armourOf() { return this.sw.v.tsArmour; }

  bars(out: import("../ui/healthBars").BarEntry[]) {
    if (!this.alive || this.sw.v.tsHp < 40) return;
    out.push({ key: this, x: this.x, y: this.y + this.height + 0.5, z: this.z, hp: this.health, max: this.sw.v.tsHp, armour: this.armourOf(), width: 1.4, always: false });
  }

  sheet(s: Sheet, out: SheetHit<Hittable>[]) {
    const c = sheetCircle(s, this.x, this.z, this.radius);
    if (!c) return;
    const x = s.ox + s.dx * c.along, z = s.oz + s.dz * c.along;
    if (!inBand(s, c.along, x, z, this.y, this.y + this.height)) return;
    this.caps();
    out.push({ target: this, key: 0, along: c.along, chord: c.chord, material: this.material, x, y: this.y + this.height * 0.55, z });
  }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts) {
    if (!this.alive) return 0;
    const dx = this.x - at.x, dz = this.z - at.z;
    const y = Math.min(Math.max(at.y, this.y), this.y + this.height);
    const d = Math.max(0, Math.hypot(dx, at.y - y, dz) - this.radius);
    if (d > radius) return 0;
    if (o?.cover?.(this.x, this.y + this.height * 0.5, this.z)) return 0;
    this.fallYaw = Math.atan2(dx, dz);
    this.damage(damage * (1 - 0.5 * d / Math.max(0.01, radius)), undefined, undefined, o?.pierce);
    return 1;
  }

  private caps() {
    const r = Math.min(this.radius, this.height * 0.5);
    this.a.set(this.x, this.y + r, this.z);
    this.b.set(this.x, this.y + Math.max(r, this.height - r), this.z);
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    this.caps();
    return rayCapsule(o, d, this.a, this.b, Math.min(this.radius, this.height * 0.5), maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  damage(amount: number, _at?: THREE.Vector3, dir?: THREE.Vector3, pierce?: number) {
    if (!this.alive) return;
    const dealt = armourHit(amount, this.armourOf(), pierce);
    if (dir) this.fallYaw = Math.atan2(dir.x, dir.z);
    const useful = Math.min(dealt, Math.max(0, this.health));
    this.health -= dealt;
    this.flash = 1;
    const kill = this.health <= 0;
    if (kill) { this.alive = false; this.deadFor = 0; }
    this.sw.record(this.index, useful, dealt - useful, kill);
  }
}

/** One recorded hit: when (sim time and tick), on which body, useful damage, overkill, a kill. */
interface Hit { t: number; tick: number; body: number; useful: number; waste: number; kill: boolean }

export interface TestSwarmStats {
  /** Over the window: useful hp/s (capped at each body's health), kills/s, bodies hurt per impact (a sim step with
   *  hits), overkill share of what landed. */
  hps: number; kps: number; perImpact: number; overkill: number;
  /** Since the last reset: useful hp/s, kills/s, and seconds measured (with a body standing). */
  avgHps: number; avgKps: number; since: number;
  /** Wave clears (s from the wave standing up to its last kill): the last few, newest last, and their mean. */
  clears: number[]; clearMean: number;
  /** Bodies standing / all, and kills since the reset. */
  up: number; n: number; kills: number;
}

export class TestSwarm {
  bodies: TestBody[] = [];
  /** The pen's centre and the direction from the origin to it (its own frame's z). */
  cx = 0; cz = 0; fx = 0; fz = 1;
  clock = 0;
  /** Time with a body standing (a wave's pause doesn't count: rates are per second of something to shoot). */
  private live = 0;
  private tick = 0;
  private hits: Hit[] = [];
  private since = 0;
  private useful = 0;
  kills = 0;
  private waveStart = 0;
  private waveDown = -1;
  clears: number[] = [];
  /** The distance to the centre in use (the lab moves it in for short guns); null: tsDist. */
  dist: number | null = null;

  constructor(readonly v: TestSwarmValues, public origin: { x: number; z: number } = { x: 0, z: 0 }) { this.build(); }

  /** Lay the pen out again (after a slider or tier change, or the origin moved) and start measuring afresh. */
  build() {
    const v = this.v, a = (v.tsAngle * Math.PI) / 180, d = this.dist ?? v.tsDist;
    this.fx = Math.sin(a); this.fz = Math.cos(a);
    this.cx = this.origin.x + this.fx * d; this.cz = this.origin.z + this.fz * d;
    // The pen's frame: z away from the mech, x across (to the mech's left is +x when facing +z).
    const ax = this.fz, az = -this.fx;
    this.bodies = testSwarmLayout(v).map((p, i) => new TestBody(this, i, this.cx + ax * p.x + this.fx * p.z, this.cz + az * p.x + this.fz * p.z));
    this.reset();
  }

  /** Every body up at full health, the counts cleared (a new measurement). */
  reset() {
    for (const b of this.bodies) { b.alive = true; b.health = this.v.tsHp; b.deadFor = 0; b.flash = 0; }
    this.hits = []; this.since = 0; this.useful = 0; this.kills = 0; this.clears = [];
    this.waveStart = this.clock; this.waveDown = -1;
  }

  record(body: number, useful: number, waste: number, kill: boolean) {
    this.hits.push({ t: this.live, tick: this.tick, body, useful, waste, kill });
    this.useful += useful;
    if (kill) {
      this.kills++;
      if (this.v.tsRespawn <= 0 && this.bodies.every((b) => !b.alive)) {
        this.clears.push(this.clock - this.waveStart);
        if (this.clears.length > 8) this.clears.shift();
        this.waveDown = 0;
      }
    }
  }

  update(dt: number, ground: Ground) {
    this.clock += dt; this.tick++;
    const v = this.v;
    if (this.bodies.some((b) => b.alive)) { this.live += dt; this.since += dt; }
    for (const b of this.bodies) {
      b.flash = Math.max(0, b.flash - dt * 6);
      b.y = ground.height(b.x, b.z);
      if (!b.alive) {
        b.deadFor += dt;
        if (v.tsRespawn > 0 && b.deadFor > v.tsRespawn) { b.alive = true; b.health = v.tsHp; }
      }
    }
    if (this.waveDown >= 0) {
      this.waveDown += dt;
      if (this.waveDown > v.tsPause || v.tsRespawn > 0) {
        for (const b of this.bodies) { b.alive = true; b.health = v.tsHp; b.deadFor = 0; }
        this.waveDown = -1; this.waveStart = this.clock;
      }
    }
    while (this.hits.length && this.live - this.hits[0].t > v.tsWindow) this.hits.shift();
  }

  /** The live body nearest the pen's centre (where the demo aims), or null when all are down. */
  aimBody(): TestBody | null {
    let best: TestBody | null = null, bd = Infinity;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - this.cx, b.z - this.cz);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  stats(): TestSwarmStats {
    const w = Math.max(0.1, Math.min(this.v.tsWindow, this.since));
    let useful = 0, waste = 0, kills = 0;
    const perTick = new Map<number, Set<number>>();
    for (const h of this.hits) {
      useful += h.useful; waste += h.waste; if (h.kill) kills++;
      let s = perTick.get(h.tick);
      if (!s) perTick.set(h.tick, (s = new Set()));
      s.add(h.body);
    }
    let bodies = 0;
    for (const s of perTick.values()) bodies += s.size;
    const since = Math.max(0.1, this.since);
    const clearMean = this.clears.length ? this.clears.reduce((a, b) => a + b, 0) / this.clears.length : NaN;
    return {
      hps: useful / w, kps: kills / w, perImpact: perTick.size ? bodies / perTick.size : 0, overkill: useful + waste > 0 ? waste / (useful + waste) : 0,
      avgHps: this.useful / since, avgKps: this.kills / since, since: this.since,
      clears: [...this.clears], clearMean,
      up: this.bodies.filter((b) => b.alive).length, n: this.bodies.length, kills: this.kills,
    };
  }
}
