// The Rampart (the old project's v4 mech study) on the walker and upper-body sims.
// The model comes as one mesh per bone (Part_Pelvis, Part_Torso, Part_Thigh_L/R, Part_Shin_*, Part_Cannon_*,
// Part_Foot_*, Part_Pod_*) plus empties at the joints (Thigh_L hip, Shin_L knee, Cannon_L hock, Foot_L foot
// point, UpperArm_L shoulder, Waist) and gun points (PodSpin_R axis, PodMuzzle0_R, PodEject_R).
// Each mesh is baked into rest-pose world space, then hung under a pivot that sits on its joint in the rest pose;
// every frame the pivots follow the sim's joints. Hull-mounted miniguns on both sides: the right pod is mirrored
// onto the left shoulder in place of the rocket box. Ammo drums and a power pack ride on the back.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WalkerSim, LegPose } from "./walker";
import type { UpperSim } from "./upper";
import type { WalkerValues } from "./walkerTuning";
import type { ToonLook } from "../look/toon";
import { LEG_TYPES } from "./legTypes";
import { MECH_VARIANTS, RAMPART_BACK } from "./variants";
import type { BodyParts, MountSocket } from "../game/mechUnit";
import type { Aim } from "./upper";
import { HeadDriver, HEAD_DEFAULTS, type HeadValues } from "./head";
import { fromGlb, sensorGlb, standInSensor, type SensorModel } from "./sensorModels";
import { BASE_BY_ID, type SensorStyle } from "../items/bases";

/**
 * Stand-in fit for the mounts (Keith 2026-10-26) until arms, sensors and waist kit are modelled: an arm drops its
 * side's gun pivot to a hand below and outboard of the shoulder (the held weapon rides there, smaller than a hull
 * weapon); a sensor head sits on the front of the hull (`Sensor_Front`), a cluster on top (`Sensor_Top`); the waist
 * mounts are where the half drums hang. The Rampart's own hull mesh has a cab window in its nose: that's the
 * cockpit, part of the one hull mesh, so it stays; a fitted head sits on the nose below it.
 */
export const MOUNT_STANDIN = {
  armDrop: 0.75, armOut: 0.3, armFwd: 0.35, heldScale: 0.72,
  sensorTop: [0, 1.62, -0.55] as [number, number, number],
  sensorFront: [0, 0.78, 1.0] as [number, number, number],
};
/** The sensor a body shows before any loadout is applied (the default loadout's). */
const DEFAULT_SENSOR = { id: "sensor-visor", style: "head" as SensorStyle };

const loader = new GLTFLoader();

/**
 * A Rampart variant picked with `?mech=<id>` in any lab: loads public/models/mechs/<id>.glb (same parts and joint
 * empties as rampart.glb, built by tools/blender/mechs/variants/<id>/). Null for the Rampart itself.
 */
export function mechVariant(): string | null {
  if (typeof location === "undefined") return null;
  const id = new URLSearchParams(location.search).get("mech");
  return id && /^[a-z0-9-]+$/.test(id) ? id : null;
}

/** The leg type for the loaded mech: the variant's own entry in LEG_TYPES if it has one, else the Rampart's. */
export function mechLegType(): string {
  const id = mechVariant();
  return id && LEG_TYPES[id] ? id : "rampart";
}
const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();

/** Rotation whose +Y runs from a to b and whose +X lies along `side` (made perpendicular). */
function boneQuat(a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, out: THREE.Quaternion) {
  Y.subVectors(b, a).normalize();
  X.copy(side).addScaledVector(Y, -side.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0);
  X.normalize();
  Z.crossVectors(X, Y);
  return out.setFromRotationMatrix(M.makeBasis(X, Y, Z));
}

/** Split a rest-space geometry into the triangles behind and ahead of z (by each triangle's centre). */
function splitAtZ(g: THREE.BufferGeometry, z: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position;
  const back: number[] = [], front: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    (cz > z ? front : back).push(t, t + 1, t + 2);
  }
  const pick = (verts: number[]) => {
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.attributes[name] as THREE.BufferAttribute, n = a.itemSize;
      // Through the accessors, so normalised integer colours come out as plain floats.
      const get = [a.getX, a.getY, a.getZ, a.getW].map((f) => f.bind(a));
      const arr = new Float32Array(verts.length * n);
      verts.forEach((v, i) => { for (let k = 0; k < n; k++) arr[i * n + k] = get[k](v); });
      out.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    return out;
  };
  return [pick(back), pick(front)];
}

