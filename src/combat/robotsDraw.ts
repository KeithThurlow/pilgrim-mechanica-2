// Draws the robot swarm (robots.ts; shapes from robotLegs.ts). Keith 2026-10-24: small ones are four-legged
// starfish, a low faceted hub with legs splayed out on the diagonals, scuttling any way; big ones are War of the
// Worlds tripods, a small hood high up on three very long thin legs that cast long shadows.
// Instanced: hubs, tripod hoods, eyes, guns, and every leg as a thigh and a shin (two-bone, knees up and out).
// Standing small ones take their feet from the sim's leg pose (robots.ts smallLegPose); latched ones lie flat on the
// hull, legs gripping round them and raking; leaping ones fly splayed with their underside to the mech; flung and
// dead small ones tumble with their legs curled. Tripods' feet come from the sim (planted, stepping).
import * as THREE from "three/webgpu";
import { RobotSwarm, ROBOT_MAX, BIG, LEAP, LATCHED, FIRE, DOWN, DEAD, EMPTY, RUN } from "./robots";
import {
  HUB_R, HUB_H, HIP_R, FOOT_R, S_THIGH, S_SHIN, SMALL_LEGS, BIG_LEGS, B_BODY_H, B_THIGH, B_SHIN,
  bigHip, bigBend, solveKnee, type V3,
} from "./robotLegs";

/** Look values that aren't feel (kept here; promote any to sliders if they need tuning). */
const ROLL_RATE = 7, COLLAPSE = 2, SINK = 0.5, HOOD_LONG = 1.15;
const PANEL = 0xd9d8d0, PANEL_BIG = 0x8e918f, LEG = 0x45484c, LEG_BIG = 0x34373b, GUN = 0x2f3134, EYE = 0xff2a1a;

/** The small hub: a low faceted puck (× size), flat underneath, a shallow dome on top. */
function hubGeometry(): THREE.BufferGeometry {
  const R = HUB_R, H = HUB_H;
  const pts = [[0, -0.5], [0.72, -0.5], [1, -0.12], [0.96, 0.18], [0.66, 0.44], [0.28, 0.58], [0, 0.6]]
    .map(([r, y]) => new THREE.Vector2(r * R, y * H));
  return new THREE.LatheGeometry(pts, 8).toNonIndexed();
}

/** The tripod's hood (× size): a wide flat dome over a narrower belly, a little longer than wide. */
function hoodGeometry(): THREE.BufferGeometry {
  const H = B_BODY_H;
  const pts = [[0, -0.5], [0.5, -0.46], [0.8, -0.22], [1, 0], [0.92, 0.16], [0.68, 0.34], [0.32, 0.48], [0, 0.5]]
    .map(([r, y]) => new THREE.Vector2(r * 0.5, y * H));
  const g = new THREE.LatheGeometry(pts, 10).toNonIndexed();
  g.scale(1, 1, HOOD_LONG);
  return g;
}

/** A leg segment: unit length hanging down from its top (y 0 to -1), unit thickness, tapering a little. */
function segGeometry(taper: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5 * taper, 1, 6);
  g.translate(0, -0.5, 0);
  return g;
}

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

