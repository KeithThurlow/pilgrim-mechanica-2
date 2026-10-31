// Night lights (Keith 2026-10-28, first pass; 2026-10-29: more lights, without the frame cost blowing up). Cosmetic
// (drawing only, every peer makes its own).
//
// Real lights cost on every lit pixel and adding one recompiles the shaders, so there are few and they never come or
// go at run time: a pool of unshadowed point lights and a pool of unshadowed spot lights, both made the first time
// night falls and then kept (at 0 in the day; their sizes are sliders), plus the mech's headlamp, one spot that casts
// shadows (small map, short reach). The pools go to the lamps that matter most this frame: blast flashes first, then
// by kind and nearness to the focus (robot eyes, convoy floods, headlights; deck lamps and cab windows for the points).
//
// Every other lamp is faked, all of them in three draw calls (src/fx/lampDraw.ts): a glow on the lamp head, a soft
// pool where its beam lands and a faint beam cone. Lamps are declared on the bodies (src/world/lamps.ts) and found by
// a scan of the scene every half second: vehicles, the convoy's cars and plough, the robot swarm.
//
// Everything fades in with the night (0 at noon: no lamps drawn, the pools at 0, the headlamp's shadow map not drawn).
// The minigun's muzzle flashes carry their own lights (src/fx/minigun.ts).
//
// Short lights (Keith 2026-10-31: a rocket barrage at night): every rocket and missile in flight (src/weapons/arsenalDraw.ts
// posts them each frame), rocket launches and blasts ask for a real point light; the ones close together merge into
// one brighter light (src/world/lightCluster.ts) and the biggest, nearest clusters get the pool's points; the rest are
// faked on the ground. Each rocket also gets a faked glow, exhaust flare and light on the sand.
//
// Enemy fire and telegraphs (Keith 2026-10-31: "lights being a large part of how the game works"): the same path
// (src/world/lamps.ts ShortLights) takes every side's fire, colour-coded by family (the player's warm orange, bandits
// red-orange, robots red; sliders in Enemy fire lights): gun muzzle flashes, shells in flight, launches, blasts. Held
// lights (an excavator's beam charging) carry a priority over blasts; telegraphs on the ground (shell rings, painted
// strips, the beam's line) glow on the sand and bid for a real light, brighter as they come down. Bodies that ask
// each frame set userData.shortLights (found by the same scan).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { LampDraw } from "../fx/lampDraw";
import { clusterLights, type LightCluster, type LightReq } from "./lightCluster";
import {
  LAMP_HEAD, LAMP_FLOOD, LAMP_ROBOT, LAMP_RUNNING, LAMP_CAB, LAMP_TAIL, LAMP_MECH, LAMP_KINDS,
  FAM_PLAYER, FAM_BANDIT, FAM_ROBOT,
  type LampKind, type LampSpot, type LampSource, type LampEmit, type LightFamily, type ShortLights, type ShortLightSource,
} from "./lamps";

export const NIGHT_LIGHT_DEFAULTS = {
  nightLightCap: 6,
  nightSpotCap: 4,
  lampStrength: 22,
  lampRange: 14,
  headlamp: 1,
  headlampStrength: 220,
  headlampRange: 50,
  headlampAngle: 30,
  headlampDip: 24,
  headlampShadow: 1,
  headlampShadowMap: 1024,
  headlampShadowNear: 0.6,
  headlampBeam: 0.06,
  blastLight: 900,
  blastLightTime: 0.45,
  nightLightsFrom: 0.15,
  lightFar: 160,
  // Rockets and clustering (Keith 2026-10-31)
  clusterRadius: 8,
  clusterCurve: 0.5,
  clusterCap: 4000,
  clusterGrow: 0.6,
  flashPool: 0.5,
  dayFlash: 0,
  rocketLight: 120,
  rocketRange: 10,
  rocketHue: 30,
  rocketGlow: 1.6,
  rocketFlare: 2.8,
  rocketPool: 0.45,
  muzzleLight: 500,
  muzzleTime: 0.1,
  // Enemy fire (Keith 2026-10-31: enemy attacks light up too, colour-coded)
  enemyHue: 18,
  enemyLight: 1.2,
  robotFireHue: 354,
  robotFireLight: 1.3,
  gunFlashLight: 180,
  gunFlashTime: 0.07,
  // Telegraphs on the ground (rings, strips, the beam's line): they glow and light the sand, brighter as they land
  teleLight: 260,
  telePool: 0.55,
  teleRamp: 2,
  telePrio: 1.5,
  // Vehicle lights
  vehReach: 16,
  vehAngle: 16,
  vehGlow: 0.9,
  vehPool: 0.25,
  vehBeam: 0.05,
  vehReal: 160,
  tailGlow: 0.45,
  // Robot lights
  robotReach: 9,
  robotAngle: 16,
  robotSweep: 35,
  robotSweepRate: 0.3,
  robotGlow: 0.7,
  robotPool: 0.35,
  robotBeam: 0.14,
  robotReal: 260,
  // Convoy lights
  floodAngle: 38,
  floodGlow: 1.3,
  floodPool: 0.22,
  floodBeam: 0.04,
  floodReal: 220,
  runningGlow: 0.5,
  runningGap: 4,
  cabGlow: 1.1,
  cabReal: 25,
};
export type NightLightValues = typeof NIGHT_LIGHT_DEFAULTS;

