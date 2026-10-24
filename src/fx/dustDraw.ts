// Draws the dust sim (dust.ts): soft camera-facing puffs, back to front, with frayed grainy edges from noise, a faked
// round shading (lit on the sun side, browner and darker underneath, thicker puffs shading themselves), and a depth
// fade so they melt into the sand and wrap round the mech. Under each puff, a soft shadow laid on the sand, pushed
// away from the sun by the puff's height (the dark band under the trail in Keith's reference video).
import * as THREE from "three/webgpu";
import {
  instancedBufferAttribute, uv, vec3, float, uniform, mx_fractal_noise_float, mx_noise_float, smoothstep, mix, time,
  linearDepth, viewportLinearDepth, cameraNear, cameraFar, max, clamp,
} from "three/tsl";
import { DustSim, DUST_MAX, CLOUD, type DustValues } from "./dust";
import type { Ground } from "../mech/walker";

export class DustDraw {
  readonly group = new THREE.Group();
  private sprite: THREE.Sprite;
  private posAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 3), 3);
  private sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX), 1);
  private dataAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 4), 4);
  private shadows: THREE.InstancedMesh;
  private shadowAlpha = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX), 1);
  private order = new Uint16Array(DUST_MAX);
  private depth = new Float32Array(DUST_MAX);
  private uSunView = uniform(new THREE.Vector3(0, 1, 0));
  private uLit = uniform(lin(0xe8d3aa));
  private uShade = uniform(lin(0x8c6e4c));
  private uBright = uniform(1);
  private uShadeAmt = uniform(0.5);
  private uFray = uniform(0.5);
  private uGrain = uniform(0.35);
  private uSoft = uniform(1.2);
  private uShadow = uniform(0.45);
  private uBillow = uniform(0.4);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private nn = [0, 1, 0];

  constructor(private sim: DustSim, private ground: Ground) {
    for (const a of [this.posAttr, this.sizeAttr, this.dataAttr, this.shadowAlpha]) a.setUsage(THREE.DynamicDrawUsage);

    const data = instancedBufferAttribute<"vec4">(this.dataAttr); // alpha, seed, kind, -
    const p = uv().mul(2).sub(1);
    const r = p.length();
    const seed = data.y;
    // Billowy body noise (slowly churning) frays the edge; fine noise gives the grain.
    const body = mx_fractal_noise_float(vec3(p.mul(1.4).add(seed.mul(17)), time.mul(0.12).add(seed.mul(9))), 3, 2.0, 0.55);
    const fine = mx_noise_float(vec3(p.mul(9).add(seed.mul(31)), seed.mul(5)));
    const edge = r.add(body.mul(this.uFray.mul(0.55)));
    const shape = float(1).sub(smoothstep(0.2, 1.0, edge));
    const grain = float(1).sub(this.uGrain.mul(0.6).mul(fine.mul(0.5).add(0.5)));
    // Depth fade into whatever is behind (the sand, the mech).
    const behind = viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear));
    const soft = clamp(behind.div(this.uSoft), 0, 1);
    // Round shading faked from the sprite's disc, nudged by the body noise so it billows.
    const nz = max(float(1).sub(r.mul(r)), 0).sqrt();
    const nrm = vec3(p.x, p.y, nz).normalize();
    const lit = clamp(nrm.dot(this.uSunView).mul(0.5).add(0.5).add(body.mul(this.uBillow)), 0, 1);
    const thick = data.x;
    const shadeMix = clamp(float(1).sub(lit).mul(this.uShadeAmt.mul(1.6)).add(thick.mul(this.uShadeAmt).mul(0.35)), 0, 1);
    const clumpDark = mix(float(0.82), float(1), data.z); // clumps (kind 0) read darker, heavier sand
    const col = mix(this.uLit, this.uShade, shadeMix).mul(this.uBright).mul(clumpDark);

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    mat.positionNode = instancedBufferAttribute<"vec3">(this.posAttr);
    mat.scaleNode = instancedBufferAttribute<"float">(this.sizeAttr);
    mat.rotationNode = seed.mul(6.283);
    mat.colorNode = col;
    mat.opacityNode = shape.mul(grain).mul(thick).mul(soft);
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 2;

    // Shadows: soft dark discs on the sand. Same colour for all, so their order doesn't matter.
    const sa = instancedBufferAttribute<"float">(this.shadowAlpha);
    const sp = uv().mul(2).sub(1);
    const sr = sp.length().add(mx_noise_float(vec3(sp.mul(2.2), sa.mul(13))).mul(0.18));
    const smat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    smat.colorNode = uniform(lin(0x5e4126));
    smat.opacityNode = float(1).sub(smoothstep(0.15, 1.0, sr)).mul(sa).mul(this.uShadow);
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), smat, DUST_MAX);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows, this.sprite);
  }

  /** sunDir: unit vector from the ground toward the sun. */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, v: DustValues) {
    const sim = this.sim;
    this.uBright.value = v.dustBright; this.uShadeAmt.value = v.dustShade; this.uFray.value = v.edgeFray;
    this.uGrain.value = v.grain; this.uSoft.value = v.softDistance; this.uShadow.value = v.shadowStrength; this.uBillow.value = v.billow;
    this.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);

    // Live puffs, sorted far to near.
    const e = camera.matrixWorldInverse.elements;
    let n = 0;
    for (let i = 0; i < DUST_MAX; i++) {
      if (sim.alpha[i] <= 0.002) continue;
      this.order[n++] = i;
      this.depth[i] = e[2] * sim.px[i] + e[6] * sim.py[i] + e[10] * sim.pz[i];
    }
    const ord = this.order.subarray(0, n).sort((a, b) => this.depth[a] - this.depth[b]);
    const P = this.posAttr.array as Float32Array, S = this.sizeAttr.array as Float32Array, D = this.dataAttr.array as Float32Array;
    const SA = this.shadowAlpha.array as Float32Array;
    let ns = 0;
    const sy = Math.max(0.15, sunDir.y);
    for (let j = 0; j < n; j++) {
      const i = ord[j];
      P[j * 3] = sim.px[i]; P[j * 3 + 1] = sim.py[i]; P[j * 3 + 2] = sim.pz[i];
      S[j] = sim.radius[i] * 2;
      D[j * 4] = Math.min(1, sim.alpha[i]); D[j * 4 + 1] = sim.seed[i]; D[j * 4 + 2] = sim.kind[i]; D[j * 4 + 3] = 0;
      // Shadow: down the sun's ray from the puff to the sand (two steps to land on the dune), facing the slope.
      const k = sim.kind[i] === CLOUD ? 1 : 0.6;
      let h = sim.py[i] - this.ground.height(sim.px[i], sim.pz[i]);
      let x = sim.px[i] - (sunDir.x / sy) * h, z = sim.pz[i] - (sunDir.z / sy) * h;
      h = sim.py[i] - this.ground.height(x, z);
      x = sim.px[i] - (sunDir.x / sy) * h; z = sim.pz[i] - (sunDir.z / sy) * h;
      const gy = this.ground.height(x, z);
      const nr = this.ground.normal(x, z, this.nn);
      this.n.set(nr[0], nr[1], nr[2]);
      this.q.setFromUnitVectors(UP, this.n);
      const d = sim.radius[i] * 2 * v.shadowSize * (1 + Math.min(1, h / 6) * 0.4); // higher puffs cast softer, wider shadows
      this.m.compose(this.p.set(x, gy + 0.03, z), this.q, this.s.set(d, 1, d));
      this.shadows.setMatrixAt(ns, this.m);
      SA[ns] = Math.min(1, sim.alpha[i]) * k / (1 + Math.min(1, h / 6) * 0.5);
      ns++;
    }
    this.sprite.count = n;
    this.shadows.count = ns;
    for (const a of [this.posAttr, this.sizeAttr, this.dataAttr, this.shadowAlpha]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true; }
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** An sRGB hex colour as a linear vec3 (what the shader works in). */
function lin(hex: number) { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }
