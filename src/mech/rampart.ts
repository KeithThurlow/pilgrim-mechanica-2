// The Rampart (the old project's v4 mech study) on the walker and upper-body sims.
// The model comes as one mesh per bone (Part_Pelvis, Part_Torso, Part_Thigh_L/R, Part_Shin_*, Part_Cannon_*,
// Part_Foot_*, Part_Pod_*) plus empties at the joints (Thigh_L hip, Shin_L knee, Cannon_L hock, Foot_L foot
// point, UpperArm_L shoulder, Waist) and gun points (PodSpin_R axis, PodMuzzle0_R, PodEject_R).
// Each mesh is baked into rest-pose world space, then hung under a pivot that sits on its joint in the rest pose;
// every frame the pivots follow the sim's joints. Hull-mounted miniguns on both sides: the right pod is mirrored
// onto the left shoulder in place of the rocket box. Ammo drums and a power pack ride on the back.
import * as THREE from "three/webgpu";
import { flatPaint, mergeTinted } from "../look/mergeGeometry";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WalkerSim, LegPose } from "./walker";
import type { UpperSim, UpperValues } from "./upper";
import { armRoll } from "./upper";

const UP = new THREE.Vector3(0, 1, 0);
import type { WalkerValues } from "./walkerTuning";
import type { ToonLook } from "../look/toon";
import { LEG_TYPES } from "./legTypes";
import { MECH_VARIANTS, RAMPART_BACK } from "./variants";
import type { BodyParts, MountSocket } from "../game/mechUnit";
import type { Aim } from "./upper";
import { armIk, type SwordPose } from "../weapons/sword";

/** A held weapon's pose driven by its weapon (the sword, src/weapons/sword.ts), hull frame: the hand's place and the
 *  weapon's axes, the arm's bone lengths, and the way the elbow bends. */
/** A held pose and its arm: bone lengths, and how far the shoulder sits out from the hull's (a stub bridges it). */
export interface HeldPose extends SwordPose { upper: number; fore: number; out: number }
/** A two-bone arm as drawn: its pieces (the hull's arm model, or boxes until it loads), the elbow's last hinge, the model's id. */
interface IkArm { g: THREE.Group; upper: THREE.Mesh; fore: THREE.Mesh; elbow: THREE.Mesh; hand: THREE.Mesh; stub: THREE.Mesh; joint: THREE.Mesh; hinge: THREE.Vector3; id: string }
const AX = { a: new THREE.Vector3(), b: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };
import { HeadDriver, HEAD_DEFAULTS, type HeadValues } from "./head";
import { fromGlb, sensorGlb, standInSensor, type SensorModel } from "./sensorModels";
import { ARM_PIECES, armFromGlb, partFromGlb, partGlb } from "./partModels";
import { BASE_BY_ID, type SensorStyle } from "../items/bases";
import { AVAILABLE_LOOKS } from "../items/item";
import { footShapeOr, type FootShape } from "../fx/footprint";
import { bakeFootFromGeometry } from "../fx/footprintMesh";
import { drawBetweenTicks } from "../look/treeInterp";
import { asset } from "../core/assetBase";

/**
 * Stand-in fit for the mounts (Keith 2026-10-26) until arms, sensors and waist kit are modelled: an arm drops its
 * side's gun pivot to a hand below and outboard of the shoulder (the held weapon rides there, smaller than a hull
 * weapon); a sensor head sits on the front of the hull (`Sensor_Front`), a cluster on top (`Sensor_Top`); the waist
 * mounts are where the half drums hang. The Rampart's own hull mesh has a cab window in its nose: that's the
 * cockpit, part of the one hull mesh, so it stays; a fitted head sits on the nose below it.
 */
export const MOUNT_STANDIN = {
  armDrop: 0.75, armOut: 0.3, armFwd: 0.35, heldScale: 0.72,
  // The fist at the end of the forearm (from the elbow, the gun pivot), and where a held weapon's origin sits so its
  // grip (about 0.3 under its origin, scaled) is in that fist: held in the hand, not lying along the forearm (Keith
  // 2026-11-03: "they look mounted on the forearm").
  handAt: [0, -0.14, 0.72] as [number, number, number],
  gunAt: [0, 0.08, 0.78] as [number, number, number],
  sensorTop: [0, 1.62, -0.55] as [number, number, number],
  sensorFront: [0, 0.78, 1.0] as [number, number, number],
};
/** The sensor a body shows before any loadout is applied (the default loadout's). */
/** The pack a body shows when no loadout says which (the labs' plain Rampart): the Rampart's standard pack. */
const DEFAULT_PACK = "pack-standin";
const DEFAULT_SENSOR = { id: "sensor-visor", style: "head" as SensorStyle };

const loader = new GLTFLoader();

/** A mech model as parts: each mesh baked to rest-pose world space by name, and the joint empties' positions. */
interface Src { geo: Record<string, THREE.BufferGeometry>; rest: Record<string, THREE.Vector3> }
/** The part looks a loadout can show (legs and hulls with a model; src/items/item.ts AVAILABLE_LOOKS). */
const PART_LOOKS = AVAILABLE_LOOKS;
const scenes = new Map<string, Promise<THREE.Object3D>>();
const srcs = new Map<string, Promise<Src>>();
const loaded = new Map<string, Src>();
/** A GLB's scene, fetched and parsed once per page. */
function loadScene(url: string) {
  let p = scenes.get(url);
  if (!p) {
    p = new Promise<THREE.Object3D>((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
    scenes.set(url, p);
  }
  return p;
}
const lookFile = (id: string) => (id === "rampart" ? "rampart.glb" : `mechs/${id}.glb`);
function loadSrc(id: string, base: string): Promise<Src> {
  const key = base + lookFile(id);
  let p = srcs.get(key);
  if (!p) {
    p = loadScene(key).then((scene) => {
      scene.updateMatrixWorld(true);
      const src: Src = { geo: {}, rest: {} };
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) src.geo[m.name] = m.geometry.clone().applyMatrix4(m.matrixWorld);
        else if (o !== scene) src.rest[o.name] = o.getWorldPosition(new THREE.Vector3());
      });
      loaded.set(key, src);
      return src;
    });
    srcs.set(key, p);
  }
  return p;
}
/** A look's parts if already loaded (RampartBody.load loads every part look). */
const srcNow = (id: string, base: string) => loaded.get(base + lookFile(id)) ?? null;

const frame = (origin: THREE.Vector3, q = new THREE.Quaternion()) => new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, 1, 1));
function clearMeshes(g: THREE.Object3D) {
  for (const c of [...g.children]) if ((c as THREE.Mesh).isMesh) { g.remove(c); (c as THREE.Mesh).geometry.dispose(); }
}
/**
 * How far forward a hull's nose and how high its roof reach (hull frame, metres) where the sensor sockets sit: the
 * nose ahead of the head socket's height, the roof over the cluster socket. The Rampart's are RAMPART_SURFACES.
 */
function torsoSurfaces(g: THREE.BufferGeometry) {
  const p = g.attributes.position, S = MOUNT_STANDIN;
  let top = -Infinity, front = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(x) > 0.45) continue;
    if (Math.abs(z - S.sensorTop[2]) < 0.45) top = Math.max(top, y);
    if (Math.abs(y - S.sensorFront[1]) < 0.4) front = Math.max(front, z);
  }
  return { top: isFinite(top) ? top : RAMPART_SURFACES.top, front: isFinite(front) ? front : RAMPART_SURFACES.front };
}
/** torsoSurfaces of rampart.glb (measured 2026-10-31). */
const RAMPART_SURFACES = { top: 2.302, front: 1.365 };

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
/** Where the minigun pod's rear box starts, behind its shoulder (m; the Rampart's pod: a box round the barrel axis from
 *  -1.0 to -0.62, the housing ahead of it). */
const POD_REAR_Z = -0.62;

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
/** RampartBody.slim: cross-section of the legs and feet, the hull's width, height and length, the guns (1: as modelled). */
export interface RampartSlim { leg: number; foot: number; hull: [number, number, number]; gun: number; /** Show the back unit (default yes). */ back?: boolean }
interface PodRig {
  yawPitch: THREE.Group; kick: THREE.Group; spin: THREE.Group; muzzle: THREE.Object3D; eject: THREE.Object3D; side: 1 | -1;
  /** The pod's rear box (hidden while the feed drum sits in its place). */
  rear: THREE.Mesh;
  /** The gun pivot's rest place on the shoulder (an arm moves it to its hand). */
  home: THREE.Vector3;
  /** Stand-in arm: the upper arm (fixed to the hull) and the forearm (turns with the aim). */
  arm: THREE.Group; forearm: THREE.Group;
  /** Where showParts put the gun pivot, and whether it showed the stand-in arm (put back when a held pose ends). */
  heldAt?: THREE.Vector3; armShown?: boolean;
  /** Where the weapon pivot (kick) rests: the hand's grip for an arm, the shoulder pivot for a hull weapon. */
  kickBase?: THREE.Vector3;
  /** A weapon-driven pose (holdPose) and its two-bone arm, built on first use. */
  held?: boolean;
  ik?: IkArm;
}

export class RampartBody {
  readonly root = drawBetweenTicks(new THREE.Group());
  private pelvis = new THREE.Group();
  private hull = new THREE.Group();
  /** The torso mesh's holder (the fitted hull's mesh goes in it). */
  private torso = new THREE.Group();
  private back: THREE.Object3D | null = null;
  private drums: THREE.Object3D[] = [];
  private pack: THREE.Object3D | null = null;
  /** The fitted pack's base id and the code stand-in it shows until (or without) its model. */
  private packId: string | null = null;
  private packStandIn: THREE.Object3D | null = null;
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
  private waists: { side: 1 | -1; g: THREE.Group; kit: THREE.Group; kitId: string | null }[] = [];
  private legs: { thigh: Bone; shin: Bone; cannon: Bone; foot: THREE.Group; toe: THREE.Group }[] = [];
  private pods: PodRig[] = [];
  /** Rest-pose joints of the fitted legs' model and the fitted hull's model (world space, metres). */
  private legRest: Record<string, THREE.Vector3> = {};
  private hullRest: Record<string, THREE.Vector3> = {};
  private legsLook = "rampart";
  /** The fitted legs' print shapes, left and right (src/fx/footprint.ts). */
  private feet: (FootShape | null)[] = [null, null];
  private hullLook = "rampart";
  /** Where the part models load from; fixed: a ?mech= variant (whole, its parts don't swap). */
  private base = asset("models/");
  private fixed = false;
  /** The front sensor socket's place on the fitted hull (before the head sliders move it). */
  private frontAt = new THREE.Vector3(...MOUNT_STANDIN.sensorFront);
  private lastParts: BodyParts | null = null;
  /** The hull's own arm (its base id): the model the two-bone arms draw with (Keith 2026-11-14). */
  private armId = "arm-rampart";
  private tmp = { q: new THREE.Quaternion(), v: new THREE.Vector3(), e: new THREE.Euler(), left: new THREE.Vector3(), e2: new THREE.Vector3(), h2: new THREE.Vector3(), d2: new THREE.Vector3(), o2: new THREE.Vector3() };

  private constructor() { this.root.name = "rampart"; }

  static async load(look: ToonLook, base = asset("models/")): Promise<RampartBody> {
    const body = new RampartBody();
    const id = mechVariant();
    // The whole variant with ?mech=, else the Rampart; the part looks (src/items/item.ts AVAILABLE_LOOKS) load too so a
    // fitted Stilt or Siege swaps in at once (each file is fetched and parsed once per page, shared by every body).
    const own = id ?? "rampart";
    const [src, drumR, drumL] = await Promise.all([
      loadSrc(own, base), loadScene(base + "ammo-drum-half.glb"), loadScene(base + "ammo-drum-half-left.glb"),
      ...(id ? [] : PART_LOOKS.map((l) => loadSrc(l, base))),
    ]) as [Src, THREE.Object3D, THREE.Object3D];
    body.base = base;
    body.fixed = !!id;
    body.build(src, drumR, drumL, look);
    return body;
  }

  /**
   * Leg proportions measured from the fitted legs' joints: apply these to the walker tuning so the IK fits the parts.
   * Stance width is not taken from the model: its rest pose stands far wider than it walks.
   */
  legValues(): Partial<WalkerValues> {
    const r = this.legRest;
    const hip = r.Thigh_L, knee = r.Shin_L, hock = r.Cannon_L, foot = r.Foot_L;
    return {
      hipHeight: hip.y, hipWidth: hip.x,
      femur: hip.distanceTo(knee), shin: knee.distanceTo(hock), cannon: hock.distanceTo(foot),
      cannonRake: (Math.atan2(-(hock.z - foot.z), hock.y - foot.y) * 180) / Math.PI,
      ankleHeight: foot.y, ankleBack: 0,
    };
  }

  /** The fitted legs' print in the sand: side 1 the left foot, -1 the right (null: the plain oval). */
  footprint(side: 1 | -1): FootShape | null { return this.feet[side === 1 ? 0 : 1]; }
  /** Slimmed feet (slim) print smaller. */
  printScale() { return this.thin.foot; }

  /** The legs and hull looks on show (a look is a model in public/models: "rampart" or a variant id). */
  get looks() { return { legs: this.legsLook, hull: this.hullLook }; }

  /**
   * Show the fitted legs' and hull's models (Keith 2026-10-31: the mech changes as parts are fitted). Legs come from
   * one model (pelvis, legs, feet), the hull from another (torso; the guns, shoulders, back kit and sensor sockets
   * move to its shoulders and surfaces). Looks not loaded yet, or a body fixed by ?mech=, stay as they are.
   * True when the legs changed (their proportions: legValues()).
   */
  setLooks(legs: string, hull: string): boolean {
    if (this.fixed) return false;
    const L = srcNow(legs, this.base), H = srcNow(hull, this.base);
    let legsChanged = false;
    if (L && legs !== this.legsLook) { this.fitLegs(L, legs); legsChanged = true; }
    if (H && hull !== this.hullLook) this.fitHull(H, hull);
    return legsChanged;
  }

  private mesh(g: THREE.BufferGeometry, name: string, parent: THREE.Object3D, restFrame: THREE.Matrix4) {
    const m = new THREE.Mesh(g.clone().applyMatrix4(restFrame.clone().invert()), undefined);
    m.name = name;
    this.look!.apply(m);
    parent.add(m);
    return m;
  }

  private build(src: Src, drumR: THREE.Object3D, drumL: THREE.Object3D, look: ToonLook) {
    this.look = look;
    const own = mechVariant() ?? "rampart";
    // Pelvis and hull (the torso rides on the waist; pods on its shoulders).
    this.root.add(this.pelvis, this.hull);
    this.torso.name = "torso";
    this.hull.add(this.torso);
    for (let i = 0; i < 2; i++) {
      const bone = (): Bone => { const pivot = new THREE.Group(); this.root.add(pivot); return { pivot, restLen: 1 }; };
      const foot = new THREE.Group(), toe = new THREE.Group();
      this.root.add(foot);
      foot.add(toe);
      this.legs.push({ thigh: bone(), shin: bone(), cannon: bone(), foot, toe });
    }

    // Miniguns on both shoulders: the right pod as modelled (the Rampart's, or the ?mech= variant's), its mirror on the
    // left. Built about the pod model's own shoulder; fitHull puts each on the fitted hull's shoulder.
    const r = src.rest, geo = src.geo;
    const podR = geo.Part_Pod_R, spinR = geo.Part_PodSpin_R;
    for (const sd of [1, -1] as const) {
      const flip = (v: THREE.Vector3) => new THREE.Vector3(v.x * -sd, v.y, v.z); // right-side points -> this side
      const shoulder = flip(r.UpperArm_R), axis = flip(r.PodSpin_R), axisFwd = flip(r.PodSpinFwd_R);
      const yawPitch = new THREE.Group();
      this.hull.add(yawPitch);
      const kick = new THREE.Group();
      yawPitch.add(kick);
      // The pod's rear box (behind PodRearZ) is its own mesh so the minigun's ammo drum can take its place (Keith 2026-11-03).
      const [podBack, podMain] = splitAtZ(sd === -1 ? podR : mirrored(podR), shoulder.z + POD_REAR_Z);
      this.mesh(podMain, `pod_${sd}`, kick, frame(shoulder));
      const rear = this.mesh(podBack, `podRear_${sd}`, kick, frame(shoulder));
      // Barrel cluster spins about its own axis (along +Z in the rest pose).
      const spin = new THREE.Group();
      spin.position.copy(axis).sub(shoulder);
      spin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisFwd.clone().sub(axis).normalize());
      kick.add(spin);
      this.mesh(sd === -1 ? spinR : mirrored(spinR), `spin_${sd}`, spin, new THREE.Matrix4().compose(axis, spin.quaternion, new THREE.Vector3(1, 1, 1)));
      const muzzle = new THREE.Object3D(); muzzle.position.copy(flip(r.PodMuzzle0_R)).sub(shoulder); kick.add(muzzle);
      const eject = new THREE.Object3D(); eject.position.copy(flip(r.PodEject_R)).sub(shoulder); kick.add(eject);
      // Stand-in arm (shown when the mount holds an arm): an upper arm hanging from the shoulder, a forearm under the gun.
      const arm = armUpper(look, sd), forearm = armFore(look);
      arm.visible = forearm.visible = false;
      this.hull.add(arm);
      yawPitch.add(forearm);
      this.pods.push({ yawPitch, kick, spin, muzzle, eject, side: sd, home: new THREE.Vector3(), arm, forearm, rear });
      // A shoulder weapon mount on the hull above this pod (fixed to the hull; keys 1 and 2).
      const sm = new THREE.Group();
      this.hull.add(sm);
      this.shoulderMounts.push({ side: sd, g: sm });
    }

    // Back: a half-width ammo drum per gun, a power pack raised above them (placed per hull, painted per ?mech= variant).
    const variant = MECH_VARIANTS[mechVariant() ?? ""];
    const back = new THREE.Group();
    this.back = back;
    this.hull.add(back);
    for (const [drum, x] of [[drumR, -0.5], [drumL, 0.5]] as const) {
      // The waist socket on this side (+X is the mech's left): the drum hangs in it.
      const waist = new THREE.Group();
      waist.position.set(x, 0, 0);
      back.add(waist);
      // Waist kit other than the drums (autoloader, rack, cutting kit) loads into its own group here (setWaist).
      const kit = new THREE.Group();
      kit.name = "WaistKit";
      waist.add(kit);
      this.waists.push({ side: x > 0 ? 1 : -1, g: waist, kit, kitId: null });
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
    // The pack: a slot where the stand-in box pack sits until the fitted item's model loads (setPack).
    this.pack = new THREE.Group();
    this.pack.name = "Pack";
    this.pack.position.set(0, 1.05, -0.25);
    this.packStandIn = powerPack(look, variant?.packBody, variant?.packCells);
    this.pack.add(this.packStandIn);
    back.add(this.pack);
    this.packId = null;
    this.setPack(DEFAULT_PACK);
    // A shoulder weapon on the back mount stands on top of the pack (key 3).
    this.backTop.position.set(0, 1.75, -0.1);
    back.add(this.backTop);
    // The sensor sockets: a head on the nose, a cluster on top; the default loadout's sensor until one is fitted.
    this.sensorFront.name = "Sensor_Front";
    this.sensorTop.name = "Sensor_Top";
    this.hull.add(this.sensorFront, this.sensorTop);
    this.fitLegs(src, own);
    this.fitHull(src, own);
    this.setSensor(DEFAULT_SENSOR.id, DEFAULT_SENSOR.style);
  }

