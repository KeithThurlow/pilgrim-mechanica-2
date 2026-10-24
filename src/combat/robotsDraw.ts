// Draws the robot swarm (robots.ts): stand-in quadrupeds in grey-white machine panels with a red sensor eye. One
// instanced body (a flat box with a chamfered nose), a gun on the big ones' backs, and four two-bone legs per robot
// as instanced thigh and shin segments, posed by a cheap procedural trot (diagonal pairs) with knees bent up and
// out like a spider's. Latched ones cling nose-up to the mech, legs scrabbling; flung and dead small ones tumble
// with their legs folded; dead big ones sag flat with legs splayed; wrecks sink into the sand before their slot is
// reused. Feet: big ones sample the ground under each foot, small ones use a slope plane (two samples).
import * as THREE from "three/webgpu";
import {
  RobotSwarm, ROBOT_MAX, BIG, LEAP, LATCHED, FIRE, FLUNG, DOWN, DEAD, EMPTY,
  BODY_W, BODY_H, BODY_Y, HIP_X, HIP_Z, THIGH, SHIN,
} from "./robots";

/** Look values that aren't feel (kept here; the lead can promote any to sliders). */
const LIFT = 0.16, SWING = 0.22, SPLAY = 1.5, BOB = 0.025, CLING_PITCH = 1.2, ROLL_RATE = 7, COLLAPSE = 0.8, SINK = 0.5;
const PANEL = 0xd9d8d0, PANEL_BIG = 0xb9bab4, LEG = 0x4b4e52, GUN = 0x3a3c3f, EYE = 0xff2a1a;

/** Body, length 1 along +Z, centred on the origin, the nose chamfered down and in. */
function bodyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(BODY_W, BODY_H, 1, 1, 1, 4).toNonIndexed();
  const p = g.getAttribute("position");
  for (let k = 0; k < p.count; k++) {
    const z = p.getZ(k);
    if (z > 0.2) {
      const t = (z - 0.2) / 0.3;
      p.setX(k, p.getX(k) * (1 - 0.35 * t));
      p.setY(k, p.getY(k) * (1 - 0.45 * t) - BODY_H * 0.12 * t);
    }
    if (z < -0.4) p.setY(k, p.getY(k) * 0.85); // tail tapers a little
  }
  g.computeVertexNormals();
  return g;
}

/** A leg segment: unit length hanging down from its top (y 0 to -1), unit thickness. */
function segGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
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

// Leg order: front left, front right, back left, back right. +X is the robot's left; trot pairs FL+BR, FR+BL.
const LEG_SX = [1, -1, 1, -1], LEG_SZ = [1, 1, -1, -1], LEG_PH = [0, Math.PI, Math.PI, 0];

export class RobotsDraw {
  readonly group = new THREE.Group();
  readonly body: THREE.InstancedMesh;
  readonly thighs: THREE.InstancedMesh;
  readonly shins: THREE.InstancedMesh;
  readonly eyes: THREE.InstancedMesh;
  readonly guns: THREE.InstancedMesh;
  private roll = new Float32Array(ROBOT_MAX);
  private gen = new Uint32Array(ROBOT_MAX);
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private m = new THREE.Matrix4(); private ml = new THREE.Matrix4();
  private c = new THREE.Color();
  private hip = new THREE.Vector3(); private foot = new THREE.Vector3(); private knee = new THREE.Vector3();
  private bend = new THREE.Vector3(); private dir = new THREE.Vector3(); private tmp = new THREE.Vector3();
  private up = new THREE.Vector3(); private down = new THREE.Vector3(0, -1, 0);
  private ax = new THREE.Vector3(1, 0, 0); private ay = new THREE.Vector3(0, 1, 0); private az = new THREE.Vector3(0, 0, 1);
  private nLeg = 0;

