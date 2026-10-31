// Draws the blast waves (src/fx/blastWaves.ts). Cosmetic.
// - The bend: one instanced quad per wave or heat puff, placed straight in clip space over the wave's patch of screen,
//   that samples a copy of the frame (viewportSharedTexture) at an offset: a ring pushing the picture outward, or a
//   noisy shimmer. The frame is copied once a frame however many quads draw, and not at all when nothing is live (the
//   mesh is hidden). Drawn last, over everything, no depth test (a shock passes in front of the mech too).
//   Works on WebGPU and the WebGL 2 fallback (the copy is a framebuffer blit either way).
// - The ground ring: a quick bright ring on the sand under blasts on the ground, laid on the ground's slope, additive;
//   at night it also asks the night lights for a short held light (src/world/lamps.ts ShortLights.hold).
// - Heat sources: bodies that want shimmer over them (the excavator's beam) set `object.userData.heat = (waves) => ...`;
//   found by a scan of the scene once a second.
import * as THREE from "three/webgpu";
import { Fn, float, vec2, vec3, vec4, sin, cos, exp, clamp, mix, max, screenUV, viewportSharedTexture, instancedBufferAttribute, uniform, positionGeometry, time } from "three/tsl";
import { BlastWaves } from "./blastWaves";
import type { Ground } from "../mech/walker";
import type { ShortLights } from "../world/lamps";

const MAX_QUADS = 256, MAX_RINGS = 32;
const UP = new THREE.Vector3(0, 1, 0);

export type HeatSource = (waves: BlastWaves) => void;

export class BlastWavesDraw {
  readonly group = new THREE.Group();
  /** The bend quads. */
  readonly bend: THREE.Mesh;
  /** The ground rings. */
  readonly rings: THREE.InstancedMesh;
  /** Last frame: quads and rings drawn, whether the frame copy ran. */
  readonly stats = { quads: 0, rings: 0, copy: false };
  private A: THREE.InstancedBufferAttribute;
  private B: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private uAspect = uniform(1);
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private nn = [0, 1, 0];
  private heatSources: { o: THREE.Object3D; fn: HeatSource }[] = [];
  private scanT = 1e9;