export class RobotsDraw {
  readonly group = new THREE.Group();
  readonly hubs: THREE.InstancedMesh;
  readonly hoods: THREE.InstancedMesh;
  readonly thighs: THREE.InstancedMesh;
  readonly shins: THREE.InstancedMesh;
  readonly eyes: THREE.InstancedMesh;
  readonly guns: THREE.InstancedMesh;
  private roll = new Float32Array(ROBOT_MAX);
  private gen = new Uint32Array(ROBOT_MAX);
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private m = new THREE.Matrix4(); private ml = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private mb = new THREE.Matrix4();
  private c = new THREE.Color();
  private hip = new THREE.Vector3(); private foot = new THREE.Vector3(); private knee = new THREE.Vector3();
  private bend = new THREE.Vector3(); private dir = new THREE.Vector3(); private tmp = new THREE.Vector3();
  private bx = new THREE.Vector3(); private by = new THREE.Vector3(); private bz = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);
  private ax = new THREE.Vector3(1, 0, 0); private ay = new THREE.Vector3(0, 1, 0); private az = new THREE.Vector3(0, 0, 1);
  private hips = new Float32Array(SMALL_LEGS * 3); private feet = new Float32Array(SMALL_LEGS * 3);
  private h3: V3 = { x: 0, y: 0, z: 0 }; private f3: V3 = { x: 0, y: 0, z: 0 }; private k3: V3 = { x: 0, y: 0, z: 0 }; private b3: V3 = { x: 0, y: 0, z: 0 };
  private nLeg = 0;

  constructor(private swarm: RobotSwarm) {
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.35, flatShading: true });
    const leg = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.5, flatShading: true });
    const eye = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.hubs = instanced(hubGeometry(), panel, ROBOT_MAX);
    this.hoods = instanced(hoodGeometry(), panel, ROBOT_MAX);
    this.thighs = instanced(segGeometry(0.85), leg, ROBOT_MAX * SMALL_LEGS);
    this.shins = instanced(segGeometry(0.55), leg, ROBOT_MAX * SMALL_LEGS);
    this.eyes = instanced(new THREE.BoxGeometry(1, 1, 1), eye, ROBOT_MAX, false);
    this.guns = instanced(new THREE.BoxGeometry(1, 1, 1), leg, ROBOT_MAX);
    this.group.add(this.hubs, this.hoods, this.thighs, this.shins, this.eyes, this.guns);
  }

  update(dt: number): void {
    const sw = this.swarm;
    this.nLeg = 0; this.hubI = 0; this.eyeN = 0; this.hoodI = 0; this.gunI = 0;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      if (this.gen[i] !== sw.gen[i]) { this.gen[i] = sw.gen[i]; this.roll[i] = 0; }
      if (sw.kind[i] === BIG) this.tripod(i); else this.small(i, dt);
    }
    const fin = (mesh: THREE.InstancedMesh, n: number) => { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; };
    fin(this.hubs, this.hubI); fin(this.hoods, this.hoodI); fin(this.eyes, this.eyeN); fin(this.guns, this.gunI);
    fin(this.thighs, this.nLeg); fin(this.shins, this.nLeg);
  }

  /** One small robot. */
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

    // Hub and eye.
    m.compose(p, q, s.set(S, S, S));
    this.hubs.setMatrixAt(this.hubI, m);
    c.setHex(PANEL).multiplyScalar(0.86 + sw.seed[i] * 0.2);
    if (dead) c.multiplyScalar(0.4); else if (st === DOWN) c.multiplyScalar(0.85);
    this.hubs.setColorAt(this.hubI, c);
    this.ml.compose(tmp.set(0, HUB_H * 0.05, HUB_R * 0.93), qa.identity(), s.set(0.11, 0.05, 0.05));
    this.eyes.setMatrixAt(this.eyeN, this.m2.multiplyMatrices(m, this.ml));
    c.setHex(dead ? 0x201010 : EYE); if (st === FIRE && !dead) c.multiplyScalar(1.3);
    this.eyes.setColorAt(this.eyeN, c);
    this.hubI++; this.eyeN++;

    // Legs.
    const L1 = S_THIGH * S, L2 = S_SHIN * S;
    c.setHex(LEG); if (dead) c.multiplyScalar(0.5);
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
      this.leg(this.hip, this.foot, L1, L2, this.bend, S * 0.075, S * 0.06);
    }
  }

  private hubI = 0; private eyeN = 0; private hoodI = 0; private gunI = 0;

  /** One tripod: hood high up, eye and gun at the front, three long legs to its feet on the sand. */
  private tripod(i: number) {
    const sw = this.swarm, v = sw.v;
    const { q, qa, p, s, m, c, tmp } = this;
    const st = sw.state[i], dead = st === DEAD, S = sw.size[i], h = sw.heading[i];
    let y = sw.hubY[i];
    if (dead) {
      // Folds down onto its legs and sinks at the end (only when the death physics isn't drawing it).
      const k = Math.min(1, sw.stateTime[i] / COLLAPSE), gy = sw.py[i] + S * B_BODY_H * 0.5;
      y = y + (gy - y) * k * k;
      const left = v.robotBodyLife - sw.stateTime[i];
      if (left < v.robotSinkTime) y -= (1 - Math.max(0, left) / Math.max(0.01, v.robotSinkTime)) * SINK * S;
    }
    let pitch = 0;
    if (st === FIRE) pitch = Math.max(0, 0.06 - sw.fireClock[i] * 0.4); // recoil nod
    q.setFromAxisAngle(this.ay, h);
    qa.setFromAxisAngle(this.ax, -pitch); q.multiply(qa);
    p.set(sw.px[i], y, sw.pz[i]);
    m.compose(p, q, s.set(S, S, S));
    this.hoods.setMatrixAt(this.hoodI, m);
    c.setHex(PANEL_BIG).multiplyScalar(0.9 + sw.seed[i] * 0.2); if (dead) c.multiplyScalar(0.4);
    this.hoods.setColorAt(this.hoodI, c);
    this.hoodI++;
    // Eye: a red slit across the front of the hood; gun: a barrel slung under the front.
    this.ml.compose(tmp.set(0, B_BODY_H * 0.02, 0.5 * HOOD_LONG * 0.97), qa.identity(), s.set(0.42, 0.05, 0.05));
    this.eyes.setMatrixAt(this.eyeN, this.m2.multiplyMatrices(m, this.ml));
    c.setHex(dead ? 0x201010 : EYE); if (st === FIRE && !dead) c.multiplyScalar(1.4);
    this.eyes.setColorAt(this.eyeN, c);
    this.eyeN++;
    this.ml.compose(tmp.set(0, -B_BODY_H * 0.3, 0.42), qa.identity(), s.set(0.09, 0.09, 0.75));
    this.guns.setMatrixAt(this.gunI, this.m2.multiplyMatrices(m, this.ml));
    c.setHex(GUN); if (dead) c.multiplyScalar(0.6);
    this.guns.setColorAt(this.gunI, c);
    this.gunI++;
    // Legs.
    const H = sw.hubY[i] - sw.py[i], L1 = B_THIGH * H, L2 = B_SHIN * H;
    c.setHex(LEG_BIG); if (dead) c.multiplyScalar(0.5);
    for (let k = 0; k < BIG_LEGS; k++) {
      const f = i * BIG_LEGS + k;
      bigHip(p.x, y, p.z, S, h, k, this.h3);
      this.f3.x = sw.footX[f]; this.f3.y = sw.footY[f]; this.f3.z = sw.footZ[f];
      bigBend(h, k, this.b3);
      solveKnee(this.h3, this.f3, L1, L2, this.b3.x, this.b3.y, this.b3.z, this.k3);
      this.hip.set(this.h3.x, this.h3.y, this.h3.z); this.knee.set(this.k3.x, this.k3.y, this.k3.z); this.foot.set(this.f3.x, this.f3.y, this.f3.z);
      this.seg(this.thighs, this.hip, this.knee, S * 0.1);
      this.seg(this.shins, this.knee, this.foot, S * 0.08);
      this.nLeg++;
    }
  }

  /** Hub orientation from its up axis and a facing (x, z): +Y up, +Z the facing made square to up. */
  private basis(up: THREE.Vector3, fx: number, fz: number) {
    const { bx, bz } = this;
    bz.set(fx, 0, fz).addScaledVector(up, -(fx * up.x + fz * up.z));
    if (bz.lengthSq() < 1e-6) bz.set(0, 1, 0).addScaledVector(up, -up.y);
    bz.normalize();
    bx.crossVectors(up, bz);
    this.mb.makeBasis(bx, up, bz);
    this.q.setFromRotationMatrix(this.mb);
  }

  /** A point given in the hub's frame (metres) to world: rotated by the hub, plus origin (null: a direction). */
  private local(out: THREE.Vector3, origin: THREE.Vector3 | null, x: number, y: number, z: number) {
    out.set(x, y, z).applyQuaternion(this.q);
    if (origin) out.add(origin);
  }

  /** Two-bone leg from hip to foot (clamped to reach), the knee pushed along bend. */
  private leg(hip: THREE.Vector3, foot: THREE.Vector3, L1: number, L2: number, bend: THREE.Vector3, t1: number, t2: number) {
    solveKnee(hip, foot, L1, L2, bend.x, bend.y, bend.z, this.knee);
    this.seg(this.thighs, hip, this.knee, t1);
    this.seg(this.shins, this.knee, foot, t2);
    this.nLeg++;
  }

  private seg(mesh: THREE.InstancedMesh, a: THREE.Vector3, b: THREE.Vector3, thick: number) {
    const { dir, s, m } = this;
    dir.subVectors(b, a);
    const len = dir.length();
    if (len > 1e-6) dir.multiplyScalar(1 / len); else dir.set(0, -1, 0);
    this.qa.setFromUnitVectors(this.down, dir);
    s.set(thick, Math.max(1e-4, len), thick);
    m.compose(a, this.qa, s);
    mesh.setMatrixAt(this.nLeg, m);
    mesh.setColorAt(this.nLeg, this.c);
  }
}