const G = "Night lights", GV = "Vehicle lights", GR = "Robot lights", GC = "Convoy lights", GE = "Enemy fire lights", GT = "Telegraph lights";
/** The slider groups the night lights add to a Light topic. */
export const NIGHT_LIGHT_GROUPS = [G, GE, GT, GV, GR, GC];
export const NIGHT_LIGHT_PARAMS: Param[] = [
  { key: "nightLightCap", label: "Point lights", min: 0, max: 16, step: 1, group: G, tip: "Real point lights for deck lamps, cab windows and blasts (each costs every lit pixel a little; changing it recompiles once)" },
  { key: "nightSpotCap", label: "Spot lights", min: 0, max: 12, step: 1, group: G, tip: "Real spot lights for the nearest robot eyes, floods and headlights (the rest are faked)" },
  { key: "lampStrength", label: "Deck lamp strength", min: 0, max: 100, step: 1, group: G },
  { key: "lampRange", label: "Deck lamp reach (m)", min: 2, max: 40, step: 0.5, group: G },
  { key: "headlamp", label: "Mech headlamp on", min: 0, max: 1, step: 1, group: G },
  { key: "headlampStrength", label: "Headlamp strength", min: 0, max: 2000, step: 10, group: G },
  { key: "headlampRange", label: "Headlamp reach (m)", min: 5, max: 120, step: 1, group: G },
  { key: "headlampAngle", label: "Headlamp cone (°)", min: 5, max: 60, step: 1, group: G },
  { key: "headlampDip", label: "Headlamp dip (°)", min: 0, max: 60, step: 1, group: G, tip: "How far below the head's facing the beam points" },
  { key: "headlampShadow", label: "Headlamp shadows", min: 0, max: 1, step: 1, group: G, tip: "The headlamp casts shadows (one extra shadow map, drawn only at night)" },
  { key: "headlampShadowMap", label: "Headlamp shadow map (px)", min: 256, max: 2048, step: 256, group: G },
  { key: "headlampShadowNear", label: "Headlamp shadow near (m)", min: 0.1, max: 3, step: 0.05, group: G, tip: "Shadows start this far from the lamp (keeps the head itself out)" },
  { key: "headlampBeam", label: "Headlamp beam haze", min: 0, max: 0.5, step: 0.01, group: G, tip: "A faint cone of light in the air along the beam" },
  { key: "blastLight", label: "Blast flash", min: 0, max: 5000, step: 10, group: G, tip: "A blast's light at radius 2.5 m (scales with the blast)" },
  { key: "blastLightTime", label: "Blast flash time (s)", min: 0.05, max: 2, step: 0.05, group: G },
  { key: "nightLightsFrom", label: "On from night amount", min: 0, max: 1, step: 0.01, group: G, tip: "Lights fade in from this much night (0 day .. 1 full night)" },
  { key: "lightFar", label: "Faked lamps out to (m)", min: 40, max: 400, step: 5, group: G, tip: "Glows, pools and beams fade out toward this distance from the focus" },
  { key: "clusterRadius", label: "Merge lights within (m)", min: 0, max: 30, step: 0.5, group: G, tip: "Blasts, launches and rockets this close together share one real light (0: never merge)" },
  { key: "clusterCurve", label: "Merged brightness curve", min: 0, max: 1, step: 0.05, group: G, tip: "0.5: a merged light grows as the square root of how many it holds; 1: the plain sum; 0: only the brightest" },
  { key: "clusterCap", label: "Merged brightness cap", min: 200, max: 20000, step: 100, group: G, tip: "A soft ceiling: a merged light eases toward it and never reaches it" },
  { key: "clusterGrow", label: "Merged reach growth", min: 0, max: 1, step: 0.05, group: G, tip: "How much a merged light's reach grows with its brightness" },
  { key: "flashPool", label: "Faked flash on the ground", min: 0, max: 2, step: 0.05, group: G, tip: "Merged lights left without a real light still light the ground (faked)" },
  { key: "dayFlash", label: "Blast flash by day", min: 0, max: 1, step: 0.01, group: G, tip: "Share of the night flash blasts and rockets get in daylight (above 0 makes the real lights by day: one shader rebuild and their cost all day)" },
  { key: "rocketLight", label: "Rocket light", min: 0, max: 1000, step: 5, group: G, tip: "Each rocket and missile in flight asks for a real light this strong (merged with its neighbours)" },
  { key: "rocketRange", label: "Rocket light reach (m)", min: 2, max: 40, step: 0.5, group: G },
  { key: "rocketHue", label: "Rocket light hue (°)", min: 0, max: 60, step: 1, group: G, tip: "0 red, 30 orange, 55 yellow" },
  { key: "rocketGlow", label: "Rocket glow size (m)", min: 0, max: 5, step: 0.05, group: G },
  { key: "rocketFlare", label: "Rocket exhaust flare (m)", min: 0, max: 10, step: 0.1, group: G },
  { key: "rocketPool", label: "Rocket light on the ground", min: 0, max: 2, step: 0.01, group: G, tip: "The faked glow a rocket throws on the sand under it" },
  { key: "muzzleLight", label: "Launch flash", min: 0, max: 3000, step: 10, group: G, tip: "A rocket leaving its tube" },
  { key: "muzzleTime", label: "Launch flash time (s)", min: 0.02, max: 0.5, step: 0.01, group: G },

  { key: "enemyHue", label: "Bandit fire hue (°)", min: 0, max: 60, step: 1, group: GE, tip: "Bandit and war band rockets, shells, muzzle flashes and blasts (0 red, 30 orange; the player's are 'Rocket light hue')" },
  { key: "enemyLight", label: "Bandit fire strength (×)", min: 0, max: 4, step: 0.05, group: GE },
  { key: "robotFireHue", label: "Robot fire hue (°)", min: 300, max: 380, step: 1, group: GE, tip: "Robot slugs, charges and blasts (360 red; below it toward magenta, above toward orange)" },
  { key: "robotFireLight", label: "Robot fire strength (×)", min: 0, max: 4, step: 0.05, group: GE },
  { key: "gunFlashLight", label: "Gun muzzle flash", min: 0, max: 1500, step: 10, group: GE, tip: "Raider guns, bandit rifles, robot slugs: a small flash of light per drawn round" },
  { key: "gunFlashTime", label: "Gun flash time (s)", min: 0.02, max: 0.3, step: 0.01, group: GE },

  { key: "teleLight", label: "Telegraph light", min: 0, max: 2000, step: 10, group: GT, tip: "A ring or strip about to land asks for a real light this strong (merged with its neighbours)" },
  { key: "telePool", label: "Telegraph glow on the ground", min: 0, max: 3, step: 0.05, group: GT, tip: "The faked light a telegraph throws on the sand" },
  { key: "teleRamp", label: "Brightens as it lands (curve)", min: 0.2, max: 5, step: 0.1, group: GT, tip: "1: brightens evenly over the flight; higher: stays dim, then flares at the end" },
  { key: "telePrio", label: "Telegraph light priority", min: 0.2, max: 10, step: 0.1, group: GT, tip: "How much more a telegraph wants a real light than a blast of the same power" },

  { key: "vehReach", label: "Headlights land at (m)", min: 4, max: 40, step: 0.5, group: GV },
  { key: "vehAngle", label: "Headlight cone (°)", min: 5, max: 60, step: 1, group: GV },
  { key: "vehGlow", label: "Headlight glow size (m)", min: 0, max: 3, step: 0.05, group: GV },
  { key: "vehPool", label: "Headlight pool", min: 0, max: 2, step: 0.01, group: GV, tip: "The faked light on the ground" },
  { key: "vehBeam", label: "Headlight beam haze", min: 0, max: 0.5, step: 0.01, group: GV },
  { key: "vehReal", label: "Headlight real light", min: 0, max: 1000, step: 5, group: GV, tip: "When a headlight gets one of the real spot lights" },
  { key: "tailGlow", label: "Tail light glow (m)", min: 0, max: 2, step: 0.05, group: GV },

  { key: "robotReach", label: "Eye beam lands at (m)", min: 2, max: 30, step: 0.5, group: GR },
  { key: "robotAngle", label: "Eye beam cone (°)", min: 4, max: 45, step: 1, group: GR },
  { key: "robotSweep", label: "Sweep (°)", min: 0, max: 90, step: 1, group: GR, tip: "How far the beam swings either side of where the robot faces (none while it attacks)" },
  { key: "robotSweepRate", label: "Sweeps per second", min: 0, max: 2, step: 0.01, group: GR },
  { key: "robotGlow", label: "Eye glow size (m)", min: 0, max: 3, step: 0.05, group: GR },
  { key: "robotPool", label: "Eye pool", min: 0, max: 3, step: 0.01, group: GR },
  { key: "robotBeam", label: "Eye beam haze", min: 0, max: 1, step: 0.01, group: GR },
  { key: "robotReal", label: "Eye real light", min: 0, max: 2000, step: 10, group: GR, tip: "The nearest few eyes get real red spot lights" },

  { key: "floodAngle", label: "Flood cone (°)", min: 10, max: 80, step: 1, group: GC },
  { key: "floodGlow", label: "Flood glow size (m)", min: 0, max: 4, step: 0.05, group: GC },
  { key: "floodPool", label: "Flood pool", min: 0, max: 2, step: 0.01, group: GC },
  { key: "floodBeam", label: "Flood beam haze", min: 0, max: 0.5, step: 0.01, group: GC },
  { key: "floodReal", label: "Flood real light", min: 0, max: 1500, step: 10, group: GC },
  { key: "runningGlow", label: "Running light glow (m)", min: 0, max: 2, step: 0.05, group: GC },
  { key: "runningGap", label: "Running light spacing (m)", min: 1.5, max: 12, step: 0.5, group: GC, onRelease: true },
  { key: "cabGlow", label: "Cab window glow (m)", min: 0, max: 4, step: 0.05, group: GC },
  { key: "cabReal", label: "Cab window real light", min: 0, max: 200, step: 1, group: GC },
];

