// A tall walker's hull shattering as its reactor goes up (Keith 2026-11-06: "sparks and debris as if the hull itself is
// shattering and kind of novering out"). Cosmetic (Math.random is fine): two pools, stepped here, drawn by
// novaDebrisDraw.ts.
// - Shards: white hull plates thrown out every way from the hull, glowing hot and cooling, tumbling, trailing embers,
//   bouncing once on the sand and lying there a while.
// - Sparks: long bright streaks flung out, part at once and the rest over the burst (stretched by the kind's slow-down),
//   falling and fading white to orange to red.
import type { Param } from "../core/tweaks";

export const NOVA_DEBRIS_DEFAULTS = {
  novaShards: 46,
  novaShardSize: 1.1,
  novaShardSpeed: 20,
  novaShardUp: 7,
  novaShardFrom: 2.6,
  novaShardCool: 2.2,
  novaShardLife: 7,
  novaShardEmbers: 14,
  novaSparks: 220,
  novaSparkSpeed: 34,
  novaSparkBurst: 0.55,
  novaSparkLife: 1.5,
  novaSparkStreak: 0.05,
  novaSparkDrag: 0.9,
  novaDebrisGravity: 14,
};
export type NovaDebrisValues = typeof NOVA_DEBRIS_DEFAULTS;

const G = "Reactor nova: shatter";
export const NOVA_DEBRIS_PARAMS: Param[] = [
  { key: "novaShards", label: "Hull shards", min: 0, max: 150, step: 1, group: G, tip: "Keith 2026-11-06: plates of the hull thrown out as it shatters (at the kind's Shatter × 1). Only the tall walkers shatter by default" },
  { key: "novaShardSize", label: "Shard size (m)", min: 0.1, max: 4, step: 0.05, group: G },
  { key: "novaShardSpeed", label: "Shard speed (m/s)", min: 0, max: 60, step: 0.5, group: G },
  { key: "novaShardUp", label: "Shards thrown up (m/s)", min: 0, max: 30, step: 0.5, group: G, tip: "Added upward, so they arc out rather than straight down" },
  { key: "novaShardFrom", label: "Hull size (m)", min: 0, max: 8, step: 0.1, group: G, tip: "They start spread over a ball this size round the reactor" },
  { key: "novaShardCool", label: "Shards glow for (s)", min: 0, max: 8, step: 0.1, group: G },
  { key: "novaShardLife", label: "Shards lie for (s)", min: 0.5, max: 30, step: 0.5, group: G },
  { key: "novaShardEmbers", label: "Embers per hot shard (/s)", min: 0, max: 60, step: 1, group: G, tip: "Sparks dropped by a shard while it glows: trails behind them" },
  { key: "novaSparks", label: "Sparks", min: 0, max: 600, step: 5, group: G },
  { key: "novaSparkSpeed", label: "Spark speed (m/s)", min: 0, max: 90, step: 1, group: G },
  { key: "novaSparkBurst", label: "Sparks thrown over (s)", min: 0, max: 3, step: 0.05, group: G, tip: "A third at once, the rest over this (times the kind's slow-down): the hull keeps spitting as it goes" },
  { key: "novaSparkLife", label: "Spark life (s)", min: 0.1, max: 5, step: 0.05, group: G },
  { key: "novaSparkStreak", label: "Spark streak (s of travel)", min: 0, max: 0.2, step: 0.005, group: G, tip: "How long a streak is: this many seconds of its flight" },
  { key: "novaSparkDrag", label: "Spark drag (/s)", min: 0, max: 5, step: 0.05, group: G },
  { key: "novaDebrisGravity", label: "Gravity (m/s²)", min: 0, max: 40, step: 0.5, group: G },
];

interface Ground { height(x: number, z: number): number }

export const MAX_SHARDS = 200, MAX_SPARKS = 900;

/** Sparks still to throw from a hull: where, the blast radius, how many left and over how long. */
interface Spitter { x: number; y: number; z: number; R: number; left: number; rate: number }

export class NovaDebris {
  // Shards: position, velocity, rotation (Euler), spin, size, age, life left, heat, shade, at rest.
  readonly sp = new Float32Array(MAX_SHARDS * 3); readonly sv = new Float32Array(MAX_SHARDS * 3);
  readonly sr = new Float32Array(MAX_SHARDS * 3); readonly sw = new Float32Array(MAX_SHARDS * 3);
  readonly ss = new Float32Array(MAX_SHARDS * 3); readonly sAge = new Float32Array(MAX_SHARDS).fill(1e9);
  readonly sHeat = new Float32Array(MAX_SHARDS); readonly sShade = new Float32Array(MAX_SHARDS);
  readonly sRest = new Uint8Array(MAX_SHARDS);
  // Sparks: position, velocity, age, life.
  readonly kp = new Float32Array(MAX_SPARKS * 3); readonly kv = new Float32Array(MAX_SPARKS * 3);
  readonly kAge = new Float32Array(MAX_SPARKS).fill(1e9); readonly kLife = new Float32Array(MAX_SPARKS).fill(1);
  private nextShard = 0; private nextSpark = 0;
  private spit: Spitter[] = [];

  constructor(public v: NovaDebrisValues) {}

  /** A hull at (x, y, z) shattering, blast radius R, amount × k; slow stretches the sparks' burst. */
  emit(x: number, y: number, z: number, R: number, k: number, slow = 1) {
    const v = this.v, f = Math.min(2, R / 22) * k;
    const shards = Math.round(v.novaShards * f), sparks = Math.round(v.novaSparks * f);
    for (let n = 0; n < shards; n++) this.shard(x, y, z);
    const now = Math.round(sparks / 3);
    for (let n = 0; n < now; n++) this.sparkFrom(x, y, z, 1);
    const burst = v.novaSparkBurst * slow;
    if (burst > 0.01) this.spit.push({ x, y, z, R, left: sparks - now, rate: (sparks - now) / burst });
    else for (let n = now; n < sparks; n++) this.sparkFrom(x, y, z, 1);
  }

  private shard(x: number, y: number, z: number) {
    const v = this.v, i = this.nextShard, j = i * 3;
    this.nextShard = (i + 1) % MAX_SHARDS;
    const d = dir(), from = v.novaShardFrom * Math.cbrt(Math.random()), sp = v.novaShardSpeed * (0.35 + 0.85 * Math.random());
    this.sp[j] = x + d[0] * from; this.sp[j + 1] = y + d[1] * from; this.sp[j + 2] = z + d[2] * from;
    this.sv[j] = d[0] * sp; this.sv[j + 1] = d[1] * sp + v.novaShardUp * (0.5 + Math.random()); this.sv[j + 2] = d[2] * sp;
    for (let a = 0; a < 3; a++) { this.sr[j + a] = Math.random() * 6.28; this.sw[j + a] = (Math.random() - 0.5) * 18; }
    // A plate: wide, long and thin, some big slabs among many small bits.
    const s = v.novaShardSize * (0.35 + Math.pow(Math.random(), 2.5) * 1.6);
    this.ss[j] = s; this.ss[j + 1] = s * (0.06 + Math.random() * 0.08); this.ss[j + 2] = s * (0.5 + Math.random() * 0.9);
    this.sAge[i] = 0; this.sHeat[i] = 0.6 + 0.4 * Math.random(); this.sShade[i] = Math.random(); this.sRest[i] = 0;
  }

  /** A spark out of a ball round (x, y, z) at speed × s. */
  private sparkFrom(x: number, y: number, z: number, s: number) {
    const v = this.v, d = dir(), sp = v.novaSparkSpeed * s * (0.3 + 0.9 * Math.random());
    this.spark(x + d[0] * v.novaShardFrom * 0.5, y + d[1] * v.novaShardFrom * 0.5, z + d[2] * v.novaShardFrom * 0.5,
      d[0] * sp, d[1] * sp + 4, d[2] * sp, v.novaSparkLife * (0.5 + Math.random()));
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.nextSpark, j = i * 3;
    this.nextSpark = (i + 1) % MAX_SPARKS;
    this.kp[j] = x; this.kp[j + 1] = y; this.kp[j + 2] = z;
    this.kv[j] = vx; this.kv[j + 1] = vy; this.kv[j + 2] = vz;
    this.kAge[i] = 0; this.kLife[i] = Math.max(0.05, life);
  }

  /** Shard i's look now: 0..1 of its glow left and its scale (it sinks into the sand at the end). */
  glow(i: number) { return this.sHeat[i] * Math.max(0, 1 - this.sAge[i] / Math.max(0.05, this.v.novaShardCool)); }
  fade(i: number) { return Math.max(0, Math.min(1, (this.v.novaShardLife - this.sAge[i]) / 0.8)); }
  live(i: number) { return this.sAge[i] < this.v.novaShardLife; }
  sparkLive(i: number) { return this.kAge[i] < this.kLife[i]; }

  update(dt: number, ground: Ground) {
    const v = this.v, g = v.novaDebrisGravity;
    for (let k = this.spit.length - 1; k >= 0; k--) {
      const s = this.spit[k];
      let n = Math.min(s.left, Math.max(0, Math.round(s.rate * dt + Math.random() - 0.5)));
      s.left -= n;
      while (n-- > 0) this.sparkFrom(s.x, s.y, s.z, 0.6 + 0.4 * Math.random());
      if (s.left <= 0) this.spit.splice(k, 1);
    }
    for (let i = 0; i < MAX_SHARDS; i++) {
      if (!this.live(i)) continue;
      this.sAge[i] += dt;
      if (this.sRest[i]) continue;
      const j = i * 3;
      this.sv[j + 1] -= g * dt;
      this.sp[j] += this.sv[j] * dt; this.sp[j + 1] += this.sv[j + 1] * dt; this.sp[j + 2] += this.sv[j + 2] * dt;
      for (let a = 0; a < 3; a++) this.sr[j + a] += this.sw[j + a] * dt;
      const gy = ground.height(this.sp[j], this.sp[j + 2]) + this.ss[j + 1] * 0.5;
      if (this.sp[j + 1] < gy) {
        this.sp[j + 1] = gy;
        if (this.sv[j + 1] < -4) {
          // Bounce once, skidding; then lie flat-ish.
          this.sv[j + 1] *= -0.25; this.sv[j] *= 0.45; this.sv[j + 2] *= 0.45;
          for (let a = 0; a < 3; a++) this.sw[j + a] *= 0.4;
        } else {
          this.sRest[i] = 1; this.sr[j] = (Math.random() - 0.5) * 0.3; this.sr[j + 2] = (Math.random() - 0.5) * 0.3;
        }
      }
      const glow = this.glow(i);
      if (glow > 0.15 && Math.random() < v.novaShardEmbers * glow * dt)
        this.spark(this.sp[j], this.sp[j + 1], this.sp[j + 2], this.sv[j] * 0.2 + (Math.random() - 0.5) * 2, this.sv[j + 1] * 0.2 + Math.random() * 2, this.sv[j + 2] * 0.2 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.5);
    }
    const drag = Math.max(0, 1 - v.novaSparkDrag * dt);
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (!this.sparkLive(i)) continue;
      this.kAge[i] += dt;
      const j = i * 3;
      this.kv[j] *= drag; this.kv[j + 1] = this.kv[j + 1] * drag - g * dt; this.kv[j + 2] *= drag;
      this.kp[j] += this.kv[j] * dt; this.kp[j + 1] += this.kv[j + 1] * dt; this.kp[j + 2] += this.kv[j + 2] * dt;
      const gy = ground.height(this.kp[j], this.kp[j + 2]);
      if (this.kp[j + 1] < gy) {
        // Skip along the sand, losing most of its speed, and die soon after.
        this.kp[j + 1] = gy; this.kv[j + 1] = Math.abs(this.kv[j + 1]) * 0.3; this.kv[j] *= 0.5; this.kv[j + 2] *= 0.5;
        this.kAge[i] = Math.max(this.kAge[i], this.kLife[i] * 0.7);
      }
    }
  }
}

const D: [number, number, number] = [0, 0, 0];
/** A random unit direction (shared, read at once). */
function dir() {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, c = Math.sqrt(1 - u * u);
  D[0] = Math.cos(a) * c; D[1] = u; D[2] = Math.sin(a) * c;
  return D;
}
