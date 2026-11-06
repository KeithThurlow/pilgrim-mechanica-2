// Draws the robot swarm (robots.ts; shapes from robotLegs.ts, stand-in geometry from robotShapes.ts). Keith
// 2026-11-01: sci-fi walkers in white plate over dark mechanics, red eyes for seeking and blue for weapons, pipes and
// cables dangling (a procedural sway, no physics). Small scuttlers: mites with a cylindrical abdomen and a little head,
// four thin legs splayed on the diagonals; medium walkers: a long cylindrical body with a sensor head, white thighs,
// a spinning blue cutter, hoses hanging; big walkers: a thorax disc and slung abdomen high on four long legs (short
// thigh to a knee level with the body, a long shin straight down), cables looping from the body to the legs and
// tendrils hanging under the abdomen, casting long shadows.
// All instanced: bodies per size, cutters, feet, box beams, limbs (round leg bones), pipes, cables, knuckles, lamps.
// Standing small ones take their feet from the sim's leg pose; latched ones lie flat on the hull, legs gripping and
// raking; leaping ones fly splayed; flung and dead ones tumble. Walkers take every leg from the sim (planted,
// stepping) through RobotSwarm.legPose.
import { CoreWarnDraw } from "../fx/coreWarnDraw";
import * as THREE from "three/webgpu";
import { RobotSwarm, ROBOT_MAX, BIG, MID, QUAD_WEAPON, Q_LASER, Q_RAIL, LEAP, LATCHED, FIRE, CUT, DOWN, DEAD, EMPTY, RUN } from "./robots";
import {
  HUB_R, HUB_H, HIP_R, FOOT_R, S_THIGH, S_SHIN, SMALL_LEGS, WALK_LEGS, MID_SPEC, BIG_SPEC, MID_SAW_X, MID_SAW_Y, MID_SAW_Z,
  MID_SAW_R, MID_BODY_H, BIG_BODY_H, solveKnee, type V3,
  QUAD_TURRET_Y, QUAD_GUN_X,
} from "./robotLegs";
import {
  smallBodyGeometry, midBodyGeometry, quadBodyGeometry, quadTurretGeometry, quadWeaponGeometry, bigBodyGeometry, sawGeometry, bucketGeometry, beamGeometry, pipeGeometry, knuckleGeometry,
  WHITE, WHITE_DIM, JOINT, DARK, CHROME, ROBOT_PALETTE,
} from "./robotShapes";
import { LAMP_ROBOT, LAMP_ROBOT_GLOW, type LampEmit } from "../world/lamps";
import { RobotBeamDraw } from "./robotBeamDraw";

/** Look values that aren't feel (kept here; promote any to sliders if they need tuning). */
const ROLL_RATE = 7, COLLAPSE = 2, SINK = 0.5;
const ALARM = 0xff3418, EYE_RED = 0xb01206, RAM = JOINT, OFF = 0x201810, BLUE = ROBOT_PALETTE.beam, BLUE_DIM = 0x0c3a66;
/** Cables: how far a hanging one sways (× its length), how fast, and how far it trails behind a walk (× length per m/s). */
const SWAY = 0.1, SWAY_RATE = 1.3, TRAIL = 0.05;

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = shadow; m.receiveShadow = true;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/**
 * A paint colour as linear RGB, worked out once per hex (perf pass 1: Color.setHex converts sRGB to linear with three
 * pow calls, and ran for every part of every robot every frame, 2.5 ms in the stress lab).
 */
const LINEAR = new Map<number, THREE.Color>();
function lin(hex: number): THREE.Color {
  let c = LINEAR.get(hex);
  if (!c) { c = new THREE.Color(hex); LINEAR.set(hex, c); }
  return c;
}

/** An instanced mesh with a running count for this frame. Colours are written (and uploaded) only where they changed. */
class Pool {
  n = 0;
  private colourChanged = false;
  constructor(readonly mesh: THREE.InstancedMesh, readonly cap: number) {}
  put(m: THREE.Matrix4, c: THREE.Color) {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, m);
    const a = this.mesh.instanceColor!.array as Float32Array, o = this.n * 3;
    if (a[o] !== c.r || a[o + 1] !== c.g || a[o + 2] !== c.b) { a[o] = c.r; a[o + 1] = c.g; a[o + 2] = c.b; this.colourChanged = true; }
    this.n++;
  }
  finish() {
    // Upload only the instances drawn this frame (perf, 2026-11-01: the pools hold about 47k instances, 3 MB of matrices
    // a frame when sent whole).
    const n = Math.max(1, this.n), im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor;
    this.mesh.count = this.n;
    im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
    if (ic && this.colourChanged) { ic.clearUpdateRanges(); ic.addUpdateRange(0, n * 3); ic.needsUpdate = true; }
    this.colourChanged = false;
    this.n = 0;
  }
}

/** A scan spot's yaw offset (share of the scan arc, -1..1): alternating sides, a seeded depth. Cosmetic. */
const scanAt = (seed: number, n: number) => ((n & 1) ? -1 : 1) * (0.25 + 0.75 * hash01(seed * 131.7 + n * 12.9898));
/** A scan spot's landing in or out (-1..1). */
const scanNear = (seed: number, n: number) => hash01(seed * 57.3 + n * 78.233) * 2 - 1;
const hash01 = (x: number) => { const h = Math.sin(x) * 43758.5453; return h - Math.floor(h); };