const LAMP_COLOR = 0xfff1c8;
/** Colours by kind (linear after THREE.Color's sRGB conversion). */
const KIND_COLOR: number[] = [];
KIND_COLOR[LAMP_HEAD] = 0xffeccc; KIND_COLOR[LAMP_FLOOD] = 0xffd49a; KIND_COLOR[LAMP_ROBOT] = 0xff1a0c;
KIND_COLOR[LAMP_RUNNING] = 0xffa040; KIND_COLOR[LAMP_CAB] = 0xffbf6a; KIND_COLOR[LAMP_TAIL] = 0xff2a18; KIND_COLOR[LAMP_MECH] = 0xfff1dc;
/** How much a kind wants a real light, before nearness. */
const PRIO: number[] = [];
PRIO[LAMP_HEAD] = 1.2; PRIO[LAMP_FLOOD] = 2; PRIO[LAMP_ROBOT] = 3; PRIO[LAMP_RUNNING] = 0; PRIO[LAMP_CAB] = 0.8; PRIO[LAMP_TAIL] = 0; PRIO[LAMP_MECH] = 0;

/** Per-kind values from the sliders, refreshed each frame. */
interface KindLook { reach: number; tanHalf: number; angle: number; glow: number; pool: number; beam: number; real: number; spot: boolean; r: number; g: number; b: number }

interface Lamp { list: () => Iterable<THREE.Object3D>; color: number; k: number }
/** A short light: a blast (kind 0, r its radius), a launch flash (1) or a gun's muzzle flash (2) (r its size share). */
interface Flash { x: number; y: number; z: number; r: number; t: number; T: number; kind: number; fam: LightFamily }
const F_BLAST = 0, F_LAUNCH = 1, F_GUN = 2, FLASH_MAX = 160;
/** Rockets asked for this frame: x, y, z, dx, dy, dz (flight direction), k (size), family each. */
const ROCKET_MAX = 256, RS = 8;
/** Held lights this frame: x, y, z, power, range, r, g, b, prio, glow. */
const HOLD_MAX = 64, HS = 10;
/** Telegraphs this frame: x, y, z (on the ground), half width, half length, along (hx, hz), u (0..1 to landing), family. */
const TELE_MAX = 128, TS = 9;
const BLAST_COL = new THREE.Color(0xffa860), MUZZLE_COL = new THREE.Color(0xffc27a);
/** A lamp wanting a real light this frame. */
interface Want { score: number; kind: LampKind; x: number; y: number; z: number; tx: number; ty: number; tz: number; dist: number; k: number; color: number; range: number }

const byScore = (a: Want, b: Want) => b.score - a.score;

export interface LightGround { height(x: number, z: number): number; normal?(x: number, z: number, out?: number[]): number[] }