/** Mirror a rest-space geometry across x = 0 and fix its winding so faces stay outward. */
function mirrored(g: THREE.BufferGeometry) {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (m.index) {
    const idx = m.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    m.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(m.attributes)) {
      const a = m.attributes[name] as THREE.BufferAttribute, n = a.itemSize, arr = a.array;
      for (let v = 0; v < a.count; v += 3) for (let k = 0; k < n; k++) {
        const i1 = (v + 1) * n + k, i2 = (v + 2) * n + k, t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t;
      }
      a.needsUpdate = true;
    }
  }
  return m;
}

interface Bone { pivot: THREE.Group; restLen: number }
interface PodRig {
  yawPitch: THREE.Group; kick: THREE.Group; spin: THREE.Group; muzzle: THREE.Object3D; eject: THREE.Object3D; side: 1 | -1;
  /** The gun pivot's rest place on the shoulder (an arm moves it to its hand). */
  home: THREE.Vector3;
  /** Stand-in arm: the upper arm (fixed to the hull) and the forearm (turns with the aim). */
  arm: THREE.Group; forearm: THREE.Group;
}

export class RampartBody {
  readonly root = new THREE.Group();
  private pelvis = new THREE.Group();
  private hull = new THREE.Group();
  private torso: THREE.Object3D | null = null;
  private back: THREE.Object3D | null = null;
  private drums: THREE.Object3D[] = [];
  private pack: THREE.Object3D | null = null;
  /** Where shoulder weapons stand: on each shoulder (+1 left, -1 right) and on top of the back mount. */
  private shoulderMounts: { side: 1 | -1; g: THREE.Group }[] = [];
  private backTop = new THREE.Group();
  /** The sensor sockets (a head at the front, a cluster on top), the fitted sensor's model and its head motion
   *  (cosmetic, src/mech/head.ts); and the waist sockets (where the drums hang). */
  private sensorFront = new THREE.Group();
  private sensorTop = new THREE.Group();
  private sensorModel: SensorModel | null = null;
  private sensorId: string | null = null;
  private sensorStyle: SensorStyle = "cluster";
  private look: ToonLook | null = null;
  readonly head = new HeadDriver();
  private torsoYaw = 0;
  /** The aim's bearing last frame and how fast it turns (smoothed), for the head to look ahead along a sweep. */
  private aimBearing: number | null = null;
  private aimRate = 0;
  private lastPaint: { look: ToonLook; color: number | null } | null = null;
  private waists: { side: 1 | -1; g: THREE.Group }[] = [];
  private legs: { thigh: Bone; shin: Bone; cannon: Bone; foot: THREE.Group; toe: THREE.Group }[] = [];
  private pods: PodRig[] = [];
  private rest: Record<string, THREE.Vector3> = {};
  private tmp = { q: new THREE.Quaternion(), v: new THREE.Vector3(), e: new THREE.Euler(), left: new THREE.Vector3() };

  private constructor() { this.root.name = "rampart"; }

  static async load(look: ToonLook, base = "/models/"): Promise<RampartBody> {
    const body = new RampartBody();
    const id = mechVariant();
    const [mech, drumR, drumL] = await Promise.all(
      [id ? `mechs/${id}.glb` : "rampart.glb", "ammo-drum-half.glb", "ammo-drum-half-left.glb"].map((f) =>
        new Promise<{ scene: THREE.Object3D }>((res, rej) => loader.load(base + f, res, undefined, rej))),
    );
    body.build(mech.scene, drumR.scene, drumL.scene, look);
    return body;
  }

  /**
   * Leg proportions measured from the model's joints: apply these to the walker tuning so the IK fits the parts.
   * Stance width is not taken from the model: its rest pose stands far wider than it walks.
   */
  legValues(): Partial<WalkerValues> {
    const r = this.rest;
    const hip = r.Thigh_L, knee = r.Shin_L, hock = r.Cannon_L, foot = r.Foot_L;
    return {
      hipHeight: hip.y, hipWidth: hip.x,
      femur: hip.distanceTo(knee), shin: knee.distanceTo(hock), cannon: hock.distanceTo(foot),
      cannonRake: (Math.atan2(-(hock.z - foot.z), hock.y - foot.y) * 180) / Math.PI,
      ankleHeight: foot.y, ankleBack: 0,
    };
  }

