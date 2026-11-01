// Draws the humanoid robots (droids.ts): the bandits' drawer (infantryDraw.ts: the Vanguard bake, clips matched to the
// stride) scaled up to robot height and repainted in the robots' white (Keith 2026-11-01: white plates as the key
// feature, dark mechanical joints): plates where the bake's armour mask is, panel seams banded down the body, joints
// and webbing dark, and a red visor slit across the face that brightens while the robot locks on. Its red seeking
// laser lies from the gun to the target through the tell before each burst; its blue pulses streak out on a burst.
// The dead fall as white ragdolls (droidRagdoll, for the death physics). Cosmetic.
import * as THREE from "three/webgpu";
import { attribute, instancedBufferAttribute, uniformArray, floor, int, vec3, mix, smoothstep, fract, float, step, max, min } from "three/tsl";
import { InfantryDraw, type BanditLookValues } from "./infantryDraw";
import type { BanditVatData } from "./banditVat";
import type { PartSpec, JointSpec } from "../physics/deaths";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../physics/bodies";
import { DEAD, EMPTY, FIRING } from "./infantry";
import type { DroidSwarm } from "./droids";

/** The robots' shared white palette. A copy of ROBOT_PALETTE (robotShapes.ts, the robot restyle); import it from
 *  there once that has merged. */
export const DROID_PALETTE = {
  plate: 0xe8e6e0, plateDim: 0xc8c6c0, joint: 0x3a3d42, dark: 0x22252a,
  seek: 0xff2a1a, beam: 0x3aa8ff, beamCore: 0xd8f4ff,
};

/** Visor states (written into the bake's per-instance look slot). */
const VISOR_IDLE = 0, VISOR_LOCK = 1, VISOR_FIRE = 2, VISOR_OFF = 3;
const LASERS = 256, BOLTS = 384;
/** Pulse streak: speed (m/s), length (m), width (m). */
const BOLT_SPEED = 240, BOLT_LEN = 3.2, BOLT_W = 0.16;

export class DroidsDraw {
  readonly group = new THREE.Group();
  readonly body: InfantryDraw;
  private look: BanditLookValues;
  private lasers: THREE.InstancedMesh;
  private bolts: THREE.InstancedMesh;
  private bx = new Float32Array(BOLTS * 3); private bd = new Float32Array(BOLTS * 3);
  private bt = new Float32Array(BOLTS).fill(-1); private bl = new Float32Array(BOLTS);
  private bNext = 0;
  private fireFlash = new Float32Array(1024);
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private dir = new THREE.Vector3(); private zAxis = new THREE.Vector3(0, 0, 1); private c = new THREE.Color();
  private seek = new THREE.Color(DROID_PALETTE.seek);

