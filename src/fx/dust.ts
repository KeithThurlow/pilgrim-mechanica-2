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
  dustWindAngle: 70,
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
  stompCloud: 1,
  stompClump: 1,
  stompSize: 0.8,
  stompSpeed: 2,
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
  sprayCount: 10,
  spraySpeed: 11,
  spraySize: 0.12,
  sprayLean: 0.7,
  windIn: 1.2,
  wheelDust: 0.9,
  wheelClump: 0.5,
  slideDust: 1.2,
  slideClump: 2.2,
  slideThrow: 0.6,
  slideMin: 1.5,
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
  dustCullMargin: 15,
  dustGroundRefresh: 1.5,
  dustGroundEvery: 30,
  dustSunEvery: 8,
};
export type DustValues = typeof DUST_DEFAULTS;

export const DUST_PARAMS: Param[] = [
  { key: "dustWindAngle", label: "Wind toward (°)", min: 0, max: 360, step: 1, group: "Dust", tip: "Compass heading the wind carries the dust (0 = +Z)" },
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
  { key: "stompCloud", label: "Footfall: cloud puffs (as a foot lands)", min: 0, max: 20, step: 1, group: "Dust: sources", tip: "Only the puffs as a foot comes down. At 0 the steps still raise dust (Keith 2026-10-26 likes it that way): each foot's toe kick as it leaves the ground (Toe kick sliders) and the footfall's clumps below" },
  { key: "stompClump", label: "Footfall: clumps (as a foot lands)", min: 0, max: 20, step: 1, group: "Dust: sources", tip: "Sand shoved out round the foot as it lands" },
  { key: "stompSize", label: "Stomp: puff size (m)", min: 0.1, max: 3, step: 0.05, group: "Dust: sources" },
  { key: "stompSpeed", label: "Stomp: spread speed", min: 0, max: 8, step: 0.1, group: "Dust: sources" },
  { key: "kickCloud", label: "Toe kick: cloud puffs (as a foot lifts)", min: 0, max: 20, step: 1, group: "Dust: sources", tip: "Sand flicked back as a foot leaves the ground: most of a step's dust when the footfall's puffs are 0" },
  { key: "kickClump", label: "Toe kick: clumps (as a foot lifts)", min: 0, max: 20, step: 1, group: "Dust: sources" },
  { key: "kickSize", label: "Toe kick: puff size (m)", min: 0.1, max: 3, step: 0.05, group: "Dust: sources" },
  { key: "kickSpeed", label: "Toe kick: speed", min: 0, max: 10, step: 0.1, group: "Dust: sources" },
  { key: "sprintKick", label: "Running: footfall and toe kick dust ×", min: 1, max: 4, step: 0.05, group: "Dust: sources", tip: "Multiplies both the footfall and the toe kick dust when moving faster than the walk (the Shift run and the sprint). The sprint multiplies again by its own dust × (Sprint kit)" },
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
  { key: "sprayCount", label: "Round hit: spray streaks", min: 0, max: 30, step: 1, group: "Dust: sources", tip: "The punch: fast streaks of sand flung up and forward at the strike, falling back in a moment" },
  { key: "spraySpeed", label: "Spray speed (m/s)", min: 1, max: 30, step: 0.5, group: "Dust: sources" },
  { key: "spraySize", label: "Spray streak width (m)", min: 0.02, max: 0.6, step: 0.01, group: "Dust: sources" },
  { key: "sprayLean", label: "Spray lean downrange", min: 0, max: 2, step: 0.01, group: "Dust: sources" },
  { key: "stepPush", label: "Step pushes dust along", min: 0, max: 2, step: 0.01, group: "Dust: sources", tip: "Share of the mech's speed the stomp's sand carries forward" },
  { key: "wheelDust", label: "Wheels: dust per metre", min: 0, max: 4, step: 0.05, group: "Dust: sources", tip: "Cloud puffs a rolling wheel throws up per metre, more when it slides" },
  { key: "wheelClump", label: "Wheels: clumps per metre", min: 0, max: 4, step: 0.05, group: "Dust: sources" },
  { key: "slideDust", label: "Skidding foot: dust per metre", min: 0, max: 6, step: 0.05, group: "Dust: sources", tip: "A foot sliding over the ground (a dash's slide, a drift, a landing skid, sliding down a face) throws cloud along its carve; more the faster it slides, by what the ground is (Dust: surfaces)" },
  { key: "slideClump", label: "Skidding foot: clumps per metre", min: 0, max: 8, step: 0.05, group: "Dust: sources", tip: "Sand or gravel shoved ahead of the sliding foot and flung aside" },
  { key: "slideThrow", label: "Skidding foot: thrown along (× slide speed)", min: 0, max: 1.5, step: 0.01, group: "Dust: sources" },
  { key: "slideMin", label: "Skidding foot: from (m/s)", min: 0.2, max: 6, step: 0.1, group: "Dust: sources", tip: "Slower than this a foot only creeps: no dust or furrow" },
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
  { key: "dustCullMargin", label: "Off-screen margin (m)", min: 0, max: 60, step: 1, group: "Dust: look", tip: "Puffs further than this outside the view skip sorting, shading and their ground shadow (they still drift). Raise it if shadows of off-screen dust pop in at the edges (Keith 2026-10-25: far-away convoy dust cost frame time)" },
  { key: "softDistance", label: "Soft into the ground (m)", min: 0.05, max: 4, step: 0.05, group: "Dust: look", tip: "Puffs fade where they meet the sand and the mech instead of cutting a hard line" },
  { key: "shadowStrength", label: "Shadow on the sand", min: 0, max: 1, step: 0.01, group: "Dust: look" },
  { key: "shadowSize", label: "Shadow size ×", min: 0.3, max: 2.5, step: 0.05, group: "Dust: look" },
  { key: "dustGroundRefresh", label: "Dust: re-read the ground after (m)", min: 0.1, max: 8, step: 0.1, group: "Performance", tip: "Each puff keeps the ground under it and under its shadow (height and slope) and reads it again only after drifting this far (perf pass 1: the ground lookups were 60% of the stress frame). Lower is exacter, higher cheaper" },
  { key: "dustGroundEvery", label: "Dust: re-read the ground every (frames)", min: 1, max: 240, step: 1, group: "Performance", tip: "And at least this often, in turn, so craters dug under hanging dust are picked up" },
  { key: "dustSunEvery", label: "Dust: dune shade every (frames)", min: 1, max: 60, step: 1, group: "Performance", tip: "Each puff marches toward the sun over the dunes (is it behind one?) once every this many frames, in turn" },
];

