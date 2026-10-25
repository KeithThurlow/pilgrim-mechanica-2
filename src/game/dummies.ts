// Target dummies for the loadout lab: steel posts at range for feeling a loadout change (damage per second, spread,
// tracking on the moving ones). Each is a Hittable on the battlefield with health; shot down, it stands up again
// after a while. Pure sim; drawing in dummiesDraw.ts.
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
];

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
  private t = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(private range: DummyRange, readonly ax: number, readonly az: number, readonly mover: boolean, private phase: number) {
    this.x = ax; this.z = az;
    this.health = range.v.dummyHealth;
  }

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
    this.y = ground.height(this.x, this.z);
    if (!this.alive) {
      this.deadFor += dt;
      if (this.deadFor > v.dummyRespawn) { this.alive = true; this.health = v.dummyHealth; }
    }
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const v = this.range.v;
    this.a.set(this.x, this.y + v.dummyRadius, this.z);
    this.b.set(this.x, this.y + v.dummyHeight - v.dummyRadius * 0.5, this.z);
    return rayCapsule(o, d, this.a, this.b, v.dummyRadius, maxDist);
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.a, this.b, out); }

  damage(amount: number) {
    if (!this.alive) return;
    this.health -= amount;
    this.flash = 1;
    this.range.dealt.push({ t: this.range.clock, amount });
    if (this.health <= 0) { this.alive = false; this.deadFor = 0; this.range.kills++; }
  }
}

export class DummyRange {
  dummies: Dummy[] = [];
  dealt: { t: number; amount: number }[] = [];
  clock = 0;
  kills = 0;

  constructor(readonly v: DummyValues) { this.build(); }

  /** Lay them out again (after a slider change). Movers are every other one from the middle out. */
  build() {
    const v = this.v, n = Math.round(v.dummyCount);
    this.dummies = [];
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