export class NightLights implements ShortLights {
  readonly group = new THREE.Group();
  /** The faked lamps (glows, pools, beams); its glows are what hold-V picks. */
  readonly draw = new LampDraw();
  /** The ground beams land on (labs set it; without one they land level with the focus). */
  ground: LightGround | null = null;
  /** The camera glows face (labs set it). */
  camera: THREE.Camera | null = null;
  private lamps: Lamp[] = [];
  private flashes: Flash[] = [];
  private pool: THREE.PointLight[] = [];
  private spots: THREE.SpotLight[] = [];
  private spot: THREE.SpotLight | null = null;
  private tracked: THREE.Object3D | null = null;
  private headLamps: THREE.Object3D[] = [];
  private bodies: THREE.Object3D[] = [];
  private sources: { o: THREE.Object3D; fn: LampSource }[] = [];
  private rescan = 0;
  private scanAt = 0;
  private time = 0;
  private made = false;
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private kinds: KindLook[] = [];
  private wants: Want[] = [];
  private nWant = 0;
  private order: Want[] = [];
  private focus = new THREE.Vector3();
  private n = 0;
  private emitFn: LampEmit;
  private rockets = new Float32Array(ROCKET_MAX * RS);
  private nRocket = 0;
  private reqs: LightReq[] = [];
  private clusters: LightCluster[] = [];
  private clusterOrder: LightCluster[] = [];
  private rocketCol = new THREE.Color();
  private holds = new Float32Array(HOLD_MAX * HS);
  private nHold = 0;
  private teles = new Float32Array(TELE_MAX * TS);
  private nTele = 0;
  private shortSources: { o: THREE.Object3D; fn: ShortLightSource }[] = [];
  /** Colours by family (refreshed each frame from the hue sliders): rockets and blasts, launches and guns, telegraphs. */
  private famFire = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private famMuzzle = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private famTele = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private famK = [1, 1, 1];
  private hc = new THREE.Color();
  /** The request path as the bodies see it (src/world/lamps.ts ShortLights). */
  readonly short: ShortLights;
  /** How many real lights were lit last frame (for the HUD). */
  lit = 0;
  /** Last frame's short lights: requests (rockets, blasts, launches), the clusters they merged into, and how many got a real light. */
  readonly stats = { requests: 0, clusters: 0, real: 0 };
  /** How many times the real-light pools were made (only when their size sliders change). */
  builds = 0;

  constructor(public v: NightLightValues) {
    this.group.name = "night lights";
    this.group.add(this.draw.group);
    for (let i = 0; i < LAMP_KINDS; i++) this.kinds.push({ reach: 0, tanHalf: 0, angle: 0, glow: 0, pool: 0, beam: 0, real: 0, spot: true, r: 0, g: 0, b: 0 });
    this.emitFn = (kind, x, y, z, ax, ay, az, ground, reach, k) => this.emitWorld(kind, x, y, z, ax, ay, az, ground, reach, k);
    this.short = this;
  }

