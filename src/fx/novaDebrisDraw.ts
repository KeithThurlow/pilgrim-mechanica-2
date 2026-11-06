// Draws a shattering hull (src/fx/novaDebris.ts): the shards as lit plates (white hull plate and dark mechanics) glowing
// hot and cooling, the sparks as bright additive streaks along their flight, white to orange to red. Two instanced
// meshes, cosmetic.
import * as THREE from "three/webgpu";
import { float, instancedBufferAttribute, mix, pow, vec3 } from "three/tsl";
import { MAX_SHARDS, MAX_SPARKS, type NovaDebris } from "./novaDebris";
import { ROBOT_PALETTE } from "../combat/robotShapes";

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
const DIR = new THREE.Vector3(), FWD = new THREE.Vector3(0, 0, 1), C = new THREE.Color();
const PLATE = new THREE.Color(ROBOT_PALETTE.plate), DARK = new THREE.Color(ROBOT_PALETTE.joint);
const WHITE = new THREE.Color(1, 0.95, 0.85), ORANGE = new THREE.Color(1, 0.55, 0.15), RED = new THREE.Color(0.7, 0.1, 0.02);

export class NovaDebrisDraw {
  readonly group = new THREE.Group();
  private shards: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private heat: THREE.InstancedBufferAttribute;

  constructor(private d: NovaDebris) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHARDS), 1);
    this.heat.setUsage(THREE.DynamicDrawUsage);
    box.setAttribute("shardHeat", this.heat);
    const h = instancedBufferAttribute<"float">(this.heat);
    const sm = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
    // Hot: white-yellow at the start, orange as it cools; brighter than the light can make it.
    sm.emissiveNode = mix(vec3(1, 0.35, 0.06), vec3(1, 0.85, 0.55), pow(h, float(2))).mul(h.mul(4));
    this.shards = new THREE.InstancedMesh(box, sm, MAX_SHARDS);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.setColorAt(0, PLATE);
    this.shards.frustumCulled = false; this.shards.castShadow = true; this.shards.count = 0;

    const streak = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
    const km = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.sparks = new THREE.InstancedMesh(streak, km, MAX_SPARKS);
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.setColorAt(0, WHITE);
    this.sparks.frustumCulled = false; this.sparks.count = 0; this.sparks.renderOrder = 6;
    this.group.add(this.shards, this.sparks);
  }

  update() {
    const d = this.d, v = d.v;
    // Shards: compacted to the live ones.
    let n = 0;
    for (let i = 0; i < MAX_SHARDS; i++) {
      if (!d.live(i)) continue;
      const j = i * 3, f = d.fade(i);
      P.set(d.sp[j], d.sp[j + 1] - (1 - f) * d.ss[j + 1] * 2, d.sp[j + 2]);
      Q.setFromEuler(E.set(d.sr[j], d.sr[j + 1], d.sr[j + 2]));
      S.set(d.ss[j] * f, d.ss[j + 1], d.ss[j + 2] * f);
      this.shards.setMatrixAt(n, M.compose(P, Q, S));
      const sh = d.sShade[i];
      this.shards.setColorAt(n, sh < 0.7 ? C.copy(PLATE).multiplyScalar(0.8 + 0.3 * sh) : C.copy(DARK));
      this.heat.array[n] = d.glow(i);
      n++;
    }
    this.shards.count = n;
    if (n) {
      this.shards.instanceMatrix.needsUpdate = true;
      if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
      this.heat.needsUpdate = true;
    }
    // Sparks: a streak along the flight, thinning and reddening with age.
    let m = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (!d.sparkLive(i)) continue;
      const j = i * 3, u = d.kAge[i] / d.kLife[i];
      DIR.set(d.kv[j], d.kv[j + 1], d.kv[j + 2]);
      const sp = DIR.length();
      if (sp > 1e-3) DIR.multiplyScalar(1 / sp); else DIR.set(0, 1, 0);
      Q.setFromUnitVectors(FWD, DIR);
      const w = 0.09 * (1 - 0.5 * u);
      S.set(w, w, Math.max(0.15, sp * v.novaSparkStreak));
      P.set(d.kp[j], d.kp[j + 1], d.kp[j + 2]);
      this.sparks.setMatrixAt(m, M.compose(P, Q, S));
      // Additive: the colour is the brightness. White hot, then orange, then a dim red.
      if (u < 0.35) C.copy(WHITE).lerp(ORANGE, u / 0.35); else C.copy(ORANGE).lerp(RED, (u - 0.35) / 0.65);
      this.sparks.setColorAt(m, C.multiplyScalar(2.2 * (1 - u * u)));
      m++;
    }
    this.sparks.count = m;
    if (m) {
      this.sparks.instanceMatrix.needsUpdate = true;
      if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
    }
  }
}