export const DUST_MAX = 4096;
export const CLUMP = 0, CLOUD = 1, SPRAY = 2;

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
  /**
   * The ground under each puff, kept from where it was last read (perf pass 1): the point (gx, gz), its height and
   * slope, so the floor is a plane until the puff drifts dustGroundRefresh metres. gx is NaN for a fresh puff.
   * Also counts how many reads (for the perf notes).
   */
  private gx = new Float32Array(DUST_MAX).fill(NaN); private gz = new Float32Array(DUST_MAX);
  private gy = new Float32Array(DUST_MAX); private gdx = new Float32Array(DUST_MAX); private gdz = new Float32Array(DUST_MAX);
  private frame = 0;
  private nn = [0, 1, 0];
  groundReads = 0;
  /** What the ground is at a point. Everything is sand until the terrain has other surfaces. */
  surfaceAt: (x: number, z: number) => Surface = () => "sand";
  private next = 0;
  private curTint = 0;
  private curDrag = 0;
  alive = 0;
  private t = 0;

  /** What the floor is read from: the true ground, or a cheap one for looks (src/world/chunkGround.ts). */
  constructor(public v: DustValues, public ground: Ground) {}

  emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, dens: number) {
    const i = this.next;
    this.next = (this.next + 1) % DUST_MAX;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size; this.dens[i] = dens;
    this.gx[i] = NaN;
    this.kind[i] = kind; this.seed[i] = Math.random();
    this.tint[i] = this.curTint;
    this.drag[i] = this.curDrag || (kind === CLOUD ? this.v.cloudDrag : this.v.clumpDrag);
  }

  /** A puff of a given darkness (0 sand .. 1 dark), e.g. smoke off steel or a burning wreck. */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, dens: number, dark: number) {
    this.curTint = dark;
    this.emit(CLOUD, x, y, z, vx, vy, vz, size, life, dens);
    this.curTint = 0;
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
      this.emit(CLOUD, x, y + 0.15, z, jx * s, jy * s, jz * s, v.plumeSize * k * 0.55 * (0.7 + Math.random() * 0.5) * (1.2 - 0.5 * f),
        v.cloudLife * (0.45 + Math.random() * 0.35), v.plumeDensity * (1 - 0.35 * f));
    }
    this.curDrag = 0;
    // Spray: the punch of the strike, fast grains flung up and on, streaking, falling back almost at once.
    this.curDrag = 0.6;
    for (let i = 0; i < this.count(v.sprayCount * Math.max(dm, cm)); i++) {
      const sx = (Math.random() - 0.5) * 1.2, sz = (Math.random() - 0.5) * 1.2;
      let jx = dx * v.sprayLean + sx, jy = 0.8 + Math.random() * 0.9, jz = dz * v.sprayLean + sz;
      const l = Math.hypot(jx, jy, jz); jx /= l; jy /= l; jz /= l;
      const s = v.spraySpeed * (0.5 + Math.random() * 0.7);
      this.emit(SPRAY, x, y + 0.1, z, jx * s, jy * s, jz * s, v.spraySize * (0.7 + Math.random() * 0.6) * Math.sqrt(k), 0.3 + Math.random() * 0.35, 0.95);
    }
    this.curDrag = 0;
    for (let i = 0; i < this.count(v.hitCloud * dm); i++) {
      this.emit(CLOUD, x + dx * 0.4, y + 0.2, z + dz * 0.4, dx * v.hitCarry * 0.5 + (Math.random() - 0.5), 0.4 + Math.random() * 0.6,
        dz * v.hitCarry * 0.5 + (Math.random() - 0.5), v.hitSize * k * (0.8 + Math.random() * 0.6), v.cloudLife * (0.5 + Math.random() * 0.5), v.cloudDensity * 0.8);
    }
    this.curTint = 0;
  }

  /**
   * A wheel rolling over the sand this step: travelled metres, its world velocity and how much it slides (0..1).
   * Throws a low roost of clumps and a puff of cloud behind it, in proportion to the distance (call every frame).
   * acc: the caller's per-wheel carry-over (fractional puffs), returned updated.
   */
  wheel(x: number, y: number, z: number, vx: number, vz: number, metres: number, slip: number, acc: number): number {
    const v = this.v;
    const [dm, cm] = this.ground_(x, z);
    acc += metres * (0.35 + slip * 1.6) * (v.wheelDust * dm + v.wheelClump * cm);
    const sp = Math.hypot(vx, vz) || 1;
    while (acc >= 1) {
      acc -= 1;
      const cloud = Math.random() < v.wheelDust * dm / Math.max(1e-6, v.wheelDust * dm + v.wheelClump * cm);
      const back = 0.25 + Math.random() * 0.35, side = (Math.random() - 0.5) * 1.2;
      const bx = -vx / sp, bz = -vz / sp;
      if (cloud) {
        this.emit(CLOUD, x, y + 0.3, z, vx * 0.15 + bx * 1.5 + -bz * side, 0.4 + Math.random() * 0.7, vz * 0.15 + bz * 1.5 + bx * side,
          0.5 + Math.random() * 0.4, v.cloudLife * (0.6 + Math.random() * 0.6), v.cloudDensity * 0.9);
      } else {
        const s = sp * back;
        this.emit(CLUMP, x, y + 0.15, z, bx * s + -bz * side * 2, 1 + Math.random() * 2.5 * (0.4 + slip), bz * s + bx * side * 2,
          0.18 + Math.random() * 0.2, v.clumpLife * (0.6 + Math.random() * 0.5), v.clumpDensity);
      }
    }
    this.curTint = 0;
    return acc;
  }

  /**
   * A foot skidding over the ground this step (Keith 2026-10-26 18:28: "when the foot's sliding along the ground, carving
   * up sand or dirt or whatever it is, we want to kick up dust or gravel"): sand shoved ahead of the foot and flung aside
   * low, and a trail of cloud, in proportion to the distance and more the faster it slides. acc: the caller's per-foot
   * carry-over (fractional puffs), returned updated.
   */
  slide(x: number, y: number, z: number, vx: number, vz: number, dt: number, acc: number): number {
    const v = this.v, sp = Math.hypot(vx, vz);
    if (sp < v.slideMin) return 0;
    const [dm, cm] = this.ground_(x, z);
    const dx = vx / sp, dz = vz / sp, k = Math.min(2.5, sp / 8);
    acc += sp * dt * k * (v.slideDust * dm + v.slideClump * cm);
    const cloudShare = v.slideDust * dm / Math.max(1e-6, v.slideDust * dm + v.slideClump * cm);
    while (acc >= 1) {
      acc -= 1;
      const side = Math.random() - 0.5, thr = v.slideThrow * sp;
      if (Math.random() < cloudShare) {
        this.emit(CLOUD, x + dx * 0.3, y + 0.25, z + dz * 0.3, dx * thr * 0.5 - dz * side * 1.5, 0.5 + Math.random() * 0.8, dz * thr * 0.5 + dx * side * 1.5,
          0.5 + Math.random() * 0.5, v.cloudLife * (0.6 + Math.random() * 0.6), v.cloudDensity * 0.9);
      } else {
        const s = thr * (0.6 + Math.random() * 0.6);
        this.emit(CLUMP, x + dx * 0.4, y + 0.1, z + dz * 0.4, dx * s - dz * side * 3, 1 + Math.random() * 2, dz * s + dx * side * 3,
          0.15 + Math.random() * 0.2, v.clumpLife * (0.6 + Math.random() * 0.5), v.clumpDensity);
      }
    }
    this.curTint = 0;
    return acc;
  }

  update(dt: number) {
    const v = this.v;
    this.t += dt;
    this.frame++;
    const wa = (v.dustWindAngle * Math.PI) / 180, wx = Math.sin(wa) * v.windSpeed, wz = Math.cos(wa) * v.windSpeed;
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
        this.alpha[i] = this.dens[i] * Math.min(1, u * 30) * Math.pow(1 - u, 1.4);
      } else if (this.kind[i] === SPRAY) {
        // Spray: ballistic grains, full gravity, a little drag; thin out at the end.
        const k = Math.exp(-dt * this.drag[i]);
        this.vx[i] *= k; this.vz[i] *= k; this.vy[i] = this.vy[i] * k - 9.8 * dt;
        this.radius[i] = this.size0[i];
        this.alpha[i] = this.dens[i] * (1 - u * u);
      } else {
        // Clumps: thrown, slowed hard, falling and settling on the sand; they puff out a little and fade.
        const k = Math.exp(-dt * this.drag[i]);
        this.vx[i] *= k; this.vz[i] *= k;
        this.vy[i] -= 9.8 * 0.6 * dt;
        this.radius[i] = this.size0[i] * (1 + 0.8 * u);
        this.alpha[i] = this.dens[i] * Math.min(1, u * 20) * (1 - u * u);
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const g = this.floorAt(i) + this.radius[i] * 0.25;
      if (this.py[i] < g) { this.py[i] = g; if (this.vy[i] < 0) this.vy[i] = 0; }
    }
    this.alive = alive;
  }

  /** The ground under puff i: the kept plane, read again when it has drifted off it or its turn comes round. */
  floorAt(i: number): number {
    const x = this.px[i], z = this.pz[i], dx = x - this.gx[i], dz = z - this.gz[i];
    const R = this.v.dustGroundRefresh ?? 1.5, every = Math.max(1, Math.round(this.v.dustGroundEvery ?? 30));
    if (!(dx * dx + dz * dz <= R * R) || (i + this.frame) % every === 0) {
      this.gx[i] = x; this.gz[i] = z;
      this.gy[i] = this.ground.height(x, z);
      const n = this.ground.normal(x, z, this.nn), ny = Math.max(0.2, n[1]);
      this.gdx[i] = -n[0] / ny; this.gdz[i] = -n[2] / ny;
      this.groundReads++;
      return this.gy[i];
    }
    return this.gy[i] + this.gdx[i] * dx + this.gdz[i] * dz;
  }
}
