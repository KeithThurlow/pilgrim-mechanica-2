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
// Muzzle flashes carry their own lights (src/fx/minigun.ts).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { LampDraw } from "../fx/lampDraw";
import {
  LAMP_HEAD, LAMP_FLOOD, LAMP_ROBOT, LAMP_RUNNING, LAMP_CAB, LAMP_TAIL, LAMP_MECH, LAMP_KINDS,
  type LampKind, type LampSpot, type LampSource, type LampEmit,
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
  // Vehicle lights
  vehReach: 16,
  vehAngle: 24,
  vehGlow: 0.9,
  vehPool: 0.3,
  vehBeam: 0.05,
  vehReal: 160,
  tailGlow: 0.45,
  // Robot lights
  robotReach: 9,
  robotAngle: 16,
  robotSweep: 35,
  robotSweepRate: 0.3,
  robotGlow: 0.7,
  robotPool: 0.55,
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

const G = "Night lights", GV = "Vehicle lights", GR = "Robot lights", GC = "Convoy lights";
/** The slider groups the night lights add to a Light topic. */
export const NIGHT_LIGHT_GROUPS = [G, GV, GR, GC];
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
interface Flash { x: number; y: number; z: number; r: number; t: number; T: number }
/** A lamp wanting a real light this frame. */
interface Want { score: number; kind: LampKind; x: number; y: number; z: number; tx: number; ty: number; tz: number; dist: number; k: number; color: number; range: number }

export interface LightGround { height(x: number, z: number): number; normal?(x: number, z: number, out?: number[]): number[] }

export class NightLights {
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
  private nrm = [0, 1, 0];
  private kinds: KindLook[] = [];
  private wants: Want[] = [];
  private nWant = 0;
  private focus = new THREE.Vector3();
  private n = 0;
  private emitFn: LampEmit;
  /** How many real lights were lit last frame (for the HUD). */
  lit = 0;
  /** How many times the real-light pools were made (only when their size sliders change). */
  builds = 0;

  constructor(public v: NightLightValues) {
    this.group.name = "night lights";
    this.group.add(this.draw.group);
    for (let i = 0; i < LAMP_KINDS; i++) this.kinds.push({ reach: 0, tanHalf: 0, angle: 0, glow: 0, pool: 0, beam: 0, real: 0, spot: true, r: 0, g: 0, b: 0 });
    this.emitFn = (kind, x, y, z, ax, ay, az, ground, reach, k) => this.emitWorld(kind, x, y, z, ax, ay, az, ground, reach, k);
  }

  /** Lamps riding these objects (their world positions each frame, the list asked again each frame), e.g. the convoy's deck lamps. */
  addLamps(list: () => Iterable<THREE.Object3D>, color = 0xffd9a0, k = 1) { this.lamps.push({ list, color, k }); }
  /** The mech whose sensor head lamps become a headlamp (re-found each second: the sensor can be swapped). */
  track(root: THREE.Object3D | null) { this.tracked = root; this.rescan = 0; }
  /** A blast at (x, y, z) of this radius lights the ground for a moment. */
  flash(x: number, y: number, z: number, radius: number) {
    if (this.flashes.length > 24) this.flashes.shift();
    this.flashes.push({ x, y, z, r: radius, t: 0, T: this.v.blastLightTime });
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
    this.bodies = []; this.sources = [];
    let root: THREE.Object3D = this.group;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.userData.lamps) this.bodies.push(o);
      if (o.userData.lampSource) this.sources.push({ o, fn: o.userData.lampSource as LampSource });
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
      const n = this.ground?.normal ? this.ground.normal(lx, lz, this.nrm) : null;
      this.light(kind, x, y, z, lx, this.groundAt(lx, lz), lz, n ? n[0] : 0, n ? n[1] : 1, n ? n[2] : 0, true, k);
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
        if (K.pool > 0) this.draw.pool(lx, ly, lz, nx, ny, nz, dx, dz, rad, Math.min(rad * 4, rad / sinG), r * K.pool, g * K.pool, b * K.pool);
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
    if (n <= 0 && !this.made) { this.lit = 0; this.draw.end(); return; }
    if (!this.made || this.pool.length !== Math.round(v.nightLightCap) || this.spots.length !== Math.round(v.nightSpotCap)) this.build();

    // Faked lamps (and their bids for the real ones), only at night.
    if (n > 0) {
      this.refreshKinds();
      this.scanAt -= dt;
      if (this.scanAt <= 0) { this.scan(); this.scanAt = 0.5; }
      for (const o of this.bodies) this.bodyLamps(o);
      for (const s of this.sources) if (NightLights.shown(s.o)) s.fn(this.emitFn, this.time, this.v);
    }

    // Points: blast flashes first (brightest first), then deck lamps and cab windows nearest the focus.
    let used = 0;
    const flashes = [...this.flashes].sort((a, b) => b.r * (1 - b.t / b.T) - a.r * (1 - a.t / a.T));
    for (const f of flashes) {
      if (used >= this.pool.length) break;
      const l = this.pool[used++], k = 1 - f.t / f.T;
      l.position.set(f.x, f.y, f.z);
      l.color.setHex(0xffa860);
      l.distance = f.r * 5 + 6;
      l.intensity = v.blastLight * (f.r / 2.5) * k * k * n;
    }
    if (n > 0 && used < this.pool.length) {
      for (const L of this.lamps) for (const o of L.list()) {
        o.getWorldPosition(this.p);
        if (this.p.distanceToSquared(focus) > 120 * 120) continue;
        this.draw.glow(this.p.x, this.p.y, this.p.z, 0.8, 0.5 * n, 0.42 * n, 0.3 * n);
        this.want(LAMP_CAB, this.p.x, this.p.y, this.p.z, this.p.x, this.p.y, this.p.z, 1, L.k * n, v.lampStrength, L.color, v.lampRange);
        this.wants[this.nWant - 1].score *= 1.5;
      }
    }
    const wants = this.wants.slice(0, this.nWant).sort((a, b) => b.score - a.score);
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