  /** The pelvis, legs and feet from a model (meshes swapped inside the same pivots, so selection and poses carry on). */
  private fitLegs(src: Src, id: string) {
    const r = src.rest, geo = src.geo;
    for (const s of ["L", "R"]) if (!r["Thigh_" + s]) throw new Error(`${id}: missing joint empties`);
    this.legsLook = id;
    this.legRest = r;
    clearMeshes(this.pelvis);
    this.mesh(geo.Part_Pelvis, "pelvis", this.pelvis, frame(new THREE.Vector3(0, r.Thigh_L.y, 0)));
    // Legs: thigh hip->knee, shin knee->hock, cannon hock->foot point, foot on the ground under the foot point.
    const side = new THREE.Vector3(1, 0, 0);
    const hingeZ = (LEG_TYPES[id] ?? LEG_TYPES.rampart).values.toeHinge ?? 0.14;
    (["L", "R"] as const).forEach((s, i) => {
      const L = this.legs[i];
      const hip = r["Thigh_" + s], knee = r["Shin_" + s], hock = r["Cannon_" + s], fp = r["Foot_" + s];
      const bone = (b: Bone, name: string, a: THREE.Vector3, c: THREE.Vector3) => {
        clearMeshes(b.pivot);
        this.mesh(geo[`Part_${name}_${s}`], `${name}_${s}`, b.pivot, frame(a, boneQuat(a, c, side, new THREE.Quaternion())));
        b.restLen = a.distanceTo(c);
      };
      bone(L.thigh, "Thigh", hip, knee); bone(L.shin, "Shin", knee, hock); bone(L.cannon, "Cannon", hock, fp);
      // Foot: split at the toe hinge into the heel block and the toes, so the toes bend at the ball of the foot.
      clearMeshes(L.foot); clearMeshes(L.toe);
      const [heelGeo, toeGeo] = splitAtZ(geo[`Part_Foot_${s}`], fp.z + hingeZ);
      this.mesh(heelGeo, `Foot_${s}`, L.foot, frame(new THREE.Vector3(fp.x, 0, fp.z)));
      L.toe.position.set(0, 0, hingeZ);
      this.mesh(toeGeo, `Toes_${s}`, L.toe, frame(new THREE.Vector3(fp.x, 0, fp.z + hingeZ)));
      // Its print in the sand: the sole of this foot model, baked once per look and side (src/fx/footprint.ts).
      const key = `${id}:${s}`;
      this.feet[i] = footShapeOr(key, () => bakeFootFromGeometry(key, geo[`Part_Foot_${s}`], new THREE.Vector3(fp.x, 0, fp.z)));
    });
    this.repaint();
  }

  /** The torso from a model; the guns, arms, shoulder mounts, back kit and sensor sockets move to its places. */
  private fitHull(src: Src, id: string) {
    const r = src.rest;
    this.hullLook = id;
    this.hullRest = r;
    const waist = r.Waist;
    clearMeshes(this.torso);
    const torso = this.mesh(src.geo.Part_Torso, "torso", this.torso, frame(waist));
    for (const p of this.pods) {
      const shoulder = (p.side === 1 ? r.UpperArm_L : r.UpperArm_R).clone().sub(waist);
      p.home.copy(shoulder);
      p.yawPitch.position.copy(shoulder); // a body nobody has fitted (showParts) still hangs its guns at the shoulders
      p.arm.position.copy(shoulder);
      const sm = this.shoulderMounts.find((m) => m.side === p.side)!.g;
      sm.position.copy(shoulder).add(new THREE.Vector3(Math.sign(shoulder.x || p.side) * 0.1, 0.75, -0.35));
    }
    this.back!.position.set(...(MECH_VARIANTS[id]?.backAt ?? RAMPART_BACK));
    // Sensor sockets: the Rampart's places, moved by how far this hull's nose and roof sit from the Rampart's.
    const s = torsoSurfaces(torso.geometry), S = MOUNT_STANDIN;
    this.frontAt.set(S.sensorFront[0], S.sensorFront[1], S.sensorFront[2] + s.front - RAMPART_SURFACES.front);
    this.sensorTop.position.set(S.sensorTop[0], S.sensorTop[1] + s.top - RAMPART_SURFACES.top, S.sensorTop[2]);
    this.sensorFront.position.copy(this.frontAt);
    if (this.lastParts) this.showParts(this.lastParts);
    this.repaint();
  }

  /** New meshes take the mech's current paint. */
  private repaint() {
    this.paints = null;
    if (this.lastPaint) this.paint(this.lastPaint.look, this.lastPaint.color);
  }
  /** Fit a pack's model by item base id: the stand-in box pack stays until its GLB loads (and if there is none). */
  setPack(id: string | null) {
    id = id ?? DEFAULT_PACK;
    if (id === this.packId || !this.pack || !this.look) return;
    this.packId = id;
    const slot = this.pack, look = this.look;
    void partGlb(id).then((scene) => {
      if (this.packId !== id || this.pack !== slot) return;
      slot.clear();
      slot.add(scene ? partFromGlb(scene, look) : this.packStandIn!);
      this.repaint();
    });
  }

