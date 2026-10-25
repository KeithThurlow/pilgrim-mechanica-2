// Stand-in look for the convoy's platforms: decks, rails, wheels or crawler tracks (trackBody.ts), cabs, huts, tanks
// and machines (furniture.ts), pipe runs (pipes.ts, pipesDraw.ts), footbridge landings, vehicles tied down on the
// motor pool, and the mech bay's deck markings (parking bays, launch pads, set-down pad). The crane is craneBody.ts.
// Static parts of each platform are one merged vertex-coloured mesh; wheels spin on their own; tread plates scroll.
// Swapping in modelled platforms later means replacing these meshes, not the sims.
import * as THREE from "three/webgpu";
import type { Platform } from "./platform";
import type { CraneValues } from "./crane";
import { RAIL } from "./carry";
import { deckLayout, bayZ, storesZ, BAY_W, BAY_L, type DeckValues } from "./deck";
import { deckOutline, halfWidthAt, type Outline } from "./outline";
import { Kit, kitMesh, KIT_MAT } from "./kit";
import { PAL, KIND_PAINT, furniture, furnBox, type Box } from "./furniture";
import { trackPods, type TrackValues } from "./tracks";
import { TrackBody } from "./trackBody";
import { generatePipes, type PipeValues } from "./pipes";
import { pipesGeometry, PIPE_MAT } from "./pipesDraw";
import { landingXs, landingEnds, LANDING_IN, LANDING_HALF, type TrainValues } from "./train";
import { WHEEL_X_IN, WHEEL_Z } from "./trail";
import { CarBody } from "../vehicles/carBody";
import { CarSim, carValues } from "../vehicles/car";

const MAT = KIT_MAT;
/** Deck markings get their own material so hold-V can light them apart from the platform. */
const MARK_MAT = MAT.clone();
/** Footbridge landings, lit with the bridges. */
export const LANDING_MAT = MAT.clone();
/** Paint of the convoy's own vehicles (aboard and escorting): not the raiders' rust. */
export const FRIENDLY = 0x5f7f78;