export class RobotsDraw {
  readonly group = new THREE.Group();
  private smallBodies: Pool; private midBodies: Pool; private bigBodies: Pool; private quadBodies: Pool; private quadTurrets: Pool; private quadGuns: Pool[];
  private mt = new THREE.Matrix4(); private qt = new THREE.Quaternion();
  private saws: Pool; private buckets: Pool; private beams: Pool; private limbs: Pool; private pipes: Pool; private cables: Pool; private knuckles: Pool; private lamps: Pool;
  private roll = new Float32Array(ROBOT_MAX);
  private sawA = new Float32Array(ROBOT_MAX);
  private gen = new Uint32Array(ROBOT_MAX);
  private time = 0;
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private m = new THREE.Matrix4(); private ml = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private mb = new THREE.Matrix4();
  private c = new THREE.Color(); private beacon = new THREE.Color(); private white = new THREE.Color(1, 1, 1);
  /** Hot metal (Keith 2026-11-05, src/game/burn.ts): each robot's heat 0..1 by index, read once a frame; glow strength. */
  heatMap: (() => ReadonlyMap<number, number> | null) | null = null;
  heatGlow = 1;
  private hm: ReadonlyMap<number, number> | null = null;
  private static HOT = new THREE.Color(2.4, 0.55, 0.12);
  private static WHITE_HOT = new THREE.Color(2.6, 1.6, 0.7);
  /** Chill (src/game/chill.ts): each robot's chill 0..1 by index, 2 when frozen solid. */
  chillMap: (() => ReadonlyMap<number, number> | null) | null = null;
  private cm: ReadonlyMap<number, number> | null = null;
  /** Chill and freezing › Frozen look: how strongly chilled and frozen bodies frost over (0 off). */
  frostLook = 1;
  // Keith's render pass (2026-11-05): white plate going to ice white read as no change. Chilled now goes a clear pale
  // blue, frozen solid a deep glacier blue (darker and bluer than any plate), with a pale glint running over it.
  private static ICY = new THREE.Color(0.42, 0.68, 1.15);
  private static FROZEN = new THREE.Color(0.16, 0.48, 1.0);
  private static GLINT = new THREE.Color(0.75, 0.95, 1.3);
  /** Tint a body's colour toward red, then orange-white, by its heat. */
  private heatTint(i: number, c: THREE.Color) {
    const ch = this.cm?.get(i) ?? 0;
    // Chilled bodies frost over toward pale blue; frozen solid, near white ice.
    // Frozen ones go bright ice white-blue (over 1: they catch the light) with a slow glint running over them.
    if (ch > 0.02 && this.frostLook > 0) {
      const f = Math.min(1, this.frostLook);
      if (ch >= 2) {
        c.lerp(RobotsDraw.FROZEN, f * 0.9);
        const g = Math.sin(this.time * 2.2 + i * 1.7);
        if (g > 0.6) c.lerp(RobotsDraw.GLINT, f * (g - 0.6) * 1.2);
      } else c.lerp(RobotsDraw.ICY, f * Math.min(1, ch) * 0.7);
    }
    const h = this.hm?.get(i) ?? 0;
    if (h <= 0.01 || this.heatGlow <= 0) return;
    const k = Math.min(1, h * this.heatGlow);
    c.lerp(RobotsDraw.HOT, Math.min(1, k * 1.3) * 0.75);
    if (k > 0.7) c.lerp(RobotsDraw.WHITE_HOT, (k - 0.7) / 0.3 * 0.5);
  }
  private hip = new THREE.Vector3(); private foot = new THREE.Vector3(); private knee = new THREE.Vector3(); private tip = new THREE.Vector3();
  private bend = new THREE.Vector3(); private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  private va = new THREE.Vector3(); private vb = new THREE.Vector3(); private d1 = new THREE.Vector3(); private d2 = new THREE.Vector3();
  private n1 = new THREE.Vector3(); private sp = new THREE.Vector3(); private tg = new THREE.Vector3();
  private bx = new THREE.Vector3(); private by = new THREE.Vector3(); private bz = new THREE.Vector3();
  private ax = new THREE.Vector3(1, 0, 0); private ay = new THREE.Vector3(0, 1, 0); private az = new THREE.Vector3(0, 0, 1);
  private hips = new Float32Array(SMALL_LEGS * 3); private feet = new Float32Array(SMALL_LEGS * 3);
  /** Red eye lamps this frame (Keith 2026-10-29): x, y, z, heading, seed, flags (1 locked on, +2 big, +4 glow only) per robot. */
  private eyes = new Float32Array(ROBOT_MAX * 6);
  private eyeN = 0;
  private h3: V3 = { x: 0, y: 0, z: 0 }; private k3: V3 = { x: 0, y: 0, z: 0 }; private t3: V3 = { x: 0, y: 0, z: 0 }; private f3: V3 = { x: 0, y: 0, z: 0 };

  /** The excavators' charging beams (Keith 2026-10-31). */
  readonly beamDraw: RobotBeamDraw;

  /** Lamp colours swapped in for the eyes' red and alarm (a friendly swarm's, opts.eye / opts.alarm). */
  private eyeSwap: [number, number] | null = null;

