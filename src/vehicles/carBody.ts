// Stand-in look for the raider vehicles: boxes and cylinders on the sim's body, wheels and turrets. Everything is
// built from the kind's tuning values (axles, track, ride height, wheel size) so it sits on the sim's contacts.
// One vertex-coloured material: the static body is one mesh, each wheel one, each turret two (yaw, pitch), so a
// pickup costs about seven draw calls and the war rig or the tank about thirteen. Swapping in modelled parts later
// means replacing these meshes, not the sim.
//
// Kinds: technical (pickup, MG on a post), gun truck (twin heavy guns), six-wheeler (three axles, an autocannon on a
// ring), war rig (the band's lead truck: cab-over hauler with a fuel tank, ram plate, a gunner on the cab roof and
// one at the back), tank (makeshift: welded plates on a tracked hull, road wheels, a big slow turret).
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { carAxles, carValues, type CarKind, type CarSim, type CarValues } from "./car";
import { LAMP_HEAD, LAMP_TAIL, type LampSpot } from "../world/lamps";

const PAL = {
  paint: 0xa8552c, // rust orange, the default body colour
  sand: 0xc9b48a,
  teal: 0x3f6b66,
  steel: 0x6b6a66,
  dark: 0x35312d,
  rust: 0x7a3a1f,
  hazard: 0xd8a019,
  glass: 0x1a1612,
  tyre: 0x232120,
  olive: 0x5d5a3c,
  bone: 0xd9cfb8,
};

const LIVE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2, flatShading: true });
const BURNT = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2b2724, roughness: 1, metalness: 0.05, flatShading: true });

type V3 = [number, number, number];

/** Collects coloured boxes and cylinders, merged into one geometry. */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();

  box(size: V3, at: V3, color: number, rot: V3 = [0, 0, 0]) {
    return this.add(new THREE.BoxGeometry(...size), at, rot, color);
  }
  /** Cylinder along its local y; `rot` turns it. */
  cyl(r: number, len: number, at: V3, color: number, rot: V3 = [0, 0, 0], seg = 8, r2 = r) {
    return this.add(new THREE.CylinderGeometry(r, r2, len, seg), at, rot, color);
  }
  /** A bar between two points. */
  bar(a: V3, b: V3, r: number, color: number) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 6);
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.m.compose(A.add(B).multiplyScalar(0.5), this.q, new THREE.Vector3(1, 1, 1));
    return this.push(g.applyMatrix4(this.m), color);
  }
  private add(g: THREE.BufferGeometry, at: V3, rot: V3, color: number) {
    this.q.setFromEuler(this.e.set(...rot));
    this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(1, 1, 1));
    return this.push(g.applyMatrix4(this.m), color);
  }
  private push(g: THREE.BufferGeometry, color: number) {
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    this.c.setHex(color);
    for (let i = 0; i < n; i++) { col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }
}