  /** Fit a side's waist kit by item base id (null, or a drum: nothing, the drums are their own meshes): its model
   *  from public/models/parts/ once it loads; a base with no model shows nothing, as before. */
  setWaist(side: 1 | -1, id: string | null) {
    const w = this.waists.find((q) => q.side === side);
    if (!w || !this.look || id === w.kitId) return;
    w.kitId = id;
    w.kit.clear();
    if (!id || BASE_BY_ID[id]?.tags.includes("ammo")) return;
    const look = this.look;
    void partGlb(id).then((scene) => {
      if (w.kitId !== id || !scene) return;
      w.kit.clear();
      w.kit.add(partFromGlb(scene, look));
      this.repaint();
    });
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
    this.repaint();
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
      this.sensorFront.position.set(this.frontAt.x, this.frontAt.y - v.headDrop, this.frontAt.z + v.headForward);
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
    this.lastParts = parts;
    const S = MOUNT_STANDIN;
    if (parts.armId && parts.armId !== this.armId) {
      this.armId = parts.armId;
      for (const p of this.pods) if (p.ik) this.fitArm(p.ik);
    }
    for (const p of this.pods) {
      const L = p.side === 1, arm = (L ? parts.mountL : parts.mountR) === "arm";
      // An arm: the gun pivot moves down to its hand and the held weapon draws smaller; the arm shows even unarmed.
      p.yawPitch.visible = (L ? parts.gunLeft : parts.gunRight) || arm;
      p.yawPitch.position.copy(p.home);
      if (arm) p.yawPitch.position.add(new THREE.Vector3(p.side * S.armOut, -S.armDrop, S.armFwd));
      p.kick.scale.setScalar(arm ? S.heldScale : 1);
      // The gun on the fist (the pivot is the fist now: update reaches the arm to the aim), its grip in it.
      p.kickBase = arm ? new THREE.Vector3(S.gunAt[0] - S.handAt[0], S.gunAt[1] - S.handAt[1], S.gunAt[2] - S.handAt[2]) : new THREE.Vector3();
      p.kick.position.copy(p.kickBase);
      p.heldAt = p.yawPitch.position.clone(); p.armShown = arm;
      p.kick.visible = L ? parts.gunLeft : parts.gunRight;
      // The old fixed upper arm and forearm stay hidden: the two-bone arm (drawArm) is drawn instead.
      p.arm.visible = p.forearm.visible = false;
      if (arm && this.look) (p.ik ?? (p.ik = this.ikArm())).g.visible = true;
      else if (p.ik && !p.held) p.ik.g.visible = false;
    }
    for (const d of this.drums) d.visible = parts.drumsL === undefined ? parts.drums : d.userData.side === 1 ? !!parts.drumsL : !!parts.drumsR;
    if (parts.waistL !== undefined) this.setWaist(1, parts.waistL);
    if (parts.waistR !== undefined) this.setWaist(-1, parts.waistR ?? null);
    if (this.pack) this.pack.visible = parts.pack;
    if (parts.packId !== undefined && parts.pack) this.setPack(parts.packId);
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
  /**
   * Take the cockpit pod off the front of the hull (Keith 2026-11-03, the summoner's replicas: "there's no need for a
   * pilot in the center"): the fitted hull's triangles ahead of `z` (hull frame, m) within `halfWidth` of the middle go,
   * and an armour plate closes the front, in the hull's mean colour; the front sensor socket moves back onto the plate.
   * For a body whose hull won't be swapped again. Cosmetic.
   */
  dropCab(z = 0.72, halfWidth = 1.0) {
    const old = this.torso.children.find((c) => (c as THREE.Mesh).isMesh && c.name === "torso") as THREE.Mesh | undefined;
    if (!old) return;
    const src = old.geometry.index ? old.geometry.toNonIndexed() : old.geometry;
    const pos = src.attributes.position, n = pos.count, keep: number[] = [];
    let cut = 0, y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    const mean = [0, 0, 0];
    const col = src.attributes.color;
    for (let t = 0; t < n; t += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += pos.getX(t + k); cz += pos.getZ(t + k); }
      cx /= 3; cz /= 3;
      if (cz > z && Math.abs(cx) < halfWidth) {
        cut++;
        for (let k = 0; k < 3; k++) { const y = pos.getY(t + k), x = pos.getX(t + k); y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
        continue;
      }
      keep.push(t, t + 1, t + 2);
      if (col) for (let k = 0; k < 3; k++) { mean[0] += col.getX(t + k); mean[1] += col.getY(t + k); mean[2] += col.getZ(t + k); }
    }
    if (!cut) return;
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) {
      const at = a as THREE.BufferAttribute, out = new Float32Array(keep.length * at.itemSize);
      keep.forEach((v, i) => { for (let c = 0; c < at.itemSize; c++) out[i * at.itemSize + c] = at.getComponent(v, c); });
      g.setAttribute(name, new THREE.BufferAttribute(out, at.itemSize));
    }
    old.removeFromParent();
    old.geometry.dispose();
    const m = new THREE.Mesh(g);
    m.name = "torso";
    this.look!.apply(m);
    this.torso.add(m);
    // The plate over the opening (a box with the hull's mean vertex colour, so paint and bleach treat it alike).
    const kept = keep.length || 1, c = mean.map((v) => v / kept);
    const plate = new THREE.BoxGeometry(x1 - x0 + 0.06, y1 - y0 + 0.04, 0.14).translate((x0 + x1) / 2, (y0 + y1) / 2, z - 0.02);
    const pc = new Float32Array(plate.attributes.position.count * 3);
    for (let i = 0; i < pc.length; i += 3) { pc[i] = c[0]; pc[i + 1] = c[1]; pc[i + 2] = c[2]; }
    plate.setAttribute("color", new THREE.BufferAttribute(pc, 3));
    const pm = new THREE.Mesh(plate);
    pm.name = "cabPlate";
    this.look!.apply(pm);
    this.torso.add(pm);
    this.frontAt.z = z + 0.1;
    this.sensorFront.position.z = this.frontAt.z * this.torso.scale.z;
    this.paints = null;
    if (this.bleached) for (const mm of [m, pm]) { const a = mm.geometry.attributes.color as THREE.BufferAttribute; this.bleached.push({ attr: a, base: Float32Array.from(a.array as ArrayLike<number>) }); }
    this.repaint();
  }

  /** Vertex colours as modelled (bleach keeps them to work from). */
  private bleached: { attr: THREE.BufferAttribute; base: Float32Array }[] | null = null;
  /**
   * Fade the whole model's paint toward pale grey (0: as modelled, 1: fully grey and lifted): each vertex colour is
   * mixed toward its own brightness and lifted, so panel lines and shading stay. Cosmetic.
   */
  bleach(k: number) {
    if (!this.bleached) {
      this.bleached = [];
      this.root.traverse((o) => {
        const m = o as THREE.Mesh, a = m.isMesh && !m.userData.ink && !m.userData.glow ? m.geometry.attributes.color as THREE.BufferAttribute | undefined : undefined;
        if (a && !this.bleached!.some((b) => b.attr === a)) this.bleached!.push({ attr: a, base: Float32Array.from(a.array as ArrayLike<number>) });
      });
    }
    const lift = 1 + 1.3 * k;
    for (const { attr, base } of this.bleached) {
      const arr = attr.array as Float32Array, s = attr.itemSize;
      for (let i = 0; i < base.length; i += s) {
        const r = base[i], g = base[i + 1], b = base[i + 2], l = 0.3 * r + 0.59 * g + 0.11 * b;
        arr[i] = Math.min(1, (r + (l - r) * k) * lift);
        arr[i + 1] = Math.min(1, (g + (l - g) * k) * lift);
        arr[i + 2] = Math.min(1, (b + (l * 1.04 - b) * k) * lift);
      }
      attr.needsUpdate = true;
    }
  }

  /** A slimmer build of the same rig (1: as modelled). */
  private thin: RampartSlim = { leg: 1, foot: 1, hull: [1, 1, 1], gun: 1 };
  /**
   * A slimmer build on the same skeleton (Keith 2026-11-03, the summoner's replicas: "looks like my mech, but like
   * very thin ... no need for a pilot in the center. The legs can be thinner ... the weapons ... a little bit lighter"):
   * the legs' and feet's cross-section, the hull (width, height, length, about the waist; the shoulders, gun pivots and
   * sockets come in with it) and the guns scaled. The walk is the sim's, untouched. Cosmetic; call again to change.
   */
  slim(o: RampartSlim) {
    const [hx, hy, hz] = o.hull, was = this.thin, k = new THREE.Vector3(hx / was.hull[0], hy / was.hull[1], hz / was.hull[2]);
    this.thin = { ...o, hull: [hx, hy, hz] };
    this.torso.scale.set(hx, hy, hz);
    if (this.back) { this.back.scale.set(hx, hy, hz); this.back.visible = o.back ?? true; }
    for (const p of this.pods) {
      p.home.multiply(k);
      if (!p.held) p.yawPitch.position.copy(p.home);
      if (p.heldAt) p.heldAt.multiply(k);
      p.arm.position.multiply(k);
      p.yawPitch.scale.setScalar(o.gun);
    }
    for (const m of this.shoulderMounts) m.g.position.multiply(k);
    this.frontAt.multiply(k);
    this.sensorFront.position.multiply(k);
    this.sensorTop.position.multiply(k);
  }

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

  /**
   * A weapon drives this side's arm (the sword; null hands it back to the gun's aim): the held weapon's pivot goes to
   * the pose's hand with its axes, and a two-bone arm reaches from the shoulder to it (the stand-in arm is hidden).
   * Applied at once and kept until the next call (update leaves a held side alone). Cosmetic.
   */
  holdPose(side: 1 | -1, pose: HeldPose | null) {
    const p = this.pods.find((q) => q.side === side)!;
    if (!pose) {
      if (!p.held) return;
      p.held = false;
      if (p.heldAt) p.yawPitch.position.copy(p.heldAt);
      // An arm goes back to reaching for the aim (update draws it); a hull mount hides the IK arm.
      if (p.ik) p.ik.g.visible = !!p.armShown;
      return;
    }
    p.held = true;
    p.arm.visible = p.forearm.visible = false;
    const root = new THREE.Vector3(p.home.x + side * pose.out, p.home.y, p.home.z);
    const r = armIk(root, pose.hand, pose.upper, pose.fore, pose.pole);
    p.yawPitch.position.set(r.hand.x, r.hand.y, r.hand.z);
    const z = new THREE.Vector3(pose.fwd.x, pose.fwd.y, pose.fwd.z), y = new THREE.Vector3(pose.up.x, pose.up.y, pose.up.z);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    p.yawPitch.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y.crossVectors(z, x), z));
    p.kick.position.set(0, 0, 0);
    this.drawArm(p, root, r, pose.out > 0.02);
  }

  /** The two-bone arm's boxes from the shoulder (root, a stub out to it when `stub`) through the elbow to the fist. */
  private drawArm(p: PodRig, root: THREE.Vector3, r: { elbow: { x: number; y: number; z: number }; hand: { x: number; y: number; z: number } }, stub: boolean) {
    const ik = p.ik ?? (p.ik = this.ikArm());
    ik.g.visible = true;
    const e = this.tmp.e2.set(r.elbow.x, r.elbow.y, r.elbow.z), h = this.tmp.h2.set(r.hand.x, r.hand.y, r.hand.z);
    const d = this.tmp.d2;
    // The elbow's hinge (the arm's plane): each bone turns about it, so a modelled arm keeps its front to the inside of
    // the bend (the last hinge held while the arm is straight).
    const hx = AX.a.copy(e).sub(root).cross(AX.b.copy(h).sub(e));
    if (hx.lengthSq() > 1e-6) ik.hinge.copy(hx.normalize());
    const bone = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, hinged = true) => {
      d.copy(b).sub(a); const len = d.length();
      m.position.copy(a);
      d.divideScalar(Math.max(1e-6, len));
      const x = AX.x.copy(ik.hinge).addScaledVector(d, -ik.hinge.dot(d));
      if (!hinged || x.lengthSq() < 1e-6) m.quaternion.setFromUnitVectors(UP, d);
      else { x.normalize(); m.quaternion.setFromRotationMatrix(AX.m.makeBasis(x, d, AX.z.crossVectors(x, d))); }
      m.scale.set(1, len, 1);
    };
    ik.stub.visible = stub;
    if (stub) bone(ik.stub, p.home, root, false);
    ik.joint.position.copy(root);
    bone(ik.upper, root, e);
    bone(ik.fore, e, h);
    ik.elbow.position.copy(e);
    ik.elbow.quaternion.copy(ik.fore.quaternion);
    ik.hand.position.copy(h);
    ik.hand.quaternion.copy(p.yawPitch.quaternion);
  }

  /**
   * An arm holding a gun (Keith 2026-11-03: "the arm almost fully extends and points toward the target... as the arm
   * gets further back, it stretches out straighter"): the fist goes out from the shoulder along the gun's aim, a little
   * below the line, bent at the front and straighter as the aim swings out to the side (armStraightAt); the elbow
   * finds itself (two-bone IK, bending down, out and back). The gun rides the fist. Cosmetic: the sim aims the gun.
   */
  private reachArm(p: PodRig, yaw: number, pitch: number, v: UpperValues, g: UpperSim["guns"][number]) {
    const D = Math.PI / 180, cp = Math.cos(pitch);
    const u = Math.min(1, Math.max(0, (p.side * yaw) / Math.max(1e-3, v.armStraightAt * D))), s = u * u * (3 - 2 * u);
    const full = v.armUpper + v.armFore;
    let reach = full * (v.armReachFront + (v.armReachSide - v.armReachFront) * s);
    // Across the chest the fist stops armCrossIn inboard of the arm's root (it poked out past the hull's nose): the
    // reach shortens so the fist sits by the chest, the gun still on the aim.
    const inward = -p.side * Math.sin(yaw) * cp;
    if (inward * reach > v.armCrossIn) reach = Math.max(v.armFore * 0.6, v.armCrossIn / inward);
    let drop = v.armDropFront + (v.armDropSide - v.armDropFront) * s;
    // Past side-on the arm rolls over (Keith 2026-11-06: "the elbow rolls up and then the wrist kind of almost inverts
    // upside down"): bent, the elbow bending up instead of down, the forearm freer of the aim, the gun turned over on its
    // barrel, so it tracks on round to nearly straight behind.
    const roll = armRoll(p.side, yaw, v);
    reach += (full * v.armReachBack - reach) * roll;
    drop += (v.armDropBack - drop) * roll;
    // The arm's root out from the gun's shoulder point, as the sword's arm (a stub joins them).
    const o = this.tmp.o2.set(p.home.x + p.side * v.armShoulderOut, p.home.y, p.home.z);
    const hand = { x: o.x + Math.sin(yaw) * cp * reach, y: o.y - Math.sin(pitch) * reach - drop, z: o.z + Math.cos(yaw) * cp * reach };
    const r = armIk(o, hand, v.armUpper, v.armFore, { x: p.side * (v.armPoleOut + (1 - v.armPoleOut) * roll), y: -1 + (v.armPoleUp + 1) * roll, z: -v.armPoleBack * (1 - roll) });
    // The forearm turned toward the aim, in line with the gun (Keith 2026-11-04: "the forearm just point a little more
    // towards the target... the elbows could come back"): the elbow is moved toward the point a forearm's length
    // behind the fist along the aim (armAlign of the way), kept an upper arm's length from the shoulder, and the fist
    // is put a forearm's length on from it, between the IK's forearm and the aim.
    const fx = Math.sin(yaw) * cp, fy = -Math.sin(pitch), fz = Math.cos(yaw) * cp, k = v.armAlign + (v.armAlignBack - v.armAlign) * roll;
    let ex = r.elbow.x + ((r.hand.x - fx * v.armFore) - r.elbow.x) * k, ey = r.elbow.y + ((r.hand.y - fy * v.armFore) - r.elbow.y) * k, ez = r.elbow.z + ((r.hand.z - fz * v.armFore) - r.elbow.z) * k;
    const eu = v.armUpper / Math.max(1e-6, Math.hypot(ex - o.x, ey - o.y, ez - o.z));
    ex = o.x + (ex - o.x) * eu; ey = o.y + (ey - o.y) * eu; ez = o.z + (ez - o.z) * eu;
    let dx = (r.hand.x - r.elbow.x) / v.armFore, dy = (r.hand.y - r.elbow.y) / v.armFore, dz = (r.hand.z - r.elbow.z) / v.armFore;
    dx += (fx - dx) * k; dy += (fy - dy) * k; dz += (fz - dz) * k;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // The arm's kick (Keith 2026-11-04): each shot drives the fist back along the forearm, by the gun's own kick times
    // its kind's (minigun heavy, rifle less, SMG almost none).
    const cls = g.stats?.cls ?? "minigun";
    const kick = g.kick * (cls === "minigun" ? v.armKickMinigun : cls === "rifle" ? v.armKickRifle : cls === "smg" ? v.armKickSmg : v.armKickOther);
    const fore = v.armFore - Math.min(kick, v.armFore * 0.5);
    const r2 = { elbow: { x: ex - dx * kick * 0.4, y: ey - dy * kick * 0.4, z: ez - dz * kick * 0.4 }, hand: { x: 0, y: 0, z: 0 } };
    r2.hand.x = r2.elbow.x + dx * fore; r2.hand.y = r2.elbow.y + dy * fore; r2.hand.z = r2.elbow.z + dz * fore;
    const over = p.side * (o.x - r2.hand.x) - v.armCrossIn; // the align step can carry the fist a little further in
    if (over > 0) { r2.hand.x += p.side * over; r2.elbow.x += p.side * over; }
    p.yawPitch.position.set(r2.hand.x, r2.hand.y, r2.hand.z);
    p.yawPitch.rotation.set(pitch, yaw, p.side * roll * v.armRollWrist * D, "YXZ");
    this.drawArm(p, o, r2, v.armShoulderOut > 0.02);
    // Where the gun sits in the fist and how big it draws, by kind: the minigun further back (its handle up by the
    // barrels), the SMG bigger.
    const S = MOUNT_STANDIN;
    p.kick.scale.setScalar(S.heldScale * (cls === "smg" ? v.smgScale : 1));
    p.kickBase!.set(S.gunAt[0] - S.handAt[0], S.gunAt[1] - S.handAt[1], S.gunAt[2] - S.handAt[2] - (cls === "minigun" ? v.minigunGripBack : 0));
  }

  /** The two-bone arm a held pose draws: boxes along +Y (stretched to each bone), an elbow and a fist. */
  private ikArm() {
    const look = this.look!, g = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, tint: number) => { const m = new THREE.Mesh(geo); look.apply(m); look.tint(m, tint); g.add(m); return m; };
    const upper = part(new THREE.BoxGeometry(0.36, 1, 0.4).translate(0, 0.5, 0), 0x6c7546);
    const fore = part(new THREE.BoxGeometry(0.32, 1, 0.34).translate(0, 0.5, 0), 0xb7a77c);
    const elbow = part(new THREE.SphereGeometry(0.27, 10, 8), 0x3e3c35);
    const hand = part(new THREE.BoxGeometry(0.36, 0.34, 0.36), 0x3e3c35);
    const stub = part(new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, 0.5, 0), 0x3e3c35);
    const joint = part(new THREE.SphereGeometry(0.3, 10, 8), 0x6c7546);
    this.hull.add(g);
    const ik: IkArm = { g, upper, fore, elbow, hand, stub, joint, hinge: new THREE.Vector3(-1, 0, 0), id: "" };
    this.fitArm(ik);
    return ik;
  }

  /** The hull's arm model in place of the boxes (or of another hull's arm) once its GLB loads; the boxes stay without one. */
  private fitArm(ik: IkArm) {
    const id = this.armId;
    if (ik.id === id) return;
    ik.id = id;
    void partGlb(id).then((scene) => {
      if (!scene || ik.id !== id || !this.look) return;
      const m = armFromGlb(scene, this.look);
      if (!m) return;
      for (const k of ARM_PIECES) {
        const old = ik[k], next = m[k];
        next.position.copy(old.position); next.quaternion.copy(old.quaternion); next.scale.copy(old.scale); next.visible = old.visible;
        ik.g.remove(old);
        this.look.forget(old);
        ik.g.add(next);
        ik[k] = next;
      }
      this.repaint();
    });
  }

  /** The hull's frame (hull to world), current now. */
  hullFrame(out: THREE.Matrix4) {
    this.hull.updateWorldMatrix(true, false);
    return out.copy(this.hull.matrixWorld);
  }
  /** A side's shoulder in the hull's frame. */
  shoulderAt(side: 1 | -1, out: THREE.Vector3) { return out.copy(this.pods.find((q) => q.side === side)!.home); }
  /** The hull itself (things drawn in its frame hang here: the sword's trail). */
  hullGroup() { return this.hull; }

  /** Show or hide a side's minigun pod itself (another weapon's stand-in takes its place on the same pivot). */
  showPod(side: 1 | -1, on: boolean, rear = true) {
    const p = this.pods.find((q) => q.side === side)!;
    for (const o of p.kick.children) if ((o as THREE.Mesh).isMesh || o === p.spin) o.visible = on;
    p.rear.visible = on && rear;
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
    for (const { mesh, base } of this.paints) { flatPaint(mesh, color !== null); look.tint(mesh, color === null ? base : color); }
  }

  /** A drawn-only twist of the waist (radians, + the mech's left; the sword's follow-through, Keith 2026-11-01): the
   *  hull turns, the guns on it turn back by as much, so nothing aims anywhere else. Cosmetic; set by the weapons. */
  private twist = 0;
  setTwist(rad: number) { this.twist = rad; }

  update(sim: WalkerSim, upper: UpperSim) {
    const t = this.tmp;
    this.torsoYaw = upper.torsoYaw;
    const left = t.left.set(1, 0, 0).applyQuaternion(sim.pelvisQ);
    this.pelvis.position.copy(sim.pelvis);
    this.pelvis.quaternion.copy(sim.pelvisQ);

    // Hull: on the waist, turned to the torso's aim, pitched with the body, rolled only as much as it isn't kept level.
    // Leaning back (upper.lean) when the guns need more raise than they have.
    // A rolled-over arm (reaching back) leans the hull away from it, that shoulder up (Keith 2026-11-06: "if the torso
    // leans over, most shoulders can accommodate that kind of rotation"). The arms aim in the hull's frame, so they
    // stay on target.
    let armLean = 0;
    for (const p of this.pods) if (p.armShown && !p.held) armLean += p.side * armRoll(p.side, upper.guns[p.side === 1 ? 0 : 1].yaw, upper.v);
    t.e.set(sim.bodyPitch - upper.lean, upper.torsoYaw + this.twist + upper.shake * Math.sin(performance.now() * 0.09), sim.hullRoll + armLean * upper.v.armRollLean * (Math.PI / 180), "YXZ");
    this.hull.quaternion.setFromEuler(t.e);
    // The hull stands as high above the hips as on its own model.
    t.v.copy(this.hullRest.Waist).sub(new THREE.Vector3(0, this.hullRest.Thigh_L.y, 0)).applyQuaternion(sim.pelvisQ);
    this.hull.position.copy(sim.pelvis).add(t.v);

    sim.feet.forEach((f, i) => this.poseLeg(this.legs[i], f.pose, left));

    for (const p of this.pods) {
      if (p.held) continue;
      const g = upper.guns[p.side === 1 ? 0 : 1];
      if (p.armShown) {
        // The arm points where the sim aims in the world, whatever the hull is doing (Keith 2026-11-03: bent over in
        // the sprint the arms aimed off): the aim (torso yaw + the gun's, pitch below level) into the hull's own frame,
        // so the body's lean, the sprint's lean, roll and shake are all taken out.
        const yw = upper.torsoYaw + g.yaw, pw = g.pitch - upper.lean, c = Math.cos(pw);
        t.v.set(Math.sin(yw) * c, -Math.sin(pw), Math.cos(yw) * c).applyQuaternion(t.q.copy(this.hull.quaternion).invert());
        this.reachArm(p, Math.atan2(t.v.x, t.v.z), -Math.asin(Math.max(-1, Math.min(1, t.v.y))), upper.v, g);
        // The arm took the kick (reachArm): the gun rides the fist.
        p.kick.position.copy(p.kickBase!);
      } else {
        p.yawPitch.rotation.set(g.pitch, g.yaw - this.twist, 0, "YXZ");
        if (p.kickBase) p.kick.position.copy(p.kickBase); else p.kick.position.set(0, 0, 0);
        p.kick.position.z -= g.kick;
      }
      p.spin.rotation.z = g.spinAngle * -p.side;
    }
  }

  private poseLeg(L: (typeof this.legs)[number], P: LegPose, side: THREE.Vector3) {
    const set = (b: Bone, a: THREE.Vector3, c: THREE.Vector3) => {
      b.pivot.position.copy(a);
      boneQuat(a, c, side, b.pivot.quaternion);
      b.pivot.scale.set(this.thin.leg, a.distanceTo(c) / b.restLen, this.thin.leg);
    };
    set(L.thigh, P.hip, P.knee);
    set(L.shin, P.knee, P.hock);
    set(L.cannon, P.hock, P.ankle);
    L.foot.position.copy(P.foot);
    L.foot.quaternion.copy(P.footQ);
    L.foot.scale.setScalar(this.thin.foot);
    // Toe bend relative to the foot: toeQ = footQ * bend.
    L.toe.quaternion.copy(L.foot.quaternion).invert().multiply(P.toeQ);
  }

  /**
   * For a destroyed mech's wreck (src/physics/mechWreck.ts): the pivots the ragdoll moves, and the hull's box in the
   * hull's own frame (the fitted hull's meshes, measured once per hull look).
   */
  deadRig() {
    if (!this.hullBox || this.hullBoxLook !== this.hullLook) {
      this.hullBoxLook = this.hullLook;
      this.hull.updateWorldMatrix(true, true);
      const inv = this.hull.matrixWorld.clone().invert(), box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
      this.torso.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
      });
      if (box.isEmpty()) box.set(new THREE.Vector3(-1.3, 0, -1.1), new THREE.Vector3(1.3, 1.7, 1.1));
      const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.45);
      this.hullBox = { centre: { x: c.x, y: c.y, z: c.z }, half: { x: Math.max(0.3, h.x), y: Math.max(0.3, h.y), z: Math.max(0.3, h.z) } };
    }
    return {
      pelvis: this.pelvis as THREE.Object3D, hull: this.hull as THREE.Object3D, hullBox: this.hullBox,
      legs: this.legs.map((L) => ({ thigh: L.thigh.pivot as THREE.Object3D, shin: L.shin.pivot as THREE.Object3D, cannon: L.cannon.pivot as THREE.Object3D, foot: L.foot as THREE.Object3D })),
    };
  }
  private hullBox: { centre: { x: number; y: number; z: number }; half: { x: number; y: number; z: number } } | null = null;
  private hullBoxLook = "";

  /** The model's parts by region, for selection (hold V): each list is what to raycast and light up. */
  regions() {
    const legs = this.legs.flatMap((L) => [L.thigh.pivot, L.shin.pivot, L.cannon.pivot, L.foot]);
    const gun = (side: 1 | -1) => [this.pods.find((p) => p.side === side)!.yawPitch];
    return { legs, hull: [this.pelvis, this.torso], gunLeft: gun(1), gunRight: gun(-1), back: [this.back!], sensor: [this.sensorFront, this.sensorTop] };
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
    return out.copy(this.hullRest.UpperArm_L).sub(this.hullRest.Waist).setX(0).applyQuaternion(this.hull.quaternion).add(this.hull.position);
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
  mergeTinted(g, look);
  return g;
}
/** Stand-in forearm (box) from the elbow (the gun pivot) along the aim to a fist (handAt), which holds the weapon's
 *  grip; the weapon sits ahead of and above the fist (gunAt), not along the forearm. */
function armFore(look: ToonLook) {
  const g = new THREE.Group(), H = MOUNT_STANDIN.handAt;
  const len = H[2] + 0.1;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, len));
  m.position.set(0, H[1] - 0.04, H[2] - len / 2);
  look.apply(m); look.tint(m, 0xb7a77c);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.3));
  hand.position.set(H[0], H[1], H[2]);
  look.apply(hand); look.tint(hand, 0x3e3c35);
  g.add(m, hand);
  mergeTinted(g, look);
  return g;
}
/** Stand-in power pack from boxes, in the Rampart's khaki and olive (or a variant's paint), until a modelled one exists. */
function powerPack(look: ToonLook, khaki = 0xb7a77c, olive = 0x6c7546) {
  const g = new THREE.Group();
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
  mergeTinted(g, look);
  return g;
}