  constructor(private swarm: RobotSwarm) {
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35 });
    const leg = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.5 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.body = instanced(bodyGeometry(), panel, ROBOT_MAX);
    this.thighs = instanced(segGeometry(), leg, ROBOT_MAX * 4);
    this.shins = instanced(segGeometry(), leg, ROBOT_MAX * 4);
    this.eyes = instanced(new THREE.BoxGeometry(1, 1, 1), eye, ROBOT_MAX, false);
    this.guns = instanced(new THREE.BoxGeometry(1, 1, 1), leg, ROBOT_MAX);
    this.group.add(this.body, this.thighs, this.shins, this.eyes, this.guns);
  }

  update(dt: number): void {
    const sw = this.swarm, v = sw.v, ground = sw.ground;
    const { q, qa, p, s, m, ml, c, tmp } = this;
    let nb = 0, ng = 0;
    this.nLeg = 0;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY) continue;
      if (this.gen[i] !== sw.gen[i]) { this.gen[i] = sw.gen[i]; this.roll[i] = 0; }
      const S = sw.size[i], big = sw.kind[i] === BIG, dead = st === DEAD;
      const speed = Math.hypot(sw.vx[i], sw.vz[i]);
      const h = sw.heading[i], sh = Math.sin(h), ch = Math.cos(h);
      const x = sw.px[i], z = sw.pz[i];
      let y = sw.py[i], scale = 1;

      // Knocked over (DOWN) rolls onto its side and back up.
      const wantRoll = st === DOWN ? 1.4 : 0;
      this.roll[i] += Math.sign(wantRoll - this.roll[i]) * Math.min(Math.abs(wantRoll - this.roll[i]), dt * ROLL_RATE);

      // Body orientation: yaw, then pitch (slope or clinging), then roll (tumble or knocked over).
      let pitch = 0, roll = this.roll[i] * (sw.seed[i] < 0.5 ? 1 : -1);
      let gx = 0, gz = 0; // ground slope (rise per metre) along world x and z, for the foot plane
      const grounded = st !== LEAP && st !== LATCHED && st !== FLUNG && !(dead && !big);
      if (grounded || dead) {
        const e = S * 0.4;
        gx = (ground.height(x + e, z) - y) / e; gz = (ground.height(x, z + e) - y) / e;
        const along = gx * sh + gz * ch, across = gx * ch - gz * sh;
        pitch = -Math.atan(along) * 0.8;
        if (!dead || big) roll += Math.atan(across) * 0.6;
      }
      let bodyY = S * BODY_Y;
      if (st === LATCHED) { pitch = -CLING_PITCH; bodyY = 0; }
      else if (st === LEAP) { const t = Math.min(1, sw.stateTime[i] * 3); pitch = -0.5 + t * 0.4; bodyY = 0; }
      else if (st === FLUNG) { roll = sw.tumble[i]; bodyY = S * BODY_H * 0.5; }
      else if (dead) {
        if (big) {
          const k = Math.min(1, sw.stateTime[i] / COLLAPSE);
          bodyY = S * (BODY_Y + (BODY_H * 0.5 - BODY_Y) * k * k);
          roll += k * 0.15 * (sw.seed[i] - 0.5);
        } else { roll = sw.tumble[i]; bodyY = S * BODY_H * 0.55; }
        const left = v.robotBodyLife - sw.stateTime[i];
        if (left < v.robotSinkTime) {
          const k = 1 - Math.max(0, left) / Math.max(0.01, v.robotSinkTime);
          y -= k * SINK * S; scale = 1 - k * k;
        }
      } else if (st === DOWN) bodyY = S * BODY_Y * 0.6;
      // Trot bob, and the big ones' gun recoil dip.
      const trot = grounded && !dead ? Math.min(1, speed / (big ? 2 : 3)) : 0;
      bodyY += Math.abs(Math.sin(sw.gait[i])) * BOB * S * trot;
      if (big && st === FIRE) pitch += Math.max(0, 0.04 - sw.fireClock[i] * 0.3);

      q.setFromAxisAngle(this.ay, h);
      qa.setFromAxisAngle(this.ax, pitch); q.multiply(qa);
      qa.setFromAxisAngle(this.az, roll); q.multiply(qa);
      p.set(x, y + bodyY, z);

      // Body.
      s.set(S * scale, S * scale, S * scale);
      m.compose(p, q, s);
      this.body.setMatrixAt(nb, m);
      c.setHex(big ? PANEL_BIG : PANEL).multiplyScalar(0.88 + sw.seed[i] * 0.2);
      if (dead) c.multiplyScalar(0.4); else if (st === DOWN) c.multiplyScalar(0.85);
      this.body.setColorAt(nb, c);
      // Eye on the nose (dark when dead).
      ml.compose(tmp.set(0, BODY_H * 0.05, 0.47), this.qa.identity(), this.s.set(BODY_W * 0.35, BODY_H * 0.18, 0.06));
      this.eyes.setMatrixAt(nb, this.tmp4(m, ml));
      c.setHex(dead ? 0x201010 : EYE);
      if (st === FIRE && !dead) c.multiplyScalar(1.3);
      this.eyes.setColorAt(nb, c);
      nb++;
      // Big ones carry a gun on the back.
      if (big) {
        ml.compose(tmp.set(0, BODY_H * 0.62, 0.12), this.qa.identity(), this.s.set(0.11, 0.1, 0.7));
        this.guns.setMatrixAt(ng, this.tmp4(m, ml));
        c.setHex(GUN); if (dead) c.multiplyScalar(0.6);
        this.guns.setColorAt(ng, c);
        ng++;
      }

      // Legs.
      const L1 = THIGH * S * scale, L2 = SHIN * S * scale;
      const stride = SWING * S * Math.min(1, speed / (big ? 2.5 : 4) + (st === LATCHED ? 0.6 : 0));
      const folded = st === FLUNG || (dead && !big) || st === DOWN;
      for (let k = 0; k < 4; k++) {
        const sx = LEG_SX[k], sz = LEG_SZ[k];
        // Hip in body space, to world.
        this.hip.set(sx * HIP_X, -BODY_H * 0.3, sz * HIP_Z).multiplyScalar(S * scale).applyQuaternion(q).add(p);
        const ph = sw.gait[i] + LEG_PH[k];
        const swing = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
        if (grounded && !folded && !(dead && big)) {
          // Foot on the ground below and out from the hip, swinging along the heading.
          const fx = sx * HIP_X * SPLAY * S, fz = sz * HIP_Z * S + swing * stride;
          const wx = x + fx * ch + fz * sh, wz = z - fx * sh + fz * ch;
          const gy = big ? ground.height(wx, wz) : y + (wx - x) * gx + (wz - z) * gz;
          this.foot.set(wx, gy + lift * LIFT * S * trot, wz);
        } else if (dead && big) {
          // Splayed flat.
          const fx = sx * HIP_X * 2.6 * S, fz = sz * HIP_Z * 1.5 * S;
          const wx = x + fx * ch + fz * sh, wz = z - fx * sh + fz * ch;
          this.foot.set(wx, ground.height(wx, wz) - SINK * S * (1 - scale), wz);
        } else {
          // Body-space feet: tucked when tumbling, gripping the hull when latched, stretched out in a leap.
          let lx: number, ly: number, lz: number;
          if (folded) { lx = sx * HIP_X * 0.9; ly = -BODY_H * 0.35; lz = sz * HIP_Z * 0.7; }
          else if (st === LATCHED) { lx = sx * HIP_X * 1.7; ly = -BODY_H * 1.3 - Math.max(0, swing) * 0.1; lz = sz * HIP_Z * 1.1 + swing * 0.12; }
          else { lx = sx * HIP_X * 1.3; ly = -BODY_H * 1.2; lz = sz * HIP_Z * 1.9; }
          this.foot.set(lx, ly, lz).multiplyScalar(S * scale).applyQuaternion(q).add(p);
        }
        // Knees bend up and outward from the body.
        this.up.set(0, 1, 0).applyQuaternion(q);
        this.bend.set(sx, 0, 0).applyQuaternion(q).multiplyScalar(0.8).add(this.up);
        this.leg(this.hip, this.foot, L1, L2, this.bend, S * scale, dead);
      }
    }
    for (const mesh of [this.body, this.eyes]) { mesh.count = nb; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.guns.count = ng; this.guns.instanceMatrix.needsUpdate = true; if (this.guns.instanceColor) this.guns.instanceColor.needsUpdate = true;
    for (const mesh of [this.thighs, this.shins]) { mesh.count = this.nLeg; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }

  private m2 = new THREE.Matrix4();
  private qs = new THREE.Quaternion();
  /** body × local, into a scratch matrix. */
  private tmp4(body: THREE.Matrix4, local: THREE.Matrix4): THREE.Matrix4 {
    return this.m2.multiplyMatrices(body, local);
  }

  /** Two-bone leg from hip to foot (clamped to reach), the knee pushed along `bend`. */
  private leg(hip: THREE.Vector3, foot: THREE.Vector3, L1: number, L2: number, bend: THREE.Vector3, S: number, dead: boolean) {
    const { dir, knee, tmp } = this;
    dir.subVectors(foot, hip);
    let d = dir.length();
    const reach = (L1 + L2) * 0.999;
    if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; } else dir.multiplyScalar(1 / d);
    if (d > reach) { d = reach; foot.copy(hip).addScaledVector(dir, d); }
    d = Math.max(d, Math.abs(L1 - L2) + 1e-4);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const kh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    // Bend direction with the hip-foot component removed.
    tmp.copy(bend).addScaledVector(dir, -bend.dot(dir));
    if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
    tmp.normalize();
    knee.copy(hip).addScaledVector(dir, a).addScaledVector(tmp, kh);
    this.c.setHex(LEG); if (dead) this.c.multiplyScalar(0.5);
    this.seg(this.thighs, hip, knee, S * 0.075);
    this.seg(this.shins, knee, foot, S * 0.05);
    this.nLeg++;
  }

  private seg(mesh: THREE.InstancedMesh, a: THREE.Vector3, b: THREE.Vector3, thick: number) {
    const { dir, qs: q, s, m } = this;
    dir.subVectors(b, a);
    const len = dir.length();
    if (len > 1e-6) dir.multiplyScalar(1 / len); else dir.set(0, -1, 0);
    q.setFromUnitVectors(this.down, dir);
    s.set(thick, Math.max(1e-4, len), thick);
    m.compose(a, q, s);
    mesh.setMatrixAt(this.nLeg, m);
    mesh.setColorAt(this.nLeg, this.c);
  }
}