function mesh(g: THREE.BufferGeometry, parent: THREE.Object3D) {
  const m = new THREE.Mesh(g, LIVE);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

interface WheelRig { pivot: THREE.Group; spin: THREE.Mesh; mount: THREE.Vector3; side: 1 | -1 }
interface Turret { yawG: THREE.Group; pitchG: THREE.Group; muzzle: THREE.Vector3; yaw: number; pitch: number }

/** Turret look: draws the yaw part (housing) and the pitch part (gun) into the kit; returns the gun's pivot and muzzle. */
type GunLook = (k: Kit, housing: (g: THREE.BufferGeometry) => void, color: number) => { pivot: V3; muzzle: V3 };

/** Light machine gun on a post: cradle, receiver, barrel, ammo can and a small shield (the technical's). */
const lightGun: GunLook = (k, housing) => {
  k.box([0.22, 0.12, 0.3], [0, -0.06, 0], PAL.dark);
  housing(k.build());
  k.box([0.16, 0.2, 0.75], [0, 0.03, 0.05], PAL.dark);
  k.cyl(0.035, 0.9, [0, 0.05, 0.85], PAL.dark, [Math.PI / 2, 0, 0]);
  k.cyl(0.06, 0.15, [0, 0.05, 1.25], PAL.steel, [Math.PI / 2, 0, 0]);
  k.box([0.18, 0.18, 0.25], [0.17, -0.02, 0.05], PAL.teal);
  k.box([0.6, 0.38, 0.05], [0, 0.1, 0.38], PAL.steel, [-0.1, 0, 0]);
  k.box([0.05, 0.12, 0.3], [0, -0.12, -0.35], PAL.dark);
  return { pivot: [0, 0.06, 0], muzzle: [0, 0.05, 1.33] };
};

/** Armoured housing on a ring, twin heavy barrels through a mantlet (the gun truck's). */
const twinHeavy: GunLook = (k, housing, color) => {
  k.box([1.1, 0.5, 1.0], [0, 0.25, -0.1], PAL.steel);
  k.box([1.2, 0.08, 1.1], [0, 0.53, -0.1], color, [0.05, 0, 0]);
  for (const s of [1, -1]) k.box([0.08, 0.45, 0.9], [s * 0.6, 0.25, -0.1], PAL.dark, [0, 0, s * 0.2]);
  k.box([0.3, 0.3, 0.4], [0, 0.4, -0.75], PAL.hazard);
  housing(k.build());
  k.box([0.7, 0.36, 0.3], [0, 0, 0.05], PAL.dark);
  for (const s of [1, -1]) {
    k.cyl(0.07, 1.7, [s * 0.17, 0, 1.0], PAL.dark, [Math.PI / 2, 0, 0]);
    k.cyl(0.1, 0.3, [s * 0.17, 0, 1.75], PAL.steel, [Math.PI / 2, 0, 0]);
  }
  return { pivot: [0, 0.32, 0.35], muzzle: [0, 0, 1.9] };
};

/** Open shield box on a ring, one long autocannon with a muzzle brake and a drum (the six-wheeler's). */
const autocannon: GunLook = (k, housing, color) => {
  k.cyl(0.75, 0.2, [0, 0.1, 0], PAL.dark, [0, 0, 0], 10);
  k.box([1.3, 0.75, 0.12], [0, 0.55, 0.55], color, [-0.15, 0, 0]);
  for (const s of [1, -1]) k.box([0.1, 0.6, 1.0], [s * 0.66, 0.45, 0.05], PAL.steel, [0, s * 0.15, 0]);
  k.box([0.5, 0.06, 0.06], [0.3, 0.9, 0.57], PAL.hazard, [-0.15, 0, 0]);
  housing(k.build());
  k.box([0.42, 0.4, 1.0], [0, 0, -0.05], PAL.dark);
  k.cyl(0.2, 0.32, [0.32, -0.05, -0.15], PAL.olive, [0, 0, Math.PI / 2], 10);
  k.cyl(0.075, 2.3, [0, 0.03, 1.55], PAL.dark, [Math.PI / 2, 0, 0]);
  k.cyl(0.12, 0.12, [0, 0.03, 0.65], PAL.steel, [Math.PI / 2, 0, 0]);
  k.box([0.24, 0.16, 0.28], [0, 0.03, 2.75], PAL.steel);
  return { pivot: [0, 0.5, 0.05], muzzle: [0, 0.03, 2.9] };
};

/** The tank's turret: a welded box with sloped cheeks, a mantlet and a long cannon. */
const tankGun: GunLook = (k, housing, color) => {
  k.box([2.1, 0.75, 2.4], [0, 0.38, -0.25], color);
  for (const s of [1, -1]) k.box([0.12, 0.7, 2.3], [s * 1.08, 0.36, -0.25], PAL.steel, [0, 0, s * -0.3]);
  k.box([1.8, 0.12, 2.0], [0, 0.8, -0.3], PAL.rust, [0.04, 0, 0]);
  k.box([1.5, 0.55, 0.9], [0, 0.4, -1.8], PAL.dark); // bustle
  k.cyl(0.32, 0.18, [0.5, 0.92, -0.6], PAL.steel, [0, 0, 0], 8); // hatch
  k.box([0.9, 0.08, 0.6], [-0.5, 0.86, 0.2], PAL.hazard);
  for (let i = 0; i < 3; i++) k.box([0.45, 0.3, 0.3], [-0.55 + i * 0.12, 0.5, -2.35 + (i % 2) * 0.05], PAL.olive); // stowage
  k.bar([0.6, 0.95, -0.4], [0.6, 1.6, -0.4], 0.03, PAL.dark); // antenna
  housing(k.build());
  k.box([0.9, 0.6, 0.5], [0, 0, 0.15], PAL.steel);
  k.cyl(0.13, 4.2, [0, 0, 2.4], PAL.dark, [Math.PI / 2, 0, 0], 10, 0.11);
  k.cyl(0.17, 0.4, [0, 0, 1.0], PAL.olive, [Math.PI / 2, 0, 0], 10); // fume extractor
  k.box([0.38, 0.26, 0.4], [0, 0, 4.5], PAL.steel); // muzzle brake
  return { pivot: [0, 0.4, 0.95], muzzle: [0, 0, 4.75] };
};

const tmpV = new THREE.Vector3(), tmpU = new THREE.Vector3(), invQ = new THREE.Quaternion();

export class CarBody {
  readonly root = new THREE.Group();
  readonly v: CarValues;
  private chassis: THREE.Mesh;
  private turrets: Turret[] = [];
  private gunMeshes: THREE.Mesh[] = [];
  private wheels: WheelRig[] = [];
  private hubY: number;
  private wrecked = false;
  private readonly tracked: boolean;
  /** Headlights and tail lights (body frame), lit at night by src/world/nightLights.ts. */
  readonly lamps: LampSpot[] = [];

  constructor(readonly kind: CarKind, color: number = PAL.paint, values?: CarValues) {
    const v = (this.v = values ?? carValues(kind));
    this.root.name = kind;
    this.root.userData.lamps = this.lamps;
    this.tracked = v.tracked > 0.5;
    const R = v.wheelRadius, H = v.rideHeight;
    this.hubY = R - H;
    const k = new Kit();
    if (kind === "warRig") this.buildWarRig(k, color);
    else if (kind === "tank") this.buildTank(k, color);
    else this.buildTruck(k, color);
    this.chassis = mesh(k.build(), this.root);
    this.buildWheels(k);
  }

  /** How many guns it carries (the war rig two: cab roof, then the back). */
  get turretCount() { return this.turrets.length; }

  /** Pickups, gun trucks and six-wheelers: a ladder frame, hood, cab, bed, roll cage and the gun on the bed. */
  private buildTruck(k: Kit, color: number) {
    const v = this.v, kind = this.kind, T = v.track, R = v.wheelRadius, hubY = this.hubY;
    const axles = carAxles(v), zF = axles[0].z, zR = axles[axles.length - 1].z;
    const big = kind !== "technical", six = kind === "sixWheeler";
    // Ladder frame and lower hull, sitting just above the hubs.
    const base = hubY + R * 0.45;
    const w = T * 0.96;
    const front = zF + (big ? 1.05 : 0.85), back = zR - (big ? 0.85 : 0.65), len = front - back;
    k.box([T * 0.55, 0.22, len + 0.3], [0, base - 0.05, (front + back) / 2], PAL.dark);
    k.box([w, 0.5, len], [0, base + 0.3, (front + back) / 2], color);
    // Side skirts, angled in at the bottom.
    for (const s of [1, -1]) k.box([0.08, 0.42, len * 0.62], [s * (w / 2 + 0.02), base + 0.18, (zF + zR) / 2], PAL.rust, [0, 0, s * 0.25]);
    // Fenders over every wheel: angular plates.
    for (const a of axles) for (const s of [1, -1]) {
      k.box([R * 1.0, 0.07, R * 2.4], [s * (T / 2 + 0.02), hubY + R + 0.14, a.z], big ? PAL.dark : PAL.rust, [0, 0, s * 0.35]);
      k.box([R * 0.9, 0.07, R * 0.8], [s * (T / 2 + 0.02), hubY + R * 0.75, a.z + R * 1.3], PAL.dark, [0.9, 0, s * 0.35]);
    }
    const deck = base + 0.55; // top of the lower hull

    // Engine bay: hood, grille, a ram plate up front.
    const hoodLen = big ? 1.5 : 1.25, cabZ = front - hoodLen - (big ? 0.95 : 0.8);
    k.box([w * 0.88, 0.3, hoodLen], [0, deck + 0.12, front - hoodLen / 2], color, [-0.08, 0, 0]);
    k.box([w * 0.3, 0.06, hoodLen * 0.9], [w * 0.2, deck + 0.29, front - hoodLen / 2], PAL.hazard, [-0.08, 0, 0]);
    k.box([w * 0.8, 0.42, 0.12], [0, deck - 0.02, front + 0.02], PAL.dark);
    this.addLamps(w * 0.33, deck + 0.02, front + 0.1, w * 0.42, deck + 0.2, back - 0.02);
    k.box([w * 1.05, 0.38, 0.18], [0, base + 0.05, front + 0.22], PAL.steel, [0.35, 0, 0]);
    for (const s of [1, -1]) k.box([0.1, 0.5, 0.5], [s * w * 0.3, base + 0.15, front + 0.2], PAL.steel, [0.6, 0, 0]);
    // Cab: a box with a sloped windscreen and a roof plate, a colour block on the doors.
    const cabLen = big ? 1.7 : 1.45, cabH = big ? 1.0 : 0.88;
    k.box([w * 0.9, cabH, cabLen], [0, deck + cabH / 2, cabZ], color);
    k.box([w * 0.92, 0.1, cabLen + 0.2], [0, deck + cabH + 0.05, cabZ - 0.05], PAL.rust, [0.04, 0, 0]);
    k.box([w * 0.8, cabH * (big ? 0.28 : 0.5), 0.06], [0, deck + cabH * 0.62, cabZ + cabLen / 2 + 0.02], PAL.glass, [-0.3, 0, 0]);
    for (const s of [1, -1]) {
      k.box([0.05, cabH * 0.35, cabLen * 0.55], [s * (w * 0.45 + 0.01), deck + cabH * 0.68, cabZ + 0.05], PAL.glass);
      k.box([0.05, cabH * 0.4, cabLen * 0.7], [s * (w * 0.45 + 0.02), deck + cabH * 0.25, cabZ], six ? PAL.olive : big ? PAL.sand : PAL.teal);
    }
    // Exhaust stack behind the cab.
    k.cyl(0.07, cabH + 0.9, [-w * 0.42, deck + (cabH + 0.9) / 2, cabZ - cabLen / 2 - 0.1], PAL.dark);

    // Flat bed behind the cab with low sides.
    const bedFront = cabZ - cabLen / 2 - 0.12, bedLen = bedFront - back, bedZ = (bedFront + back) / 2;
    k.box([w, 0.1, bedLen], [0, deck + 0.05, bedZ], PAL.dark);
    for (const s of [1, -1]) k.box([0.07, 0.35, bedLen], [s * (w / 2 - 0.03), deck + 0.25, bedZ], big ? PAL.steel : PAL.sand);
    k.box([w, 0.35, 0.07], [0, deck + 0.25, back + 0.03], PAL.steel);
    k.box([w * 0.3, 0.08, 0.08], [w * 0.25, deck + 0.38, back + 0.03], PAL.hazard);
    // Roll cage over the cab: posts at the back of the cab, a top bar, braces to the bed.
    const cageY = deck + cabH + (big ? 0.45 : 0.35), cz = bedFront - 0.05;
    for (const s of [1, -1]) {
      const x = s * w * 0.42;
      k.bar([x, deck + 0.1, cz], [x, cageY, cz], 0.045, PAL.steel);
      k.bar([x, cageY, cz], [x * 0.95, deck + cabH + 0.12, cabZ + cabLen * 0.35], 0.04, PAL.steel);
      k.bar([x, cageY, cz], [x, deck + 0.1, cz - 0.7], 0.035, PAL.steel);
    }
    k.bar([w * 0.42, cageY, cz], [-w * 0.42, cageY, cz], 0.045, PAL.steel);

    if (big) {
      // Gun truck and six-wheeler: slat armour along the sides, a plough instead of a bumper.
      const slats = six ? 7 : 5;
      for (const s of [1, -1]) for (let i = 0; i < slats; i++) {
        k.box([0.05, 0.75, 0.12], [s * (w / 2 + 0.1), deck + 0.15, bedZ - bedLen / 2 + 0.25 + (i * (bedLen - 0.5)) / (slats - 1)], PAL.dark, [0, 0, s * 0.12]);
      }
      for (const s of [1, -1]) k.box([0.08, 0.1, bedLen], [s * (w / 2 + 0.12), deck + 0.45, bedZ], PAL.steel);
      k.box([w * 1.1, 0.55, 0.1], [0, base + 0.15, front + 0.45], PAL.rust, [0.5, 0, 0]);
    }
    if (six) {
      // Six-wheeler: jerrycans and a spare wheel on the bed, sandbags round the gun ring, a sun-bleached roof panel.
      for (let i = 0; i < 4; i++) k.box([0.18, 0.4, 0.3], [-w / 2 + 0.2, deck + 0.3, back + 0.4 + i * 0.34], i % 2 ? PAL.olive : PAL.rust);
      k.cyl(R * 0.85, 0.3, [w / 2 - 0.4, deck + 0.3, back + 0.9], PAL.tyre, [0, 0, 0], 10);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.box([0.5, 0.22, 0.3], [Math.sin(a) * 0.95, deck + 0.2, bedZ + 0.2 + Math.cos(a) * 0.95], PAL.sand, [0, a, 0]);
      }
      k.box([w * 0.7, 0.04, cabLen * 0.7], [0, deck + cabH + 0.13, cabZ], PAL.bone);
    }

    // Turret mount on the bed (static part), then the moving gun.
    const tz = bedZ + (big ? (six ? 0.2 : 0.1) : 0.15);
    if (big) {
      if (six) k.cyl(0.55, 0.5, [0, deck + 0.35, tz], PAL.dark, [0, 0, 0], 10); // pedestal: the long gun clears the cab
      k.cyl(0.8, 0.3, [0, deck + (six ? 0.65 : 0.25), tz], PAL.dark, [0, 0, 0], 12);
      this.addTurret([0, deck + (six ? 0.8 : 0.45), tz], six ? autocannon : twinHeavy, color);
    } else {
      k.cyl(0.07, 0.95, [0, deck + 0.5, tz], PAL.dark);
      k.cyl(0.25, 0.1, [0, deck + 0.12, tz], PAL.steel);
      this.addTurret([0, deck + 1.0, tz], lightGun, color);
    }
  }

  /** The war rig: a cab-over hauler with a ram plate and bull bar, a fuel tank on the back, two gunners. */
  private buildWarRig(k: Kit, color: number) {
    const v = this.v, T = v.track, R = v.wheelRadius, hubY = this.hubY;
    const axles = carAxles(v), zF = axles[0].z, zR = axles[axles.length - 1].z;
    const base = hubY + R * 0.5, w = T * 0.98;
    const front = zF + 1.5, back = zR - 1.4, len = front - back;
    // Chassis rails and a low deck the length of the truck.
    k.box([T * 0.5, 0.3, len + 0.2], [0, base, (front + back) / 2], PAL.dark);
    for (const s of [1, -1]) k.box([0.12, 0.35, len - 0.4], [s * T * 0.3, base + 0.25, (front + back) / 2], PAL.steel);
    // Fenders over every wheel, deep and dark.
    for (const a of axles) for (const s of [1, -1]) {
      k.box([R * 1.05, 0.08, R * 2.3], [s * (T / 2 + 0.02), hubY + R + 0.16, a.z], PAL.dark, [0, 0, s * 0.3]);
    }
    // Side steps and fuel tanks between the axle groups, spikes along the sides.
    const midF = axles[1].z - R - 0.25, midR = axles[2].z + R + 0.25, midZ = (midF + midR) / 2, midLen = midF - midR;
    for (const s of [1, -1]) {
      k.cyl(0.32, midLen * 0.8, [s * (w / 2 - 0.15), base + 0.15, midZ], PAL.steel, [Math.PI / 2, 0, 0], 10);
      for (let i = 0; i < 4; i++) k.cyl(0.08, 0.55, [s * (w / 2 + 0.25), base + 0.15, midR + 0.3 + (i * (midLen - 0.6)) / 3], PAL.bone, [0, 0, s * -Math.PI / 2], 5, 0.005);
    }

    // Cab over the front axles: tall, flat-fronted, slit windows behind mesh, armour plates on the doors.
    const deck = base + 0.45, cabLen = 2.3, cabH = 1.75, cabZ = front - 0.25 - cabLen / 2;
    k.box([w * 0.95, cabH, cabLen], [0, deck + cabH / 2, cabZ], color);
    k.box([w * 0.97, 0.12, cabLen + 0.15], [0, deck + cabH + 0.06, cabZ], PAL.rust);
    k.box([w * 0.8, 0.28, 0.06], [0, deck + cabH * 0.72, cabZ + cabLen / 2 + 0.02], PAL.glass);
    for (let i = 0; i < 5; i++) k.box([0.05, 0.36, 0.05], [-w * 0.36 + (i * w * 0.72) / 4, deck + cabH * 0.72, cabZ + cabLen / 2 + 0.06], PAL.dark);
    for (const s of [1, -1]) {
      k.box([0.06, 0.22, cabLen * 0.45], [s * (w * 0.475 + 0.01), deck + cabH * 0.74, cabZ + 0.3], PAL.glass);
      k.box([0.08, cabH * 0.5, cabLen * 0.8], [s * (w * 0.475 + 0.04), deck + cabH * 0.3, cabZ], PAL.steel, [0, 0, s * 0.06]);
    }
    k.box([w * 0.95, 0.06, 0.06], [0, deck + cabH * 0.5, cabZ + cabLen / 2 + 0.03], PAL.hazard);
    // Grille, bull bar and the wedge ram plate, low and out front.
    k.box([w * 0.85, 0.7, 0.1], [0, deck + 0.2, front - 0.22], PAL.dark);
    this.addLamps(w * 0.36, deck + 0.42, front - 0.14, w * 0.45, base + 0.35, back - 0.02);
    for (const s of [1, -1]) k.bar([s * w * 0.48, base + 0.1, front], [s * w * 0.3, deck + 1.0, front - 0.1], 0.07, PAL.steel);
    k.bar([w * 0.45, deck + 0.85, front - 0.05], [-w * 0.45, deck + 0.85, front - 0.05], 0.07, PAL.steel);
    k.box([w * 1.15, 0.9, 0.14], [0, base + 0.1, front + 0.35], PAL.rust, [0.55, 0, 0]);
    for (let i = 0; i < 5; i++) k.box([0.1, 0.5, 0.3], [-w * 0.48 + (i * w * 0.96) / 4, base + 0.25, front + 0.3], PAL.steel, [0.55, 0, 0]);
    // Twin exhaust stacks behind the cab.
    for (const s of [1, -1]) k.cyl(0.11, cabH + 1.3, [s * w * 0.4, deck + (cabH + 1.3) / 2, cabZ - cabLen / 2 - 0.2], PAL.dark, [0, 0, 0], 8);
    // Cab roof: a sandbagged gunner's ring (turret 0).
    k.cyl(0.6, 0.25, [0, deck + cabH + 0.2, cabZ - 0.2], PAL.dark, [0, 0, 0], 10);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      k.box([0.4, 0.2, 0.26], [Math.sin(a) * 0.85, deck + cabH + 0.2, cabZ - 0.2 + Math.cos(a) * 0.85], PAL.sand, [0, a, 0]);
    }
    this.addTurret([0, deck + cabH + 0.32, cabZ - 0.2], twinHeavy, color);

    // The tank on the back: a long cylinder on cradles, armour bands, a catwalk and a ladder, the rear gun deck.
    const tankF = cabZ - cabLen / 2 - 0.5, tankB = back + 1.7, tankL = tankF - tankB, tankZ = (tankF + tankB) / 2;
    const tankR = 0.95, tankY = deck + tankR + 0.15;
    k.cyl(tankR, tankL, [0, tankY, tankZ], PAL.steel, [Math.PI / 2, 0, 0], 12);
    k.cyl(tankR * 0.92, 0.1, [0, tankY, tankF + 0.03], PAL.dark, [Math.PI / 2, 0, 0], 12);
    for (let i = 0; i < 4; i++) k.cyl(tankR + 0.04, 0.16, [0, tankY, tankB + 0.3 + (i * (tankL - 0.6)) / 3], i % 2 ? PAL.rust : color, [Math.PI / 2, 0, 0], 12);
    for (const z of [tankF - 0.5, tankB + 0.5]) k.box([w * 0.9, 0.3, 0.3], [0, deck + 0.1, z], PAL.dark);
    k.box([0.55, 0.06, tankL * 0.9], [0, tankY + tankR + 0.03, tankZ], PAL.dark);
    k.box([w * 0.3, 0.06, tankL * 0.3], [0, tankY + tankR + 0.06, tankZ + tankL * 0.2], PAL.hazard);
    // Rear gun deck over the back axles: a raised platform, railing, a harpoon-style heavy gun (turret 1).
    // Raised so the gun clears the tank when it swings forward.
    const gunZ = back + 0.9, gunDeck = tankY + tankR - 0.2;
    k.box([w, 0.15, 1.7], [0, gunDeck, gunZ], PAL.dark);
    for (const s of [1, -1]) {
      k.box([0.12, gunDeck - deck, 1.6], [s * w * 0.42, (gunDeck + deck) / 2, gunZ], PAL.steel);
      k.bar([s * w * 0.48, gunDeck, back + 0.1], [s * w * 0.48, gunDeck + 0.75, back + 0.1], 0.04, PAL.steel);
      k.bar([s * w * 0.48, gunDeck + 0.75, back + 0.1], [s * w * 0.48, gunDeck + 0.75, gunZ + 0.8], 0.04, PAL.steel);
    }
    k.bar([w * 0.48, gunDeck + 0.75, back + 0.1], [-w * 0.48, gunDeck + 0.75, back + 0.1], 0.04, PAL.steel);
    k.box([w, 0.5, 0.12], [0, base + 0.2, back + 0.05], PAL.rust);
    for (const s of [1, -1]) k.box([0.25, 0.12, 0.06], [s * w * 0.35, base + 0.3, back - 0.02], 0xb02818);
    k.cyl(0.55, 0.2, [0, gunDeck + 0.15, gunZ], PAL.dark, [0, 0, 0], 10);
    this.addTurret([0, gunDeck + 0.25, gunZ], autocannon, color);
  }

  /** The tank: a welded hull between two track runs, sponsons, junk armour, a big turret. */
  private buildTank(k: Kit, color: number) {
    const v = this.v, T = v.track, R = v.wheelRadius, hubY = this.hubY;
    const axles = carAxles(v), zF = axles[0].z, zR = axles[axles.length - 1].z;
    const trackW = 0.6, front = zF + 1.0, back = zR - 0.8, len = front - back;
    const belly = hubY + 0.05, hullH = 1.0, top = belly + hullH, mid = (front + back) / 2;
    const hw = T - trackW - 0.1; // hull width between the tracks
    // Hull and the sloped glacis and rear plate.
    k.box([hw, hullH, len - 1.0], [0, belly + hullH / 2, mid - 0.2], color);
    k.box([hw, 0.12, 1.6], [0, top - 0.32, front - 0.65], PAL.steel, [-0.5, 0, 0]);
    k.box([hw, 0.6, 0.12], [0, belly + 0.3, front - 0.35], PAL.dark, [0.8, 0, 0]);
    k.box([hw, 0.9, 0.12], [0, belly + 0.5, back + 0.25], PAL.steel, [-0.3, 0, 0]);
    // Deck over hull and tracks, with engine grilles and junk.
    k.box([T + trackW - 0.05, 0.1, len - 0.9], [0, top, mid - 0.3], PAL.rust);
    for (let i = 0; i < 4; i++) k.box([hw * 0.7, 0.04, 0.12], [0, top + 0.07, back + 0.5 + i * 0.25], PAL.dark);
    for (const s of [1, -1]) {
      const x = s * (T / 2);
      // Track runs: the top run, sloped runs down to the idler at the front and the sprocket at the back.
      k.box([trackW, 0.1, zF - zR + 0.2], [x, hubY + R + 0.06, (zF + zR) / 2], PAL.tyre);
      k.bar([x, hubY + R + 0.06, zF + 0.1], [x, hubY + 0.2, front - 0.25], 0.06, PAL.tyre);
      k.bar([x, hubY + R + 0.06, zR - 0.1], [x, hubY + 0.15, back + 0.2], 0.06, PAL.tyre);
      k.cyl(0.32, trackW, [x, hubY + 0.2, front - 0.3], PAL.dark, [0, 0, Math.PI / 2], 10);
      k.cyl(0.36, trackW, [x, hubY + 0.15, back + 0.3], PAL.steel, [0, 0, Math.PI / 2], 8);
      // Side skirts: mismatched welded plates hanging over the upper track run.
      const plates = 4;
      for (let i = 0; i < plates; i++) {
        const pl = (len - 1.2) / plates, pz = back + 0.6 + pl * (i + 0.5);
        const c = [PAL.steel, color, PAL.olive, PAL.rust][(i + (s > 0 ? 0 : 2)) % 4];
        k.box([0.08, 0.55 + (i % 2) * 0.12, pl * 0.98], [s * (T / 2 + trackW / 2 + 0.05), hubY + R + 0.05, pz], c, [(i % 2 ? 0.03 : -0.02), 0, s * 0.08]);
      }
      // Spare track links, a jerrycan and a tow cable on the sides of the hull top.
      k.box([0.45, 0.08, 0.9], [s * hw * 0.32, top + 0.08, front - 1.3], PAL.tyre, [-0.5, 0, 0]);
      k.box([0.2, 0.35, 0.28], [s * (hw / 2 - 0.15), top + 0.22, back + 0.3], s > 0 ? PAL.olive : PAL.rust);
    }
    // Headlights with guards and a dozer-ish plough on the front.
    for (const s of [1, -1]) k.cyl(0.1, 0.12, [s * hw * 0.38, top + 0.05, front - 0.1], PAL.bone, [Math.PI / 2, 0, 0], 6);
    this.addLamps(hw * 0.38, top + 0.05, front - 0.04, hw * 0.4, top - 0.1, back - 0.02);
    k.box([T + 0.2, 0.55, 0.1], [0, hubY + 0.2, front + 0.25], PAL.steel, [0.55, 0, 0]);
    for (const s of [1, -1]) k.bar([s * T * 0.42, hubY + 0.2, front + 0.2], [s * T * 0.3, belly + 0.4, front - 0.4], 0.06, PAL.dark);
    // Turret ring, then the turret (slow to turn: the war band sets its turn rate).
    const tz = mid + 0.15;
    k.cyl(1.0, 0.2, [0, top + 0.12, tz], PAL.dark, [0, 0, 0], 12);
    this.addTurret([0, top + 0.2, tz], tankGun, color);
  }

  /** A pair of headlights at (±x, y, z) looking ahead onto the sand, a pair of tail lights at (±tx, ty, tz). No extra
   * geometry (the glows show them): every geometry draws a uuid from Math.random, which the seeded warband check shares. */
  private addLamps(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    for (const s of [1, -1]) {
      this.lamps.push({ kind: LAMP_HEAD, p: [s * x, y, z + 0.06], d: [0, -0.04, 1], ground: true });
      this.lamps.push({ kind: LAMP_TAIL, p: [s * tx, ty, tz - 0.04] });
    }
  }

  /** A turret at `at` on the body: the gun look builds its yaw (housing) and pitch (gun) meshes in its own kit. */
  private addTurret(at: V3, look: GunLook, color: number) {
    const k = new Kit();
    const yawG = new THREE.Group(), pitchG = new THREE.Group();
    yawG.position.set(...at);
    this.root.add(yawG);
    yawG.add(pitchG);
    const { pivot, muzzle } = look(k, (g) => this.gunMeshes.push(mesh(g, yawG)), color);
    pitchG.position.set(...pivot);
    this.gunMeshes.push(mesh(k.build(), pitchG));
    this.turrets.push({ yawG, pitchG, muzzle: new THREE.Vector3(...muzzle), yaw: 0, pitch: 0 });
  }

  /** Wheels (or road wheels): tyre, a hub on the outside and a few lugs so the roll reads. */
  private buildWheels(k: Kit) {
    const v = this.v, R = v.wheelRadius, T = v.track, kind = this.kind;
    const tyreW = this.tracked ? 0.5 : kind === "technical" ? 0.36 : kind === "warRig" ? 0.6 : 0.5;
    const wheelGeo = (side: 1 | -1) => {
      if (this.tracked) {
        // Road wheel: a steel disc with a rubber rim, the track's links under it, a hub and two lugs.
        k.cyl(R, tyreW, [0, 0, 0], PAL.tyre, [0, 0, Math.PI / 2], 12);
        k.cyl(R * 0.8, tyreW + 0.03, [0, 0, 0], PAL.steel, [0, 0, Math.PI / 2], 10);
        k.cyl(R * 0.3, tyreW + 0.08, [side * 0.02, 0, 0], PAL.dark, [0, 0, Math.PI / 2], 6);
        for (let i = 0; i < 2; i++) k.box([0.05, R * 1.2, 0.07], [side * (tyreW / 2 + 0.03), 0, 0], i === 0 ? PAL.hazard : PAL.dark, [(i * Math.PI) / 2, 0, 0]);
        return k.build();
      }
      k.cyl(R, tyreW, [0, 0, 0], PAL.tyre, [0, 0, Math.PI / 2], 12);
      k.cyl(R * 0.5, tyreW + 0.04, [side * 0.02, 0, 0], PAL.steel, [0, 0, Math.PI / 2], 6);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        k.box([0.06, R * 0.9, 0.08], [side * (tyreW / 2 + 0.03), 0, 0], i === 0 ? PAL.hazard : PAL.dark, [a, 0, 0]);
      }
      return k.build();
    };
    const geoL = wheelGeo(1), geoR = wheelGeo(-1);
    for (const a of carAxles(v)) {
      for (const side of [1, -1] as const) {
        const mount = new THREE.Vector3(side * T / 2, this.hubY, a.z);
        const pivot = new THREE.Group();
        pivot.position.copy(mount);
        this.root.add(pivot);
        const spin = mesh(side === 1 ? geoL : geoR, pivot);
        this.wheels.push({ pivot, spin, mount, side });
      }
    }
  }

  /** Turret angles relative to the body, radians (yaw + left, pitch + up), for turret 0; others with `aim`. */
  update(sim: CarSim, turretYaw: number, turretPitch: number) {
    const v = this.v;
    this.root.position.copy(sim.pos);
    this.root.quaternion.copy(sim.quat);
    invQ.copy(sim.quat).invert();
    tmpU.set(0, 1, 0).applyQuaternion(sim.quat);
    const n = Math.min(this.wheels.length, sim.wheels.length);
    for (let i = 0; i < n; i++) {
      const w = this.wheels[i], s = sim.wheels[i];
      // Hub = contact + body up * radius, in body space; only its height moves (the mount keeps x and z).
      tmpV.copy(s.pos).addScaledVector(tmpU, v.wheelRadius).sub(sim.pos).applyQuaternion(invQ);
      const y = Math.min(this.hubY + v.travel + 0.05, Math.max(this.hubY - v.droop - 0.05, tmpV.y));
      w.pivot.position.set(w.mount.x, Number.isFinite(y) ? y : this.hubY, w.mount.z);
      if (this.wrecked) continue;
      w.pivot.rotation.set(0, s.steer, 0);
      w.spin.rotation.x = s.spin;
    }
    if (!this.wrecked) this.aim(0, turretYaw, turretPitch);
    for (const t of this.turrets) {
      t.yawG.rotation.y = t.yaw;
      t.pitchG.rotation.x = -t.pitch;
    }
    this.root.updateMatrixWorld(true);
  }

  /** Set a turret's angles relative to the body (radians, yaw + left, pitch + up); applied on the next update. */
  aim(i: number, yaw: number, pitch: number) {
    const t = this.turrets[i];
    if (!t || this.wrecked) return;
    t.yaw = yaw; t.pitch = pitch;
  }

  /** World position of a turret's muzzle (between the barrels on twin guns). */
  muzzle(out = new THREE.Vector3(), i = 0) {
    const t = this.turrets[Math.min(i, this.turrets.length - 1)];
    return t.pitchG.localToWorld(out.copy(t.muzzle));
  }

  /** World unit direction a turret's gun points. */
  barrel(out = new THREE.Vector3(), i = 0) {
    const t = this.turrets[Math.min(i, this.turrets.length - 1)];
    return out.set(0, 0, 1).transformDirection(t.pitchG.matrixWorld);
  }

  /** Where a turret sits on the body (body frame), e.g. to tell which way it can see. */
  turretMount(i: number, out = new THREE.Vector3()) {
    return out.copy(this.turrets[Math.min(i, this.turrets.length - 1)].yawG.position);
  }

  meshes(): THREE.Mesh[] {
    return [this.chassis, ...this.gunMeshes, ...this.wheels.map((w) => w.spin)];
  }

  /** Burnt-out look: dark, wheels splayed (road wheels stay on their tracks), the guns slumped and still. */
  setWrecked(on: boolean) {
    this.wrecked = on;
    this.root.userData.lampsOff = on;
    for (const m of this.meshes()) m.material = on ? BURNT : LIVE;
    this.wheels.forEach((w, i) => {
      if (on && !this.tracked) w.pivot.rotation.set(0, (i === 1 ? 0.3 : 0), w.side * (i === 2 ? 0.45 : i > 3 && i === this.wheels.length - 1 ? 0.3 : 0.18));
      else w.pivot.rotation.set(0, 0, 0);
    });
    if (on) for (const t of this.turrets) t.pitch = this.kind === "tank" ? -0.12 : -0.3;
  }
}