const FLAT = { height: () => 0, normal: (_x: number, _z: number, out: number[] = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

interface Wheel { mesh: THREE.Mesh; r: number }
type BodyValues = TrackValues & PipeValues & TrainValues;

export class PlatformBody {
  /** Rides the platform (local frame: x left, y up, z forward). */
  readonly root = new THREE.Group();
  private hull: THREE.Mesh | null = null;
  private marks: THREE.Mesh | null = null;
  private pipes: THREE.Mesh | null = null;
  private landings: THREE.Mesh | null = null;
  private tracks: TrackBody | null = null;
  private cars: CarBody[] = [];
  private wheels: Wheel[] = [];
  private built = "";
  private m = new THREE.Matrix4();
  /** Pipe runs on this platform (for the HUD). */
  pipeRuns = 0;

  constructor(readonly platform: Platform, private carry: (CraneValues & DeckValues) | null, private v: BodyValues, private all: Platform[]) {
    this.root.matrixAutoUpdate = false;
    this.root.name = platform.spec.name;
  }

  get index() { return this.all.indexOf(this.platform); }

  /** Meshes for hold-V selection. */
  meshes(): THREE.Object3D[] { return [this.root]; }
  /** The mech bay's deck markings and service tower (parking bays, launch pads, set-down pad), for hold-V. */
  deckMeshes(): THREE.Object3D[] { return this.marks ? [this.marks] : []; }
  trackMeshes(): THREE.Object3D[] { return this.tracks ? [this.tracks.frames, this.tracks.plates] : []; }
  pipeMeshes(): THREE.Object3D[] { return this.pipes ? [this.pipes] : []; }
  landingMeshes(): THREE.Object3D[] { return this.landings ? [this.landings] : []; }
  vehicleMeshes(): THREE.Object3D[] { return this.cars.map((c) => c.root); }

  update() {
    const p = this.platform, c = this.carry, v = this.v;
    const ends = landingEnds(this.all)[this.index];
    const key = [p.deck, v.trackPods, v.trackTop, v.trackHeight, v.trackWidth, v.trackPitch, v.trackPodGap, v.pipeDensity, v.pipeSeed, v.pipeScale,
      v.bridgeCount, v.bridgeRise, ends.nose, ends.tail,
      ...(c ? [c.craneSetDown, c.craneMount, c.deckParkX, c.deckParkZ, c.deckLaunchX, c.deckPadRadius] : [])].join("|");
    if (key !== this.built) { this.build(ends); this.built = key; }
    this.m.makeBasis(new THREE.Vector3(p.left.x, p.left.y, p.left.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.fwd.x, p.fwd.y, p.fwd.z));
    this.m.setPosition(p.x, p.y, p.z);
    this.root.matrix.copy(this.m);
    this.root.matrixWorldNeedsUpdate = true;
    for (const w of this.wheels) w.mesh.rotation.x = p.travelled / w.r;
    this.tracks?.update(p.travelled);
  }

  private clear() {
    for (const m of [this.hull, this.marks, this.pipes, this.landings]) if (m) { this.root.remove(m); m.geometry.dispose(); }
    this.hull = this.marks = this.pipes = this.landings = null;
    if (this.tracks) {
      this.root.remove(this.tracks.frames, this.tracks.plates);
      this.tracks.frames.geometry.dispose(); this.tracks.plates.geometry.dispose(); this.tracks.plates.dispose();
      this.tracks = null;
    }
    for (const w of this.wheels) { this.root.remove(w.mesh); w.mesh.geometry.dispose(); }
    this.wheels = [];
    for (const c of this.cars) this.root.remove(c.root);
    this.cars = [];
  }

  private build(ends: { nose: boolean; tail: boolean }) {
    this.clear();
    const p = this.platform, { length: L, width: W, tracked, kind } = p.spec, D = p.deck, v = this.v;
    const k = new Kit(), paint = KIND_PAINT[kind];

    // Deck plate, chassis and skirts, on the cut-cornered outline (Keith 2026-10-25: not perfect rectangles).
    const ol = p.outline;
    slab(k, ol, D - 0.35, D, PAL.deck);
    slab(k, deckOutline(p.spec, -0.15), D - 0.95, D - 0.35, paint);
    k.box([W * 0.55, 1.2, L * 0.9], [0, D - 1.4, 0], PAL.dark);
    // Deck seams.
    for (let z = -L / 2 + 4; z < L / 2 - 1; z += 4) k.box([2 * halfWidthAt(ol, z) - 0.4, 0.04, 0.12], [0, D + 0.02, z], PAL.dark);

    // Rails round every edge but the front (the cab's), posts every ~3 m; gaps at the deploy zones on a bay.
    const railY = [D + RAIL * 0.5, D + RAIL];
    const deployZ = this.carry && kind === "bay" ? bayZ(p, this.carry).crane : null;
    const inset = deckOutline(p.spec, -0.1).pts;
    for (let i = 1; i < inset.length; i++) {
      const [ax, az] = inset[i], [bx, bz] = inset[(i + 1) % inset.length];
      // The long sides open at the deploy zone.
      const side = Math.abs(ax - bx) < 1e-6;
      const segs: [number, number][] = [[0, 1]];
      if (side && deployZ !== null) {
        const t0 = (deployZ - 4 - az) / (bz - az), t1 = (deployZ + 4 - az) / (bz - az);
        const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
        segs.length = 0;
        if (lo > 0) segs.push([0, Math.min(1, lo)]);
        if (hi < 1) segs.push([Math.max(0, hi), 1]);
      }
      for (const [t0, t1] of segs) {
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.3) continue;
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        for (const y of railY) k.box([0.08, 0.08, len], [(x0 + x1) / 2, y, (z0 + z1) / 2], PAL.hazard, [0, yaw, 0]);
        const n = Math.max(1, Math.round(len / 3));
        for (let j = 0; j <= n; j++) k.box([0.1, RAIL, 0.1], [x0 + ((x1 - x0) * j) / n, D + RAIL / 2, z0 + ((z1 - z0) * j) / n], PAL.steel);
      }
    }
    if (deployZ !== null) for (const sx of [1, -1]) {
      // Deploy zone: hazard stripes on the deck edge where the crane swings the mech out.
      const x = sx * (W / 2 - 0.1);
      for (let i = 0; i < 8; i++) k.box([0.7, 0.05, 0.45], [x - sx * 0.45, D + 0.03, deployZ - 3.5 + i], i % 2 ? PAL.dark : PAL.orange, [0, sx * 0.5, 0]);
    }

    // Running gear: crawler tracks on the big platforms, wheels on the light ones.
    if (tracked) {
      const pods = trackPods(p.spec, v);
      this.tracks = new TrackBody(pods, v.trackPitch, paint, this.root);
      // Struts from the chassis out over each pod's top.
      const cx = W * 0.275;
      for (const pod of pods) for (const f of [0.25, 0.75]) {
        const z = pod.z1 + pod.slope + (pod.z0 - pod.z1 - 2 * pod.slope) * f;
        const x0 = Math.sign(pod.x) * cx, x1 = pod.x - Math.sign(pod.x) * pod.w * 0.3;
        k.box([Math.abs(x1 - x0) + 0.4, Math.max(0.4, D - 0.95 - pod.h + 0.2), 1.2], [(x0 + x1) / 2, (pod.h + D - 0.95) / 2, z], PAL.dark);
      }
    } else {
      for (const sx of [1, -1]) for (const sz of WHEEL_Z) {
        const r = 1.3, g = new Kit();
        g.cyl(r, 0.9, [0, 0, 0], PAL.tyre, [0, 0, Math.PI / 2], 16);
        g.cyl(r * 0.55, 0.95, [0, 0, 0], PAL.hub, [0, 0, Math.PI / 2], 8);
        g.box([0.96, 0.25, r * 1.6], [0, 0, 0], PAL.dark);
        const w = kitMesh(g.build(), this.root);
        w.position.set(sx * (W / 2 - WHEEL_X_IN), r, sz * L);
        this.wheels.push({ mesh: w, r });
      }
    }

    // Furniture: cab, huts, containers, tanks, machines.
    const { items, cars } = furniture(p.spec, D);
    for (const f of items) {
      if (f.shape === "box") k.box(f.size, f.at, f.color);
      else k.cyl(f.size[0], f.size[1], f.at, f.color, f.axis === "y" ? [0, 0, 0] : [Math.PI / 2, 0, 0], 16);
    }
    // Cab windows and roof.
    const cab = items[0];
    k.box([cab.size[0] - 0.4, 0.7, 0.1], [0, D + 1.7, cab.at[2] + cab.size[2] / 2 + 0.02], PAL.glass);
    k.box([cab.size[0] + 0.4, 0.2, cab.size[2] + 0.4], [0, D + 2.5, cab.at[2]], PAL.dark);
    if (kind === "housing") {
      for (let i = 0; i < 3; i++) k.box([0.06, 0.6, 0.9], [-(W / 2 - 0.39), D + 1.7, -5.5 + i * 1.5], PAL.glass);
      k.box([5, 0.08, 4], [0, D + 3, -L / 2 + 4], PAL.orange);
      for (const sx of [1, -1]) k.box([0.1, 3, 0.1], [sx * 2.4, D + 1.5, -L / 2 + 2.2], PAL.steel);
    } else if (kind === "workshop") {
      k.box([W - 2.4, 0.3, 11.8], [0, D + 3.75, -1], PAL.teal);
      k.box([4, 3, 0.1], [0, D + 1.5, 4.55], PAL.dark);
      // Gantry over the shed's open end.
      for (const sx of [1, -1]) k.box([0.35, 6, 0.35], [sx * (W / 2 - 0.8), D + 3, 5.2], PAL.steel);
      k.box([W - 1.2, 0.45, 0.45], [0, D + 6, 5.2], PAL.hazard);
      k.box([0.6, 0.6, 0.6], [1.5, D + 5.4, 5.2], PAL.dark);
    } else if (kind === "fuel") {
      for (const sx of [1, -1]) for (let i = -1; i <= 1; i++) k.box([3.3, 0.12, 0.3], [sx * 2.3, D + 3.4, -2 + i * 5], PAL.red);
    } else if (kind === "bay") {
      k.box([3.4, 0.2, 4.4], [-(W / 2 - 2.2), D + 2.7, storesZ(p.spec).stores], PAL.dark);
    }

    // Vehicles tied down (the motor pool): posed once on flat ground, hung on the platform, strapped to the deck.
    for (const slot of cars) {
      const cv = carValues(slot.kind);
      const body = new CarBody(slot.kind, FRIENDLY), sim = new CarSim(carValues(slot.kind), FLAT);
      sim.reset(0, 0, 0);
      body.update(sim, 0, 0);
      body.root.position.set(slot.x, D + sim.pos.y, slot.z);
      body.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.heading);
      this.root.add(body.root);
      this.cars.push(body);
      const hl = cv.wheelbase / 2 + 0.4;
      for (const sx of [1, -1]) for (const sz of [1, -1]) {
        k.box([0.08, 0.9, 0.08], [slot.x + sx * (cv.track / 2 + 0.35), D + 0.45, slot.z + sz * hl], PAL.hazard, [sz * 0.5, 0, -sx * 0.35]);
        k.box([0.3, 0.12, 0.3], [slot.x + sx * (cv.track / 2 + 0.55), D + 0.06, slot.z + sz * (hl + 0.25)], PAL.dark);
      }
    }

    // Footbridge landings: a tower with a stair on the tail, a landing on the nose (on the cab roof where it stands).
    const lk = new Kit(), top = D + v.bridgeRise, keep: Box[] = [];
    const tower = (x: number, z: number, from: number, stairDir: number) => {
      const h = top - from;
      for (const sx of [1, -1]) for (const sz of [1, -1]) lk.box([0.14, h, 0.14], [x + sx * (LANDING_HALF - 0.1), from + h / 2, z + sz * (LANDING_HALF - 0.1)], PAL.steel);
      lk.box([LANDING_HALF * 2 + 0.2, 0.14, LANDING_HALF * 2 + 0.2], [x, top - 0.07, z], PAL.ochre);
      for (const sx of [1, -1]) lk.box([0.06, 0.06, LANDING_HALF * 2], [x + sx * LANDING_HALF, top + 1, z], PAL.hazard);
      for (const sx of [1, -1]) for (const sz of [1, -1]) lk.box([0.06, 1, 0.06], [x + sx * LANDING_HALF, top + 0.5, z + sz * (LANDING_HALF - 0.05)], PAL.steel);
      if (h > 1) {
        // A steep stair up the inboard face.
        const run = 1.6, ang = Math.atan2(h, run);
        lk.box([0.9, 0.12, Math.hypot(h, run)], [x, from + h / 2, z + stairDir * (LANDING_HALF + run / 2)], PAL.dark, [stairDir * ang, 0, 0]);
      }
      keep.push({ x, y: (from + top) / 2, z: z + (h > 1 ? stairDir * 0.8 : 0), hx: LANDING_HALF + 0.1, hy: (top - from) / 2 + 0.6, hz: LANDING_HALF + (h > 1 ? 0.9 : 0.1) });
    };
    const xs = landingXs(v.bridgeCount, W);
    if (ends.tail) for (const x of xs) tower(x, -L / 2 + LANDING_IN, D, 1);
    if (ends.nose) for (const x of xs) tower(x, L / 2 - LANDING_IN, Math.abs(x) < cab.size[0] / 2 - 0.3 ? D + cab.size[1] + 0.1 : D, -1);
    if (!lk.empty) this.landings = kitMesh(lk.build(), this.root, LANDING_MAT);

    // The bay: markings and the crane foot.
    if (kind === "bay" && this.carry) {
      const lay = deckLayout(p, { ...this.carry, bridgeCount: v.bridgeCount }), mk = new Kit();
      for (const s of lay.spots) {
        if (s.kind === "park") {
          // Parking bay: dark pad, hazard outline, a chevron pointing forward (park facing the cab).
          mk.box([BAY_W, 0.04, BAY_L], [s.x, D + 0.02, s.z], PAL.dark);
          for (const sx of [1, -1]) mk.box([0.25, 0.06, BAY_L], [s.x + sx * BAY_W / 2, D + 0.04, s.z], PAL.hazard);
          for (const sz of [1, -1]) mk.box([BAY_W + 0.25, 0.06, 0.25], [s.x, D + 0.04, s.z + sz * BAY_L / 2], PAL.hazard);
          for (const sx of [1, -1]) mk.box([0.25, 0.06, 1.6], [s.x + sx * 0.5, D + 0.05, s.z + BAY_L / 2 - 1.4], PAL.bone, [0, -sx * 0.6, 0]);
        } else if (s.kind === "launch") {
          // Launch pad: orange ring of plates and a cross, by the rail gap.
          const r = this.carry.deckPadRadius;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            mk.box([0.5, 0.05, (2 * Math.PI * r) / 12 - 0.15], [s.x + Math.cos(a) * r, D + 0.03, s.z + Math.sin(a) * r], i % 2 ? PAL.dark : PAL.orange, [0, -a, 0]);
          }
          mk.box([r * 1.2, 0.05, 0.3], [s.x, D + 0.03, s.z], PAL.orange);
          mk.box([0.3, 0.05, r * 1.2], [s.x, D + 0.03, s.z], PAL.orange);
        } else {
          // Set-down pad: a bone-coloured square where the crane puts a picked-up mech.
          for (const sx of [1, -1]) mk.box([0.2, 0.05, 4], [s.x + sx * 2, D + 0.03, s.z], PAL.bone);
          for (const sz of [1, -1]) mk.box([4.2, 0.05, 0.2], [s.x, D + 0.03, s.z + sz * 2], PAL.bone);
        }
      }
      // Service tower between the parking bays: posts, two walkways, a light on top.
      const bz = bayZ(p, this.carry), tz = bz.park;
      for (const sx of [1, -1]) for (const sz of [1, -1]) mk.box([0.25, 4.6, 0.25], [sx * 0.6, D + 2.3, tz + sz * 1.7], PAL.steel);
      for (const y of [1.6, 3.2]) mk.box([1.6, 0.15, 3.8], [0, D + y, tz], PAL.ochre);
      mk.box([0.6, 0.6, 0.6], [0, D + 4.9, tz + 1.6], PAL.bone);
      this.marks = kitMesh(mk.build(), this.root, MARK_MAT);
      // Crane foot: a mast on a ring.
      const mz = bz.crane;
      k.cyl(1.8, 0.5, [0, D + 0.25, mz], PAL.steel, [0, 0, 0], 16);
      // Keep pipes off the launch gaps, the pads and bays, the crane ring and the service tower.
      for (const sx of [1, -1]) keep.push({ x: sx * (W / 2 - 1.5), y: D + 1, z: mz, hx: 1.6, hy: 1.5, hz: 4.6 });
      keep.push({ x: 0, y: D + 1, z: mz, hx: 2, hy: 1.5, hz: 2 }, { x: 0, y: D + 2.5, z: tz, hx: 1, hy: 2.6, hz: 2.1 });
      for (const s of lay.spots) keep.push({ x: s.x, y: D + 0.5, z: s.z, hx: s.kind === "park" ? BAY_W / 2 : 2.2, hy: 0.6, hz: s.kind === "park" ? BAY_L / 2 : 2.2 });
    }
    this.hull = kitMesh(k.build(), this.root, MAT);

    // Pipe runs: up the furniture's walls, along the skirts and deck edges, between machines.
    const mounts = items.filter((f) => f.mount).map(furnBox);
    const keepOut = [...keep, ...items.filter((f) => !f.mount).map(furnBox)];
    for (const slot of cars) { const cv = carValues(slot.kind); keepOut.push({ x: slot.x, y: D + 1.2, z: slot.z, hx: cv.track / 2 + 0.8, hy: 1.4, hz: cv.wheelbase / 2 + 1.8 }); }
    const set = generatePipes({ length: L, width: W, deck: D, mounts, keepOut, walkable: kind === "bay", index: this.index, outline: ol }, v);
    this.pipeRuns = set.runs;
    if (set.tubes.length) this.pipes = kitMesh(pipesGeometry(set), this.root, PIPE_MAT);
  }
}

/** A flat slab on an outline, from y0 to y1 (platform frame). */
function slab(k: Kit, o: Outline, y0: number, y1: number, color: number) {
  const sh = new THREE.Shape(o.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false });
  // Shape (x, -z) extruded along +z, turned so the extrusion runs up: (x, y, z) -> (x, z, -y).
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  k.geo(g, color);
}