  /** Lamps riding these objects (their world positions each frame, the list asked again each frame), e.g. the convoy's deck lamps. */
  addLamps(list: () => Iterable<THREE.Object3D>, color = 0xffd9a0, k = 1) { this.lamps.push({ list, color, k }); }
  /** The mech whose sensor head lamps become a headlamp (re-found each second: the sensor can be swapped). */
  track(root: THREE.Object3D | null) { this.tracked = root; this.rescan = 0; }
  private addFlash(x: number, y: number, z: number, r: number, T: number, kind: number, fam: LightFamily) {
    if (this.flashes.length >= FLASH_MAX) {
      // Full: drop the faintest gun flash, else the oldest.
      const j = this.flashes.findIndex((f) => f.kind === F_GUN);
      this.flashes.splice(j >= 0 ? j : 0, 1);
    }
    this.flashes.push({ x, y, z, r, t: 0, T, kind, fam });
  }
  /** A blast at (x, y, z) of this radius lights the ground for a moment (fam: whose fire, for its colour). */
  flash(x: number, y: number, z: number, radius: number, fam: LightFamily = FAM_PLAYER) { this.addFlash(x, y, z, radius, this.v.blastLightTime, F_BLAST, fam); }
  /** A rocket or shell leaving its tube (k: its size, 1 a launcher's rocket). */
  launch(x: number, y: number, z: number, k = 1, fam: LightFamily = FAM_PLAYER) { this.addFlash(x, y, z, k, this.v.muzzleTime, F_LAUNCH, fam); }
  /** A gun's muzzle flash (raider guns, bandit rifles, robot slugs; k its size, 1 a heavy gun). */
  gun(x: number, y: number, z: number, k = 1, fam: LightFamily = FAM_PLAYER) { this.addFlash(x, y, z, k, this.v.gunFlashTime, F_GUN, fam); }
  /** A rocket, missile or shell in flight this frame, flying along (dx, dy, dz) (k: its size, 1 a launcher's rocket). Cleared each update. */
  rocket(x: number, y: number, z: number, dx: number, dy: number, dz: number, k = 1, fam: LightFamily = FAM_PLAYER) {
    if (this.nRocket >= ROCKET_MAX) return;
    const a = this.rockets, i = this.nRocket++ * RS;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = dx; a[i + 4] = dy; a[i + 5] = dz; a[i + 6] = k; a[i + 7] = fam;
  }
  /** A light held this frame (a charging emitter): power, reach, colour, priority over blasts (1 alike), faked glow size. */
  hold(x: number, y: number, z: number, power: number, range: number, color: number, prio = 1, glow = 0) {
    if (this.nHold >= HOLD_MAX || power <= 0) return;
    const c = this.hc.setHex(color), a = this.holds, i = this.nHold++ * HS;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = power; a[i + 4] = range; a[i + 5] = c.r; a[i + 6] = c.g; a[i + 7] = c.b; a[i + 8] = prio; a[i + 9] = glow;
  }
  private tele(x: number, y: number, z: number, w: number, l: number, hx: number, hz: number, u: number, fam: LightFamily) {
    if (this.nTele >= TELE_MAX) return;
    const a = this.teles, i = this.nTele++ * TS;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = w; a[i + 4] = l; a[i + 5] = hx; a[i + 6] = hz; a[i + 7] = Math.max(0, Math.min(1, u)); a[i + 8] = fam;
  }
  /** A ring telegraph on the ground (y the ground's height), radius r, u 0..1 how near it is to landing. */
  telegraph(x: number, y: number, z: number, r: number, u: number, fam: LightFamily = FAM_PLAYER) { this.tele(x, y, z, r, r, 1, 0, u, fam); }
  /** A strip telegraph from (x0, z0) to (x1, z1), this wide, u 0..1 how near it is to landing (lit in pieces of 12 m at most). */
  telegraphLine(x0: number, z0: number, x1: number, z1: number, width: number, u: number, fam: LightFamily = FAM_PLAYER) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.1) return;
    const n = Math.min(8, Math.ceil(L / 12)), seg = L / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = x0 + dx * t, z = z0 + dz * t;
      this.tele(x, this.groundAt(x, z), z, width / 2, seg / 2, dx / L, dz / L, u, fam);
    }
  }
  /** The real lights in use: points, spots and the headlamp (for checks). */
  get pools() { return { points: this.pool.length, spots: this.spots.length, headlamp: this.spot }; }
  /** Meshes for hold-V (the lamp glows). */
  selectables(): THREE.Object3D[] { return [this.draw.glows]; }

  private build() {
    const v = this.v;
    for (const l of this.pool) this.group.remove(l);
    for (const s of this.spots) this.group.remove(s, s.target);
    this.pool = []; this.spots = [];
    for (let i = 0; i < Math.round(v.nightLightCap); i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 10, 2);
      this.pool.push(l); this.group.add(l);
    }
    for (let i = 0; i < Math.round(v.nightSpotCap); i++) {
      const s = new THREE.SpotLight(0xffffff, 0, 20, 0.4, 0.6, 2);
      this.spots.push(s); this.group.add(s, s.target);
    }
    if (!this.spot) {
      this.spot = new THREE.SpotLight(0xfff1dc, 0, 40, 0.5, 0.6, 2);
      this.spot.shadow.bias = -0.0006;
      this.spot.shadow.normalBias = 0.03;
      this.group.add(this.spot, this.spot.target);
    }
    this.made = true;
    this.builds++;
  }

  private findLamps() {
    this.headLamps = [];
    this.tracked?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.glow || !o.visible) return;
      const c = (mesh.material as THREE.MeshBasicMaterial).color;
      if (c && c.getHex() === new THREE.Color(LAMP_COLOR).getHex()) this.headLamps.push(o);
    });
  }

  /** Find every body carrying lamps (userData.lamps) and every lamp source (userData.lampSource) in the scene. */
  private scan() {
    this.bodies = []; this.sources = []; this.shortSources = [];
    let root: THREE.Object3D = this.group;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.userData.lamps) this.bodies.push(o);
      if (o.userData.lampSource) this.sources.push({ o, fn: o.userData.lampSource as LampSource });
      if (o.userData.shortLights) this.shortSources.push({ o, fn: o.userData.shortLights as ShortLightSource });
    });
  }

  private static shown(o: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  private refreshKinds() {
    const v = this.v, c = new THREE.Color();
    const set = (kind: number, reach: number, angle: number, glow: number, pool: number, beam: number, real: number, spot = true) => {
      const K = this.kinds[kind];
      K.reach = reach; K.angle = (angle * Math.PI) / 180; K.tanHalf = Math.tan(K.angle); K.glow = glow; K.pool = pool; K.beam = beam; K.real = real; K.spot = spot;
      c.setHex(KIND_COLOR[kind]); K.r = c.r; K.g = c.g; K.b = c.b;
    };
    set(LAMP_HEAD, v.vehReach, v.vehAngle, v.vehGlow, v.vehPool, v.vehBeam, v.vehReal);
    set(LAMP_FLOOD, 12, v.floodAngle, v.floodGlow, v.floodPool, v.floodBeam, v.floodReal);
    set(LAMP_ROBOT, v.robotReach, v.robotAngle, v.robotGlow, v.robotPool, v.robotBeam, v.robotReal);
    set(LAMP_RUNNING, 0, 0, v.runningGlow, 0, 0, 0);
    set(LAMP_TAIL, 0, 0, v.tailGlow, 0, 0, 0);
    set(LAMP_CAB, 0, 0, v.cabGlow, 0, 0, v.cabReal, false);
    set(LAMP_MECH, 0, v.headlampAngle, 0, 0, v.headlampBeam, 0);
  }

  private groundAt(x: number, z: number) { return this.ground ? this.ground.height(x, z) : this.focus.y; }

  /** A world lamp from a source: find where its beam lands, then light it. */
  private emitWorld(kind: LampKind, x: number, y: number, z: number, ax: number, ay: number, az: number, ground: boolean, reach: number, k: number) {
    const K = this.kinds[kind];
    const R = reach > 0 ? reach : K.reach;
    if (Math.hypot(x - this.focus.x, z - this.focus.z) > this.v.lightFar) return;
    if (K.pool <= 0 && K.beam <= 0 && K.real <= 0 || R <= 0) { this.light(kind, x, y, z, 0, 0, 0, 0, 1, 0, false, k); return; }
    if (ground) {
      const h = Math.hypot(ax, az) || 1, lx = x + (ax / h) * R, lz = z + (az / h) * R;
      // The pool lies on the slope near the focus (two more height samples); far ones lie level (cheaper).
      const h0 = this.groundAt(lx, lz);
      let nx = 0, nz = 0;
      if (this.ground && Math.hypot(lx - this.focus.x, lz - this.focus.z) < 35) {
        nx = (h0 - this.ground.height(lx + 0.8, lz)) / 0.8; nz = (h0 - this.ground.height(lx, lz + 0.8)) / 0.8;
      }
      const nl = Math.hypot(nx, 1, nz);
      this.light(kind, x, y, z, lx, h0, lz, nx / nl, 1 / nl, nz / nl, true, k);
    } else this.light(kind, x, y, z, x + ax * R, y + ay * R, z + az * R, 0, 1, 0, true, k);
  }

  /** Light one lamp: its glow, pool and beam (faked), and a bid for a real light. */
  private light(kind: LampKind, x: number, y: number, z: number, lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, beam: boolean, k: number) {
    const K = this.kinds[kind], F = this.v.lightFar;
    const d = Math.hypot(x - this.focus.x, z - this.focus.z);
    if (d > F) return;
    const fade = d < F * 0.7 ? 1 : 1 - (d - F * 0.7) / (F * 0.3);
    const a = this.n * fade * k;
    if (a <= 0.002) return;
    const r = K.r * a, g = K.g * a, b = K.b * a;
    this.draw.glow(x, y, z, K.glow, r, g, b);
    if (beam) {
      const dx = lx - x, dy = ly - y, dz = lz - z, dist = Math.hypot(dx, dy, dz);
      if (dist > 0.1) {
        const rad = Math.max(0.3, dist * K.tanHalf);
        // Low beams stretch their pool along the way they come in.
        const sinG = Math.max(0.22, -(dx * nx + dy * ny + dz * nz) / dist);
        if (K.pool > 0) this.draw.pool(lx, ly, lz, nx, ny, nz, dx, dz, rad, Math.min(rad * 2.5, rad / sinG), r * K.pool, g * K.pool, b * K.pool);
        if (K.beam > 0) this.draw.beam(x, y, z, lx, ly, lz, rad, r * K.beam, g * K.beam, b * K.beam);
      }
      if (K.real > 0 && K.spot) this.want(kind, x, y, z, lx, ly, lz, Math.max(1, dist), a, K.real, 0);
    } else if (K.real > 0 && !K.spot) this.want(kind, x, y, z, x, y, z, 1, a, K.real, 0, 9);
  }

  private want(kind: LampKind, x: number, y: number, z: number, tx: number, ty: number, tz: number, dist: number, k: number, strength: number, color: number, range = 0) {
    if (this.nWant >= this.wants.length) this.wants.push({ score: 0, kind: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, dist: 0, k: 0, color: 0, range: 0 });
    const w = this.wants[this.nWant++];
    const d = Math.hypot(x - this.focus.x, y - this.focus.y, z - this.focus.z);
    w.score = (PRIO[kind] ?? 1) * k / (1 + d / 20);
    w.kind = kind; w.x = x; w.y = y; w.z = z; w.tx = tx; w.ty = ty; w.tz = tz; w.dist = dist; w.k = k * strength; w.color = color || KIND_COLOR[kind]; w.range = range;
  }

  /** Lamps fixed on a body: to world space, then lit. */
  private bodyLamps(o: THREE.Object3D) {
    const spots = o.userData.lamps as LampSpot[];
    if (!spots.length || o.userData.lampsOff || !NightLights.shown(o)) return;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    // Whole body out of reach: skip it (the bodies are a few tens of metres at most).
    if (Math.hypot(e[12] - this.focus.x, e[14] - this.focus.z) > this.v.lightFar + 40) return;
    const ux = e[4], uy = e[5], uz = e[6], ul = Math.hypot(ux, uy, uz) || 1;
    for (const s of spots) {
      const [px, py, pz] = s.p;
      const x = e[0] * px + e[4] * py + e[8] * pz + e[12], y = e[1] * px + e[5] * py + e[9] * pz + e[13], z = e[2] * px + e[6] * py + e[10] * pz + e[14];
      if (!s.d) { this.light(s.kind, x, y, z, 0, 0, 0, 0, 1, 0, false, 1); continue; }
      const [qx, qy, qz] = s.d;
      let ax = e[0] * qx + e[4] * qy + e[8] * qz, ay = e[1] * qx + e[5] * qy + e[9] * qz, az = e[2] * qx + e[6] * qy + e[10] * qz;
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      const R = s.len ?? this.kinds[s.kind].reach;
      if (s.ground) this.emitWorld(s.kind, x, y, z, ax, ay, az, true, R, 1);
      else this.light(s.kind, x, y, z, x + ax * R, y + ay * R, z + az * R, ux / ul, uy / ul, uz / ul, true, 1);
    }
  }

  /**
   * The short lights this frame as requests (k: their share of full strength, n: night for the faked parts), each
   * rocket's faked glow, exhaust flare and light on the sand, then merged into clusters. Returns the cluster count.
   */
  private shortLights(k: number, n: number): number {
    const v = this.v;
    let nr = 0;
    const req = (x: number, y: number, z: number, power: number, range: number, c: { r: number; g: number; b: number }, prio = 1) => {
      if (nr >= this.reqs.length) this.reqs.push({ x: 0, y: 0, z: 0, power: 0, range: 0, r: 0, g: 0, b: 0, prio: 1 });
      const q = this.reqs[nr++];
      q.x = x; q.y = y; q.z = z; q.power = power; q.range = range; q.r = c.r; q.g = c.g; q.b = c.b; q.prio = prio;
    };
    // Family colours and strengths from the sliders.
    const hue = (h: number) => (((h % 360) + 360) % 360) / 360;
    this.famFire[FAM_PLAYER].copy(BLAST_COL); this.famMuzzle[FAM_PLAYER].copy(MUZZLE_COL); this.famTele[FAM_PLAYER].setHex(0xff5a2a);
    // The hue sliders pick colours as they look (sRGB), not in linear.
    const SRGB = THREE.SRGBColorSpace;
    this.famFire[FAM_BANDIT].setHSL(hue(v.enemyHue), 1, 0.55, SRGB); this.famMuzzle[FAM_BANDIT].setHSL(hue(v.enemyHue + 4), 1, 0.6, SRGB); this.famTele[FAM_BANDIT].setHSL(hue(v.enemyHue), 1, 0.5, SRGB);
    this.famFire[FAM_ROBOT].setHSL(hue(v.robotFireHue), 1, 0.5, SRGB); this.famMuzzle[FAM_ROBOT].setHSL(hue(v.robotFireHue + 2), 1, 0.56, SRGB); this.famTele[FAM_ROBOT].setHSL(hue(v.robotFireHue), 1, 0.48, SRGB);
    this.famK[FAM_PLAYER] = 1; this.famK[FAM_BANDIT] = v.enemyLight; this.famK[FAM_ROBOT] = v.robotFireLight;
    const fam = (f: number) => (f === FAM_BANDIT || f === FAM_ROBOT ? f : FAM_PLAYER);
    const F = v.lightFar;
    /** Faked parts fade toward the far edge (and are night only). */
    const fadeAt = (x: number, z: number) => {
      const d = Math.hypot(x - this.focus.x, z - this.focus.z);
      return n <= 0 || d > F ? 0 : n * (d < F * 0.7 ? 1 : 1 - (d - F * 0.7) / (F * 0.3));
    };
    if (k > 0) {
      for (const f of this.flashes) {
        const e = 1 - f.t / f.T, ee = e * e * k, fm = fam(f.fam), K = this.famK[fm];
        if (f.kind === F_LAUNCH) req(f.x, f.y, f.z, v.muzzleLight * f.r * ee * K, 5 + 4 * f.r, this.famMuzzle[fm]);
        else if (f.kind === F_GUN) req(f.x, f.y, f.z, v.gunFlashLight * f.r * ee * K, 4 + 3 * f.r, this.famMuzzle[fm]);
        else req(f.x, f.y, f.z, v.blastLight * (f.r / 2.5) * ee * K, f.r * 5 + 6, this.famFire[fm]);
      }
      // Held lights (a charging emitter), with their own priority and a faked glow.
      const hd = this.holds;
      for (let i = 0; i < this.nHold; i++) {
        const o = i * HS, x = hd[o], y = hd[o + 1], z = hd[o + 2];
        this.hc.setRGB(hd[o + 5], hd[o + 6], hd[o + 7]);
        req(x, y, z, hd[o + 3] * k, hd[o + 4], this.hc, hd[o + 8]);
        const A = fadeAt(x, z);
        if (A > 0 && hd[o + 9] > 0) this.draw.glow(x, y, z, hd[o + 9], hd[o + 5] * A, hd[o + 6] * A, hd[o + 7] * A);
      }
      // Telegraphs: a glow on the sand (faked) and a bid for a real light, both brightening as they come down.
      const ta = this.teles;
      for (let i = 0; i < this.nTele; i++) {
        const o = i * TS, x = ta[o], y = ta[o + 1], z = ta[o + 2], w = ta[o + 3], l = ta[o + 4], c = this.famTele[fam(ta[o + 8])];
        const b = 0.25 + 0.75 * Math.pow(ta[o + 7], v.teleRamp), size = Math.sqrt(Math.max(1, w * l) / 9);
        req(x, y + 1.2, z, v.teleLight * b * k * Math.min(2, size), Math.max(w, l) * 1.6 + 4, c, v.telePrio);
        const A = fadeAt(x, z) * b * v.telePool;
        if (A > 0) this.draw.pool(x, y, z, 0, 1, 0, ta[o + 5], ta[o + 6], w * 1.25, l * 1.1 + w * 0.25, c.r * A, c.g * A, c.b * A);
      }
      this.rocketCol.setHSL(v.rocketHue / 360, 1, 0.6);
      const a = this.rockets;
      for (let i = 0; i < this.nRocket; i++) {
        const o = i * RS, x = a[o], y = a[o + 1], z = a[o + 2], s = a[o + 6], fm = fam(a[o + 7]);
        const col = fm === FAM_PLAYER ? this.rocketCol : this.famFire[fm];
        req(x, y, z, v.rocketLight * s * k * this.famK[fm], v.rocketRange * Math.sqrt(s), col);
        // Faked, at night only: a glow on the rocket, a flare back along its flight, a soft light on the sand under it.
        const d = Math.hypot(x - this.focus.x, z - this.focus.z);
        if (n <= 0 || d > F) continue;
        const A = n * (d < F * 0.7 ? 1 : 1 - (d - F * 0.7) / (F * 0.3));
        const r = col.r * A, g = col.g * A, b = col.b * A;
        this.draw.glow(x, y, z, v.rocketGlow * s, r, g, b);
        const dl = Math.hypot(a[o + 3], a[o + 4], a[o + 5]) || 1, L = v.rocketFlare * s / dl;
        if (L > 0) this.draw.beam(x, y, z, x - a[o + 3] * L, y - a[o + 4] * L, z - a[o + 5] * L, 0.22 * v.rocketFlare * s, r, g, b);
        if (v.rocketPool > 0) {
          const gy = this.groundAt(x, z), h = Math.max(0, y - gy);
          if (h < 30) {
            const rad = (1.5 + h * 0.4) * Math.sqrt(s), p = v.rocketPool / (1 + h * 0.12);
            this.draw.pool(x, gy, z, 0, 1, 0, a[o + 3], a[o + 5], rad, rad, r * p, g * p, b * p);
          }
        }
      }
    }
    this.nRocket = 0; this.nHold = 0; this.nTele = 0;
    this.stats.requests = nr;
    return clusterLights(this.reqs, nr, { radius: v.clusterRadius, curve: v.clusterCurve, cap: v.clusterCap, grow: v.clusterGrow }, this.clusters);
  }

  /** night: 0 day .. 1 full night (from the look). focus: where the camera looks, for picking the nearest lamps. */
  update(dt: number, night: number, focus: THREE.Vector3) {
    const v = this.v;
    this.time += dt;
    this.focus.copy(focus);
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.T);
    const n = (this.n = Math.max(0, Math.min(1, (night - v.nightLightsFrom) / Math.max(0.01, 1 - v.nightLightsFrom))));
    this.draw.begin(this.camera);
    this.nWant = 0;
    // Short lights (blasts, launches, rockets) by day: a share of their night light, only if the slider asks for it.
    const shortK = n + (v.dayFlash > 0 ? v.dayFlash * (1 - n) : 0);
    const busy = this.flashes.length > 0 || this.nRocket > 0 || this.nHold > 0 || this.nTele > 0;
    if (n <= 0 && !this.made && !(shortK > 0 && busy)) {
      this.lit = 0; this.nRocket = this.nHold = this.nTele = 0; this.stats.requests = this.stats.clusters = this.stats.real = 0; this.draw.end(); return;
    }
    if (!this.made || this.pool.length !== Math.round(v.nightLightCap) || this.spots.length !== Math.round(v.nightSpotCap)) this.build();
    // Bodies that ask for short lights each frame (the excavators' beams), before they're merged.
    this.scanAt -= dt;
    if (this.scanAt <= 0) { this.scan(); this.scanAt = 0.5; }
    if (shortK > 0) for (const s of this.shortSources) if (NightLights.shown(s.o)) s.fn(this.short, this.time);

    // Short lights first, so a big swarm's lamps never crowd the rockets' glows out of the faked-light buffers.
    const nc = this.shortLights(shortK, n);
    // Faked lamps (and their bids for the real ones), only at night.
    if (n > 0) {
      this.refreshKinds();
      for (const o of this.bodies) this.bodyLamps(o);
      for (const s of this.sources) if (NightLights.shown(s.o)) s.fn(this.emitFn, this.time, this.v);
    }

    // Points: the short lights first (blasts, launches, rockets, merged where they bunch up; the brightest and nearest
    // first; the rest faked on the ground), then deck lamps and cab windows nearest the focus.
    let used = 0;
    const cl = this.clusterOrder; cl.length = 0;
    for (let j = 0; j < nc; j++) {
      const c = this.clusters[j];
      c.score = c.power * c.prio / (1 + Math.hypot(c.x - focus.x, c.z - focus.z) / 30);
      cl.push(c);
    }
    cl.sort((a, b) => b.score - a.score);
    for (const c of cl) {
      if (used < this.pool.length) {
        const l = this.pool[used++];
        l.position.set(c.x, c.y, c.z);
        l.color.setRGB(c.r, c.g, c.b);
        l.distance = c.range;
        l.intensity = c.power;
      } else if (n > 0 && v.flashPool > 0) {
        const gy = this.groundAt(c.x, c.z), h = Math.max(0, c.y - gy);
        const k = v.flashPool * Math.min(1.5, c.power / Math.max(1, v.blastLight)) / (1 + h * 0.15);
        const rad = c.range * 0.45;
        this.draw.pool(c.x, gy, c.z, 0, 1, 0, 1, 0, rad, rad, c.r * k, c.g * k, c.b * k);
      }
    }
    this.stats.clusters = nc; this.stats.real = used;
    if (n > 0 && used < this.pool.length) {
      for (const L of this.lamps) for (const o of L.list()) {
        o.getWorldPosition(this.p);
        if (this.p.distanceToSquared(focus) > 120 * 120) continue;
        this.draw.glow(this.p.x, this.p.y, this.p.z, 0.8, 0.5 * n, 0.42 * n, 0.3 * n);
        this.want(LAMP_CAB, this.p.x, this.p.y, this.p.z, this.p.x, this.p.y, this.p.z, 1, L.k * n, v.lampStrength, L.color, v.lampRange);
        this.wants[this.nWant - 1].score *= 1.5;
      }
    }
    const wants = this.order; wants.length = 0;
    for (let i = 0; i < this.nWant; i++) wants.push(this.wants[i]);
    wants.sort(byScore);
    let spotsUsed = 0;
    for (const w of wants) {
      if (w.kind === LAMP_CAB) {
        if (used >= this.pool.length) continue;
        const l = this.pool[used++];
        l.position.set(w.x, w.y, w.z);
        l.color.setHex(w.color);
        l.distance = w.range;
        l.intensity = w.k;
      } else {
        if (spotsUsed >= this.spots.length) continue;
        const s = this.spots[spotsUsed++];
        s.position.set(w.x, w.y, w.z);
        s.target.position.set(w.tx, w.ty, w.tz);
        s.target.updateMatrixWorld();
        s.color.setHex(w.color);
        s.angle = Math.min(1.4, this.kinds[w.kind].angle * 1.15);
        s.distance = w.dist * 1.8 + 4;
        s.intensity = w.k;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].intensity = 0;
    for (let i = spotsUsed; i < this.spots.length; i++) this.spots[i].intensity = 0;
    this.lit = n > 0 ? used + spotsUsed : used;

    // Headlamp: from the sensor head's lamps, along the head's facing, dipped toward the ground; it casts shadows.
    const s = this.spot!;
    const shadow = v.headlampShadow > 0.5;
    if (s.castShadow !== shadow) s.castShadow = shadow;
    const ms = Math.round(v.headlampShadowMap);
    if (s.shadow.mapSize.x !== ms) s.shadow.mapSize.set(ms, ms);
    if (s.shadow.camera.near !== v.headlampShadowNear) { s.shadow.camera.near = v.headlampShadowNear; s.shadow.camera.updateProjectionMatrix(); }
    this.rescan -= dt;
    if (this.rescan <= 0) { this.findLamps(); this.rescan = 1; }
    if (v.headlamp > 0.5 && this.headLamps.length && n > 0) {
      this.p.set(0, 0, 0);
      for (const o of this.headLamps) { o.getWorldPosition(this.q); this.p.add(this.q); }
      this.p.divideScalar(this.headLamps.length);
      this.m.extractRotation(this.headLamps[0].matrixWorld);
      const fwd = this.q.set(0, 0, 1).applyMatrix4(this.m);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const dip = (v.headlampDip * Math.PI) / 180;
      s.position.copy(this.p).addScaledVector(fwd, 0.3);
      s.target.position.copy(s.position).addScaledVector(fwd, Math.cos(dip) * 10);
      s.target.position.y -= Math.sin(dip) * 10;
      s.angle = (v.headlampAngle * Math.PI) / 180;
      s.distance = v.headlampRange;
      s.intensity = v.headlampStrength * n;
      s.shadow.autoUpdate = shadow;
      this.lit++;
      // A faint cone in the air down to where the beam meets the ground.
      if (v.headlampBeam > 0) {
        const h = s.position.y - this.groundAt(s.position.x, s.position.z);
        const reach = Math.min(v.headlampRange * 0.6, h / Math.max(0.05, Math.tan(dip)));
        const lx = s.position.x + fwd.x * reach, lz = s.position.z + fwd.z * reach;
        const K = this.kinds[LAMP_MECH], a = n * v.headlampBeam;
        this.draw.beam(s.position.x, s.position.y, s.position.z, lx, this.groundAt(lx, lz), lz, Math.max(0.5, Math.hypot(reach, h) * Math.tan(s.angle) * 0.8), K.r * a, K.g * a, K.b * a);
      }
    } else { s.intensity = 0; s.shadow.autoUpdate = false; }
    this.draw.end();
  }
}