  constructor(private sw: DroidSwarm, vat: BanditVatData | null) {
    const d = sw.d;
    this.look = { banditLook: 1, banditAnimSpeed: d.droidAnimSpeed, banditFade: 0.25, banditScale: d.droidHeight };
    this.body = new InfantryDraw(sw, this.look, vat);
    this.group.add(this.body.group);
    if (this.body.vat) this.repaint(this.body.vat.mesh, this.body.vat.animB, this.body.vat.tints);
    else (this.body.boxes.material as THREE.MeshStandardMaterial).color.setHex(DROID_PALETTE.plate);

    const glow = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.lasers = new THREE.InstancedMesh(unit, glow(0xffffff), LASERS);
    this.lasers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LASERS * 3), 3);
    this.bolts = new THREE.InstancedMesh(unit, glow(0xffffff), BOLTS);
    this.bolts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BOLTS * 3), 3);
    for (const im of [this.lasers, this.bolts]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.count = 0; im.renderOrder = 2;
      this.group.add(im);
    }
    this.lasers.name = "droid lasers"; this.bolts.name = "droid pulses";
  }

  /** The drawn mesh (hold-V). */
  get mesh(): THREE.Object3D { return this.body.mesh; }

  /** White plates, seams, dark joints, a red visor: the bake's cloth mask and rest pose pick where each goes. */
  private repaint(mesh: THREE.Mesh, animB: THREE.InstancedBufferAttribute, tints: THREE.Color[]) {
    mesh.name = "humanoid robots";
    const P = DROID_PALETTE, col = (h: number) => { const c = new THREE.Color(h); return vec3(c.r, c.g, c.b); };
    // Visor colours by state: idle dim red, locking bright red, firing blue-white, dead off.
    tints[VISOR_IDLE].setHex(P.seek).multiplyScalar(1.2);
    tints[VISOR_LOCK].setHex(P.seek).multiplyScalar(4);
    tints[VISOR_FIRE].setHex(P.beamCore).multiplyScalar(3);
    tints[VISOR_OFF].setRGB(0, 0, 0);
    const mat = mesh.material as THREE.MeshStandardNodeMaterial;
    const c = attribute<"vec4">("vatColour", "vec4"), rest = attribute<"vec3">("position", "vec3");
    const b = instancedBufferAttribute<"vec4">(animB);
    const look = floor(b.w.div(4)), shade = b.w.sub(look.mul(4));
    const lum = c.r.mul(0.3).add(c.g.mul(0.59)).add(c.b.mul(0.11));
    // Plates: the armour mask, and anything the bake had pale; the rest is joint and webbing.
    const plate = max(smoothstep(0.25, 0.6, c.a), smoothstep(0.12, 0.3, lum));
    // Panel seams: thin dark bands down the body (rest-pose height), wider gaps on the limbs' joints.
    const band = fract(rest.y.mul(3.4));
    const seam = step(band, float(0.045)).mul(plate);
    const white = mix(col(P.plateDim), col(P.plate), smoothstep(0.9, 1.6, rest.y).mul(0.6).add(0.4));
    const base = mix(col(P.joint), white, plate).mul(float(1).sub(seam.mul(0.55)));
    mat.colorNode = base.mul(min(shade, 1.15));
    // The visor: a slit across the front of the head (the bake faces +Z; the head sits about 1.45-1.62 m in its rest pose).
    const visor = smoothstep(1.47, 1.5, rest.y).mul(float(1).sub(smoothstep(1.56, 1.59, rest.y))).mul(smoothstep(0.2, 0.25, rest.z));
    const tint = vec3(uniformArray(tints, "color").element(int(look)) as unknown as THREE.Node<"vec3">);
    mat.emissiveNode = tint.mul(visor);
    mat.roughness = 0.5; mat.metalness = 0.15;
    mat.needsUpdate = true;
  }

  /** A burst pulse leaving the gun at from along dir (unit), flying len metres. */
  bolt(from: THREE.Vector3, dir: THREE.Vector3, len: number, robot: number) {
    const k = this.bNext; this.bNext = (this.bNext + 1) % BOLTS;
    this.bx[k * 3] = from.x; this.bx[k * 3 + 1] = from.y; this.bx[k * 3 + 2] = from.z;
    this.bd[k * 3] = dir.x; this.bd[k * 3 + 1] = dir.y; this.bd[k * 3 + 2] = dir.z;
    this.bt[k] = 0; this.bl[k] = len;
    if (robot >= 0 && robot < this.fireFlash.length) this.fireFlash[robot] = 0.12;
  }

  /** Muzzle point of robot i (the rifle, out ahead at gun height). */
  muzzle(i: number, out: THREE.Vector3): THREE.Vector3 {
    const sw = this.sw, h = sw.heading[i], H = sw.v.banditHeight, f = H * 0.26;
    return out.set(sw.px[i] + Math.sin(h) * f - Math.cos(h) * H * 0.03, sw.py[i] + sw.v.muzzleHeight, sw.pz[i] + Math.cos(h) * f + Math.sin(h) * H * 0.03);
  }

  /** target: where the lasers point (the prey's aim point). */
  update(dt: number, target: THREE.Vector3 | null) {
    const sw = this.sw, d = sw.d;
    this.look.banditAnimSpeed = d.droidAnimSpeed; this.look.banditScale = d.droidHeight;
    // Visor states, and the seeking lasers.
    let nl = 0;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY) continue;
      this.fireFlash[i] = Math.max(0, this.fireFlash[i] - dt);
      if (st >= DEAD) { sw.look[i] = VISOR_OFF; continue; }
      const lock = target ? sw.lock(i, Math.hypot(target.x - sw.px[i], target.z - sw.pz[i])) : 0;
      const firing = st === FIRING && sw.burstLeft[i] > 0 || this.fireFlash[i] > 0;
      sw.look[i] = firing ? VISOR_FIRE : lock > 0 ? VISOR_LOCK : VISOR_IDLE;
      if (lock > 0 && target && nl < LASERS) {
        this.muzzle(i, this.p);
        this.dir.subVectors(target, this.p);
        const L = this.dir.length();
        if (L < 0.5) continue;
        this.dir.divideScalar(L);
        this.q.setFromUnitVectors(this.zAxis, this.dir);
        const w = 0.035 + 0.05 * lock;
        this.s.set(w, w, L);
        this.m.compose(this.p, this.q, this.s);
        this.lasers.setMatrixAt(nl, this.m);
        // Flickers in, steady and bright just before the burst.
        const k = (0.35 + 0.65 * lock) * (lock < 0.6 ? 0.75 + 0.25 * Math.sin(i * 7.3 + performance.now() * 0.05) : 1);
        this.c.copy(this.seek).multiplyScalar(k * 2.2);
        this.lasers.setColorAt(nl, this.c);
        nl++;
      }
    }
    this.lasers.count = nl;
    this.lasers.instanceMatrix.needsUpdate = true;
    if (this.lasers.instanceColor) this.lasers.instanceColor.needsUpdate = true;
    // Pulses: streaks flying out at BOLT_SPEED, gone at their length.
    let nb = 0;
    const beam = new THREE.Color(DROID_PALETTE.beam);
    for (let k = 0; k < BOLTS; k++) {
      if (this.bt[k] < 0) continue;
      this.bt[k] += dt;
      const head = this.bt[k] * BOLT_SPEED, len = this.bl[k];
      if (head - BOLT_LEN > len) { this.bt[k] = -1; continue; }
      const a = Math.max(0, head - BOLT_LEN), e = Math.min(len, head);
      if (e <= a) continue;
      const dx = this.bd[k * 3], dy = this.bd[k * 3 + 1], dz = this.bd[k * 3 + 2];
      this.p.set(this.bx[k * 3] + dx * a, this.bx[k * 3 + 1] + dy * a, this.bx[k * 3 + 2] + dz * a);
      this.dir.set(dx, dy, dz);
      this.q.setFromUnitVectors(this.zAxis, this.dir);
      this.s.set(BOLT_W, BOLT_W, e - a);
      this.m.compose(this.p, this.q, this.s);
      this.bolts.setMatrixAt(nb, this.m);
      this.c.copy(beam).multiplyScalar(3);
      this.bolts.setColorAt(nb, this.c);
      nb++;
    }
    this.bolts.count = nb;
    this.bolts.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    this.body.update(dt);
  }
}

const ragdolls = new Map<number, { parts: PartSpec[]; joints: JointSpec[] }>();
/** A white robot ragdoll the height of the robot (the bandit's layout scaled, plates white, joints dark). */
export function droidRagdoll(height: number): { parts: PartSpec[]; joints: JointSpec[] } {
  const key = Math.round(height * 20);
  let r = ragdolls.get(key);
  if (r) return r;
  const k = height / 1.8, P = DROID_PALETTE;
  const s3 = (v: [number, number, number]): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  const colour = [P.joint, P.plate, P.plate, P.plateDim, P.plateDim, P.joint, P.joint, P.plate, P.plate, P.plateDim, P.plateDim];
  const parts = BANDIT_PARTS(P.plate).map((p, n) => ({ ...p, half: s3(p.half), at: s3(p.at), color: colour[n] ?? P.plate }));
  const joints = BANDIT_JOINTS.map((j) => ({ ...j, at: s3(j.at) }));
  r = { parts, joints };
  ragdolls.set(key, r);
  return r;
}
