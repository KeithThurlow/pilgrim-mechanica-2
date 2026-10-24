// Stand-in look for the crawler tracks (tracks.ts): each pod a trapezoid frame with big side panels, sprocket hubs
// at the corners, and a loop of tread plates (one instanced mesh for all of a platform's plates) that scrolls with
// the distance travelled, so the plates on the sand stay still against it.
import * as THREE from "three/webgpu";
import { Kit, kitMesh, KIT_MAT } from "./kit";
import { PAL } from "./furniture";
import { treadAt, treadLength, type Pod } from "./tracks";

/** Tracks get their own material so hold-V can light them apart from the platform. */
export const TRACK_MAT = KIT_MAT.clone();
const PLATE_T = 0.16;

export class TrackBody {
  readonly frames: THREE.Mesh;
  readonly plates: THREE.InstancedMesh;
  private loops: { pod: Pod; n: number; step: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private X = new THREE.Vector3(1, 0, 0);
  private t = { y: 0, z: 0, ty: 0, tz: 0 };

  constructor(pods: Pod[], pitch: number, paint: number, parent: THREE.Object3D) {
    const k = new Kit();
    let count = 0;
    for (const pod of pods) {
      const L = treadLength(pod), n = Math.max(8, Math.floor(L / pitch));
      this.loops.push({ pod, n, step: L / n });
      count += n;
      this.frame(k, pod, paint);
    }
    this.frames = kitMesh(k.build(), parent, TRACK_MAT);
    // A plate: a flat link with a grouser bar across its outer face.
    const pk = new Kit();
    const w = pods[0]?.w ?? 2.4, len = pitch * 0.86;
    pk.box([w, PLATE_T, len], [0, 0, 0], PAL.tyre);
    pk.box([w * 0.96, 0.1, 0.14], [0, PLATE_T / 2 + 0.05, 0], PAL.dark);
    this.plates = new THREE.InstancedMesh(pk.build(), TRACK_MAT, Math.max(1, count));
    this.plates.count = count;
    this.plates.castShadow = true;
    this.plates.receiveShadow = true;
    this.plates.frustumCulled = false;
    parent.add(this.plates);
    this.update(0);
  }

  /** The pod's frame: a trapezoid block inside the tread, side panels outside it, hubs at the corners. */
  private frame(k: Kit, pod: Pod, paint: number) {
    const inset = 0.32;
    const shape = (pad: number) => {
      const s = new THREE.Shape();
      s.moveTo(pod.z0 - pad, inset + pad * 0.2);
      s.lineTo(pod.z1 + pad, inset + pad * 0.2);
      s.lineTo(pod.z1 + pod.slope + pad * 0.6, pod.h - inset - pad * 0.2);
      s.lineTo(pod.z0 - pod.slope - pad * 0.6, pod.h - inset - pad * 0.2);
      s.closePath();
      return s;
    };
    // Shape (z, y) extruded along -x: basis (0,0,1), (0,1,0), (-1,0,0) keeps the winding.
    const basis = (x: number) => new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)).setPosition(x, 0, 0);
    const core = pod.w - 0.25;
    k.geo(new THREE.ExtrudeGeometry(shape(0), { depth: core, bevelEnabled: false }), PAL.dark, basis(pod.x + core / 2));
    // Side panels on both faces, in the platform's paint: the big flat sides that read from the camera.
    for (const sx of [1, -1]) {
      const x = pod.x + sx * (pod.w / 2 + 0.06);
      k.geo(new THREE.ExtrudeGeometry(shape(0.25), { depth: 0.12, bevelEnabled: false }), paint, basis(x + 0.06));
      // Corner hubs (sprockets and idlers) and a row of road-wheel bolts along the bottom.
      for (const [z, y, r] of [[pod.z0 - 0.7, 0.8, 0.6], [pod.z1 + 0.7, 0.8, 0.6], [pod.z0 - pod.slope - 0.3, pod.h - 0.75, 0.5], [pod.z1 + pod.slope + 0.3, pod.h - 0.75, 0.5]] as const) {
        k.cyl(r, 0.3, [x + sx * 0.12, y, z], PAL.hub, [0, 0, Math.PI / 2], 12);
        k.cyl(r * 0.4, 0.4, [x + sx * 0.15, y, z], PAL.dark, [0, 0, Math.PI / 2], 8);
      }
      const n = Math.max(2, Math.round((pod.z0 - pod.z1 - 2.8) / 1.6));
      for (let i = 0; i <= n; i++) k.cyl(0.22, 0.24, [x + sx * 0.1, 0.62, pod.z1 + 1.4 + ((pod.z0 - pod.z1 - 2.8) * i) / n], PAL.dark, [0, 0, Math.PI / 2], 8);
      // A stripe of hazard paint along the top edge.
      k.box([0.14, 0.18, Math.max(0.5, pod.z0 - pod.z1 - 2 * pod.slope - 1)], [x + sx * 0.02, pod.h - inset - 0.25, (pod.z0 + pod.z1) / 2], PAL.hazard);
    }
  }

  /** Scroll the tread: plates at `travelled` metres round the loop. */
  update(travelled: number) {
    let i = 0;
    for (const { pod, n, step } of this.loops) {
      for (let j = 0; j < n; j++, i++) {
        const t = treadAt(pod, j * step + travelled, this.t);
        // Local z along the loop, local y outward (see tracks.ts: a = atan2(-ty, tz)).
        this.q.setFromAxisAngle(this.X, Math.atan2(-t.ty, t.tz));
        // The path is the tread's outer face: the plate's middle sits half a plate inside it.
        this.p.set(pod.x, t.y - t.tz * (PLATE_T / 2), t.z + t.ty * (PLATE_T / 2));
        this.m.compose(this.p, this.q, this.s);
        this.plates.setMatrixAt(i, this.m);
      }
    }
    this.plates.instanceMatrix.needsUpdate = true;
  }
}