  constructor(private waves: BlastWaves, private ground: Ground) {
    // A unit quad (-1..1); every instance is placed in clip space by its own attributes.
    const base = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    // A: screen centre (u, v from the top left), reach and ring thickness (in screen heights).
    // B: bend (screen heights), mode (0 ring, 1 shimmer), seed, rim brightness.
    this.A = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    this.B = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    for (const a of [this.A, this.B]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("waveA", this.A);
    this.geo.setAttribute("waveB", this.B);
    this.geo.instanceCount = 0;
    const A = instancedBufferAttribute<"vec4">(this.A), B = instancedBufferAttribute<"vec4">(this.B);
    const aspect = this.uAspect;

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false });
    mat.vertexNode = Fn(() => {
      const p = positionGeometry;
      // Half the patch in screen heights: the ring's reach plus its thickness, or the puff's size.
      const ext = mix(A.z.add(A.w.mul(2.5)), A.z, B.y);
      const cx = A.x.mul(2).sub(1), cy = float(1).sub(A.y.mul(2));
      return vec4(cx.add(p.x.mul(ext).mul(2).div(aspect)), cy.add(p.y.mul(ext).mul(2)), 0, 1);
    })();
    const shade = Fn(() => {
      const rel = screenUV.sub(A.xy).mul(vec2(aspect, 1));
      const d = rel.length();
      const dir = rel.div(max(d, 1e-5));
      // The ring: a band round the front, pushing the picture outward.
      const x = d.sub(A.z).div(max(A.w, 1e-5));
      const band = exp(x.mul(x).negate().mul(2));
      const ringOff = dir.mul(band.mul(B.x));
      // The shimmer: wobbling noise inside the puff, strongest at its middle.
      const qn = rel.div(max(A.z, 1e-5));
      const fall = clamp(float(1).sub(qn.length()), 0, 1);
      const f2 = fall.mul(fall), t = time, sd = B.z;
      const nx = sin(qn.y.mul(9).add(t.mul(11)).add(sd)).add(sin(qn.x.mul(13).sub(t.mul(7)).add(sd.mul(1.7))).mul(0.5));
      const ny = cos(qn.x.mul(8).add(t.mul(10)).add(sd.mul(0.7))).add(sin(qn.y.mul(12).add(t.mul(8))).mul(0.5));
      const shimOff = vec2(nx, ny).mul(f2).mul(B.x).mul(0.6);
      const off = mix(ringOff, shimOff, B.y).div(vec2(aspect, 1));
      const col = viewportSharedTexture(screenUV.add(off)).rgb;
      const rim = band.mul(B.w).mul(float(1).sub(B.y));
      const mask = mix(band, fall, B.y);
      return vec4(col.add(vec3(1, 0.72, 0.45).mul(rim)), clamp(mask.mul(3), 0, 1));
    })();
    mat.colorNode = shade.rgb;
    mat.opacityNode = shade.a;
    this.bend = new THREE.Mesh(this.geo, mat);
    this.bend.frustumCulled = false;
    this.bend.renderOrder = 100;
    this.bend.visible = false;

    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    ringMat.polygonOffset = true; ringMat.polygonOffsetFactor = -6;
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), ringMat, MAX_RINGS);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    this.rings.count = 0;
    this.group.add(this.rings, this.bend);
  }

  /** Bodies with `userData.heat` under the scene (rescanned once a second). */
  private scan(root: THREE.Object3D) {
    this.heatSources = [];
    root.traverse((o) => { if (o.userData.heat) this.heatSources.push({ o, fn: o.userData.heat as HeatSource }); });
  }

  /**
   * Once a frame, after everything posted its blasts: heat sources, the waves' sim, then the quads and rings.
   * lights: the night lights (null by day or without a look); light k scales the ground ring's light (blastLight).
   */
  update(dt: number, camera: THREE.PerspectiveCamera, lights: ShortLights | null, blastLight = 2600) {
    const w = this.waves, v = w.v;
    this.scanT += dt;
    if (this.scanT > 1) {
      this.scanT = 0;
      let root: THREE.Object3D = this.group;
      while (root.parent) root = root.parent;
      this.scan(root);
    }
    for (const h of this.heatSources) if (h.o.parent && h.o.visible) h.fn(w);
    w.update(dt);
    const on = w.active;
    let nq = 0, nr = 0;
    if (on) {
      const A = this.A.array as Float32Array, B = this.B.array as Float32Array;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      this.uAspect.value = camera.aspect;
      // Screen height (m) at a point: the bend and reach are given in metres there.
      const place = (x: number, y: number, z: number): number => {
        const p = this.p.set(x, y, z).project(camera);
        if (p.z > 1 || p.z < -1) return -1;
        const dist = camera.position.distanceTo(this.s.set(x, y, z));
        A[nq * 4] = (p.x + 1) / 2; A[nq * 4 + 1] = (1 - p.y) / 2;
        return 2 * dist * tanH;
      };
      for (const wv of w.waves) {
        if (nq >= MAX_QUADS) break;
        const { front, fade } = BlastWaves.shape(wv, v.waveEase);
        if (fade <= 0.002 || front <= 0) continue;
        const H = place(wv.x, wv.y, wv.z);
        if (H <= 0) continue;
        const r = (wv.reach * front) / H;
        // Off screen by more than its reach: skip.
        const cu = A[nq * 4], cv = A[nq * 4 + 1], ext = r * 1.5;
        if (cu < -ext || cu > 1 + ext || cv < -ext || cv > 1 + ext) continue;
        const o = nq * 4;
        A[o + 2] = r; A[o + 3] = Math.max(0.002, (wv.thick * wv.reach * (0.4 + 0.6 * front)) / H);
        B[o] = (wv.strength * fade) / H; B[o + 1] = 0; B[o + 2] = 0; B[o + 3] = v.waveRim * fade;
        nq++;
      }
      for (const pf of w.puffs) {
        if (nq >= MAX_QUADS) break;
        const u = pf.t / pf.life, fade = Math.sin(Math.PI * Math.min(1, u * 1.4 + 0.05)) * (1 - u);
        if (fade <= 0.01) continue;
        const H = place(pf.x, pf.y, pf.z);
        if (H <= 0) continue;
        const o = nq * 4;
        A[o + 2] = (pf.size * (0.7 + 0.5 * u)) / H; A[o + 3] = 0;
        B[o] = (pf.strength * fade) / H; B[o + 1] = 1; B[o + 2] = pf.seed; B[o + 3] = 0;
        nq++;
      }
      if (nq) { this.A.needsUpdate = true; this.B.needsUpdate = true; this.A.addUpdateRange(0, nq * 4); this.B.addUpdateRange(0, nq * 4); }

      // The ground rings, and their light at night.
      for (const wv of w.waves) {
        if (!wv.ground || nr >= MAX_RINGS || v.waveGround <= 0 || wv.groundReach <= 0) continue;
        const u = wv.t / Math.max(0.02, v.waveGroundLife);
        if (u >= 1 || u < 0) continue;
        const f = (1 - u) * (1 - u), rad = wv.groundReach * (0.25 + 0.75 * (1 - Math.pow(1 - u, 2)));
        const gy = this.ground.height(wv.x, wv.z);
        const nr3 = this.ground.normal(wv.x, wv.z, this.nn);
        this.q.setFromUnitVectors(UP, this.n.set(nr3[0], nr3[1], nr3[2]));
        this.m.compose(this.p.set(wv.x, gy + 0.12, wv.z), this.q, this.s.set(rad, 1, rad));
        this.rings.setMatrixAt(nr, this.m);
        this.rings.setColorAt(nr, this.c.setRGB(1, 0.62, 0.3).multiplyScalar(f * v.waveGround));
        nr++;
        if (lights && v.waveGroundLight > 0) lights.hold(wv.x, gy + 1, wv.z, blastLight * 0.4 * v.waveGroundLight * f, rad * 1.6 + 4, 0xffb070, 0.8, rad);
      }
      if (nr) { this.rings.instanceMatrix.needsUpdate = true; this.rings.instanceColor!.needsUpdate = true; }
    }
    this.geo.instanceCount = nq;
    this.bend.visible = nq > 0;
    this.rings.count = nr;
    this.rings.visible = nr > 0;
    this.stats.quads = nq; this.stats.rings = nr; this.stats.copy = nq > 0;
  }
}
