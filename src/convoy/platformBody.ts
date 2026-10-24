// Stand-in look for the convoy's platforms and cranes: decks, rails, big wheels or tracks, cabs, containers and huts,
// deck markings (the mech bay, deploy zones on the deck edges), and the crane (mast, turret, jib, rope, cradle).
// Static parts of each platform are one merged vertex-coloured mesh; each wheel spins on its own; the crane's turret
// rides the platform and its jib, rope and cradle are placed in the world from the crane sim. Swapping in modelled
// platforms later means replacing these meshes, not the sims.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Platform } from "./platform";
import type { Crane } from "./crane";
import type { CarryValues } from "./carry";
import type { CraneValues } from "./crane";
import { RAIL } from "./carry";

const PAL = {
  steel: 0x6e6b64,
  deck: 0x55524c,
  dark: 0x302d29,
  tyre: 0x232120,
  hub: 0x8a857a,
  rust: 0x8a4a2a,
  teal: 0x4f6f6a,
  sand: 0xb9a27a,
  bone: 0xcfc6b2,
  hazard: 0xd8a019,
  orange: 0xd0642a,
  glass: 0x1a1612,
  red: 0x8f3b2a,
  ochre: 0xb08a3e,
};
const KIND_PAINT = { bay: 0x7a7458, workshop: PAL.teal, housing: PAL.sand, fuel: PAL.rust } as const;

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2, flatShading: true });
const ROPE = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.6, metalness: 0.4 });

type V3 = [number, number, number];

