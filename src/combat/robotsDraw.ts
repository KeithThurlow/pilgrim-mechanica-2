// Draws the robot swarm (robots.ts; shapes from robotLegs.ts, stand-in geometry from robotShapes.ts). Keith
// 2026-10-24: autonomous terraforming machines in industrial paint. Small scrappers: a low hub with a cutting disc,
// four legs splayed on the diagonals; medium cutters: a crab chassis with a spinning saw and a scrap bin, four legs
// with knees up and a ram on each thigh; big excavators: a chassis high up on four excavator arms (boom, stick, rams,
// hoses) with buckets for feet, casting long shadows.
// All instanced: bodies per size, saw blades, buckets, box beams (walker leg bones), pipes (small legs, rams, rods,
// hoses), knuckles at the joints, and lamps. Standing small ones take their feet from the sim's leg pose; latched ones
// lie flat on the hull, legs gripping and raking; leaping ones fly splayed; flung and dead ones tumble. Walkers take
// every leg from the sim (planted, stepping) through RobotSwarm.legPose.
import * as THREE from "three/webgpu";
import { RobotSwarm, ROBOT_MAX, BIG, MID, LEAP, LATCHED, FIRE, CUT, DOWN, DEAD, EMPTY, RUN } from "./robots";
import {
  HUB_R, HUB_H, HIP_R, FOOT_R, S_THIGH, S_SHIN, SMALL_LEGS, WALK_LEGS, MID_SPEC, BIG_SPEC, MID_SAW_X, MID_SAW_Y, MID_SAW_Z,
  MID_SAW_R, MID_BODY_H, BIG_BODY_H, solveKnee, type V3,
} from "./robotLegs";
import {
  smallBodyGeometry, midBodyGeometry, bigBodyGeometry, sawGeometry, bucketGeometry, beamGeometry, pipeGeometry, knuckleGeometry,
  YELLOW, YELLOW_DIRTY, GREY, DARK, BLACK, CHROME,
} from "./robotShapes";

/** Look values that aren't feel (kept here; promote any to sliders if they need tuning). */
const ROLL_RATE = 7, COLLAPSE = 2, SINK = 0.5;
const LEG_SMALL = 0x4a4d51, LAMP = 0xfff0c8, AMBER = 0xffa31a, ALARM = 0xff3418, RAM = 0x3b3d40;

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
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor && this.colourChanged) this.mesh.instanceColor.needsUpdate = true;
    this.colourChanged = false;
    this.n = 0;
  }
}

export class RobotsDraw {
  readonly group = new THREE.Group();
  private smallBodies: Pool; private midBodies: Pool; private bigBodies: Pool;
  private saws: Pool; private buckets: Pool; private beams: Pool; private pipes: Pool; private knuckles: Pool; private lamps: Pool;
  private roll = new Float32Array(ROBOT_MAX);
  private sawA = new Float32Array(ROBOT_MAX);
  private gen = new Uint32Array(ROBOT_MAX);
  private time = 0;
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private m = new THREE.Matrix4(); private ml = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private mb = new THREE.Matrix4();
  private c = new THREE.Color(); private beacon = new THREE.Color(); private white = new THREE.Color(1, 1, 1);
  private hip = new THREE.Vector3(); private foot = new THREE.Vector3(); private knee = new THREE.Vector3(); private tip = new THREE.Vector3();
  private bend = new THREE.Vector3(); private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private head = new THREE.Vector3();
  private va = new THREE.Vector3(); private vb = new THREE.Vector3(); private d1 = new THREE.Vector3(); private d2 = new THREE.Vector3();
  private n1 = new THREE.Vector3(); private n2 = new THREE.Vector3(); private sp = new THREE.Vector3(); private tg = new THREE.Vector3();
  private bx = new THREE.Vector3(); private by = new THREE.Vector3(); private bz = new THREE.Vector3();
  private ax = new THREE.Vector3(1, 0, 0); private ay = new THREE.Vector3(0, 1, 0); private az = new THREE.Vector3(0, 0, 1);
  private hips = new Float32Array(SMALL_LEGS * 3); private feet = new Float32Array(SMALL_LEGS * 3);
  private h3: V3 = { x: 0, y: 0, z: 0 }; private k3: V3 = { x: 0, y: 0, z: 0 }; private t3: V3 = { x: 0, y: 0, z: 0 }; private f3: V3 = { x: 0, y: 0, z: 0 };