  private build(scene: THREE.Object3D, drumR: THREE.Object3D, drumL: THREE.Object3D, look: ToonLook) {
    scene.updateMatrixWorld(true);
    const geo: Record<string, THREE.BufferGeometry> = {};
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) geo[m.name] = m.geometry.clone().applyMatrix4(m.matrixWorld);
      else if (o !== scene) this.rest[o.name] = o.getWorldPosition(new THREE.Vector3());
    });
    const r = this.rest;
    for (const s of ["L", "R"]) if (!r["Thigh_" + s]) throw new Error("rampart.glb: missing joint empties");
    const pelvisRest = new THREE.Vector3(0, r.Thigh_L.y, 0);
    const waistRest = r.Waist;

    const mesh = (g: THREE.BufferGeometry, name: string, parent: THREE.Object3D, restFrame: THREE.Matrix4) => {
      const m = new THREE.Mesh(g.clone().applyMatrix4(restFrame.clone().invert()), undefined);
      m.name = name;
      look.apply(m);
      parent.add(m);
      return m;
    };
    const frame = (origin: THREE.Vector3, q = new THREE.Quaternion()) => new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, 1, 1));

    // Pelvis and hull (the torso rides on the waist; pods on its shoulders).
    this.root.add(this.pelvis, this.hull);
    mesh(geo.Part_Pelvis, "pelvis", this.pelvis, frame(pelvisRest));
    const hullFrame = frame(waistRest);
    this.torso = mesh(geo.Part_Torso, "torso", this.hull, hullFrame);

    // Legs: thigh hip->knee, shin knee->hock, cannon hock->foot point, foot on the ground under the foot point.
    const side = new THREE.Vector3(1, 0, 0);
    for (const s of ["L", "R"] as const) {
      const hip = r["Thigh_" + s], knee = r["Shin_" + s], hock = r["Cannon_" + s], fp = r["Foot_" + s];
      const bone = (name: string, a: THREE.Vector3, b: THREE.Vector3): Bone => {
        const pivot = new THREE.Group();
        this.root.add(pivot);
        mesh(geo[`Part_${name}_${s}`], `${name}_${s}`, pivot, frame(a, boneQuat(a, b, side, new THREE.Quaternion())));
        return { pivot, restLen: a.distanceTo(b) };
      };
      // Foot: split at the toe hinge into the heel block and the toes, so the toes bend at the ball of the foot.
      const foot = new THREE.Group();
      this.root.add(foot);
      const hingeZ = LEG_TYPES[mechLegType()].values.toeHinge ?? 0.14;
      const [heelGeo, toeGeo] = splitAtZ(geo[`Part_Foot_${s}`], fp.z + hingeZ);
      mesh(heelGeo, `Foot_${s}`, foot, frame(new THREE.Vector3(fp.x, 0, fp.z)));
      const toe = new THREE.Group();
      toe.position.set(0, 0, hingeZ);
      foot.add(toe);
      mesh(toeGeo, `Toes_${s}`, toe, frame(new THREE.Vector3(fp.x, 0, fp.z + hingeZ)));
      this.legs.push({ thigh: bone("Thigh", hip, knee), shin: bone("Shin", knee, hock), cannon: bone("Cannon", hock, fp), foot, toe });
    }

    // Miniguns on both shoulders: the right pod as modelled, and its mirror on the left.
    const podR = geo.Part_Pod_R, spinR = geo.Part_PodSpin_R;
    for (const sd of [1, -1] as const) {
      const flip = (v: THREE.Vector3) => new THREE.Vector3(v.x * -sd, v.y, v.z); // right-side points -> this side
      const shoulder = flip(r.UpperArm_R), axis = flip(r.PodSpin_R), axisFwd = flip(r.PodSpinFwd_R);
      const yawPitch = new THREE.Group();
      yawPitch.position.copy(shoulder).sub(waistRest);
      this.hull.add(yawPitch);
      const kick = new THREE.Group();
      yawPitch.add(kick);
      const podFrame = frame(shoulder);
      mesh(sd === -1 ? podR : mirrored(podR), `pod_${sd}`, kick, podFrame);
      // Barrel cluster spins about its own axis (along +Z in the rest pose).
      const spin = new THREE.Group();
      spin.position.copy(axis).sub(shoulder);
      spin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisFwd.clone().sub(axis).normalize());
      kick.add(spin);
      mesh(sd === -1 ? spinR : mirrored(spinR), `spin_${sd}`, spin, new THREE.Matrix4().compose(axis, spin.quaternion, new THREE.Vector3(1, 1, 1)));
      const muzzle = new THREE.Object3D(); muzzle.position.copy(flip(r.PodMuzzle0_R)).sub(shoulder); kick.add(muzzle);
      const eject = new THREE.Object3D(); eject.position.copy(flip(r.PodEject_R)).sub(shoulder); kick.add(eject);
      // Stand-in arm (shown when the mount holds an arm): an upper arm hanging from the shoulder, a forearm under the gun.
      const arm = armUpper(look, sd), forearm = armFore(look);
      arm.position.copy(yawPitch.position);
      arm.visible = forearm.visible = false;
      this.hull.add(arm);
      yawPitch.add(forearm);
      this.pods.push({ yawPitch, kick, spin, muzzle, eject, side: sd, home: yawPitch.position.clone(), arm, forearm });
      // A shoulder weapon mount on the hull above this pod (fixed to the hull; keys 1 and 2).
      const sm = new THREE.Group();
      sm.position.copy(shoulder).sub(waistRest).add(new THREE.Vector3(Math.sign(shoulder.x || sd) * 0.1, 0.75, -0.35));
      this.hull.add(sm);
      this.shoulderMounts.push({ side: sd, g: sm });
    }

    // Back: a half-width ammo drum per gun, a power pack raised above them (placed and painted per variant).
    const variant = MECH_VARIANTS[mechVariant() ?? ""];
    const back = new THREE.Group();
    this.back = back;
    back.position.set(...(variant?.backAt ?? RAMPART_BACK));
    this.hull.add(back);
    for (const [drum, x] of [[drumR, -0.5], [drumL, 0.5]] as const) {
      // The waist socket on this side (+X is the mech's left): the drum hangs in it.
      const waist = new THREE.Group();
      waist.position.set(x, 0, 0);
      back.add(waist);
      this.waists.push({ side: x > 0 ? 1 : -1, g: waist });
      drum.updateMatrixWorld(true);
      drum.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const part = new THREE.Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld));
        part.userData.side = x > 0 ? 1 : -1;
        look.apply(part);
        // The drums carry another brand's paint: tint them into the Rampart's olive (or the variant's colour).
        look.tint(part, variant?.drumTint ?? 0x8b9160);
        waist.add(part);
        this.drums.push(part);
      });
    }
    this.pack = powerPack(look, variant?.packBody, variant?.packCells);
    back.add(this.pack);
    // A shoulder weapon on the back mount stands on top of the pack (key 3).
    this.backTop.position.set(0, 1.75, -0.1);
    back.add(this.backTop);
    // The sensor sockets: a head on the nose, a cluster on top; the default loadout's sensor until one is fitted.
    this.look = look;
    this.sensorFront.name = "Sensor_Front";
    this.sensorTop.name = "Sensor_Top";
    this.sensorFront.position.set(...MOUNT_STANDIN.sensorFront);
    this.sensorTop.position.set(...MOUNT_STANDIN.sensorTop);
    this.hull.add(this.sensorFront, this.sensorTop);
    this.setSensor(DEFAULT_SENSOR.id, DEFAULT_SENSOR.style);
  }

  /** Fit a sensor's model by base id (null: none): the code stand-in at once, its GLB in its place if one loads. */
  setSensor(id: string | null, style?: SensorStyle) {
    if (id === this.sensorId) return;
    this.sensorId = id;
    this.sensorStyle = style ?? (id ? BASE_BY_ID[id]?.sensor?.style : undefined) ?? "cluster";
    this.put(id ? standInSensor(id, this.look!, this.sensorStyle) : null);
    if (!id) return;
    void sensorGlb(id).then((scene) => { if (scene && this.sensorId === id) this.put(fromGlb(scene, this.look!)); });
  }

  private put(m: SensorModel | null) {
    this.sensorModel?.root.removeFromParent();
    this.sensorModel = m;
    this.head.reset();
    if (m) (this.sensorStyle === "head" ? this.sensorFront : this.sensorTop).add(m.root);
    // New meshes take the mech's current paint.
    this.paints = null;
    if (this.lastPaint) this.paint(this.lastPaint.look, this.lastPaint.color);
  }

  /**
   * Turn the fitted head toward the aim (or scan with none) and sweep a cluster: cosmetic, called each frame after
   * update(). v: the head sliders (src/mech/head.ts).
   */
  aimSensor(dt: number, aim: Aim | null, v: HeadValues = HEAD_DEFAULTS) {
    const m = this.sensorModel;
    if (!m) return;
    // Size and height of a fitted head (sliders); a cluster on top keeps its own size.
    if (this.sensorStyle === "head") {
      m.root.scale.setScalar(v.headSize);
      this.sensorFront.position.set(MOUNT_STANDIN.sensorFront[0], MOUNT_STANDIN.sensorFront[1] - v.headDrop, MOUNT_STANDIN.sensorFront[2] + v.headForward);
    }
    const sweep = this.sensorId ? BASE_BY_ID[this.sensorId]?.sensor?.sweep ?? 0 : 0;
    let local: { x: number; y: number; z: number } | null = null, behind = 0;
    if (aim && m.head) {
      const sock = this.sensorStyle === "head" ? this.sensorFront : this.sensorTop;
      sock.updateWorldMatrix(true, false);
      const p = this.tmp.v.set(aim.x, aim.y, aim.z);
      sock.worldToLocal(p);
      local = { x: p.x, y: p.y, z: p.z };
      // How far the torso still has to turn toward the aim, so the head can look ahead of it.
      const hp = sock.getWorldPosition(this.tmp.left);
      const want = Math.atan2(aim.x - hp.x, aim.z - hp.z);
      behind = Math.atan2(Math.sin(want - this.torsoYaw), Math.cos(want - this.torsoYaw));
      if (this.aimBearing !== null && dt > 0) {
        const d = want - this.aimBearing, rate = Math.atan2(Math.sin(d), Math.cos(d)) / dt;
        this.aimRate += (rate - this.aimRate) * Math.min(1, dt * 8);
      }
      this.aimBearing = want;
    } else { this.aimBearing = null; this.aimRate = 0; }
    this.head.step(dt, { aim: local, torsoBehind: behind, aimRate: this.aimRate }, v, sweep);
    if (m.head) m.head.rotation.y = this.head.yaw;
    if (m.pitch) m.pitch.rotation.x = -this.head.pitch;
    if (m.sweep) m.sweep.rotation.y = this.head.sweep;
  }

  /** Show or hide fitted parts (a loadout with an empty side, no drums or no pack). */
  showParts(parts: BodyParts) {
    const S = MOUNT_STANDIN;
    for (const p of this.pods) {
      const L = p.side === 1, arm = (L ? parts.mountL : parts.mountR) === "arm";
      // An arm: the gun pivot moves down to its hand and the held weapon draws smaller; the arm shows even unarmed.
      p.yawPitch.visible = (L ? parts.gunLeft : parts.gunRight) || arm;
      p.yawPitch.position.copy(p.home);
      if (arm) p.yawPitch.position.add(new THREE.Vector3(p.side * S.armOut, -S.armDrop, S.armFwd));
      p.kick.scale.setScalar(arm ? S.heldScale : 1);
      p.kick.visible = L ? parts.gunLeft : parts.gunRight;
      p.arm.visible = p.forearm.visible = arm;
    }
    for (const d of this.drums) d.visible = parts.drumsL === undefined ? parts.drums : d.userData.side === 1 ? !!parts.drumsL : !!parts.drumsR;
    if (this.pack) this.pack.visible = parts.pack;
    // A back weapon stands on the pack, or lower where the pack would be.
    this.backTop.position.y = parts.pack ? 1.75 : 0.95;
    // The fitted sensor (a body told only on/off keeps its model and hides it).
    if (parts.sensorId !== undefined) this.setSensor(parts.sensor === false ? null : parts.sensorId, parts.sensorStyle ?? undefined);
    this.sensorFront.visible = this.sensorTop.visible = parts.sensor ?? true;
  }

  /**
   * Where a stand-in weapon hangs (src/weapons/models.ts): a gun side's pivot (it turns and kicks with the gun; +Z
   * along the barrel, origin on the shoulder), a shoulder mount on the hull, or the top of the back mount (+Z forward).
   */
  mount(slot: MountSocket): THREE.Object3D {
    switch (slot) {
      case "back": case "Pack": return this.backTop;
      case "Sensor_Front": return this.sensorFront;
      case "Sensor_Top": return this.sensorTop;
      case "Sensor": return this.sensorStyle === "head" ? this.sensorFront : this.sensorTop;
      case "Waist_L": case "Waist_R": return this.waists.find((w) => w.side === (slot === "Waist_L" ? 1 : -1))!.g;
      case "shoulderL": case "shoulderR": case "Shoulder_L": case "Shoulder_R":
        return this.shoulderMounts.find((m) => m.side === (slot === "shoulderL" || slot === "Shoulder_L" ? 1 : -1))!.g;
      default: {
        // A side's gun pivot: the hull weapon on its hull mount, or the held weapon in the arm's grip.
        const left = slot === "left" || slot === "HullMount_L" || slot === "Grip_L";
        return this.pods.find((p) => p.side === (left ? 1 : -1))!.kick;
      }
    }
  }

  /** Show or hide a side's minigun pod itself (another weapon's stand-in takes its place on the same pivot). */
  showPod(side: 1 | -1, on: boolean) {
    const p = this.pods.find((q) => q.side === side)!;
    for (const o of p.kick.children) if ((o as THREE.Mesh).isMesh || o === p.spin) o.visible = on;
  }

  /** Has guns (the battlefield's mech unit fires them). */
  readonly armed = true;
  private paints: { mesh: THREE.Mesh; base: number }[] | null = null;
  /**
   * Repaint the whole mech (e.g. red for bandit mechs, near black for a wreck); null puts its own paint back.
   * The colour multiplies the model's vertex colours, so the panel shading stays.
   */
  paint(look: ToonLook, color: number | null) {
    this.lastPaint = { look, color };
    if (!this.paints) {
      this.paints = [];
      this.root.traverse((o) => {
        const m = o as THREE.Mesh;
        // Lenses and lamps keep their glow.
        if (m.isMesh && !m.userData.ink && !m.userData.glow) this.paints!.push({ mesh: m, base: (m.material as THREE.MeshStandardMaterial).color.getHex() });
      });
    }
    for (const { mesh, base } of this.paints) look.tint(mesh, color === null ? base : color);
  }

  update(sim: WalkerSim, upper: UpperSim) {
    const t = this.tmp;
    this.torsoYaw = upper.torsoYaw;
    const left = t.left.set(1, 0, 0).applyQuaternion(sim.pelvisQ);
    this.pelvis.position.copy(sim.pelvis);
    this.pelvis.quaternion.copy(sim.pelvisQ);

    // Hull: on the waist, turned to the torso's aim, pitched with the body, rolled only as much as it isn't kept level.
    // Leaning back (upper.lean) when the guns need more raise than they have.
    t.e.set(sim.bodyPitch - upper.lean, upper.torsoYaw + upper.shake * Math.sin(performance.now() * 0.09), sim.hullRoll, "YXZ");
    this.hull.quaternion.setFromEuler(t.e);
    t.v.copy(this.rest.Waist).sub(new THREE.Vector3(0, this.rest.Thigh_L.y, 0)).applyQuaternion(sim.pelvisQ);
    this.hull.position.copy(sim.pelvis).add(t.v);

    sim.feet.forEach((f, i) => this.poseLeg(this.legs[i], f.pose, left));

    for (const p of this.pods) {
      const g = upper.guns[p.side === 1 ? 0 : 1];
      p.yawPitch.rotation.set(g.pitch, g.yaw, 0, "YXZ");
      p.kick.position.z = -g.kick;
      p.spin.rotation.z = g.spinAngle * -p.side;
    }
  }

  private poseLeg(L: (typeof this.legs)[number], P: LegPose, side: THREE.Vector3) {
    const set = (b: Bone, a: THREE.Vector3, c: THREE.Vector3) => {
      b.pivot.position.copy(a);
      boneQuat(a, c, side, b.pivot.quaternion);
      b.pivot.scale.set(1, a.distanceTo(c) / b.restLen, 1);
    };
    set(L.thigh, P.hip, P.knee);
    set(L.shin, P.knee, P.hock);
    set(L.cannon, P.hock, P.ankle);
    L.foot.position.copy(P.foot);
    L.foot.quaternion.copy(P.footQ);
    // Toe bend relative to the foot: toeQ = footQ * bend.
    L.toe.quaternion.copy(L.foot.quaternion).invert().multiply(P.toeQ);
  }

  /** The model's parts by region, for selection (hold V): each list is what to raycast and light up. */
  regions() {
    const legs = this.legs.flatMap((L) => [L.thigh.pivot, L.shin.pivot, L.cannon.pivot, L.foot]);
    const gun = (side: 1 | -1) => [this.pods.find((p) => p.side === side)!.yawPitch];
    return { legs, hull: [this.pelvis, this.torso!], gunLeft: gun(1), gunRight: gun(-1), back: [this.back!], sensor: [this.sensorFront, this.sensorTop] };
  }

  /** World position of a gun's muzzle (side +1 left, -1 right). */
  muzzle(side: 1 | -1, out = new THREE.Vector3()) { return this.pods.find((p) => p.side === side)!.muzzle.getWorldPosition(out); }
  /** World position of a gun's casing port. */
  eject(side: 1 | -1, out = new THREE.Vector3()) { return this.pods.find((p) => p.side === side)!.eject.getWorldPosition(out); }
  /** World direction a gun's barrels point. */
  barrel(side: 1 | -1, out = new THREE.Vector3()) {
    const p = this.pods.find((q) => q.side === side)!;
    return out.set(0, 0, 1).applyQuaternion(p.kick.getWorldQuaternion(this.tmp.q));
  }
  /** World position of the line between the shoulders, for aiming. */
  shoulderLine(out = new THREE.Vector3()) {
    return out.copy(this.rest.UpperArm_L).sub(this.rest.Waist).setX(0).applyQuaternion(this.hull.quaternion).add(this.hull.position);
  }
}

