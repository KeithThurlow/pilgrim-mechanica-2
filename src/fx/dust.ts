// Sand dust, the sim (no drawing: dustDraw.ts draws it). Target look: Keith's reference video
// (old repo art-refs/particles/m2-res_1080p.mp4): a dense, lumpy band of sand rolled out low behind what kicked it,
// and above it a soft cloud that blooms wide, rises a little, drifts off on the wind and hangs for seconds, thick
// enough to swallow whatever drives back through it, and shadowing the sand under it.
//
// Two kinds share one pool: clumps (small, dense, darker, thrown low, slowed hard and settling) and cloud (starts
// small and dense, grows several times, slows, rises, drifts with the wind, thins out). Sources: a foot landing
// (stomp), a foot leaving the ground (toe kick), a round into the sand (hit: plus a plume thrown up and forward).
// Dust first carries the push of whatever threw it (a step's momentum, a round's travel), slowing, and the wind takes
// over after windIn seconds (Keith 2026-10-24). What it comes off decides how much (Keith 2026-10-24): sand is the
// full amount, gravel little dust and some chips, dirt a few darker clods, concrete nothing.
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
  plumePuffs: 6,
  plumeSpeed: 7,
  plumeLean: 0.55,
  plumeSpread: 0.22,
  plumeSize: 0.3,
  plumeDensity: 0.85,
  plumeDrag: 2.6,
  windIn: 1.2,
  stepPush: 0.7,
  gravelDust: 0.25,
  gravelClump: 0.35,
  dirtDust: 0.3,
  dirtClump: 0.7,
  concreteDust: 0,
  concreteClump: 0,
  dustBright: 1,
  dustShade: 0.85,
  edgeFray: 0.7,
  billow: 0.7,
  inShadow: 0.6,
  dustShadowBlur: 0.6,
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
  { key: "plumePuffs", label: "Round hit: plume puffs", min: 0, max: 16, step: 1, group: "Dust: sources", tip: "A fan of sand thrown up and forward from the strike" },
  { key: "plumeSpeed", label: "Plume throw (m/s)", min: 0, max: 20, step: 0.1, group: "Dust: sources" },
  { key: "plumeLean", label: "Plume lean downrange", min: 0, max: 1.5, step: 0.01, group: "Dust: sources" },
  { key: "plumeSpread", label: "Plume spread", min: 0, max: 1, step: 0.01, group: "Dust: sources" },
  { key: "plumeSize", label: "Plume puff size (m)", min: 0.05, max: 1.5, step: 0.01, group: "Dust: sources" },
  { key: "plumeDensity", label: "Plume thickness", min: 0, max: 1, step: 0.01, group: "Dust: sources" },
  { key: "plumeDrag", label: "Plume drag", min: 0.2, max: 8, step: 0.05, group: "Dust: sources", tip: "Higher stops the throw sooner, so the puffs string out into a column" },
  { key: "stepPush", label: "Step pushes dust along", min: 0, max: 2, step: 0.01, group: "Dust: sources", tip: "Share of the mech's speed the stomp's sand carries forward" },
  { key: "windIn", label: "Wind takes over after (s)", min: 0, max: 5, step: 0.05, group: "Dust", tip: "Dust first keeps the push of whatever threw it, then the wind takes it" },
  { key: "gravelDust", label: "Gravel: dust ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "gravelClump", label: "Gravel: chips ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "dirtDust", label: "Dirt: dust ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "dirtClump", label: "Dirt: clods ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "concreteDust", label: "Concrete: dust ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "concreteClump", label: "Concrete: chips ×", min: 0, max: 1.5, step: 0.01, group: "Dust: surfaces" },
  { key: "dustBright", label: "Brightness", min: 0.2, max: 2, step: 0.01, group: "Dust: look" },
  { key: "dustShade", label: "Shaded side", min: 0, max: 1, step: 0.01, group: "Dust: look", tip: "How dark the side away from the sun goes" },
  { key: "edgeFray", label: "Frayed edges", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "billow", label: "Billows (lumpy shading)", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "inShadow", label: "Darker in shade", min: 0, max: 1, step: 0.01, group: "Dust: look", tip: "How much dust in the shadow of a dune, the mech or a wreck loses its sunlit side" },
  { key: "dustShadowBlur", label: "Shade edge softness (m)", min: 0, max: 3, step: 0.05, group: "Dust: look" },
  { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "softDistance", label: "Soft into the ground (m)", min: 0.05, max: 4, step: 0.05, group: "Dust: look", tip: "Puffs fade where they meet the sand and the mech instead of cutting a hard line" },
  { key: "shadowStrength", label: "Shadow on the sand", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "shadowSize", label: "Shadow size ×", min: 0.3, max: 2.5, step: 0.05, group: "Dust: look" },
];

