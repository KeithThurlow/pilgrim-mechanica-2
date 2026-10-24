// Stand-in look for the footbridges between the convoy's cars (train.ts): each one two telescoping gangway halves,
// one hung from each car's landing and pointed at the other's, so the bridge stretches, shortens and swings with the
// cars' relative motion every frame (the inner half slides under the outer one). When the cars pull out of reach in
// a tight turn the halves swing up clear like drawbridges, and come down again once the cars are back in reach.
import * as THREE from "three/webgpu";
import { Kit, kitMesh, KIT_MAT } from "./kit";
import { PAL } from "./furniture";
import { BRIDGE_HALF, type Span } from "./train";

/** Footbridges get their own material so hold-V can light them apart. */
export const BRIDGE_MAT = KIT_MAT.clone();
/** Raised angle (rad) and how fast the halves swing up or down (rad/s). */
const RAISED = 1.15, SWING = 0.9;

/** One half of a gangway, `len` long from its landing along +z: deck plank, stringers, rails and posts. */
function half(len: number, w: number, color: number) {
  const k = new Kit();
  k.box([w, 0.1, len], [0, -0.05, len / 2], PAL.dark);
  for (const sx of [1, -1]) k.box([0.12, 0.28, len], [sx * (w / 2 - 0.06), -0.24, len / 2], color);
  const n = Math.max(2, Math.round(len / 1.2));
  for (const sx of [1, -1]) {
    for (let i = 0; i <= n; i++) k.box([0.06, 1.05, 0.06], [sx * (w / 2 - 0.03), 0.5, (len * i) / n], PAL.steel);
    k.box([0.07, 0.07, len], [sx * (w / 2 - 0.03), 1.05, len / 2], color);
    k.box([0.05, 0.05, len], [sx * (w / 2 - 0.03), 0.55, len / 2], PAL.steel);
  }
  return k.build();
}

interface Gangway { outer: THREE.Mesh; inner: THREE.Mesh; rest: number; raise: number }

export class BridgeBody {
  readonly group = new THREE.Group();
  private list: Gangway[] = [];
  private m = new THREE.Matrix4();
  private x = new THREE.Vector3();
  private y = new THREE.Vector3();
  private z = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private UP = new THREE.Vector3(0, 1, 0);
  private X = new THREE.Vector3(1, 0, 0);

  constructor() { this.group.name = "footbridges"; }

  objects(): THREE.Object3D[] { return [this.group]; }

  update(spans: Span[], dt: number) {
    while (this.list.length > spans.length) this.drop(this.list.pop()!);
    spans.forEach((s, i) => {
      let g = this.list[i];
      if (g && Math.abs(g.rest - s.rest) > 0.05) { this.drop(g); g = undefined as unknown as Gangway; }
      if (!g) {
        const len = s.rest * BRIDGE_HALF;
        g = this.list[i] = {
          outer: kitMesh(half(len, 1.5, PAL.hazard), this.group, BRIDGE_MAT),
          inner: kitMesh(half(len, 1.2, PAL.ochre), this.group, BRIDGE_MAT),
          rest: s.rest, raise: s.lifted ? RAISED : 0,
        };
      }
      const want = s.lifted ? RAISED : 0;
      g.raise += Math.max(-SWING * dt, Math.min(SWING * dt, want - g.raise));
      this.place(g.outer, s.a, s.b, 0, g.raise);
      this.place(g.inner, s.b, s.a, -0.12, g.raise);
    });
  }

  private drop(g: Gangway) {
    this.group.remove(g.outer, g.inner);
    g.outer.geometry.dispose(); g.inner.geometry.dispose();
  }

  /** Hang a half at `from`, pointing at `to`, dropped by `drop`, swung up by `raise` (rad) about its landing. */
  private place(mesh: THREE.Mesh, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, drop: number, raise: number) {
    this.z.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
    this.x.crossVectors(this.UP, this.z).normalize();
    this.y.crossVectors(this.z, this.x);
    this.m.makeBasis(this.x, this.y, this.z);
    if (raise > 1e-4) this.m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(this.q.setFromAxisAngle(this.X, -raise)));
    this.m.setPosition(from.x, from.y + drop, from.z);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.m);
    mesh.matrixWorldNeedsUpdate = true;
  }
}
