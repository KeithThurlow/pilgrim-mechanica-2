// Draws the dust sim (dust.ts): soft camera-facing puffs, back to front, with frayed grainy edges from noise, a faked
// round shading (lit on the sun side, browner and darker underneath, thicker puffs shading themselves), and a depth
// fade so they melt into the sand and wrap round the mech. Under each puff, a soft shadow laid on the sand, pushed
// away from the sun by the puff's height (the dark band under the trail in Keith's reference video).
// Puffs also receive the sun's shadows (Keith 2026-10-24: dust in shade was as bright as dust in the sun): each
// pixel looks up the sun's shadow map where it sits on its sprite, four taps for a soft edge. They don't shadow
// each other.
// The GPU dust (scale step 5, src/fx/gpuDust.ts) is drawn here too, with the same shader and uniforms (attachGpu): its
// sprites and shadows read the particle buffers directly, unsorted, with no CPU work a frame.
import * as THREE from "three/webgpu";
import {
  instancedBufferAttribute, uv, vec3, float, uniform, mx_fractal_noise_float, mx_noise_float, smoothstep, mix, time,
  linearDepth, viewportLinearDepth, cameraNear, cameraFar, max, clamp, texture, vec2, vec4, abs,
  Fn, min, select, atan, cameraViewMatrix, positionLocal, varyingProperty,
} from "three/tsl";
import { DustSim, DUST_MAX, CLOUD, SPRAY, type DustValues } from "./dust";
import type { Ground } from "../mech/walker";
import { sunReach } from "../world/raycast";
import { puffLook, type GpuDust } from "./gpuDust";
import { groundAt, type GpuGroundSource } from "./gpuGround";

type Parts = { col: THREE.Node<"vec3">; p: THREE.Node<"vec2">; centre: THREE.Node<"vec3">; size: THREE.Node<"float">; sunVis: THREE.Node<"float"> };