/** Stand-in upper arm (box), from the shoulder down and out to the hand; side +1 left, -1 right. */
function armUpper(look: ToonLook, side: 1 | -1) {
  const S = MOUNT_STANDIN, g = new THREE.Group();
  const len = Math.hypot(S.armDrop, S.armOut, S.armFwd);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, len, 0.38));
  m.position.set((side * S.armOut) / 2, -S.armDrop / 2, S.armFwd / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-side * S.armOut, S.armDrop, -S.armFwd).normalize());
  look.apply(m); look.tint(m, 0x6c7546);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8));
  look.apply(joint); look.tint(joint, 0x3e3c35);
  g.add(m, joint);
  return g;
}
/** Stand-in forearm (box) under the gun pivot, along the aim, with a hand block where the grip is. */
function armFore(look: ToonLook) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.1));
  m.position.set(0, -0.22, 0.25);
  look.apply(m); look.tint(m, 0xb7a77c);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3));
  hand.position.set(0, -0.1, 0.8);
  look.apply(hand); look.tint(hand, 0x3e3c35);
  g.add(m, hand);
  return g;
}
/** Stand-in power pack from boxes, in the Rampart's khaki and olive (or a variant's paint), until a modelled one exists. */
function powerPack(look: ToonLook, khaki = 0xb7a77c, olive = 0x6c7546) {
  const g = new THREE.Group();
  g.position.set(0, 1.05, -0.25);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (geo: THREE.BufferGeometry, tint: number, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo);
    m.scale.set(...size); m.position.set(...at); m.rotation.set(...rot);
    look.apply(m);
    look.tint(m, tint);
    g.add(m);
  };
  const dark = 0x3e3c35;
  add(box, khaki, [1.55, 0.7, 0.75], [0, 0, 0]);
  add(box, dark, [1.35, 0.5, 0.12], [0, 0.02, -0.42]);
  for (let i = 0; i < 5; i++) add(box, dark, [0.05, 0.42, 0.12], [-0.5 + i * 0.25, 0.02, -0.5]);
  const cell = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  for (const x of [-0.42, 0.42]) add(cell, olive, [0.34, 0.85, 0.34], [x, 0.48, 0.02], [0, 0, Math.PI / 2]);
  add(box, khaki, [0.5, 0.18, 0.5], [0, 0.42, 0.05]);
  add(box, 0xd18a2a, [0.12, 0.1, 0.03], [0.55, 0.15, -0.39]);
  return g;
}
