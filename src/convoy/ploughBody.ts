// Stand-in look for the convoy's plough (plough.ts): a giant tracked bulldozer. Two big crawler pods (the platforms'
// tread, scrolling), a hull with an engine deck and exhaust stacks, a cab up top, push arms, and a wide V blade of
// ribbed plates with a hazard-striped top edge, sized to the road's half-width and the blade sweep (rebuilt when those
// sliders change). Code-built until the desktop agent's model lands (docs/asset-list.md, C3 · Convoy plough).
import * as THREE from "three/webgpu";
import { Kit, kitMesh } from "./kit";
import { PAL } from "./furniture";
import { TrackBody } from "./trackBody";
import type { Pod } from "./tracks";
import { Plough, PLOUGH_BASE_LENGTH, PLOUGH_BASE_HALF, BLADE_AHEAD, BLADE_HEIGHT } from "./plough";
import { sweepTan } from "./wake";
import { LAMP_HEAD, type LampSpot } from "../world/lamps";

const PAINT = 0xc08a2e;
const Y = new THREE.Vector3(0, 1, 0);

export class PloughBody {
  readonly root = new THREE.Group();

  private blade: THREE.Mesh | null = null;
  private tracks: TrackBody;
  private key = "";
  private m = new THREE.Matrix4();
  /** Lamps lit after dark: the cab's light bar. */
  readonly lamps: LampSpot[] = [];

  constructor(readonly plough: Plough) {
    this.root.name = "Plough";
    this.root.userData.lamps = this.lamps;
    this.root.matrixAutoUpdate = false;
    const L = PLOUGH_BASE_LENGTH, x = PLOUGH_BASE_HALF - 1.6;
    const pods: Pod[] = [1, -1].map((sx) => ({ x: sx * x, z0: L / 2 - 0.4, z1: -L / 2 + 0.4, slope: 2.6, h: 3.4, w: 3.2 }));
    this.tracks = new TrackBody(pods, 0.8, PAINT, this.root);
    this.buildHull();
  }

  meshes(): THREE.Object3D[] { return [this.root]; }

  private buildHull() {
    const k = new Kit(), L = PLOUGH_BASE_LENGTH, W = PLOUGH_BASE_HALF;
    // The hull between the tracks: a long engine block with a raised deck.
    k.box([2 * W - 6.2, 3.2, L - 1.5], [0, 3.2, -0.3], PAL.dark);
    k.box([2 * W - 1.0, 0.6, L - 1.2], [0, 4.9, -0.4], PAINT);
    // Engine deck with grilles, and two exhaust stacks.
    k.box([2 * W - 3.5, 1.6, L * 0.45], [0, 6.0, -L * 0.22], PAINT);
    for (let i = 0; i < 5; i++) k.box([2 * W - 4.2, 0.12, 0.3], [0, 6.85, -L * 0.38 + i * 1.1], PAL.dark);
    for (const sx of [1, -1]) {
      k.cyl(0.42, 4.2, [sx * 2.4, 8.4, -L * 0.36], PAL.dark, [0, 0, 0], 10);
      k.cyl(0.5, 0.5, [sx * 2.4, 10.5, -L * 0.36], PAL.rust, [0, 0, 0], 10);
    }
    // The cab: up front over the blade, glass all round, a roof and a light bar.
    k.box([5.2, 3.0, 4.2], [0, 7.0, L * 0.18], PAINT);
    k.box([5.4, 1.4, 4.4], [0, 7.4, L * 0.18], PAL.glass);
    k.box([5.8, 0.35, 4.8], [0, 8.65, L * 0.18], PAL.dark);
    for (let i = -2; i <= 2; i++) k.box([0.5, 0.3, 0.3], [i * 1.1, 8.95, L * 0.18 + 2.2], PAL.bone);
    // After dark the light bar lights the cut ahead (src/world/nightLights.ts).
    for (let i = -2; i <= 2; i += 2) this.lamps.push({ kind: LAMP_HEAD, p: [i * 1.1, 8.95, L * 0.18 + 2.4], d: [i * 0.08, -0.3, 1], len: 24, ground: true });
    // Front bumper and the push frame (C-frame arms from the track frames forward to the blade).
    k.box([2 * W - 2, 1.4, 1.2], [0, 1.9, L / 2 - 0.2], PAL.dark);
    for (const sx of [1, -1]) {
      k.between([sx * (W - 1.6), 1.6, -1], [sx * 3.2, 1.9, L / 2 + BLADE_AHEAD - 1.4], 0.45, PAL.dark, 8);
      // A lift ram from the hull's nose to the blade's back.
      k.between([sx * 1.6, 4.4, L / 2 - 0.6], [sx * 2.6, 3.4, L / 2 + BLADE_AHEAD - 1.2], 0.32, PAL.steel, 8);
      k.between([sx * 1.6, 4.4, L / 2 - 0.6], [sx * 2.2, 3.9, L / 2 + 1.2], 0.42, PAL.dark, 8);
    }
    kitMesh(k.build(), this.root);
  }