export class DustDraw {
  readonly group = new THREE.Group();
  private sprite: THREE.Sprite;
  private posAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 3), 3);
  private sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 2), 2);
  private rotAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX), 1);
  private dataAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 4), 4);
  /** Per sprite: 1 in the sun, 0 behind a dune (marched against the ground toward the sun on the CPU). */
  private sunAttr = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX).fill(1), 1);
  /** Per puff (sim index): the same, smoothed; each puff is re-marched every few frames. */
  private sunVis = new Float32Array(DUST_MAX).fill(1);
  private frame = 0;
  private shadows: THREE.InstancedMesh;
  private shadowAlpha = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX), 1);
  private order = new Uint16Array(DUST_MAX);
  private depth = new Float32Array(DUST_MAX);
  private projView = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private uSunView = uniform(new THREE.Vector3(0, 1, 0));
  private uLit = uniform(lin(0xe8d3aa));
  private uShade = uniform(lin(0x8c6e4c));
  /** Dust in shade is lit by the sky: paler and greyer than its own shaded side, not a dark brown (Keith's shot 2026-10-24). */
  private uShadowCol = uniform(lin(0xa39282));
  private uBright = uniform(1);
  private uShadeAmt = uniform(0.5);
  private uFray = uniform(0.5);
  private uGrain = uniform(0.35);
  private uSoft = uniform(1.2);
  private uShadow = uniform(0.45);
  private uBillow = uniform(0.4);
  private uInShadow = uniform(0.6);
  private uCamRight = uniform(new THREE.Vector3(1, 0, 0));
  private uCamUp = uniform(new THREE.Vector3(0, 1, 0));
  private uTap = uniform(0.002);
  private uBias = uniform(-0.002);
  private shadowWired = false;
  /** Each puff material (the CPU's, the GPU's) and the pieces of its shader kept to rebuild its colour once the sun's
   *  shadow map exists. */
  private mats: { mat: THREE.SpriteNodeMaterial; parts: Parts }[] = [];
  /** The sun's direction (world, toward it) for the GPU shadows. */
  private uSunWorld = uniform(new THREE.Vector3(0, 1, 0));
  private uShadowSize = uniform(1.1);
  /** The GPU dust's sprites and shadows (attachGpu), and whether they're the ones in use. */
  private gpuSprite: THREE.Sprite | null = null;
  private gpuLow: THREE.Sprite | null = null;
  private gpuShadows: THREE.InstancedMesh | null = null;
  gpuOn = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private nn = [0, 1, 0];
  /**
   * Under each puff's shadow, the ground kept from where it was last read (perf pass 1): the point, its height and
   * slope, and its normal; read again after drifting dustGroundRefresh metres or on its turn. lastAge spots a slot
   * reused by a fresh puff (its age went down).
   */
  private sx = new Float32Array(DUST_MAX).fill(NaN); private sz = new Float32Array(DUST_MAX); private sy = new Float32Array(DUST_MAX);
  private sdx = new Float32Array(DUST_MAX); private sdz = new Float32Array(DUST_MAX);
  private snx = new Float32Array(DUST_MAX); private sny = new Float32Array(DUST_MAX).fill(1); private snz = new Float32Array(DUST_MAX);
  private lastAge = new Float32Array(DUST_MAX).fill(1e9);
  /** Ground reads this frame (shadows, sun marches), for the perf notes. */
  groundReads = 0;

  /** ground: what the shadows and the sun march read (the true ground, or a cheap one for looks). */
  constructor(private sim: DustSim, public ground: Ground) {
    for (const a of [this.posAttr, this.sizeAttr, this.rotAttr, this.dataAttr, this.shadowAlpha, this.sunAttr]) a.setUsage(THREE.DynamicDrawUsage);

    const data = instancedBufferAttribute<"vec4">(this.dataAttr); // alpha, seed, kind, surface darkness
    const centre = instancedBufferAttribute<"vec3">(this.posAttr), size2 = instancedBufferAttribute<"vec2">(this.sizeAttr);
    const sunVis = instancedBufferAttribute<"float">(this.sunAttr);
    this.sprite = new THREE.Sprite(this.puffMaterial(data, centre, size2, instancedBufferAttribute<"float">(this.rotAttr), sunVis));
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 2;

    // Shadows: soft dark discs on the sand. Same colour for all, so their order doesn't matter.
    const sa = instancedBufferAttribute<"float">(this.shadowAlpha);
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMaterial(sa), DUST_MAX);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows, this.sprite);
  }

  /** The soft dark disc a puff lays on the sand, `sa` its strength. */
  private shadowMaterial(sa: THREE.Node<"float">) {
    const sp = uv().mul(2).sub(1);
    const sr = sp.length().add(mx_noise_float(vec3(sp.mul(2.2), sa.mul(13))).mul(0.18));
    const smat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    smat.colorNode = uniform(lin(0x5e4126));
    smat.opacityNode = float(1).sub(smoothstep(0.15, 1.0, sr)).mul(sa).mul(this.uShadow);
    return smat;
  }

  /**
   * The puff shader (CPU and GPU dust alike): data is (alpha, seed, kind, surface darkness); centre, size (x, y),
   * rotation and sun visibility (1 lit .. 0 behind a dune) per puff.
   */
  private puffMaterial(data: THREE.Node<"vec4">, centre: THREE.Node<"vec3">, size2: THREE.Node<"vec2">, rotation: THREE.Node<"float">, sunVis: THREE.Node<"float">) {
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
    const clumpDark = mix(float(0.8), float(1), float(1).sub(abs(data.z.sub(1)))); // clumps and spray (kinds 0, 2) read darker, heavier sand
    const col = mix(this.uLit, this.uShade, shadeMix).mul(this.uBright).mul(clumpDark).mul(float(1).sub(data.w.mul(0.55)));

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    void seed;
    this.mats.push({ mat, parts: { col, p, centre, size: size2.y, sunVis } });
    mat.positionNode = centre;
    mat.scaleNode = size2;
    mat.rotationNode = rotation;
    // Behind a dune (the CPU march) the puff takes the shaded colour; the shadow map adds the mech's and the rest.
    mat.colorNode = mix(mix(col, this.uShadowCol.mul(this.uBright), this.uInShadow), col, sunVis);
    mat.opacityNode = shape.mul(grain).mul(thick).mul(soft);
    return mat;
  }

  /**
   * Draw the GPU dust (src/fx/gpuDust.ts) too: sprites and shadows straight off its buffers, with this shader and these
   * uniforms. Shown instead of nothing new from the CPU while gpuOn.
   */
  attachGpu(gpu: GpuDust, G: GpuGroundSource) {
    const N = gpu.pool.N;
    const pa = gpu.pool.P.toAttribute(), va = gpu.pool.V.toAttribute(), aa = gpu.pool.A.toAttribute(), ba = gpu.pool.B.toAttribute();
    const look = puffLook(pa.w, va.w, aa.x, aa.y, aa.z, gpu.uGrow);
    const radius = look.radius, alpha = min(1, look.alpha);
    const isSpray = aa.z.sub(SPRAY).abs().lessThan(0.5), live = alpha.greaterThan(0.002);
    // A spray streak lies along its motion on screen, longer the faster it goes.
    const sv = cameraViewMatrix.mul(vec4(va.xyz, 0));
    const along = select(isSpray, radius.mul(2).add(vec2(sv.x, sv.y).length().mul(0.05)), radius.mul(2));
    const size2 = select(live, vec2(along, radius.mul(2)), vec2(0, 0));
    const rot = select(isSpray, atan(sv.y, sv.x), aa.w.mul(6.283));
    const data = vec4(alpha, aa.w, aa.z, ba.x);
    // Unsorted, so in two passes: the low, dense clumps and spray first, the cloud over them (as the sort would have
    // it nearly always: the cloud rises and spreads above what's on the sand).
    const isCloud = aa.z.sub(CLOUD).abs().lessThan(0.5);
    const low = new THREE.Sprite(this.puffMaterial(data, pa.xyz, select(isCloud, vec2(0, 0), size2), rot, float(1)));
    const sprite = new THREE.Sprite(this.puffMaterial(data, pa.xyz, select(isCloud, size2, vec2(0, 0)), rot, float(1)));
    for (const s of [low, sprite]) { s.count = N; s.frustumCulled = false; s.visible = false; }
    low.renderOrder = 2;
    sprite.renderOrder = 2.5;

    // Its shadow: down the sun's ray to the ground (twice, to land on the dune), a disc draped on the ground there.
    const vA = varyingProperty("float", "vDustShadowA");
    const smat = this.shadowMaterial(vA);
    smat.positionNode = Fn(() => {
      const sun = this.uSunWorld, sy = max(sun.y, 0.15);
      const g0 = groundAt(G, pa.x, pa.z, ba.z).x;
      const h0 = pa.y.sub(g0);
      const x0 = pa.x.sub(sun.x.div(sy).mul(h0)), z0 = pa.z.sub(sun.z.div(sy).mul(h0));
      const h = pa.y.sub(groundAt(G, x0, z0, ba.z).x);
      const x = pa.x.sub(sun.x.div(sy).mul(h)), z = pa.z.sub(sun.z.div(sy).mul(h));
      const hk = min(1, max(h, 0).div(6));
      const k = select(aa.z.sub(CLOUD).abs().lessThan(0.5), float(1), select(isSpray, float(0.3), float(0.6)));
      vA.assign(alpha.mul(k).div(hk.mul(0.5).add(1)));
      const d = select(live, radius.mul(2).mul(this.uShadowSize).mul(hk.mul(0.4).add(1)), float(0));
      const cx = x.add(positionLocal.x.mul(d)), cz = z.add(positionLocal.z.mul(d));
      return vec3(cx, groundAt(G, cx, cz, ba.z).x.add(0.03), cz);
    })();
    const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), smat, N);
    shadows.frustumCulled = false;
    shadows.renderOrder = 1;
    shadows.visible = false;
    this.gpuSprite = sprite; this.gpuLow = low; this.gpuShadows = shadows;
    this.group.add(shadows, low, sprite);
  }

  /** Once the renderer has made the sun's shadow map: shade each puff pixel by it (soft, four taps). */
  private wireShadows(light: THREE.DirectionalLight) {
    const depthTex = light.shadow.map?.depthTexture;
    if (!depthTex) return;
    this.shadowWired = true;
    const shadowMatrix = uniform(light.shadow.matrix);
    for (const { mat, parts } of this.mats) {
      const { col, p, centre, size, sunVis } = parts;
      // Where to look up the shadow: across the puff sideways and up (never down into the sand under it, which
      // striped the dust with the sand's own shadow), so a puff half in shade is shaded across it.
      const world = centre.add(this.uCamRight.mul(p.x.mul(size).mul(0.5))).add(vec3(0, size.mul(0.15).add(p.y.max(0).mul(size).mul(0.4)), 0));
      const sc = shadowMatrix.mul(vec4(world, 1));
      const xyz = sc.xyz.div(sc.w);
      const suv = vec2(xyz.x, xyz.y.oneMinus()), z = xyz.z.add(this.uBias);
      const t = this.uTap;
      const tap = (dx: number, dy: number) => texture(depthTex, suv.add(vec2(t.mul(dx), t.mul(dy)))).compare(z);
      const vis = tap(1, 0.4).add(tap(-1, -0.4)).add(tap(0.4, -1)).add(tap(-0.4, 1)).mul(0.25);
      // In shade the puff loses its sunlit side: toward the shaded brown, darker.
      const shaded = mix(col, this.uShadowCol.mul(this.uBright), this.uInShadow);
      mat.colorNode = mix(shaded, col, vis.min(sunVis));
      mat.needsUpdate = true;
    }
  }

  /** sunDir: unit vector from the ground toward the sun. sun: the light whose shadows the dust receives. */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, v: DustValues, sun?: THREE.DirectionalLight) {
    const sim = this.sim;
    if (sun && !this.shadowWired) this.wireShadows(sun);
    if (sun) {
      const sc = sun.shadow.camera as THREE.OrthographicCamera;
      this.uTap.value = v.dustShadowBlur / Math.max(1, sc.right - sc.left);
      this.uBias.value = sun.shadow.bias - 0.0015;
    }
    this.uInShadow.value = v.inShadow;
    const me = camera.matrixWorld.elements;
    this.uCamRight.value.set(me[0], me[1], me[2]).normalize();
    this.uCamUp.value.set(me[4], me[5], me[6]).normalize();
    this.uBright.value = v.dustBright; this.uShadeAmt.value = v.dustShade; this.uFray.value = v.edgeFray;
    this.uGrain.value = v.grain; this.uSoft.value = v.softDistance; this.uShadow.value = v.shadowStrength; this.uBillow.value = v.billow;
    this.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    this.uSunWorld.value.copy(sunDir);
    this.uShadowSize.value = v.shadowSize;
    if (this.gpuSprite) {
      this.gpuSprite.visible = this.gpuLow!.visible = this.gpuShadows!.visible = this.gpuOn;
    }

    // Live puffs in view, sorted far to near. Puffs outside the view (plus a margin for their shadows on the sand) are
    // left out: the convoy's dust far behind the camera used to be sorted, shaded and sun-marched every frame.
    const e = camera.matrixWorldInverse.elements;
    this.projView.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    // The camera's own depth convention (WebGPU and WebGL clip depth differently), so the near plane lands right.
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    const planes = this.frustum.planes, margin = v.dustCullMargin;
    let n = 0;
    outer: for (let i = 0; i < DUST_MAX; i++) {
      if (sim.alpha[i] <= 0.002) continue;
      const x = sim.px[i], y = sim.py[i], z = sim.pz[i], r = sim.radius[i] + margin;
      for (let k = 0; k < 6; k++) {
        const pl = planes[k], nn = pl.normal;
        if (nn.x * x + nn.y * y + nn.z * z + pl.constant < -r) continue outer;
      }
      this.order[n++] = i;
      this.depth[i] = e[2] * sim.px[i] + e[6] * sim.py[i] + e[10] * sim.pz[i];
    }
    const ord = this.order.subarray(0, n).sort((a, b) => this.depth[a] - this.depth[b]);
    const P = this.posAttr.array as Float32Array, S = this.sizeAttr.array as Float32Array, D = this.dataAttr.array as Float32Array;
    const R = this.rotAttr.array as Float32Array;
    const SA = this.shadowAlpha.array as Float32Array;
    const SV = this.sunAttr.array as Float32Array;
    this.frame++;
    let ns = 0;
    const sy = Math.max(0.15, sunDir.y);
    const sunEvery = Math.max(1, Math.round(v.dustSunEvery ?? 8)), every = Math.max(1, Math.round(v.dustGroundEvery ?? 30));
    const R2 = (v.dustGroundRefresh ?? 1.5) ** 2;
    this.groundReads = 0;
    for (let j = 0; j < n; j++) {
      const i = ord[j];
      P[j * 3] = sim.px[i]; P[j * 3 + 1] = sim.py[i]; P[j * 3 + 2] = sim.pz[i];
      if (sim.kind[i] === SPRAY) {
        // A streak along its motion on screen, longer the faster it goes.
        const vx = sim.vx[i], vy = sim.vy[i], vz = sim.vz[i];
        const sx = e[0] * vx + e[4] * vy + e[8] * vz, sy2 = e[1] * vx + e[5] * vy + e[9] * vz;
        R[j] = Math.atan2(sy2, sx);
        S[j * 2] = sim.radius[i] * 2 + Math.hypot(sx, sy2) * 0.05; S[j * 2 + 1] = sim.radius[i] * 2;
      } else {
        R[j] = sim.seed[i] * 6.283;
        S[j * 2] = S[j * 2 + 1] = sim.radius[i] * 2;
      }
      const fresh = sim.age[i] < this.lastAge[i];
      this.lastAge[i] = sim.age[i];
      // Hill shadow on the puff: on its turn (every dustSunEvery frames) march toward the sun over the dunes.
      if (fresh || (i + this.frame) % sunEvery === 0) {
        const target = sunReach(this.ground, sim.px[i], sim.py[i] + sim.radius[i] * 0.3, sim.pz[i], sunDir);
        this.sunVis[i] += (target - this.sunVis[i]) * (fresh || sim.age[i] < 0.1 ? 1 : 0.5);
        this.groundReads += 25;
      }
      SV[j] = this.sunVis[i];
      D[j * 4] = Math.min(1, sim.alpha[i]); D[j * 4 + 1] = sim.seed[i]; D[j * 4 + 2] = sim.kind[i]; D[j * 4 + 3] = sim.tint[i];
      // Shadow: down the sun's ray from the puff to the sand (two steps to land on the dune), facing the slope. The
      // ground under the puff is the sim's kept plane; under the shadow, this one's.
      const k = sim.kind[i] === CLOUD ? 1 : sim.kind[i] === SPRAY ? 0.3 : 0.6;
      let h = sim.py[i] - sim.floorAt(i);
      let x = sim.px[i] - (sunDir.x / sy) * h, z = sim.pz[i] - (sunDir.z / sy) * h;
      {
        const dx = x - this.sx[i], dz = z - this.sz[i];
        if (fresh || !(dx * dx + dz * dz <= R2) || (i + this.frame) % every === 0) {
          this.sx[i] = x; this.sz[i] = z;
          this.sy[i] = this.ground.height(x, z);
          const nr = this.ground.normal(x, z, this.nn), ny = Math.max(0.2, nr[1]);
          this.snx[i] = nr[0]; this.sny[i] = nr[1]; this.snz[i] = nr[2];
          this.sdx[i] = -nr[0] / ny; this.sdz[i] = -nr[2] / ny;
          this.groundReads += 2;
        }
      }
      h = sim.py[i] - (this.sy[i] + this.sdx[i] * (x - this.sx[i]) + this.sdz[i] * (z - this.sz[i]));
      x = sim.px[i] - (sunDir.x / sy) * h; z = sim.pz[i] - (sunDir.z / sy) * h;
      const gy = this.sy[i] + this.sdx[i] * (x - this.sx[i]) + this.sdz[i] * (z - this.sz[i]);
      this.n.set(this.snx[i], this.sny[i], this.snz[i]);
      this.q.setFromUnitVectors(UP, this.n);
      const d = sim.radius[i] * 2 * v.shadowSize * (1 + Math.min(1, h / 6) * 0.4); // higher puffs cast softer, wider shadows
      this.m.compose(this.p.set(x, gy + 0.03, z), this.q, this.s.set(d, 1, d));
      this.shadows.setMatrixAt(ns, this.m);
      SA[ns] = Math.min(1, sim.alpha[i]) * k / (1 + Math.min(1, h / 6) * 0.5);
      ns++;
    }
    this.sprite.count = n;
    this.shadows.count = ns;
    for (const a of [this.posAttr, this.sizeAttr, this.rotAttr, this.dataAttr, this.shadowAlpha, this.sunAttr]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true; }
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** An sRGB hex colour as a linear vec3 (what the shader works in). */
function lin(hex: number) { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }
