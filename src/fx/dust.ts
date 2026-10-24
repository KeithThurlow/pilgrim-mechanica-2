// Sand dust, the sim (no drawing: dustDraw.ts draws it). Target look: Keith's reference video
// (old repo art-refs/particles/m2-res_1080p.mp4): a dense, lumpy band of sand rolled out low behind what kicked it,
// and above it a soft cloud that blooms wide, rises a little, drifts off on the wind and hangs for seconds, thick
// enough to swallow whatever drives back through it, and shadowing the sand under it.
//
// Two kinds share one pool: clumps (small, dense, darker, thrown low, slowed hard and settling) and cloud (starts
// small and dense, grows several times, slows, rises, drifts with the wind, thins out). Sources: a foot landing
// (stomp), a foot leaving the ground (toe kick), a round into the sand (hit).
import type { Param } from "../core/tweaks";
import type { Ground } from "../mech/walker";

export const DUST_DEFAULTS = {
  windAngle: 70,
  windSpeed: 1.4,
  cloudLife: 5,
  cloudGrow: 3.5,
  cloudRise: 0.35,
  cloudDrag: 1.4,
  cloudDensity: 0.65,
  turbulence: 0.5,
  clumpLife: 1.3,
  clumpDensity: 0.85,
  clumpDrag: 3.2,
  stompCloud: 6,
  stompClump: 7,
  stompSize: 0.9,
  stompSpeed: 2.8,
  kickCloud: 3,
  kickClump: 5,
  kickSize: 0.7,
  kickSpeed: 3,
  sprintKick: 1.8,
  hitCloud: 2,
  hitClump: 4,
  hitSize: 0.45,
  hitCarry: 5,
  dustBright: 1,
  dustShade: 0.85,
  edgeFray: 0.7,
  billow: 0.7,
  grain: 0.35,
  softDistance: 1.2,
  shadowStrength: 0.45,
  shadowSize: 1.1,
};
export type DustValues = typeof DUST_DEFAULTS;

export const DUST_PARAMS: Param[] = [
  { key: "windAngle", label: "Wind toward (°)", min: 0, max: 360, step: 1, group: "Dust", tip: "Compass heading the wind carries the dust (0 = +Z)" },
  { key: "windSpeed", label: "Wind speed (m/s)", min: 0, max: 8, step: 0.05, group: "Dust" },
  { key: "cloudLife", label: "Cloud hangs for (s)", min: 0.5, max: 12, step: 0.1, group: "Dust" },
  { key: "cloudGrow", label: "Cloud grows ×", min: 1, max: 8, step: 0.1, group: "Dust" },
  { key: "cloudRise", label: "Cloud rise (m/s)", min: 0, max: 2, step: 0.01, group: "Dust" },
  { key: "cloudDrag", label: "Cloud drag", min: 0.1, max: 6, step: 0.05, group: "Dust", tip: "How fast a puff gives up its kick and joins the wind" },
  { key: "cloudDensity", label: "Cloud thickness", min: 0, max: 1, step: 0.01, group: "Dust" },
  { key: "turbulence", label: "Turbulence (m/s)", min: 0, max: 3, step: 0.05, group: "Dust" },
  { key: "clumpLife", label: "Clump life (s)", min: 0.2, max: 4, step: 0.05, group: "Dust" },
  { key: "clumpDensity", label: "Clump thickness", min: 0, max: 1, step: 0.01, group: "Dust" },
  { key: "clumpDrag", label: "Clump drag", min: 0.2, max: 10, step: 0.1, group: "Dust" },
  { key: "stompCloud", label: "Stomp: cloud puffs", min: 0, max: 20, step: 1, group: "Dust: sources" },
  { key: "stompClump", label: "Stomp: clumps", min: 0, max: 20, step: 1, group: "Dust: sources" },
  { key: "stompSize", label: "Stomp: puff size (m)", min: 0.1, max: 3, step: 0.05, group: "Dust: sources" },
  { key: "stompSpeed", label: "Stomp: spread speed", min: 0, max: 8, step: 0.1, group: "Dust: sources" },
  { key: "kickCloud", label: "Toe kick: cloud puffs", min: 0, max: 20, step: 1, group: "Dust: sources", tip: "Sand flicked back as a foot leaves the ground" },
  { key: "kickClump", label: "Toe kick: clumps", min: 0, max: 20, step: 1, group: "Dust: sources" },
  { key: "kickSize", label: "Toe kick: puff size (m)", min: 0.1, max: 3, step: 0.05, group: "Dust: sources" },
  { key: "kickSpeed", label: "Toe kick: speed", min: 0, max: 10, step: 0.1, group: "Dust: sources" },
  { key: "sprintKick", label: "Sprint: more dust ×", min: 1, max: 4, step: 0.05, group: "Dust: sources" },
  { key: "hitCloud", label: "Round hit: cloud puffs", min: 0, max: 10, step: 1, group: "Dust: sources" },
  { key: "hitClump", label: "Round hit: clumps", min: 0, max: 12, step: 1, group: "Dust: sources", tip: "The low layer torn up and pushed downrange" },
  { key: "hitSize", label: "Round hit: puff size (m)", min: 0.05, max: 2, step: 0.01, group: "Dust: sources" },
  { key: "hitCarry", label: "Round hit: push (m/s)", min: 0, max: 15, step: 0.1, group: "Dust: sources" },
  { key: "dustBright", label: "Brightness", min: 0.2, max: 2, step: 0.01, group: "Dust: look" },
  { key: "dustShade", label: "Shaded side", min: 0, max: 1, step: 0.01, group: "Dust: look", tip: "How dark the side away from the sun goes" },
  { key: "edgeFray", label: "Frayed edges", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "billow", label: "Billows (lumpy shading)", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "softDistance", label: "Soft into the ground (m)", min: 0.05, max: 4, step: 0.05, group: "Dust: look", tip: "Puffs fade where they meet the sand and the mech instead of cutting a hard line" },
  { key: "shadowStrength", label: "Shadow on the sand", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "shadowSize", label: "Shadow size ×", min: 0.3, max: 2.5, step: 0.05, group: "Dust: look" },
];