export const DUST_MAX = 4096;
export const CLUMP = 0, CLOUD = 1;

/** What the ground is made of where dust comes off it. */
export type Surface = "sand" | "gravel" | "dirt" | "concrete";
/** How dark each surface's dust reads (0 = sand). */
const SURFACE_TINT: Record<Surface, number> = { sand: 0, gravel: 0.3, dirt: 0.5, concrete: 0.15 };

/** Structure-of-arrays pool; slots are reused oldest first. */
export class DustSim {
  readonly px = new Float32Array(DUST_MAX); readonly py = new Float32Array(DUST_MAX); readonly pz = new Float32Array(DUST_MAX);
  readonly vx = new Float32Array(DUST_MAX); readonly vy = new Float32Array(DUST_MAX); readonly vz = new Float32Array(DUST_MAX);
  readonly age = new Float32Array(DUST_MAX); readonly life = new Float32Array(DUST_MAX).fill(0);
  readonly size0 = new Float32Array(DUST_MAX); readonly dens = new Float32Array(DUST_MAX);
  readonly kind = new Uint8Array(DUST_MAX); readonly seed = new Float32Array(DUST_MAX);
  /** Darkness of the surface it came off (0 sand .. 1), per puff drag. */
  readonly tint = new Float32Array(DUST_MAX); readonly drag = new Float32Array(DUST_MAX);
  /** Current drawn radius and opacity (written by update for the drawer). */
  readonly radius = new Float32Array(DUST_MAX); readonly alpha = new Float32Array(DUST_MAX);
  /** What the ground is at a point. Everything is sand until the terrain has other surfaces. */
  surfaceAt: (x: number, z: number) => Surface = () => "sand";
  private next = 0;
  private curTint = 0;
  private curDrag = 0;
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
    this.tint[i] = this.curTint;
    this.drag[i] = this.curDrag || (kind === CLOUD ? this.v.cloudDrag : this.v.clumpDrag);
  }

  /** Dust and clump multipliers for the ground at a point (and sets the tint for what's emitted next). */
  private ground_(x: number, z: number): [number, number] {
    const v = this.v, s = this.surfaceAt(x, z);
    this.curTint = SURFACE_TINT[s];
    if (s === "gravel") return [v.gravelDust, v.gravelClump];
    if (s === "dirt") return [v.dirtDust, v.dirtClump];
    if (s === "concrete") return [v.concreteDust, v.concreteClump];
    return [1, 1];
  }

  private count(n: number) { const f = Math.floor(n); return f + (Math.random() < n - f ? 1 : 0); }

  /** A foot landing: sand shoved out round it and pushed on the way the mech moves (vx, vz), a low ring of cloud. */
  stomp(x: number, y: number, z: number, strength: number, mvx = 0, mvz = 0) {
    const v = this.v;
    const [dm, cm] = this.ground_(x, z);
    const nCloud = this.count(v.stompCloud * strength * dm), nClump = this.count(v.stompClump * strength * cm);
    const px = mvx * v.stepPush, pz = mvz * v.stepPush;
    for (let i = 0; i < nCloud; i++) {
      const a = (i / Math.max(1, nCloud)) * Math.PI * 2 + Math.random() * 0.9;
      const s = v.stompSpeed * strength * (0.5 + Math.random() * 0.6);
      this.emit(CLOUD, x + Math.cos(a) * 0.4, y + 0.2, z + Math.sin(a) * 0.4, Math.cos(a) * s + px, 0.3 + Math.random() * 0.5, Math.sin(a) * s + pz,
        v.stompSize * (0.6 + Math.random() * 0.6), v.cloudLife * (0.6 + Math.random() * 0.6), v.cloudDensity);
    }
    for (let i = 0; i < nClump; i++) {
      const a = Math.random() * Math.PI * 2, s = v.stompSpeed * strength * (0.8 + Math.random() * 0.8);
      this.emit(CLUMP, x, y + 0.1, z, Math.cos(a) * s + px * 1.3, 0.8 + Math.random() * 1.6, Math.sin(a) * s + pz * 1.3,
        v.stompSize * 0.35 * (0.6 + Math.random() * 0.7), v.clumpLife * (0.6 + Math.random() * 0.6), v.clumpDensity);
    }
    this.curTint = 0;
  }

  /** A foot leaving the sand: flicked back (dx, dz: unit, the way the sand goes) and up. */
  kick(x: number, y: number, z: number, dx: number, dz: number, strength: number) {
    const v = this.v;
    const [dm, cm] = this.ground_(x, z);
    const nCloud = this.count(v.kickCloud * strength * dm), nClump = this.count(v.kickClump * strength * cm);
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
    this.curTint = 0;
  }

  /**
   * A round into the sand (dx, dz: its flat travel): thick packets of sand churned up and shoved downrange low, a
   * plume thrown up and forward that strings out into a column as its puffs slow, and a little low cloud.
   */
  hit(x: number, y: number, z: number, dx: number, dz: number, k: number) {
    const v = this.v;
    const [dm, cm] = this.ground_(x, z);
    for (let i = 0; i < this.count(v.hitClump * cm); i++) {
      const sp = (Math.random() - 0.5) * 0.6, s = v.hitCarry * (0.5 + Math.random() * 0.7);
      const ex = dx + -dz * sp, ez = dz + dx * sp;
      this.emit(CLUMP, x, y + 0.08, z, ex * s, 0.3 + Math.random() * 1.2, ez * s, v.hitSize * k * (0.5 + Math.random() * 0.6),
        v.clumpLife * (0.5 + Math.random() * 0.5), v.clumpDensity);
    }
    // Plume: up and leaning downrange; faster puffs go further before the drag stops them, so they line up.
    this.curDrag = v.plumeDrag;
    const n = this.count(v.plumePuffs * dm);
    for (let i = 0; i < n; i++) {
      const f = (i + Math.random()) / Math.max(1, n);
      const sx = (Math.random() - 0.5) * 2 * v.plumeSpread, sz = (Math.random() - 0.5) * 2 * v.plumeSpread;
      let jx = dx * v.plumeLean + sx, jy = 1, jz = dz * v.plumeLean + sz;
      const l = Math.hypot(jx, jy, jz); jx /= l; jy /= l; jz /= l;
      const s = v.plumeSpeed * (0.25 + 0.75 * f);
      this.emit(CLOUD, x, y + 0.15, z, jx * s, jy * s, jz * s, v.plumeSize * k * (0.7 + Math.random() * 0.5) * (1.2 - 0.5 * f),
        v.cloudLife * (0.45 + Math.random() * 0.35), v.plumeDensity * (1 - 0.35 * f));
    }
    this.curDrag = 0;
    for (let i = 0; i < this.count(v.hitCloud * dm); i++) {
      this.emit(CLOUD, x + dx * 0.4, y + 0.2, z + dz * 0.4, dx * v.hitCarry * 0.5 + (Math.random() - 0.5), 0.4 + Math.random() * 0.6,
        dz * v.hitCarry * 0.5 + (Math.random() - 0.5), v.hitSize * k * (0.8 + Math.random() * 0.6), v.cloudLife * (0.5 + Math.random() * 0.5), v.cloudDensity * 0.8);
    }
    this.curTint = 0;
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
        // First the throw slows under drag (still air), then the wind and a slow swirl take it; it rises and grows.
        const a = this.age[i], w = v.windIn > 0 ? Math.min(1, a / v.windIn) : 1;
        const ws = w * w * (3 - 2 * w);
        const k = Math.min(1, dt * this.drag[i]);
        const tx = (wx + Math.sin(this.t * 0.7 + sd * 40) * v.turbulence) * ws, tz = (wz + Math.cos(this.t * 0.6 + sd * 31) * v.turbulence) * ws;
        this.vx[i] += (tx - this.vx[i]) * k;
        this.vz[i] += (tz - this.vz[i]) * k;
        this.vy[i] += (v.cloudRise * (0.6 + sd * 0.8) - this.vy[i]) * k;
        this.radius[i] = this.size0[i] * (1 + (v.cloudGrow - 1) * (1 - Math.exp(-u * 4)));
        // Thick from the start, thinning as it spreads.
        this.alpha[i] = this.dens[i] * Math.min(1, u * 12) * Math.pow(1 - u, 1.4);
      } else {
        // Clumps: thrown, slowed hard, falling and settling on the sand; they puff out a little and fade.
        const k = Math.exp(-dt * this.drag[i]);
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