  constructor(private swarm: RobotSwarm) {
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.25, flatShading: true });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pool = (geo: THREE.BufferGeometry, n: number, mat: THREE.Material = paint, shadow = true) => {
      const mesh = instanced(geo, mat, n, shadow);
      this.group.add(mesh);
      return new Pool(mesh, n);
    };
    this.smallBodies = pool(smallBodyGeometry(), ROBOT_MAX);
    this.midBodies = pool(midBodyGeometry(), ROBOT_MAX);
    this.bigBodies = pool(bigBodyGeometry(), 256);
    this.saws = pool(sawGeometry(), ROBOT_MAX);
    this.buckets = pool(bucketGeometry(), 256 * WALK_LEGS);
    this.beams = pool(beamGeometry(), ROBOT_MAX * 8);
    this.pipes = pool(pipeGeometry(), ROBOT_MAX * 10);
    this.knuckles = pool(knuckleGeometry(), ROBOT_MAX * 8);
    this.lamps = pool(new THREE.BoxGeometry(1, 1, 1), ROBOT_MAX * 3, lamp, false);
  }

  update(dt: number): void {
    const sw = this.swarm;
    this.time += dt;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      if (this.gen[i] !== sw.gen[i]) { this.gen[i] = sw.gen[i]; this.roll[i] = 0; this.sawA[i] = 0; }
      const k = sw.kind[i];
      if (k === BIG) this.big(i); else if (k === MID) this.mid(i, dt); else this.small(i, dt);
    }
    for (const p of [this.smallBodies, this.midBodies, this.bigBodies, this.saws, this.buckets, this.beams, this.pipes, this.knuckles, this.lamps]) p.finish();
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
    this.smallBodies.put(m, c);
    this.lamp(m, 0, HUB_H * 0.2, HUB_R * 0.97, 0.07, 0.045, 0.04, dead ? 0x201810 : st === FIRE ? ALARM : LAMP);

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
      c.copy(lin(LEG_SMALL)); if (dead) c.multiplyScalar(0.5);
      this.pipe(this.hip, this.knee, S * 0.075, c);
      c.copy(lin(DARK)); if (dead) c.multiplyScalar(0.5);
      this.pipe(this.knee, this.foot, S * 0.055, c);
    }
  }

  /** One medium cutter: chassis, saw, lamps, four crab legs with a ram on each thigh. */
  private mid(i: number, dt: number) {
    const sw = this.swarm, v = sw.v;
    const { q, qa, p, s, m, c } = this;
    const st = sw.state[i], dead = st === DEAD, S = sw.size[i], h = sw.heading[i];
    let y = sw.hubY[i];
    if (dead) y = this.collapse(i, y, MID_BODY_H);
    // The saw attack reads from far off: it rears back with the blade spinning up, then pitches into the lunge.
    let pitch = 0, spin = 9, alarm = false;
    if (st === CUT) {
      const t = sw.stateTime[i], w = Math.max(0.01, v.robotMidCutWindup), L = v.robotMidLungeTime;
      if (t < w) { const k = t / w; pitch = -0.28 * k * (2 - k); spin = 10 + 60 * k; alarm = Math.sin(t * 30) > -0.3; }
      else if (t < w + L) { pitch = 0.16; spin = 70; alarm = true; }
      else { const k = Math.min(1, (t - w - L) / Math.max(0.05, v.robotMidCutRecover)); pitch = 0.16 * (1 - k); spin = 70 * (1 - k) + 9 * k; }
    } else if (st === FIRE && sw.tell[i]) {
      // Shot tell: rears back, lamps flashing red.
      pitch = -0.14; alarm = Math.sin(this.time * 30) > -0.3;
    } else if (dead) spin = 0;
    this.sawA[i] += spin * dt;
    q.setFromAxisAngle(this.ay, h); qa.setFromAxisAngle(this.ax, pitch); q.multiply(qa);
    p.set(sw.px[i], y, sw.pz[i]);
    m.compose(p, q, s.set(S, S, S));
    c.copy(this.white).multiplyScalar(0.85 + sw.seed[i] * 0.2); if (dead) c.multiplyScalar(0.4);
    this.midBodies.put(m, c);
    // Blade.
    this.qb.copy(q).multiply(qa.setFromAxisAngle(this.ax, this.sawA[i]));
    this.local(this.tmp, p, MID_SAW_X * S, MID_SAW_Y * S, MID_SAW_Z * S);
    this.m2.compose(this.tmp, this.qb, s.setScalar(S * MID_SAW_R));
    c.copy(this.white); if (dead) c.multiplyScalar(0.5);
    this.saws.put(this.m2, c);
    // Lamps: two on the cab, a beacon on its mast (red and flashing while it winds up the saw).
    const cabY = MID_BODY_H * 0.4 + 0.06, lampC = dead ? 0x201810 : alarm ? ALARM : LAMP;
    this.lamp(m, 0.12, cabY, 0.315, 0.04, 0.03, 0.02, lampC);
    this.lamp(m, 0.2, cabY, 0.315, 0.04, 0.03, 0.02, lampC);
    const blink = Math.sin(this.time * 6 + sw.seed[i] * 20) > 0;
    this.lamp(m, 0.16, MID_BODY_H * 0.4 + 0.24, 0.2, 0.05, 0.05, 0.05, dead ? 0x201810 : alarm ? ALARM : blink ? AMBER : 0x6a3a08);
    // Legs.
    const { hip, knee, tip, foot } = this;
    for (let k = 0; k < WALK_LEGS; k++) {
      sw.legPose(i, k, this.h3, this.k3, this.t3, this.f3, y);
      hip.set(this.h3.x, this.h3.y, this.h3.z); knee.set(this.k3.x, this.k3.y, this.k3.z); foot.set(this.t3.x, this.t3.y, this.t3.z);
      const a = h + MID_SPEC.angles[k];
      this.sp.set(Math.sin(a), 0, Math.cos(a)); this.tg.set(Math.cos(a), 0, -Math.sin(a));
      c.copy(lin(YELLOW)); if (dead) c.multiplyScalar(0.45);
      this.beam(this.beams, hip, knee, S * 0.07, S * 0.09, this.tg, c);
      c.copy(lin(GREY)); if (dead) c.multiplyScalar(0.45);
      this.beam(this.beams, knee, foot, S * 0.05, S * 0.065, this.tg, c);
      c.copy(lin(DARK)); if (dead) c.multiplyScalar(0.5);
      this.knuckle(knee, S * 0.09, c);
      // Thigh ram: from the chassis above the hip to the thigh's top side.
      this.d1.subVectors(knee, hip).normalize();
      this.upNormal(this.d1, this.n1);
      this.va.copy(hip).addScaledVector(this.ay, S * 0.1).addScaledVector(this.sp, -S * 0.04);
      this.vb.copy(hip).addScaledVector(this.d1, hip.distanceTo(knee) * 0.6).addScaledVector(this.n1, S * 0.06);
      this.ram(this.va, this.vb, S * 0.032, dead);
      void tip;
    }
  }

  /** One big excavator: chassis, lamps, four arm legs (boom, stick, three rams, a hose, bucket). */
  private big(i: number) {
    const sw = this.swarm;
    const { q, qa, p, s, m, c } = this;
    const st = sw.state[i], dead = st === DEAD, S = sw.size[i], h = sw.heading[i], H = sw.heightOf(i);
    let y = sw.hubY[i];
    if (dead) y = this.collapse(i, y, BIG_BODY_H);
    // Volley tell: the chassis rears back and the gun lamp flashes red; each charge kicks it back further.
    const tell = st === FIRE && sw.tell[i] === 1;
    const pitch = tell ? 0.07 + Math.max(0, 0.08 - (sw.v.robotBigRoundInterval - sw.fireClock[i]) * 0.3) * (sw.burstLeft[i] > 0 ? 1 : 0) : 0;
    q.setFromAxisAngle(this.ay, h); qa.setFromAxisAngle(this.ax, -pitch); q.multiply(qa);
    p.set(sw.px[i], y, sw.pz[i]);
    m.compose(p, q, s.set(S, S, S));
    c.copy(this.white).multiplyScalar(0.88 + sw.seed[i] * 0.16); if (dead) c.multiplyScalar(0.4);
    this.bigBodies.put(m, c);
    // Lamps: two work lights on the cab, one under the gun, a turning beacon.
    const cabY = BIG_BODY_H * 0.3 + 0.12, off = dead ? 0x201810 : 0;
    this.lamp(m, 0.14, cabY, 0.375, 0.04, 0.03, 0.015, off || LAMP);
    this.lamp(m, 0.26, cabY, 0.375, 0.04, 0.03, 0.015, off || LAMP);
    const flash = tell && Math.sin(this.time * 24) > -0.2;
    this.lamp(m, 0, -BIG_BODY_H * 0.3 - 0.07, 0.42, 0.06, 0.02, 0.04, off || (flash ? ALARM : LAMP));
    this.lamp(m, 0, -BIG_BODY_H * 0.3, 0.83, 0.07, 0.07, 0.02, off || (flash ? ALARM : 0x301008));
    const beat = (Math.sin(this.time * 5 + sw.seed[i] * 20) + 1) * 0.5;
    this.beacon.copy(lin(AMBER)).multiplyScalar(0.35 + 0.65 * beat);
    this.lamp(m, 0.2, BIG_BODY_H * 0.3 + 0.33, 0.24, 0.045, 0.05, 0.045, off || this.beacon);
    // Arm legs.
    const { hip, knee, tip, foot, d1, d2, n1, n2, sp, tg, va, vb } = this;
    const L1 = BIG_SPEC.L1 * H, L2 = BIG_SPEC.L2 * H, bucketH = BIG_SPEC.toe * H;
    for (let k = 0; k < WALK_LEGS; k++) {
      sw.legPose(i, k, this.h3, this.k3, this.t3, this.f3, y);
      hip.set(this.h3.x, this.h3.y, this.h3.z); knee.set(this.k3.x, this.k3.y, this.k3.z);
      tip.set(this.t3.x, this.t3.y, this.t3.z); foot.set(this.f3.x, this.f3.y, this.f3.z);
      const a = h + BIG_SPEC.angles[k];
      sp.set(Math.sin(a), 0, Math.cos(a)); tg.set(Math.cos(a), 0, -Math.sin(a));
      d1.subVectors(knee, hip).normalize(); d2.subVectors(tip, knee).normalize();
      this.upNormal(d1, n1);
      // The stick's outer side (away from the body), for the bucket ram.
      n2.crossVectors(tg, d2).normalize(); if (n2.dot(sp) < 0) n2.negate();
      const dim = dead ? 0.45 : 1;
      // Boom: from the hip up to the elbow, deep in its own plane. Stick: from its head (past the elbow) to the bucket.
      c.copy(lin(YELLOW)).multiplyScalar(dim);
      this.beam(this.beams, hip, knee, S * 0.085, S * 0.13, tg, c);
      this.head.copy(knee).addScaledVector(d2, -0.09 * H);
      c.copy(lin(YELLOW_DIRTY)).multiplyScalar(dim);
      this.beam(this.beams, this.head, tip, S * 0.065, S * 0.095, tg, c);
      c.copy(lin(DARK)).multiplyScalar(dim);
      this.knuckle(knee, S * 0.11, c);
      this.knuckle(tip, S * 0.07, c);
      // Rams: boom lift under the boom from the chassis; stick ram on top of the boom to the stick's head; bucket ram
      // down the stick's outside.
      va.copy(hip).addScaledVector(this.ay, -S * 0.12).addScaledVector(sp, -S * 0.05);
      vb.copy(hip).addScaledVector(d1, L1 * 0.42).addScaledVector(n1, -S * 0.07);
      this.ram(va, vb, S * 0.04, dead);
      va.copy(hip).addScaledVector(d1, L1 * 0.5).addScaledVector(n1, S * 0.08);
      vb.copy(this.head).addScaledVector(n2, S * 0.03);
      this.ram(va, vb, S * 0.035, dead);
      va.copy(knee).addScaledVector(d2, L2 * 0.12).addScaledVector(n2, S * 0.065);
      vb.copy(tip).addScaledVector(d2, -L2 * 0.1).addScaledVector(n2, S * 0.065);
      this.ram(va, vb, S * 0.03, dead);
      // A hose along the boom's top.
      va.copy(hip).addScaledVector(n1, S * 0.075); vb.copy(knee).addScaledVector(n1, S * 0.06);
      c.copy(lin(BLACK)); this.pipe(va, vb, S * 0.018, c);
      // Bucket: hangs from the stick's end, teeth down in the sand, curling as the leg swings over.
      const f = i * WALK_LEGS + k, t = sw.stepT[f];
      const curl = t >= 0 ? Math.sin(Math.PI * t) * 0.9 : 0;
      this.basis(this.ay, sp.x, sp.z);
      this.q.multiply(qa.setFromAxisAngle(this.ax, -curl));
      this.m2.compose(tip, this.q, s.setScalar(bucketH));
      c.copy(this.white).multiplyScalar(dead ? 0.45 : 0.9 + sw.seed[i] * 0.1);
      this.buckets.put(this.m2, c);
      // The body's frame for the lamps has been overwritten: restore it for the next leg's use of q (none).
      void foot;
    }
    // Leave this.q as the body's (nothing after this reads it, but keep it sane).
    this.q.setFromAxisAngle(this.ay, h);
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