  /** The V blade: two wings from the point back to the tips, ribbed plates, a hazard edge, end plates. */
  private buildBlade(hw: number, tan: number) {
    if (this.blade) { this.root.remove(this.blade); this.blade.geometry.dispose(); }
    const k = new Kit(), tipZ = PLOUGH_BASE_LENGTH / 2 + BLADE_AHEAD, H = BLADE_HEIGHT;
    for (const sx of [1, -1]) {
      const dir = new THREE.Vector3(sx * hw, 0, -hw * tan), len = dir.length();
      dir.normalize();
      const ax = new THREE.Vector3().crossVectors(Y, dir).normalize();
      // Plates along the wing (moldboard sections with a small gap between).
      const n = Math.max(3, Math.round(len / 6));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, cx = dir.x * len * f, cz = tipZ + dir.z * len * f;
        k.oriented([0.7, H, len / n - 0.15], [cx, H / 2 + 0.1, cz], ax, Y, dir, PAINT);
        // Ribs on the back.
        // ax points behind the left wing and ahead of the right one.
        const back = ax.clone().multiplyScalar(sx * 0.6);
        k.oriented([0.5, H * 0.85, 0.35], [cx + back.x, H * 0.45, cz + back.z], ax, Y, dir, PAL.dark);
      }
      // The cutting edge along the bottom and a hazard-striped top edge.
      const mid = new THREE.Vector3(dir.x * len / 2, 0, tipZ + dir.z * len / 2);
      k.oriented([0.95, 0.4, len], [mid.x, 0.3, mid.z], ax, Y, dir, PAL.steel);
      const stripes = Math.max(4, Math.round(len / 2.4));
      for (let i = 0; i < stripes; i++) {
        const f = (i + 0.5) / stripes;
        k.oriented([0.85, 0.5, len / stripes], [dir.x * len * f, H + 0.3, tipZ + dir.z * len * f], ax, Y, dir, i % 2 ? PAL.hazard : PAL.dark);
      }
      // An end plate at the tip, square to the road.
      k.box([0.5, H * 1.15, 3.2], [sx * hw, H * 0.55, tipZ - hw * tan - 0.6], PAL.dark);
      // Arms from the push frame out along the back of the wing.
      k.between([sx * 3.2, 1.9, tipZ - 1.4], [dir.x * len * 0.55 - sx * 0.8, 2.2, tipZ + dir.z * len * 0.55 - 0.8], 0.38, PAL.dark, 8);
      k.between([sx * 3.2, 1.9, tipZ - 1.4], [dir.x * len * 0.9 - sx * 0.8, 2.6, tipZ + dir.z * len * 0.9 - 0.8], 0.32, PAL.dark, 8);
    }
    // The point: a ram plate where the wings meet.
    k.box([1.6, H * 1.2, 1.6], [0, H * 0.6, tipZ - 0.2], PAL.dark, [0, Math.PI / 4, 0]);
    this.blade = kitMesh(k.build(), this.root);
  }

  update() {
    const p = this.plough, hw = p.halfBlade, tan = sweepTan(p.route.v), key = `${hw}|${tan}`;
    if (key !== this.key) { this.key = key; this.buildBlade(hw, tan); }
    this.m.makeBasis(new THREE.Vector3(p.left.x, p.left.y, p.left.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.fwd.x, p.fwd.y, p.fwd.z));
    this.m.setPosition(p.x, p.y, p.z);
    this.root.matrix.copy(this.m);
    this.root.matrixWorldNeedsUpdate = true;
    this.tracks.update(p.travelled);
  }
}