  /**
   * opts (a friendly swarm, src/summon/allies.ts): cap, the most robots drawn (pools sized to it; ROBOT_MAX by default);
   * paint, a colour multiplied into every painted part; eye and alarm, lamp colours in place of the red ones.
   */
  /** Dying big ones' cores going unstable (its hooks: src/game/robotBeam.ts coreWarnFx). */
  readonly coreWarn: CoreWarnDraw;
  constructor(private swarm: RobotSwarm, opts: { cap?: number; paint?: number; eye?: number; alarm?: number } = {}) {
    this.beamDraw = new RobotBeamDraw(swarm);
    this.group.add(this.beamDraw.group);
    this.coreWarn = new CoreWarnDraw(swarm.ground);
    this.group.add(this.coreWarn.group);
    if (opts.eye !== undefined) this.eyeSwap = [opts.eye, opts.alarm ?? opts.eye];
    const M = Math.max(1, Math.min(ROBOT_MAX, opts.cap ?? ROBOT_MAX)), cap = (n: number) => Math.min(n, M);
    const paint = new THREE.MeshStandardMaterial({ color: opts.paint ?? 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.25, flatShading: true });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pool = (geo: THREE.BufferGeometry, n: number, mat: THREE.Material = paint, shadow = true) => {
      const mesh = instanced(geo, mat, n, shadow);
      this.group.add(mesh);
      return new Pool(mesh, n);
    };
    this.smallBodies = pool(smallBodyGeometry(), M);
    this.midBodies = pool(midBodyGeometry(), M);
    this.quadBodies = pool(quadBodyGeometry(), cap(512));
    this.quadTurrets = pool(quadTurretGeometry(), cap(512));
    this.quadGuns = [0, 1, 2, 3].map((w) => pool(quadWeaponGeometry(w), cap(256)));
    this.bigBodies = pool(bigBodyGeometry(), cap(256));
    this.saws = pool(sawGeometry(), M, lamp, false);
    this.buckets = pool(bucketGeometry(), cap(256) * WALK_LEGS);
    this.beams = pool(beamGeometry(), M * 2);
    this.limbs = pool(pipeGeometry(10), M * 6);
    this.pipes = pool(pipeGeometry(), M * 10);
    this.cables = pool(pipeGeometry(5), M * 12);
    this.knuckles = pool(knuckleGeometry(), M * 8);
    this.lamps = pool(new THREE.BoxGeometry(1, 1, 1), M * 3, lamp, false);
    // After dark every working robot sweeps a red beam where it looks; the night lights (src/world/nightLights.ts)
    // find this on the group and draw the beams (faked, a real red light on the nearest few).
    this.group.userData.lampSource = (emit: LampEmit, time: number, v: { readonly [k: string]: number }) => this.emitEyes(emit, time, v);
  }

  /**
   * The night lamps (Keith 2026-11-01): small robots only glow red, breathing, full while attacking; medium and big
   * ones scan with a searchlight like a targeting servo: hold on a spot, snap to the next (alternating sides, near and
   * far, a little overshoot), and snap straight onto the mech while attacking.
   */
  private emitEyes(emit: LampEmit, time: number, v: { readonly [k: string]: number }) {
    const e = this.eyes, sweep = ((v.robotSweep ?? 35) * Math.PI) / 180, reach = v.robotReach ?? 9;
    const hold = Math.max(0.05, v.robotScanHold ?? 0.9), snap = Math.max(0.01, v.robotScanSnap ?? 0.12);
    const over = v.robotScanOvershoot ?? 1.6, near = v.robotScanNear ?? 0.25;
    const idle = v.robotSmallIdle ?? 0.6, pulse = v.robotSmallPulse ?? 0.25, pw = Math.PI * 2 * (v.robotSmallPulseRate ?? 0.7);
    for (let j = 0; j < this.eyeN; j++) {
      const o = j * 6, f = e[o + 5], locked = (f & 1) !== 0, big = (f & 2) !== 0, seed = e[o + 4];
      if ((f & 4) !== 0) {
        const k = locked ? 1 : idle * (1 - pulse * 0.5 + pulse * 0.5 * Math.sin(pw * time + seed * 40));
        emit(LAMP_ROBOT_GLOW, e[o], e[o + 1], e[o + 2], 0, 0, 0, false, 0, k);
        continue;
      }
      const R = reach * (big ? 1.7 : 1);
      if (locked) { emit(LAMP_ROBOT, e[o], e[o + 1], e[o + 2], Math.sin(e[o + 3]), 0, Math.cos(e[o + 3]), true, R, 1); continue; }
      const per = hold * (0.8 + 0.4 * seed) + snap, t = time + seed * 97, n = Math.floor(t / per), u = t - n * per;
      const s = Math.min(1, u / snap), q = s - 1, ease = 1 + (over + 1) * q * q * q + over * q * q;
      const yaw = e[o + 3] + sweep * (scanAt(seed, n - 1) + (scanAt(seed, n) - scanAt(seed, n - 1)) * ease);
      const rk = 1 + near * (scanNear(seed, n - 1) + (scanNear(seed, n) - scanNear(seed, n - 1)) * ease);
      emit(LAMP_ROBOT, e[o], e[o + 1], e[o + 2], Math.sin(yaw), 0, Math.cos(yaw), true, R * rk, 1);
    }
  }

  /** Note a robot's eye at body-frame point (x, y, z) of frame m. */
  private eye(i: number, m: THREE.Matrix4, x: number, y: number, z: number, locked: boolean, big: boolean, glowOnly = false) {
    if (this.eyeN >= ROBOT_MAX) return;
    this.tmp.set(x, y, z).applyMatrix4(m);
    const o = this.eyeN++ * 6, e = this.eyes;
    e[o] = this.tmp.x; e[o + 1] = this.tmp.y; e[o + 2] = this.tmp.z;
    e[o + 3] = this.swarm.heading[i]; e[o + 4] = this.swarm.seed[i]; e[o + 5] = (locked ? 1 : 0) + (big ? 2 : 0) + (glowOnly ? 4 : 0);
  }