/** Collects coloured boxes and cylinders, merged into one geometry. */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();
  box(size: V3, at: V3, color: number, rot: V3 = [0, 0, 0]) { return this.add(new THREE.BoxGeometry(...size), at, rot, color); }
  /** Cylinder along its local y; `rot` turns it. */
  cyl(r: number, len: number, at: V3, color: number, rot: V3 = [0, 0, 0], seg = 10) { return this.add(new THREE.CylinderGeometry(r, r, len, seg), at, rot, color); }
  private add(g: THREE.BufferGeometry, at: V3, rot: V3, color: number) {
    this.q.setFromEuler(this.e.set(...rot));
    this.m.compose(new THREE.Vector3(...at), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    this.c.setHex(color);
    for (let i = 0; i < n; i++) { col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // Merging needs matching attributes: drop uvs everywhere.
    g.deleteAttribute("uv");
    this.parts.push(g.index ? g.toNonIndexed() : g);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }
}

function mesh(g: THREE.BufferGeometry, parent: THREE.Object3D, mat: THREE.Material = MAT) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

interface Wheel { mesh: THREE.Mesh; r: number }

export class PlatformBody {
  /** Rides the platform (local frame: x left, y up, z forward). */
  readonly root = new THREE.Group();
  private hull: THREE.Mesh | null = null;
  private wheels: Wheel[] = [];
  private built = "";
  private m = new THREE.Matrix4();

  constructor(readonly platform: Platform, private carry: (CarryValues & CraneValues) | null) {
    this.root.matrixAutoUpdate = false;
    this.root.name = platform.spec.name;
  }

  /** Meshes for hold-V selection. */
  meshes(): THREE.Object3D[] { return [this.root]; }

  update() {
    const p = this.platform;
    const key = `${p.deck}|${this.carry?.craneBaySlot}|${this.carry?.craneMount}`;
    if (key !== this.built) { this.build(); this.built = key; }
    this.m.makeBasis(new THREE.Vector3(p.left.x, p.left.y, p.left.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.fwd.x, p.fwd.y, p.fwd.z));
    this.m.setPosition(p.x, p.y, p.z);
    this.root.matrix.copy(this.m);
    this.root.matrixWorldNeedsUpdate = true;
    for (const w of this.wheels) w.mesh.rotation.x = p.travelled / w.r;
  }

  private build() {
    if (this.hull) { this.root.remove(this.hull); this.hull.geometry.dispose(); }
    for (const w of this.wheels) { this.root.remove(w.mesh); w.mesh.geometry.dispose(); }
    this.wheels = [];
    const p = this.platform, { length: L, width: W, tracked, kind } = p.spec, D = p.deck;
    const k = new Kit(), paint = KIND_PAINT[kind];

    // Deck plate, chassis and skirts.
    k.box([W, 0.35, L], [0, D - 0.175, 0], PAL.deck);
    k.box([W - 0.3, 0.6, L - 0.3], [0, D - 0.65, 0], paint);
    k.box([W * 0.55, 1.2, L * 0.9], [0, D - 1.4, 0], PAL.dark);
    // Deck seams.
    for (let z = -L / 2 + 4; z < L / 2 - 1; z += 4) k.box([W - 0.4, 0.04, 0.12], [0, D + 0.02, z], PAL.dark);

    // Rails along both sides and the back, posts every ~3 m; gaps at the deploy zones on the bay.
    const railY = [D + RAIL * 0.5, D + RAIL];
    const deployZ = this.carry && kind === "bay" ? this.carry.craneMount : null;
    for (const sx of [1, -1]) {
      const x = sx * (W / 2 - 0.1);
      const segs: [number, number][] = deployZ === null ? [[-L / 2, L / 2]] : [[-L / 2, deployZ - 4], [deployZ + 4, L / 2]];
      for (const [z0, z1] of segs) {
        if (z1 - z0 < 0.5) continue;
        for (const y of railY) k.box([0.08, 0.08, z1 - z0], [x, y, (z0 + z1) / 2], PAL.hazard);
        for (let z = z0; z <= z1 + 0.01; z += Math.max(1.5, (z1 - z0) / Math.max(1, Math.round((z1 - z0) / 3)))) k.box([0.1, RAIL, 0.1], [x, D + RAIL / 2, z], PAL.steel);
      }
      if (deployZ !== null) {
        // Deploy zone: hazard stripes on the deck edge where the crane swings the mech out.
        for (let i = 0; i < 8; i++) k.box([1.6, 0.05, 0.45], [x - sx * 0.9, D + 0.03, deployZ - 3.5 + i], i % 2 ? PAL.dark : PAL.orange, [0, sx * 0.5, 0]);
      }
    }
    for (const y of railY) k.box([W - 0.2, 0.08, 0.08], [0, y, -L / 2 + 0.1], PAL.hazard);

    // Running gear.
    if (tracked) {
      for (const sx of [1, -1]) {
        const x = sx * (W / 2 - 1.6);
        k.box([2.2, 0.35, L * 0.84], [x, 2.25, 0], PAL.tyre);
        k.box([2.2, 0.35, L * 0.84], [x, 0.18, 0], PAL.tyre);
        k.box([1.6, 1.8, L * 0.86], [x, 1.2, 0], PAL.dark);
        for (const sz of [1, -1]) k.cyl(1.2, 2.2, [x, 1.2, sz * L * 0.42], PAL.tyre, [0, 0, Math.PI / 2], 14);
        // Road wheels, visible on the outside face.
        for (let i = 0; i < 7; i++) k.cyl(0.6, 2.3, [x, 0.8, -L * 0.36 + (L * 0.72 * i) / 6], PAL.hub, [0, 0, Math.PI / 2], 10);
        // Track guards.
        k.box([2.6, 0.2, L * 0.92], [x, 2.6, 0], paint);
      }
    } else {
      for (const sx of [1, -1]) for (const sz of [0.36, 0, -0.36]) {
        const r = 1.3, g = new Kit();
        g.cyl(r, 0.9, [0, 0, 0], PAL.tyre, [0, 0, Math.PI / 2], 16);
        g.cyl(r * 0.55, 0.95, [0, 0, 0], PAL.hub, [0, 0, Math.PI / 2], 8);
        g.box([0.96, 0.25, r * 1.6], [0, 0, 0], PAL.dark);
        const w = mesh(g.build(), this.root);
        w.position.set(sx * (W / 2 - 0.7), r, sz * L);
        this.wheels.push({ mesh: w, r });
      }
    }

    // Cab at the front.
    const cabZ = L / 2 - 2;
    k.box([Math.min(W - 1, 6), 2.4, 3], [0, D + 1.2, cabZ], paint);
    k.box([Math.min(W - 1.2, 5.6), 0.7, 0.1], [0, D + 1.7, cabZ + 1.52], PAL.glass);
    k.box([Math.min(W - 0.6, 6.4), 0.2, 3.4], [0, D + 2.5, cabZ], PAL.dark);

    // What it carries.
    if (kind === "bay" && this.carry) {
      const slot = this.carry.craneBaySlot;
      // Bay outline (hazard), pad, and service towers either side (open above: the crane lifts the mech straight out).
      const bw = 6, bl = 7;
      k.box([bw, 0.04, bl], [0, D + 0.02, slot], PAL.dark);
      for (const sx of [1, -1]) k.box([0.3, 0.06, bl], [sx * bw / 2, D + 0.04, slot], PAL.hazard);
      for (const sz of [1, -1]) k.box([bw + 0.3, 0.06, 0.3], [0, D + 0.04, slot + sz * bl / 2], PAL.hazard);
      for (const sx of [1, -1]) {
        const x = sx * (bw / 2 + 1.4);
        for (const sz of [1, -1]) k.box([0.3, 4.6, 0.3], [x + sx * 0.5, D + 2.3, slot + sz * 1.6], PAL.steel);
        for (const y of [1.6, 3.2]) k.box([1.6, 0.15, 3.8], [x, D + y, slot], PAL.ochre);
        k.box([0.08, 0.9, 3.6], [x - sx * 0.75, D + 3.7, slot], PAL.hazard);
        k.box([0.6, 0.6, 0.6], [x + sx * 0.4, D + 4.9, slot + 1.6], PAL.bone);
      }
      // Parts racks and a tool hut aft of the bay.
      k.box([3, 2.6, 4], [-(W / 2 - 2.2), D + 1.3, -L / 2 + 4], PAL.teal);
      k.box([3.4, 0.2, 4.4], [-(W / 2 - 2.2), D + 2.7, -L / 2 + 4], PAL.dark);
      for (let i = 0; i < 3; i++) k.box([1.2, 1.2, 1.2], [W / 2 - 1.8, D + 0.6 + (i === 2 ? 1.2 : 0), -L / 2 + 3 + (i % 2) * 1.4], PAL.ochre);
      // Crane foot: a mast on a ring.
      const mz = this.carry.craneMount;
      k.cyl(1.8, 0.5, [0, D + 0.25, mz], PAL.steel, [0, 0, 0], 16);
    } else if (kind === "housing") {
      // Containers and a hut with a canopy.
      k.box([2.5, 2.6, 6], [W / 2 - 1.6, D + 1.3, 3], PAL.red);
      k.box([2.5, 2.6, 6], [W / 2 - 1.6, D + 3.9, 3.4], PAL.teal);
      k.box([4, 2.8, 5], [-(W / 2 - 2.4), D + 1.4, -4], PAL.bone);
      k.box([4.6, 0.25, 5.6], [-(W / 2 - 2.4), D + 2.95, -4], PAL.rust);
      for (let i = 0; i < 3; i++) k.box([0.06, 0.6, 0.9], [-(W / 2 - 0.39), D + 1.7, -5.5 + i * 1.5], PAL.glass);
      k.box([5, 0.08, 4], [0, D + 3, -L / 2 + 3], PAL.orange);
      for (const sx of [1, -1]) k.box([0.1, 3, 0.1], [sx * 2.4, D + 1.5, -L / 2 + 1.2], PAL.steel);
    } else if (kind === "workshop") {
      k.box([W - 2, 3.2, 8], [0, D + 1.6, -2], PAL.bone);
      k.box([W - 1.4, 0.3, 8.8], [0, D + 3.35, -2], PAL.teal);
      k.box([3.6, 2.6, 0.1], [0, D + 1.3, 2.06], PAL.dark);
      for (let i = 0; i < 4; i++) k.box([1.1, 1.1, 1.1], [-(W / 2 - 1.4) + (i % 2) * 1.3, D + 0.55, -L / 2 + 2 + Math.floor(i / 2) * 1.3], PAL.ochre);
      k.box([0.3, 5, 0.3], [W / 2 - 1, D + 2.5, -L / 2 + 2], PAL.steel);
      k.box([3.5, 0.3, 0.3], [W / 2 - 2.6, D + 5, -L / 2 + 2], PAL.hazard);
    } else if (kind === "fuel") {
      for (const sx of [1, -1]) {
        k.cyl(1.6, 14, [sx * 2.3, D + 1.8, -2], PAL.bone, [Math.PI / 2, 0, 0], 16);
        for (const sz of [-7, 3]) k.box([3.4, 1, 0.5], [sx * 2.3, D + 0.5, sz], PAL.dark);
        for (let i = -1; i <= 1; i++) k.box([3.3, 0.12, 0.3], [sx * 2.3, D + 3.4, -2 + i * 5], PAL.red);
      }
    }
    this.hull = mesh(k.build(), this.root);
  }
}

/** The crane: turret on the platform, jib, rope and cradle placed in the world. */
export class CraneBody {
  readonly group = new THREE.Group();
  private turret = new THREE.Group();
  private jib: THREE.Mesh;
  private rope: THREE.Mesh;
  private cradle: THREE.Mesh;
  private mast: THREE.Mesh;
  private jibLen = -1;
  private e = new THREE.Euler();

  constructor(readonly crane: Crane, private platformBody: PlatformBody) {
    const t = new Kit();
    // Turret: a cab and a counterweight on the slewing ring.
    t.box([3, 2.4, 4.4], [0, 0.4, -1], PAL.ochre);
    t.box([2.6, 0.7, 0.1], [0, 0.9, 1.25], PAL.glass);
    t.box([3.4, 1.6, 1.8], [0, 0.2, -3.6], PAL.dark);
    t.box([0.6, 1, 1], [1.1, 1.5, 0], PAL.steel);
    t.box([0.6, 1, 1], [-1.1, 1.5, 0], PAL.steel);
    mesh(t.build(), this.turret);
    this.mast = mesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 12).translate(0, 0.5, 0), platformBody.root);
    this.platformBody.root.add(this.turret);

    this.jib = mesh(new THREE.BufferGeometry(), this.group);
    const rg = new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, -0.5, 0);
    this.rope = mesh(rg, this.group, ROPE);
    this.rope.castShadow = false;
    // Cradle: a yoke with two arms that hook under the hull.
    const c = new Kit();
    c.box([3.6, 0.5, 0.8], [0, 0, 0], PAL.hazard);
    c.box([0.5, 0.5, 0.5], [0, 0.4, 0], PAL.dark);
    for (const sx of [1, -1]) {
      c.box([0.35, 2.2, 0.6], [sx * 1.7, -1.1, 0], PAL.hazard);
      c.box([0.9, 0.3, 0.6], [sx * 1.35, -2.2, 0], PAL.dark);
    }
    this.cradle = mesh(c.build(), this.group);
    this.group.name = "crane";
  }

  meshes(): THREE.Object3D[] { return [this.group, this.turret, this.mast]; }

  update() {
    const cr = this.crane, v = cr.v, p = cr.platform, D = p.deck;
    if (v.craneJib !== this.jibLen) {
      this.jibLen = v.craneJib;
      const k = new Kit();
      const L = v.craneJib;
      // A lattice-ish jib: two chords and a top chord, cross plates, and a sheave at the tip.
      for (const sx of [1, -1]) k.box([0.18, 0.18, L], [sx * 0.45, 0, L / 2], PAL.ochre);
      k.box([0.18, 0.18, L], [0, 0.7, L / 2], PAL.ochre);
      for (let z = 1; z < L; z += 1.6) k.box([1, 0.8, 0.1], [0, 0.35, z], PAL.ochre, [0.5, 0, 0]);
      k.cyl(0.45, 0.9, [0, 0, L], PAL.dark, [0, 0, Math.PI / 2], 10);
      this.jib.geometry.dispose();
      this.jib.geometry = k.build();
    }
    this.mast.position.set(0, D, v.craneMount);
    this.mast.scale.set(1, v.craneMast, 1);
    this.turret.position.set(0, D + v.craneMast, v.craneMount);
    this.turret.rotation.set(0, cr.slew, 0);
    this.jib.position.set(cr.base.x, cr.base.y, cr.base.z);
    this.jib.quaternion.setFromEuler(this.e.set(-cr.luff, p.heading + cr.slew, 0, "YXZ"));
    this.rope.position.set(cr.tip.x, cr.tip.y, cr.tip.z);
    this.rope.scale.set(1, Math.max(0.1, cr.hoist), 1);
    this.cradle.position.set(cr.cradle.x, cr.cradle.y, cr.cradle.z);
    // Arms either side of a carried mech (which is turned to face along the platform).
    this.cradle.rotation.set(0, p.heading, 0);
  }
}
