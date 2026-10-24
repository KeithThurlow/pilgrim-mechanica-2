// Stand-in look for the raider vehicles: boxes and cylinders on the sim's body, wheels and turret. Everything is
// built from the kind's tuning values (wheelbase, track, ride height, wheel size) so it sits on the sim's contacts.
// One vertex-coloured material: the static body is one mesh, each wheel one, the turret two (yaw, pitch), so a truck
// costs about seven draw calls. Swapping in modelled parts later means replacing these meshes, not the sim.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { carValues, type CarKind, type CarSim, type CarValues } from "./car";

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

const tmpV = new THREE.Vector3(), tmpU = new THREE.Vector3(), invQ = new THREE.Quaternion();

export class CarBody {
  readonly root = new THREE.Group();
  readonly v: CarValues;
  private chassis: THREE.Mesh;
  private yawG = new THREE.Group();
  private pitchG = new THREE.Group();
  private gunMeshes: THREE.Mesh[] = [];
  private wheels: WheelRig[] = [];
  private muzzleLocal = new THREE.Vector3();
  private hubY: number;
  private wrecked = false;
  private frozen = { yaw: 0, pitch: 0 };

  constructor(readonly kind: CarKind, color: number = PAL.paint, values?: CarValues) {
    const v = (this.v = values ?? carValues(kind));
    this.root.name = kind;
    const L = v.wheelbase, T = v.track, R = v.wheelRadius, H = v.rideHeight;
    const hubY = (this.hubY = R - H);
    const big = kind === "gunTruck";
    const k = new Kit();

    // Ladder frame and lower hull, sitting just above the hubs.
    const base = hubY + R * 0.45;
    const len = L + (big ? 1.9 : 1.5), w = T * 0.96;
    const front = L / 2 + (big ? 1.05 : 0.85), back = -L / 2 - (big ? 0.85 : 0.65);
    k.box([T * 0.55, 0.22, len + 0.3], [0, base - 0.05, (front + back) / 2], PAL.dark);
    k.box([w, 0.5, len], [0, base + 0.3, (front + back) / 2], color);
    // Side skirts, angled in at the bottom.
    for (const s of [1, -1]) k.box([0.08, 0.42, len * 0.62], [s * (w / 2 + 0.02), base + 0.18, 0], PAL.rust, [0, 0, s * 0.25]);
    // Fenders over every wheel: angular plates.
    for (const z of [L / 2, -L / 2]) for (const s of [1, -1]) {
      k.box([R * 1.0, 0.07, R * 2.4], [s * (T / 2 + 0.02), hubY + R + 0.14, z], big ? PAL.dark : PAL.rust, [0, 0, s * 0.35]);
      k.box([R * 0.9, 0.07, R * 0.8], [s * (T / 2 + 0.02), hubY + R * 0.75, z + R * 1.3], PAL.dark, [0.9, 0, s * 0.35]);
    }
    const deck = base + 0.55; // top of the lower hull

    // Engine bay: hood, grille, a ram plate up front.
    const hoodLen = big ? 1.5 : 1.25, cabZ = front - hoodLen - (big ? 0.95 : 0.8);
    k.box([w * 0.88, 0.3, hoodLen], [0, deck + 0.12, front - hoodLen / 2], color, [-0.08, 0, 0]);
    k.box([w * 0.3, 0.06, hoodLen * 0.9], [w * 0.2, deck + 0.29, front - hoodLen / 2], PAL.hazard, [-0.08, 0, 0]);
    k.box([w * 0.8, 0.42, 0.12], [0, deck - 0.02, front + 0.02], PAL.dark);
    k.box([w * 1.05, 0.38, 0.18], [0, base + 0.05, front + 0.22], PAL.steel, [0.35, 0, 0]);
    for (const s of [1, -1]) k.box([0.1, 0.5, 0.5], [s * w * 0.3, base + 0.15, front + 0.2], PAL.steel, [0.6, 0, 0]);
    // Cab: a box with a sloped windscreen and a roof plate, a colour block on the doors.
    const cabLen = big ? 1.7 : 1.45, cabH = big ? 1.0 : 0.88;
    k.box([w * 0.9, cabH, cabLen], [0, deck + cabH / 2, cabZ], color);
    k.box([w * 0.92, 0.1, cabLen + 0.2], [0, deck + cabH + 0.05, cabZ - 0.05], PAL.rust, [0.04, 0, 0]);
    k.box([w * 0.8, cabH * (big ? 0.28 : 0.5), 0.06], [0, deck + cabH * 0.62, cabZ + cabLen / 2 + 0.02], PAL.glass, [-0.3, 0, 0]);
    for (const s of [1, -1]) {
      k.box([0.05, cabH * 0.35, cabLen * 0.55], [s * (w * 0.45 + 0.01), deck + cabH * 0.68, cabZ + 0.05], PAL.glass);
      k.box([0.05, cabH * 0.4, cabLen * 0.7], [s * (w * 0.45 + 0.02), deck + cabH * 0.25, cabZ], big ? PAL.sand : PAL.teal);
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
      // Gun truck: slat armour along the sides, a plough instead of a bumper.
      for (const s of [1, -1]) for (let i = 0; i < 5; i++) {
        k.box([0.05, 0.75, 0.12], [s * (w / 2 + 0.1), deck + 0.15, bedZ - bedLen / 2 + 0.25 + (i * (bedLen - 0.5)) / 4], PAL.dark, [0, 0, s * 0.12]);
      }
      for (const s of [1, -1]) k.box([0.08, 0.1, bedLen], [s * (w / 2 + 0.12), deck + 0.45, bedZ], PAL.steel);
      k.box([w * 1.1, 0.55, 0.1], [0, base + 0.15, front + 0.45], PAL.rust, [0.5, 0, 0]);
    }

    // Turret mount on the bed (static part), then the moving gun.
    const tz = bedZ + (big ? 0.1 : 0.15);
    let pivotY: number;
    if (big) {
      k.cyl(0.8, 0.3, [0, deck + 0.25, tz], PAL.dark, [0, 0, 0], 12);
      pivotY = deck + 0.45;
    } else {
      k.cyl(0.07, 0.95, [0, deck + 0.5, tz], PAL.dark);
      k.cyl(0.25, 0.1, [0, deck + 0.12, tz], PAL.steel);
      pivotY = deck + 1.0;
    }
    this.chassis = mesh(k.build(), this.root);

    this.yawG.position.set(0, pivotY, tz);
    this.root.add(this.yawG);
    this.yawG.add(this.pitchG);
    if (big) {
      // Armoured housing on the ring, twin heavy barrels through a mantlet.
      k.box([1.1, 0.5, 1.0], [0, 0.25, -0.1], PAL.steel);
      k.box([1.2, 0.08, 1.1], [0, 0.53, -0.1], color, [0.05, 0, 0]);
      for (const s of [1, -1]) k.box([0.08, 0.45, 0.9], [s * 0.6, 0.25, -0.1], PAL.dark, [0, 0, s * 0.2]);
      k.box([0.3, 0.3, 0.4], [0, 0.4, -0.75], PAL.hazard);
      this.gunMeshes.push(mesh(k.build(), this.yawG));
      this.pitchG.position.set(0, 0.32, 0.35);
      k.box([0.7, 0.36, 0.3], [0, 0, 0.05], PAL.dark);
      for (const s of [1, -1]) {
        k.cyl(0.07, 1.7, [s * 0.17, 0, 1.0], PAL.dark, [Math.PI / 2, 0, 0]);
        k.cyl(0.1, 0.3, [s * 0.17, 0, 1.75], PAL.steel, [Math.PI / 2, 0, 0]);
      }
      this.muzzleLocal.set(0, 0, 1.9);
    } else {
      // Light machine gun on a post: cradle, receiver, barrel, ammo can and a small shield.
      k.box([0.22, 0.12, 0.3], [0, -0.06, 0], PAL.dark);
      this.gunMeshes.push(mesh(k.build(), this.yawG));
      this.pitchG.position.set(0, 0.06, 0);
      k.box([0.16, 0.2, 0.75], [0, 0.03, 0.05], PAL.dark);
      k.cyl(0.035, 0.9, [0, 0.05, 0.85], PAL.dark, [Math.PI / 2, 0, 0]);
      k.cyl(0.06, 0.15, [0, 0.05, 1.25], PAL.steel, [Math.PI / 2, 0, 0]);
      k.box([0.18, 0.18, 0.25], [0.17, -0.02, 0.05], PAL.teal);
      k.box([0.6, 0.38, 0.05], [0, 0.1, 0.38], PAL.steel, [-0.1, 0, 0]);
      k.box([0.05, 0.12, 0.3], [0, -0.12, -0.35], PAL.dark);
      this.muzzleLocal.set(0, 0.05, 1.33);
    }
    this.gunMeshes.push(mesh(k.build(), this.pitchG));

    // Wheels: tyre, a hub on the outside and a few lugs so the roll reads.
    const tyreW = big ? 0.5 : 0.36;
    const wheelGeo = (side: 1 | -1) => {
      k.cyl(R, tyreW, [0, 0, 0], PAL.tyre, [0, 0, Math.PI / 2], 12);
      k.cyl(R * 0.5, tyreW + 0.04, [side * 0.02, 0, 0], PAL.steel, [0, 0, Math.PI / 2], 6);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        k.box([0.06, R * 0.9, 0.08], [side * (tyreW / 2 + 0.03), 0, 0], i === 0 ? PAL.hazard : PAL.dark, [a, 0, 0]);
      }
      return k.build();
    };
    const geoL = wheelGeo(1), geoR = wheelGeo(-1);
    for (let i = 0; i < 4; i++) {
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const mount = new THREE.Vector3(side * T / 2, hubY, i < 2 ? L / 2 : -L / 2);
      const pivot = new THREE.Group();
      pivot.position.copy(mount);
      this.root.add(pivot);
      const spin = mesh(side === 1 ? geoL : geoR, pivot);
      this.wheels.push({ pivot, spin, mount, side });
    }
  }

  /** Turret angles relative to the body, radians (yaw + left, pitch + up). */
  update(sim: CarSim, turretYaw: number, turretPitch: number) {
    const v = this.v;
    this.root.position.copy(sim.pos);
    this.root.quaternion.copy(sim.quat);
    invQ.copy(sim.quat).invert();
    tmpU.set(0, 1, 0).applyQuaternion(sim.quat);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], s = sim.wheels[i];
      // Hub = contact + body up * radius, in body space; only its height moves (the mount keeps x and z).
      tmpV.copy(s.pos).addScaledVector(tmpU, v.wheelRadius).sub(sim.pos).applyQuaternion(invQ);
      const y = Math.min(this.hubY + v.travel + 0.05, Math.max(this.hubY - v.droop - 0.05, tmpV.y));
      w.pivot.position.set(w.mount.x, Number.isFinite(y) ? y : this.hubY, w.mount.z);
      if (this.wrecked) continue;
      w.pivot.rotation.set(0, s.steer, 0);
      w.spin.rotation.x = s.spin;
    }
    if (!this.wrecked) { this.frozen.yaw = turretYaw; this.frozen.pitch = turretPitch; }
    this.yawG.rotation.y = this.frozen.yaw;
    this.pitchG.rotation.x = -this.frozen.pitch;
    this.root.updateMatrixWorld(true);
  }

  /** World position of the gun's muzzle (between the barrels on the gun truck). */
  muzzle(out = new THREE.Vector3()) {
    return this.pitchG.localToWorld(out.copy(this.muzzleLocal));
  }

  /** World unit direction the gun points. */
  barrel(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).transformDirection(this.pitchG.matrixWorld);
  }

  meshes(): THREE.Mesh[] {
    return [this.chassis, ...this.gunMeshes, ...this.wheels.map((w) => w.spin)];
  }

  /** Burnt-out look: dark, wheels splayed, the gun slumped and still. */
  setWrecked(on: boolean) {
    this.wrecked = on;
    for (const m of this.meshes()) m.material = on ? BURNT : LIVE;
    this.wheels.forEach((w, i) => {
      if (on) w.pivot.rotation.set(0, (i === 1 ? 0.3 : 0), w.side * (i === 2 ? 0.45 : 0.18));
      else w.pivot.rotation.set(0, 0, 0);
    });
    if (on) this.frozen.pitch = -0.3;
  }
}
