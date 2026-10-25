// Target dummies for the loadout lab: steel posts at range for feeling a loadout change (damage per second, spread,
// tracking on the moving ones). Each is a Hittable on the battlefield with health; shot down, it stands up again
// after a while. Pure sim; drawing in dummiesDraw.ts.
// The weapons range (labs/weapons) lays them out by hand (`layout`) and adds light cutouts: bandit-sized plywood
// figures in lines and columns that rounds pierce, blasts reach and a rail beam throws back.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable } from "./battlefield";
import type { HitSurface } from "../fx/minigun";
import { rayCapsule, capsuleNormal } from "./mechUnit";

export const DUMMY_DEFAULTS = {
  dummyCount: 7,
  dummyNear: 16,
  dummyFar: 36,
  dummySpreadAngle: 70,
  dummyHealth: 900,
  dummyRespawn: 3,
  dummyMovers: 3,
  dummyMoveSpeed: 4,
  dummyMoveRange: 12,
  dummyRadius: 0.9,
  dummyHeight: 3.4,
  dpsWindow: 3,
  cutoutHealth: 150,
  cutoutRadius: 0.45,
  cutoutHeight: 1.9,
  cutoutFriction: 7,
};
export type DummyValues = typeof DUMMY_DEFAULTS;

const G = "Target dummies";
export const DUMMY_PARAMS: Param[] = [
  { key: "dummyCount", label: "Dummies", min: 0, max: 20, step: 1, group: G },
  { key: "dummyNear", label: "Nearest (m)", min: 5, max: 60, step: 1, group: G },
  { key: "dummyFar", label: "Farthest (m)", min: 5, max: 90, step: 1, group: G },
  { key: "dummySpreadAngle", label: "Spread round the front (°)", min: 0, max: 180, step: 1, group: G, tip: "They stand in an arc this wide ahead of where the mech starts" },
  { key: "dummyHealth", label: "Health", min: 10, max: 10000, step: 10, group: G },
  { key: "dummyRespawn", label: "Stands up again after (s)", min: 0.5, max: 20, step: 0.5, group: G },
  { key: "dummyMovers", label: "How many move", min: 0, max: 20, step: 1, group: G, tip: "These slide side to side, for feeling the guns' tracking and arc" },
  { key: "dummyMoveSpeed", label: "Move speed (m/s)", min: 0, max: 15, step: 0.1, group: G },
  { key: "dummyMoveRange", label: "Move range (m)", min: 0, max: 40, step: 0.5, group: G },
  { key: "dummyRadius", label: "Hit radius (m)", min: 0.3, max: 3, step: 0.05, group: G },
  { key: "dummyHeight", label: "Height (m)", min: 1, max: 8, step: 0.1, group: G },
  { key: "dpsWindow", label: "Damage/s measured over (s)", min: 0.5, max: 10, step: 0.5, group: G },
  { key: "cutoutHealth", label: "Cutout health", min: 5, max: 2000, step: 5, group: G, tip: "The light plywood figures (bandit-sized) in the weapons range" },
  { key: "cutoutRadius", label: "Cutout hit radius (m)", min: 0.2, max: 1.5, step: 0.05, group: G },
  { key: "cutoutHeight", label: "Cutout height (m)", min: 0.8, max: 4, step: 0.05, group: G },
  { key: "cutoutFriction", label: "Cutout slide stops (m/s²)", min: 0.5, max: 30, step: 0.5, group: G, tip: "How fast a cutout thrown back by a rail beam slides to a stop" },
];

/** A hand-placed dummy (the weapons range): where, light (a cutout) or a steel post, sliding or not. */
export interface DummySpot { x: number; z: number; light?: boolean; mover?: boolean }

/** Shape of the ground they stand on. */
interface Ground { height(x: number, z: number): number }