export const DUST_MAX = 4096;
export const CLUMP = 0, CLOUD = 1;

/** Structure-of-arrays pool; slots are reused oldest first. */
export class DustSim {
  readonly px = new Float32Array(DUST_MAX); readonly py = new Float32Array(DUST_MAX); readonly pz = new Float32Array(DUST_MAX);
  readonly vx = new Float32Array(DUST_MAX); readonly vy = new Float32Array(DUST_MAX); readonly vz = new Float32Array(DUST_MAX);
  readonly age = new Float32Array(DUST_MAX); readonly life = new Float32Array(DUST_MAX).fill(0);
  readonly size0 = new Float32Array(DUST_MAX); readonly dens = new Float32Array(DUST_MAX);
  readonly kind = new Uint8Array(DUST_MAX); readonly seed = new Float32Array(DUST_MAX);
  /** Current drawn radius and opacity (written by update for the drawer). */
  readonly radius = new Float32Array(DUST_MAX); readonly alpha = new Float32Array(DUST_MAX);
  private next = 0;
  alive = 0;
  private t = 0;

  constructor(public v: DustValues, private ground: Ground) {}

  emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, dens: number) {
    const i = this.next;
    this.next = (this.next + 1) % DUST_MAX;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size; this.dens[i] = dens;
    this.kind[i] = kind; this.seed[i] = Math.random();
  }

  /** A foot landing: clumps rolled out and a low ring of cloud. strength around 1. */
  stomp(x: number, y: number, z: number, strength: number) {
    const v = this.v;
    const nCloud = Math.round(v.stompCloud * strength), nClump = Math.round(v.stompClump * strength);
    for (let i = 0; i < nCloud; i++) {
      const a = (i / Math.max(1, nCloud)) * Math.PI * 2 + Math.random() * 0.9;
      const s = v.stompSpeed * strength * (0.5 + Math.random() * 0.6);
      this.emit(CLOUD, x + Math.cos(a) * 0.4, y + 0.2, z + Math.sin(a) * 0.4, Math.cos(a) * s, 0.3 + Math.random() * 0.5, Math.sin(a) * s,
        v.stompSize * (0.6 + Math.random() * 0.6), v.cloudLife * (0.6 + Math.random() * 0.6), v.cloudDensity);
    }
    for (let i = 0; i < nClump; i++) {
      const a = Math.random() * Math.PI * 2, s = v.stompSpeed * strength * (0.8 + Math.random() * 0.8);
      this.emit(CLUMP, x, y + 0.1, z, Math.cos(a) * s, 0.8 + Math.random() * 1.6, Math.sin(a) * s,
        v.stompSize * 0.35 * (0.6 + Math.random() * 0.7), v.clumpLife * (0.6 + Math.random() * 0.6), v.clumpDensity);
    }
  }

  /** A foot leaving the sand: flicked back (dx, dz: unit, the way the sand goes) and up. */
  kick(x: number, y: number, z: number, dx: number, dz: number, strength: number) {
    const v = this.v;
    const nCloud = Math.round(v.kickCloud * strength), nClump = Math.round(v.kickClump * strength);
    for (let i = 0; i < nClump; i++) {
      const sp = (Math.random() - 0.5) * 0.7, s = v.kickSpeed * strength * (0.6 + Math.random() * 0.7);
      const ex = dx + -dz * sp, ez = dz + dx * sp;
      this.emit(CLUMP, x, y + 0.15, z, ex * s, 1 + Math.random() * 2.2, ez * s, v.kickSize * 0.4 * (0.6 + Math.random() * 0.7),
        v.clumpLife * (0.6 + Math.random() * 0.6), v.clumpDensity);
    }
    for (let i = 0; i < nCloud; i++) {
      const s = v.kickSpeed * strength * (0.3 + Math.random() * 0.5);
      this.emit(CLOUD, x + dx * 0.3, y + 0.3, z + dz * 0.3, dx * s + (Math.random() - 0.5), 0.5 + Math.random() * 0.8, dz * s + (Math.random() - 0.5),
        v.kickSize * (0.6 + Math.random() * 0.6), v.cloudLife * (0.6 + Math.random() * 0.6), v.cloudDensity);
    }
  }

  /** A round into the sand: the low layer torn up and shoved downrange (dx, dz: its travel), and dust thrown up. */
  hit(x: number, y: number, z: number, dx: number, dz: number, k: number) {
    const v = this.v;
    for (let i = 0; i < v.hitClump; i++) {
      const sp = (Math.random() - 0.5) * 0.6, s = v.hitCarry * (0.5 + Math.random() * 0.7);
      const ex = dx + -dz * sp, ez = dz + dx * sp;
      this.emit(CLUMP, x, y + 0.08, z, ex * s, 0.3 + Math.random() * 1.2, ez * s, v.hitSize * k * (0.5 + Math.random() * 0.6),
        v.clumpLife * (0.5 + Math.random() * 0.5), v.clumpDensity);
    }
    for (let i = 0; i < v.hitCloud; i++) {
      this.emit(CLOUD, x + dx * 0.4, y + 0.2, z + dz * 0.4, dx * v.hitCarry * 0.3 + (Math.random() - 0.5), 0.8 + Math.random() * 1.4,
        dz * v.hitCarry * 0.3 + (Math.random() - 0.5), v.hitSize * k * (0.8 + Math.random() * 0.6), v.cloudLife * (0.5 + Math.random() * 0.5), v.cloudDensity * 0.8);
    }
  }

  update(dt: number) {
    const v = this.v;
    this.t += dt;
    const wa = (v.windAngle * Math.PI) / 180, wx = Math.sin(wa) * v.windSpeed, wz = Math.cos(wa) * v.windSpeed;
    let alive = 0;
    for (let i = 0; i < DUST_MAX; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) { this.alpha[i] = 0; continue; }
      alive++;
      const sd = this.seed[i];
      if (this.kind[i] === CLOUD) {
        // Drag toward the wind (plus a slow swirl), rising, growing fast then slower.
        const k = Math.min(1, dt * v.cloudDrag);
        const tx = wx + Math.sin(this.t * 0.7 + sd * 40) * v.turbulence, tz = wz + Math.cos(this.t * 0.6 + sd * 31) * v.turbulence;
        this.vx[i] += (tx - this.vx[i]) * k;
        this.vz[i] += (tz - this.vz[i]) * k;
        this.vy[i] += (v.cloudRise * (0.6 + sd * 0.8) - this.vy[i]) * k;
        this.radius[i] = this.size0[i] * (1 + (v.cloudGrow - 1) * (1 - Math.exp(-u * 4)));
        // Thick from the start, thinning as it spreads.
        this.alpha[i] = this.dens[i] * Math.min(1, u * 12) * Math.pow(1 - u, 1.4);
      } else {
        // Clumps: thrown, slowed hard, falling and settling on the sand; they puff out a little and fade.
        const k = Math.exp(-dt * v.clumpDrag);
        this.vx[i] *= k; this.vz[i] *= k;
        this.vy[i] -= 9.8 * 0.6 * dt;
        this.radius[i] = this.size0[i] * (1 + 0.8 * u);
        this.alpha[i] = this.dens[i] * Math.min(1, u * 20) * (1 - u * u);
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const g = this.ground.height(this.px[i], this.pz[i]) + this.radius[i] * 0.25;
      if (this.py[i] < g) { this.py[i] = g; if (this.vy[i] < 0) this.vy[i] = 0; }
    }
    this.alive = alive;
  }
}