  update(dt: number): void {
    const sw = this.swarm;
    this.time += dt;
    this.eyeN = 0;
    this.hm = this.heatMap?.() ?? null;
    this.cm = this.chillMap?.() ?? null;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      if (this.gen[i] !== sw.gen[i]) { this.gen[i] = sw.gen[i]; this.roll[i] = 0; this.sawA[i] = 0; }
      const k = sw.kind[i];
      if (k === BIG) this.big(i); else if (k === MID) this.mid(i, dt); else this.small(i, dt);
    }
    for (const p of [this.smallBodies, this.midBodies, this.bigBodies, this.quadBodies, this.quadTurrets, ...this.quadGuns, this.saws, this.buckets, this.beams, this.limbs, this.pipes, this.cables, this.knuckles, this.lamps]) p.finish();
    this.beamDraw.update(dt);
    this.coreWarn.update(dt, sw.cores);
  }

  /** One small scrapper. */
  private small(i: number, dt: number) {
    const sw = this.swarm, v = sw.v;
    const { q, qa, p, s, m, c, tmp, hips, feet } = this;
    const st = sw.state[i], dead = st === DEAD, S0 = sw.size[i];
    let scale = 1, sink = 0;
    if (dead) {
      const left = v.robotBodyLife - sw.stateTime[i];
      if (left < v.robotSinkTime) { const k = 1 - Math.max(0, left) / Math.max(0.01, v.robotSinkTime); sink = k * SINK * S0; scale = 1 - k * k; }
    }
    const S = S0 * scale;
    const h = sw.heading[i];
    // Knocked over (DOWN) rolls onto its side and back up.
    const wantRoll = st === DOWN ? 1.6 : 0;
    this.roll[i] += Math.sign(wantRoll - this.roll[i]) * Math.min(Math.abs(wantRoll - this.roll[i]), dt * ROLL_RATE);

    const standing = st === RUN || st === FIRE;
    if (standing) {
      // Legs on the sand from the sim; the hub rides its hips, tilted to them.
      sw.smallLegPose(i, hips, feet);
      p.set(0, 0, 0);
      for (let k = 0; k < SMALL_LEGS; k++) p.x += hips[k * 3], p.y += hips[k * 3 + 1], p.z += hips[k * 3 + 2];
      p.multiplyScalar(1 / SMALL_LEGS); p.y += HUB_H * 0.25 * S;
      this.by.set(hips[0] - hips[6], hips[1] - hips[7], hips[2] - hips[8]).cross(tmp.set(hips[3] - hips[9], hips[4] - hips[10], hips[5] - hips[11]));
      if (this.by.y < 0) this.by.negate();
      this.basis(this.by.normalize(), Math.sin(h), Math.cos(h));
    } else if (st === LATCHED) {
      // Flat on the hull: underside to the mech (heading points at its centre), top outward.
      p.set(sw.px[i], sw.py[i], sw.pz[i]);
      this.by.set(-Math.sin(h), 0, -Math.cos(h));
      this.basis(this.by, 0, 1);
    } else if (st === LEAP) {
      // Turning its underside to the mech on the way over.
      p.set(sw.px[i], sw.py[i], sw.pz[i]);
      const t = Math.min(1, sw.stateTime[i] * 2.5) * 0.85;
      this.by.set(-Math.sin(h) * t, 1 - t, -Math.cos(h) * t).normalize();
      this.basis(this.by, Math.sin(h), Math.cos(h));
    } else {
      // Flung, down or dead: tumbling or rolled over.
      p.set(sw.px[i], sw.hubY[i] - sink, sw.pz[i]);
      if (dead) p.y = sw.py[i] + HUB_H * 0.5 * S - sink;
      q.setFromAxisAngle(this.ay, h);
      qa.setFromAxisAngle(this.az, st === DOWN ? this.roll[i] * (sw.seed[i] < 0.5 ? 1 : -1) : sw.tumble[i]); q.multiply(qa);
    }

    // Hub and lamp.
    m.compose(p, q, s.set(S, S, S));
    c.copy(this.white).multiplyScalar(0.86 + sw.seed[i] * 0.2);
    if (dead) c.multiplyScalar(0.4); else if (st === DOWN) c.multiplyScalar(0.85);
    this.heatTint(i, c);
    this.smallBodies.put(m, c);
    // No searchlight on the small ones (Keith 2026-11-01): a red eye, brighter while attacking.
    this.lamp(m, 0, HUB_H * 0.22, HUB_R * 0.99, 0.06, 0.03, 0.02, dead ? OFF : st === FIRE ? ALARM : EYE_RED);
    if (standing) this.eye(i, m, 0, HUB_H * 0.22, HUB_R * 0.99 + 0.03, st === FIRE, false, true);

    // Legs: thin pipes, knees up.
    const L1 = S_THIGH * S, L2 = S_SHIN * S;
    for (let k = 0; k < SMALL_LEGS; k++) {
      const a = Math.PI / 4 + k * (Math.PI / 2), sa = Math.sin(a), ca = Math.cos(a);
      if (standing) {
        this.hip.set(hips[k * 3], hips[k * 3 + 1], hips[k * 3 + 2]);
        this.foot.set(feet[k * 3], feet[k * 3 + 1], feet[k * 3 + 2]);
      } else {
        this.local(this.hip, p, sa * HIP_R * S, -HUB_H * 0.25 * S, ca * HIP_R * S);
        let r: number, y: number;
        if (st === LATCHED) {
          // Gripping round the hub and raking at the plating, opposite pairs in turn.
          const ph = sw.gait[i] + (k & 1) * Math.PI;
          r = FOOT_R * (0.82 + 0.1 * Math.sin(ph)); y = -HUB_H * 1.4 - Math.max(0, Math.cos(ph)) * 0.05;
        } else if (st === LEAP) { r = FOOT_R * 1.05; y = -HUB_H * 0.9; }
        else { r = HIP_R * 1.6; y = -HUB_H * 1.6; } // curled up
        this.local(this.foot, p, sa * r * S, y * S, ca * r * S);
      }
      // Knees up (off the hub's top side) and out along the leg's spoke.
      this.local(this.bend, null, sa * 0.6, 1, ca * 0.6);
      solveKnee(this.hip, this.foot, L1, L2, this.bend.x, this.bend.y, this.bend.z, this.knee);
      c.copy(lin(WHITE_DIM)); if (dead) c.multiplyScalar(0.5);
      this.pipe(this.hip, this.knee, S * 0.07, c);
      c.copy(lin(JOINT)); if (dead) c.multiplyScalar(0.5);
      this.pipe(this.knee, this.foot, S * 0.045, c);
    }
  }

  /** One medium walker: body, blue cutter, red eyes, four legs (white thighs), hoses hanging. */
  private mid(i: number, dt: number) {
    const sw = this.swarm, v = sw.v;
    const { q, qa, p, s, m, c } = this;
    const st = sw.state[i], dead = st === DEAD, S = sw.size[i], h = sw.heading[i];
    let y = sw.hubY[i];
    if (dead) y = this.collapse(i, y, MID_BODY_H);
    // The cutter attack reads from far off: it rears back with the disc spinning up, then pitches into the lunge.
    let pitch = 0, spin = 9, alarm = false;
    if (st === CUT) {
      const t = sw.stateTime[i], w = Math.max(0.01, v.robotMidCutWindup), L = v.robotMidLungeTime;
      if (t < w) { const k = t / w; pitch = -0.28 * k * (2 - k); spin = 10 + 60 * k; alarm = Math.sin(t * 30) > -0.3; }
      else if (t < w + L) { pitch = 0.16; spin = 70; alarm = true; }
      else { const k = Math.min(1, (t - w - L) / Math.max(0.05, v.robotMidCutRecover)); pitch = 0.16 * (1 - k); spin = 70 * (1 - k) + 9 * k; }
    } else if (st === FIRE && sw.tell[i]) {
      // Shot tell: rears back, eyes flashing.
      pitch = -0.14; alarm = Math.sin(this.time * 30) > -0.3;
    } else if (dead) spin = 0;
    this.sawA[i] += spin * dt;
    q.setFromAxisAngle(this.ay, h); qa.setFromAxisAngle(this.ax, pitch); q.multiply(qa);
    p.set(sw.px[i], y, sw.pz[i]);
    m.compose(p, q, s.set(S, S, S));
    c.copy(this.white).multiplyScalar(0.9 + sw.seed[i] * 0.12); if (dead) c.multiplyScalar(0.4);
    if (sw.variant[i] === QUAD_WEAPON) {
      // The turret on its own yaw (the sim's), pitched with the body.
      this.qt.setFromAxisAngle(this.ay, sw.turret[i]).multiply(qa);
      this.mt.compose(p, this.qt, s);
      this.quadTop(i, m, this.mt, c, alarm, dead);
    }
    else this.smallQuadTop(i, m, c, q, p, S, spin, alarm, dead);
    this.midLegs(i, p, S, h, y, dead);
  }

  /** A weapon quad's drum and weapons, red eyes, the laser's or rail's lens glowing blue as it charges. */
  private quadTop(i: number, body: THREE.Matrix4, m: THREE.Matrix4, c: THREE.Color, alarm: boolean, dead: boolean) {
    const sw = this.swarm, st = sw.state[i], w = sw.weapon[i];
    this.heatTint(i, c);
    this.quadBodies.put(body, c);
    this.quadTurrets.put(m, c);
    this.quadGuns[w].put(m, c);
    const flash = (alarm || sw.tell[i] === 1) && Math.sin(this.time * 24) > -0.2, eyeY = QUAD_TURRET_Y + 0.03;
    const lampC = dead ? OFF : flash ? ALARM : EYE_RED;
    this.lamp(m, 0.045, eyeY, 0.282, 0.04, 0.022, 0.01, lampC);
    this.lamp(m, -0.045, eyeY, 0.282, 0.04, 0.022, 0.01, lampC);
    if (st === RUN || st === FIRE) this.eye(i, m, 0, eyeY, 0.3, st === FIRE, false);
    if (w === Q_LASER || w === Q_RAIL) {
      const bt = sw.beamT[i], u = bt >= 0 ? Math.min(1, bt / Math.max(0.05, sw.beamSpec(i).charge)) : 0;
      this.beacon.copy(lin(BLUE_DIM)).lerp(lin(BLUE), 0.25 + 0.75 * u);
      const r = 0.05 + 0.04 * u;
      this.lamp(m, -QUAD_GUN_X, QUAD_TURRET_Y, w === Q_LASER ? 0.62 : 0.6, r, r, 0.02, dead ? OFF : this.beacon);
    }
  }

  /** A small quad's shell, its blue cutter (brighter as it spins up), red eyes in the visor, a red tip on the mast. */
  private smallQuadTop(i: number, m: THREE.Matrix4, c: THREE.Color, q: THREE.Quaternion, p: THREE.Vector3, S: number, spin: number, alarm: boolean, dead: boolean) {
    const sw = this.swarm, st = sw.state[i], { qa, s } = this;
    this.heatTint(i, c);
    this.midBodies.put(m, c);
    this.qb.copy(q).multiply(qa.setFromAxisAngle(this.ax, this.sawA[i]));
    this.local(this.tmp, p, MID_SAW_X * S, MID_SAW_Y * S, MID_SAW_Z * S);
    this.m2.compose(this.tmp, this.qb, s.setScalar(S * MID_SAW_R));
    if (dead) c.copy(lin(OFF)); else c.copy(lin(BLUE_DIM)).lerp(lin(BLUE), Math.min(1, 0.35 + spin / 70));
    this.saws.put(this.m2, c);
    const eyeY = MID_BODY_H * 0.32, lampC = dead ? OFF : alarm ? ALARM : EYE_RED;
    this.lamp(m, 0.07, eyeY, 0.37, 0.05, 0.025, 0.012, lampC);
    this.lamp(m, -0.07, eyeY, 0.37, 0.05, 0.025, 0.012, lampC);
    if (st === RUN || st === FIRE || st === CUT) this.eye(i, m, 0, eyeY, 0.39, st !== RUN, false);
    const blink = Math.sin(this.time * 4 + sw.seed[i] * 20) > 0.6;
    this.lamp(m, 0.17, MID_BODY_H * 0.7 + 0.34, -0.16, 0.022, 0.022, 0.022, dead ? OFF : alarm || blink ? ALARM : EYE_RED);
  }

  /** A medium walker's four legs (white thighs, dark shins, pistons), cables to the front knees, hoses hanging. */
  private midLegs(i: number, p: THREE.Vector3, S: number, h: number, y: number, dead: boolean) {
    const sw = this.swarm, { c } = this;
    // Legs.
    const { hip, knee, foot } = this;
    for (let k = 0; k < WALK_LEGS; k++) {
      sw.legPose(i, k, this.h3, this.k3, this.t3, this.f3, y);
      hip.set(this.h3.x, this.h3.y, this.h3.z); knee.set(this.k3.x, this.k3.y, this.k3.z); foot.set(this.t3.x, this.t3.y, this.t3.z);
      const a = h + MID_SPEC.angles[k];
      this.sp.set(Math.sin(a), 0, Math.cos(a)); this.tg.set(Math.cos(a), 0, -Math.sin(a));
      c.copy(lin(WHITE)); if (dead) c.multiplyScalar(0.45);
      this.beam(this.limbs, hip, knee, S * 0.085, S * 0.085, this.tg, c);
      c.copy(lin(JOINT)); if (dead) c.multiplyScalar(0.45);
      this.beam(this.limbs, knee, foot, S * 0.05, S * 0.05, this.tg, c);
      c.copy(lin(DARK)); if (dead) c.multiplyScalar(0.5);
      this.knuckle(knee, S * 0.085, c);
      // A thin piston from the frame above the hip to the thigh.
      this.d1.subVectors(knee, hip).normalize();
      this.upNormal(this.d1, this.n1);
      this.va.copy(hip).addScaledVector(this.ay, S * 0.09).addScaledVector(this.sp, -S * 0.04);
      this.vb.copy(hip).addScaledVector(this.d1, hip.distanceTo(knee) * 0.6).addScaledVector(this.n1, S * 0.05);
      this.ram(this.va, this.vb, S * 0.02, dead);
      // A cable from the body to each front knee, sagging.
      if (k === 0 || k === 3) {
        this.local(this.va, p, Math.sin(MID_SPEC.angles[k]) * 0.18 * S, 0.02 * S, 0.15 * S);
        this.sag(this.va, knee, S * 0.12, 4, S * 0.022, sw.seed[i] * 9 + k, dead);
      }
    }
    // Two hoses hanging under the abdomen.
    for (let k = 0; k < 2; k++) {
      this.local(this.va, p, (k ? -0.08 : 0.08) * S, -0.02 * S, -0.3 * S);
      this.hang(this.va, S * (0.3 + 0.08 * k), 4, S * 0.022, sw.seed[i] * 13 + k * 3.1, sw.vx[i], sw.vz[i], dead);
    }
  }

  /** One big walker: thorax and abdomen, red eye and rim lamps, the blue emitter, four long legs, cables, tendrils. */
  private big(i: number) {
    const sw = this.swarm, v = sw.v;
    const { q, qa, p, s, m, c } = this;
    const st = sw.state[i], dead = st === DEAD, S = sw.size[i], h = sw.heading[i], H = sw.heightOf(i);
    let y = sw.hubY[i];
    if (dead) y = this.collapse(i, y, BIG_BODY_H);
    // Volley tell: the body rears back, each charge kicks it back further. A terraform pulse: it crouches as it charges.
    const tell = st === FIRE && sw.tell[i] === 1;
    const pitch = tell ? 0.07 + Math.max(0, 0.08 - (v.robotBigRoundInterval - sw.fireClock[i]) * 0.3) * (sw.burstLeft[i] > 0 ? 1 : 0) : 0;
    const pt = sw.pulseT[i], pc = Math.max(0.05, v.robotPulseCharge);
    const pu = pt >= 0 ? Math.min(1, pt / pc) : 0;
    q.setFromAxisAngle(this.ay, h); qa.setFromAxisAngle(this.ax, -pitch); q.multiply(qa);
    p.set(sw.px[i], y, sw.pz[i]);
    m.compose(p, q, s.set(S, S, S));
    c.copy(this.white).multiplyScalar(0.92 + sw.seed[i] * 0.1); if (dead) c.multiplyScalar(0.4);
    this.heatTint(i, c);
    this.bigBodies.put(m, c);
    // The eye in the head's visor, red lamps round the rim, slowly chasing (fast and bright when attacking).
    const flash = (tell || pt >= 0) && Math.sin(this.time * 24) > -0.2;
    this.lamp(m, 0, BIG_BODY_H * 0.04, 0.715, 0.1, 0.03, 0.012, dead ? OFF : flash ? ALARM : EYE_RED);
    if (st === RUN || st === FIRE) this.eye(i, m, 0, BIG_BODY_H * 0.04, 0.74, st === FIRE, true);
    const chase = this.time * (st === FIRE ? 6 : 1.5) + sw.seed[i] * 10;
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2 + Math.PI / 8, lit = Math.cos(a * 2 - chase) > 0.4;
      this.lamp(m, Math.sin(a) * 0.588, -BIG_BODY_H * 0.02, Math.cos(a) * 0.588, 0.03, 0.02, 0.03, dead ? OFF : lit || flash ? ALARM : EYE_RED);
    }
    // The emitter lens under the front: a faint blue, swelling while a beam or pulse charges.
    const bt = sw.beamT[i], bu = bt >= 0 ? Math.min(1, bt / Math.max(0.05, v.robotBeamCharge)) : 0, charge = Math.max(bu, pu);
    this.beacon.copy(lin(BLUE_DIM)).lerp(lin(BLUE), 0.3 + 0.7 * charge);
    const lens = 0.16 + 0.08 * charge;
    this.lamp(m, 0, -BIG_BODY_H * 0.62 - 0.045, 0.2, lens, 0.02, lens, dead ? OFF : this.beacon);
    // Legs: a short white thigh to a knee level with the body, a long shin (white sleeve over a dark rod) to the foot.
    const { hip, knee, tip, foot, d2, sp, tg, va, vb } = this;
    const footH = BIG_SPEC.toe * H;
    for (let k = 0; k < WALK_LEGS; k++) {
      sw.legPose(i, k, this.h3, this.k3, this.t3, this.f3, y);
      hip.set(this.h3.x, this.h3.y, this.h3.z); knee.set(this.k3.x, this.k3.y, this.k3.z);
      tip.set(this.t3.x, this.t3.y, this.t3.z); foot.set(this.f3.x, this.f3.y, this.f3.z);
      const a = h + BIG_SPEC.angles[k];
      sp.set(Math.sin(a), 0, Math.cos(a)); tg.set(Math.cos(a), 0, -Math.sin(a));
      d2.subVectors(tip, knee);
      const shin = d2.length(); d2.multiplyScalar(1 / Math.max(1e-4, shin));
      const dim = dead ? 0.45 : 1;
      c.copy(lin(WHITE)).multiplyScalar(dim);
      this.beam(this.limbs, hip, knee, S * 0.15, S * 0.15, tg, c);
      va.copy(knee).addScaledVector(d2, shin * 0.6);
      this.beam(this.limbs, knee, va, S * 0.12, S * 0.12, tg, c);
      c.copy(lin(JOINT)).multiplyScalar(dim);
      this.beam(this.limbs, va, tip, S * 0.065, S * 0.065, tg, c);
      // Bands: a dark collar where the sleeve ends, a white one low on the rod.
      vb.copy(va).addScaledVector(d2, -S * 0.05);
      this.beam(this.limbs, vb, va, S * 0.13, S * 0.13, tg, c);
      c.copy(lin(WHITE_DIM)).multiplyScalar(dim);
      va.copy(knee).addScaledVector(d2, shin * 0.78); vb.copy(va).addScaledVector(d2, S * 0.12);
      this.beam(this.limbs, va, vb, S * 0.085, S * 0.085, tg, c);
      c.copy(lin(DARK)).multiplyScalar(dim);
      this.knuckle(knee, S * 0.17, c);
      this.knuckle(hip, S * 0.12, c);
      // Two cables looping from under the thorax's rim down to the shin.
      for (let j = 0; j < 2; j++) {
        this.local(va, p, Math.sin(BIG_SPEC.angles[k] + (j ? 0.25 : -0.25)) * 0.5 * S, -BIG_BODY_H * 0.3 * S, Math.cos(BIG_SPEC.angles[k] + (j ? 0.25 : -0.25)) * 0.5 * S);
        vb.copy(knee).addScaledVector(d2, shin * (0.2 + 0.1 * j)).addScaledVector(tg, (j ? 1 : -1) * S * 0.07);
        this.sag(va, vb, S * (0.35 + 0.15 * j), 6, S * 0.028, sw.seed[i] * 11 + k * 2 + j, dead);
      }
      // Foot: a dark pad under the shin.
      this.basis(this.ay, sp.x, sp.z);
      this.m2.compose(tip, this.q, s.setScalar(footH));
      c.copy(this.white).multiplyScalar(dead ? 0.45 : 0.9 + sw.seed[i] * 0.1);
      this.buckets.put(this.m2, c);
    }
    // Tendrils: five pipes hanging from the abdomen's underside, swaying and trailing the walk.
    this.q.copy(q);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      this.local(va, p, Math.sin(a) * 0.14 * S, -BIG_BODY_H * 1.05 * S, -0.5 * S + Math.cos(a) * 0.12 * S);
      this.hang(va, S * (0.9 + 0.35 * hash01(sw.seed[i] * 17 + k)), 6, S * 0.03, sw.seed[i] * 23 + k * 1.7, sw.vx[i], sw.vz[i], dead);
    }
    this.q.setFromAxisAngle(this.ay, h);
  }

  /** A cable hanging from a, len long in n pieces, swaying and trailing behind the body's walk (vx, vz). Cosmetic. */
  private hang(a: THREE.Vector3, len: number, n: number, dia: number, seed: number, vx: number, vz: number, dead: boolean) {
    const { c } = this;
    c.copy(lin(DARK)); if (dead) c.multiplyScalar(0.6);
    const amp = dead ? 0 : SWAY * len, w = this.time * SWAY_RATE;
    const tx = Math.max(-0.6, Math.min(0.6, -vx * TRAIL)) * len, tz = Math.max(-0.6, Math.min(0.6, -vz * TRAIL)) * len;
    this.cp0.copy(a);
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t;
      const ox = amp * t2 * Math.sin(w + seed + t * 2.4) + tx * t2, oz = amp * t2 * Math.cos(w * 0.8 + seed * 1.7 + t * 2) + tz * t2;
      this.cp1.set(a.x + ox, a.y - len * t * (1 - 0.25 * Math.min(1, Math.hypot(ox, oz) / Math.max(1e-3, len))), a.z + oz);
      this.cable(this.cp0, this.cp1, dia, c);
      this.cp0.copy(this.cp1);
    }
  }

  /** A cable from a to b sagging by sag (m) at its middle in n pieces, swaying a little. Cosmetic. */
  private sag(a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number, dia: number, seed: number, dead: boolean) {
    const { c } = this;
    c.copy(lin(DARK)); if (dead) c.multiplyScalar(0.6);
    const sway = dead ? 0 : sag * 0.25 * Math.sin(this.time * SWAY_RATE + seed);
    this.cp0.copy(a);
    for (let k = 1; k <= n; k++) {
      const t = k / n, bow = 4 * t * (1 - t);
      this.cp1.copy(a).lerp(b, t);
      this.cp1.y -= sag * bow; this.cp1.x += sway * bow; this.cp1.z += sway * bow * 0.6;
      this.cable(this.cp0, this.cp1, dia, c);
      this.cp0.copy(this.cp1);
    }
  }
  private cp0 = new THREE.Vector3(); private cp1 = new THREE.Vector3();

  /** A cable piece from a to b. */
  private cable(a: THREE.Vector3, b: THREE.Vector3, dia: number, c: THREE.Color) {
    this.tmp.set(0, 1, 0);
    if (Math.abs(b.y - a.y) > 0.9 * a.distanceTo(b)) this.tmp.set(1, 0, 0);
    this.beam(this.cables, a, b, dia, dia, this.tmp, c);
  }

  /** A dead walker's body height: settling onto its legs over COLLAPSE seconds, sinking at the end. */
  private collapse(i: number, y: number, bodyH: number): number {
    const sw = this.swarm, v = sw.v, S = sw.size[i];
    const k = Math.min(1, sw.stateTime[i] / COLLAPSE), gy = sw.py[i] + S * bodyH * 0.5;
    y = y + (gy - y) * k * k;
    const left = v.robotBodyLife - sw.stateTime[i];
    if (left < v.robotSinkTime) y -= (1 - Math.max(0, left) / Math.max(0.01, v.robotSinkTime)) * SINK * S;
    return y;
  }

  /** A hydraulic ram from a to b: a dark barrel over the first 60%, a chrome rod out of it. */
  private ram(a: THREE.Vector3, b: THREE.Vector3, r: number, dead: boolean) {
    const { c, tmp2 } = this;
    tmp2.copy(a).lerp(b, 0.6);
    c.copy(lin(RAM)); if (dead) c.multiplyScalar(0.5);
    this.pipe(a, tmp2, r * 2, c);
    tmp2.copy(a).lerp(b, 0.45);
    c.copy(lin(CHROME)); if (dead) c.multiplyScalar(0.5);
    this.pipe(tmp2, b, r, c);
  }

  /** A lamp in a body's frame m (local metres × the body's scale): an unlit box of colour hex. */
  private lamp(m: THREE.Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, hex: number | THREE.Color) {
    this.ml.compose(this.tmp.set(x, y, z), this.qa.identity(), this.s.set(w, h, d));
    this.mb.multiplyMatrices(m, this.ml);
    const sw = this.eyeSwap;
    if (sw && typeof hex === "number") hex = hex === EYE_RED ? sw[0] : hex === ALARM ? sw[1] : hex;
    this.lamps.put(this.mb, typeof hex === "number" ? lin(hex) : hex);
  }

  /** The up-facing normal of a segment direction d within its leg's plane (the plane holding d and world up). */
  private upNormal(d: THREE.Vector3, out: THREE.Vector3) {
    out.copy(this.ay).addScaledVector(d, -d.y);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    out.normalize();
  }

  /** Orientation from an up axis and a facing (x, z) into this.q: +Y up, +Z the facing made square to up. */
  private basis(up: THREE.Vector3, fx: number, fz: number) {
    const { bx, bz } = this;
    bz.set(fx, 0, fz).addScaledVector(up, -(fx * up.x + fz * up.z));
    if (bz.lengthSq() < 1e-6) bz.set(0, 1, 0).addScaledVector(up, -up.y);
    bz.normalize();
    bx.crossVectors(up, bz);
    this.mb.makeBasis(bx, up, bz);
    this.q.setFromRotationMatrix(this.mb);
  }

  /** A point given in the hub's frame (metres) to world: rotated by this.q, plus origin (null: a direction). */
  private local(out: THREE.Vector3, origin: THREE.Vector3 | null, x: number, y: number, z: number) {
    out.set(x, y, z).applyQuaternion(this.q);
    if (origin) out.add(origin);
  }

  /** A box beam from a to b, w across (along side) and d deep, narrowing to taper at b. */
  private beam(pool: Pool, a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, side: THREE.Vector3, c: THREE.Color) {
    const { by, bx, bz, m } = this;
    by.subVectors(b, a);
    const len = by.length();
    if (len < 1e-5) return;
    by.multiplyScalar(1 / len);
    bx.copy(side).addScaledVector(by, -side.dot(by));
    if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0).addScaledVector(by, -by.x);
    bx.normalize();
    bz.crossVectors(bx, by);
    m.makeBasis(bx.multiplyScalar(w), by.multiplyScalar(len), bz.multiplyScalar(d));
    m.setPosition(a);
    pool.put(m, c);
  }

  /** A round pipe from a to b of diameter dia. */
  private pipe(a: THREE.Vector3, b: THREE.Vector3, dia: number, c: THREE.Color) {
    this.tmp.set(0, 1, 0);
    if (Math.abs(b.y - a.y) > 0.9 * a.distanceTo(b)) this.tmp.set(1, 0, 0);
    this.beam(this.pipes, a, b, dia, dia, this.tmp, c);
  }

  /** A knuckle (pin housing) at p. */
  private knuckle(at: THREE.Vector3, size: number, c: THREE.Color) {
    this.m.compose(at, this.qa.identity(), this.s.setScalar(size));
    this.knuckles.put(this.m, c);
  }
}