export class Dummy implements Hittable {
  team = 2;
  alive = true;
  surface: HitSurface = "metal";
  health: number;
  deadFor = 0;
  x: number;
  z: number;
  y = 0;
  /** Recent hit flash 0..1. */
  flash = 0;
  /** Thrown back (cutouts): offset from where it stands and its slide. */
  kx = 0; kz = 0; kvx = 0; kvz = 0;
  /** Direction it fell (for the drawing). */
  fallYaw = 0;
  private t = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private range: DummyRange, readonly ax: number, readonly az: number, readonly mover: boolean, private phase: number, readonly light = false) {
    this.x = ax; this.z = az;
    this.health = this.maxHealth;
  }

  get maxHealth() { return this.light ? this.range.v.cutoutHealth : this.range.v.dummyHealth; }
  get radius() { return this.light ? this.range.v.cutoutRadius : this.range.v.dummyRadius; }
  get height() { return this.light ? this.range.v.cutoutHeight : this.range.v.dummyHeight; }

  update(dt: number, ground: Ground) {
    const v = this.range.v;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.mover && v.dummyMoveRange > 0) {
      // Slide across the line from the start point, at the set speed.
      this.t += dt;
      const len = Math.hypot(this.ax, this.az) || 1;
      const w = (v.dummyMoveSpeed / Math.max(0.1, v.dummyMoveRange)) * 1.5;
      const off = Math.sin(this.t * w + this.phase) * v.dummyMoveRange * 0.5;
      this.x = this.ax + (this.az / len) * off;
      this.z = this.az - (this.ax / len) * off;
    }
    // Thrown back: slide to a stop.
    const sp = Math.hypot(this.kvx, this.kvz);
    if (sp > 1e-3) {
      const k = Math.max(0, sp - v.cutoutFriction * dt) / sp;
      this.kvx *= k; this.kvz *= k;
      this.kx += this.kvx * dt; this.kz += this.kvz * dt;
    }
    if (!this.mover) { this.x = this.ax + this.kx; this.z = this.az + this.kz; }
    this.y = ground.height(this.x, this.z);
    if (!this.alive) {
      this.deadFor += dt;
      if (this.deadFor > v.dummyRespawn) { this.alive = true; this.health = this.maxHealth; this.kx = this.kz = this.kvx = this.kvz = 0; }
    }
  }

  /** Light ones let a round carry on through. */
  canPierce() { return this.light; }

  /** A rail beam throws a cutout back along it. */
  knock(_at: THREE.Vector3, dir: THREE.Vector3, speed: number) {
    if (!this.light) return;
    const l = Math.hypot(dir.x, dir.z) || 1;
    this.kvx += (dir.x / l) * speed; this.kvz += (dir.z / l) * speed;
    this.fallYaw = Math.atan2(dir.x, dir.z);
  }

  /** A blast: hurt if it reaches the body, full at the centre, half at the edge; it falls away from the blast. */
  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3) {
    if (!this.alive) return 0;
    const dx = this.x - at.x, dz = this.z - at.z;
    const y = Math.min(Math.max(at.y, this.y), this.y + this.height);
    const d = Math.max(0, Math.hypot(dx, at.y - y, dz) - this.radius);
    if (d > radius) return 0;
    this.fallYaw = Math.atan2(dx, dz);
    if (this.light) { const l = Math.hypot(dx, dz) || 1, k = 4 * (1 - d / Math.max(0.01, radius)); this.kvx += (dx / l) * k; this.kvz += (dz / l) * k; }
    this.damage(damage * (1 - 0.5 * d / Math.max(0.01, radius)));
    return 1;
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const r = this.radius, h = this.height;
    this.a.set(this.x, this.y + r, this.z);
    this.b.set(this.x, this.y + h - r * 0.5, this.z);
    return rayCapsule(o, d, this.a, this.b, r, maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  damage(amount: number, _at?: THREE.Vector3, dir?: THREE.Vector3) {
    if (!this.alive) return;
    if (dir) this.fallYaw = Math.atan2(dir.x, dir.z);
    this.health -= amount;
    this.flash = 1;
    this.range.record(amount);
    if (this.health <= 0) { this.alive = false; this.deadFor = 0; this.range.kills++; }
  }
}

export class DummyRange {
  dummies: Dummy[] = [];
  dealt: { t: number; amount: number }[] = [];
  clock = 0;
  kills = 0;
  /** Everything dealt so far and how many hits (for per-shot readouts). */
  total = 0;
  hits = 0;

  /** A hit on anything the range counts (its dummies; the weapons lab adds its vehicles). */
  record(amount: number) { this.dealt.push({ t: this.clock, amount }); this.total += amount; this.hits++; }
  /** Hand-placed spots (the weapons range); null lays them in an arc by the sliders. */
  layout: DummySpot[] | null = null;

  constructor(readonly v: DummyValues, layout: DummySpot[] | null = null) { this.layout = layout; this.build(); }

  /** Lay them out again (after a slider change). Movers are every other one from the middle out. */
  build() {
    const v = this.v, n = Math.round(v.dummyCount);
    this.dummies = [];
    if (this.layout) {
      this.layout.forEach((s, i) => this.dummies.push(new Dummy(this, s.x, s.z, !!s.mover, i * 1.7, !!s.light)));
      return;
    }
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5;
      const ang = ((u - 0.5) * v.dummySpreadAngle * Math.PI) / 180;
      const dist = v.dummyNear + (v.dummyFar - v.dummyNear) * ((i * 0.618034) % 1);
      this.dummies.push(new Dummy(this, Math.sin(ang) * dist, Math.cos(ang) * dist, i % 2 === 1 && Math.floor(i / 2) < v.dummyMovers, i * 1.7));
    }
  }

  update(dt: number, ground: Ground) {
    this.clock += dt;
    for (const d of this.dummies) d.update(dt, ground);
    while (this.dealt.length && this.clock - this.dealt[0].t > this.v.dpsWindow) this.dealt.shift();
  }

  /** Damage per second dealt to the dummies over the measuring window. */
  dps() { return this.dealt.reduce((s, d) => s + d.amount, 0) / Math.max(0.1, this.v.dpsWindow); }
}
