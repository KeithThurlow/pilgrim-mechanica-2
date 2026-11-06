// Draws the blast waves (src/fx/blastWaves.ts). Cosmetic.
// - The orb (Keith 2026-11-01: "a distortion shader on an orb that scales outwards", in place of the solid ground
//   ring): one instanced sphere per wave, growing to the wave's reach (the blast's damage radius by default, so what
//   is inside the orb is inside the blast). Its shader samples a copy of the frame (viewportSharedTexture) bent along
//   the sphere's normal on screen, most at its silhouette and barely through its middle, like a bubble of hot air,
//   with a faint wobble and a faint hot rim. Not depth tested (drawn over everything).
// - The clear spot (Claude 2026-11-05: a crowd's rockets left a pale dome over the mech): orbs and shimmer fade out
//   within waveClear metres of the local player's mech on screen, so blasts on it bend the air round it, not over it.
// - The shimmer: heat puffs (exhaust behind rockets, heat over big blasts, the beam) are instanced quads placed
//   straight in clip space that sample the same copy with a noisy offset, drawn last, no depth test.
//   The frame is copied once a frame however many draw, and not at all when nothing is live (both meshes hidden).
//   Works on WebGPU and the WebGL 2 fallback (the copy is a framebuffer blit either way).
// - At night a blast on the ground also asks the night lights for a short held light (src/world/lamps.ts ShortLights.hold).
// - Heat sources: bodies that want shimmer over them (the excavator's beam) set `object.userData.heat = (waves) => ...`;
//   found by a scan of the scene once a second.
import * as THREE from "three/webgpu";
import { Fn, float, vec2, vec3, vec4, sin, cos, clamp, max, abs, dot, pow, normalize, smoothstep, screenUV, viewportSharedTexture, instancedBufferAttribute, uniform, positionGeometry, positionView, normalView, time } from "three/tsl";
import { BlastWaves } from "./blastWaves";
import type { Ground } from "../mech/walker";
import type { ShortLights } from "../world/lamps";

const MAX_QUADS = 256, MAX_ORBS = 64;

export type HeatSource = (waves: BlastWaves) => void;

export class BlastWavesDraw {
  readonly group = new THREE.Group();
  /** The shimmer quads (heat puffs). */
  readonly bend: THREE.Mesh;
  /** The wave orbs. */
  readonly orbs: THREE.InstancedMesh;
  /** Last frame: shimmer quads and orbs drawn, whether the frame copy ran. */
  readonly stats = { quads: 0, orbs: 0, copy: false };
  private O: THREE.InstancedBufferAttribute;
  private A: THREE.InstancedBufferAttribute;
  private B: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private uAspect = uniform(1);
  /** The clear spot over your mech: screen centre (u, v from the top left), radius (screen heights; 0 off), soft share. */
  private uClear = uniform(new THREE.Vector4(0, 0, 0, 0.5));
  private p = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private heatSources: { o: THREE.Object3D; fn: HeatSource }[] = [];
  private scanT = 1e9;

  constructor(private waves: BlastWaves, private ground: Ground) {
    // A unit quad (-1..1); every instance is placed in clip space by its own attributes.
    const base = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    // A: screen centre (u, v from the top left), size (in screen heights), unused.
    // B: bend (screen heights), unused, seed, unused.
    this.A = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    this.B = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    for (const a of [this.A, this.B]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("waveA", this.A);
    this.geo.setAttribute("waveB", this.B);
    this.geo.instanceCount = 0;
    const A = instancedBufferAttribute<"vec4">(this.A), B = instancedBufferAttribute<"vec4">(this.B);
    const aspect = this.uAspect, C = this.uClear;
    // 0 over your mech, 1 outside the clear spot (Claude 2026-11-05: a rain of blasts on the mech hid it under orbs).
    const clearMask = Fn(() => {
      const d = screenUV.sub(C.xy).mul(vec2(aspect, 1)).length();
      const r = max(C.z, 1e-5);
      return C.z.greaterThan(0).select(smoothstep(r.mul(float(1).sub(C.w)), r, d), float(1));
    });

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false });
    mat.vertexNode = Fn(() => {
      const p = positionGeometry;
      // Half the patch in screen heights: the puff's size.
      const ext = A.z;
      const cx = A.x.mul(2).sub(1), cy = float(1).sub(A.y.mul(2));
      return vec4(cx.add(p.x.mul(ext).mul(2).div(aspect)), cy.add(p.y.mul(ext).mul(2)), 0, 1);
    })();
    const shade = Fn(() => {
      const rel = screenUV.sub(A.xy).mul(vec2(aspect, 1));
      // Wobbling noise inside the puff, strongest at its middle.
      const qn = rel.div(max(A.z, 1e-5));
      const fall = clamp(float(1).sub(qn.length()), 0, 1);
      const f2 = fall.mul(fall), t = time, sd = B.z;
      const nx = sin(qn.y.mul(9).add(t.mul(11)).add(sd)).add(sin(qn.x.mul(13).sub(t.mul(7)).add(sd.mul(1.7))).mul(0.5));
      const ny = cos(qn.x.mul(8).add(t.mul(10)).add(sd.mul(0.7))).add(sin(qn.y.mul(12).add(t.mul(8))).mul(0.5));
      const off = vec2(nx, ny).mul(f2).mul(B.x).mul(0.6).div(vec2(aspect, 1));
      const col = viewportSharedTexture(screenUV.add(off)).rgb;
      return vec4(col, clamp(fall.mul(3), 0, 1).mul(clearMask()));
    })();
    mat.colorNode = shade.rgb;
    mat.opacityNode = shade.a;
    this.bend = new THREE.Mesh(this.geo, mat);
    this.bend.frustumCulled = false;
    this.bend.renderOrder = 100;
    this.bend.visible = false;

    // The orbs: a sphere each, scaled by its matrix; per orb O = (bend in screen heights, fade, rim, shell sharpness).
    const sphere = new THREE.IcosahedronGeometry(1, 3);
    this.O = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ORBS * 4), 4);
    this.O.setUsage(THREE.DynamicDrawUsage);
    sphere.setAttribute("orb", this.O);
    const O = instancedBufferAttribute<"vec4">(this.O);
    const orbMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.FrontSide });
    const orbShade = Fn(() => {
      const n = normalize(normalView), vd = normalize(positionView).negate();
      // 0 through the middle, 1 at the silhouette.
      const edge = clamp(float(1).sub(abs(dot(n, vd))), 0, 1);
      const shell = pow(edge, O.w);
      // Its normal on screen (v runs down): the picture is drawn in from outside, so it looks pushed outward.
      const sdir = vec2(n.x, n.y.negate());
      const t = time, sp = positionGeometry;
      const wob = vec2(sin(sp.y.mul(7).add(t.mul(13)).add(sp.x.mul(5))), cos(sp.x.mul(6).sub(t.mul(11)).add(sp.z.mul(4)))).mul(0.25);
      const off = sdir.add(wob).mul(shell).mul(O.x).div(vec2(aspect, 1));
      const col = viewportSharedTexture(screenUV.sub(off)).rgb;
      const rim = pow(edge, O.w.mul(2.5)).mul(O.z);
      return vec4(col.add(vec3(1, 0.72, 0.45).mul(rim)), clamp(shell.mul(3).mul(O.y), 0, 1).mul(clearMask()));
    })();
    orbMat.colorNode = orbShade.rgb;
    orbMat.opacityNode = orbShade.a;
    this.orbs = new THREE.InstancedMesh(sphere, orbMat, MAX_ORBS);
    this.orbs.frustumCulled = false;
    this.orbs.renderOrder = 99;
    this.orbs.count = 0;
    this.orbs.visible = false;
    this.group.add(this.orbs, this.bend);
  }

  /** Bodies with `userData.heat` under the scene (rescanned once a second). */
  private scan(root: THREE.Object3D) {
    this.heatSources = [];
    root.traverse((o) => { if (o.userData.heat) this.heatSources.push({ o, fn: o.userData.heat as HeatSource }); });
  }

  /**
   * Once a frame, after everything posted its blasts: heat sources, the waves' sim, then the orbs and quads.
   * lights: the night lights (null by day or without a look); light k scales a blast's flash (blastLight).
   */
  update(dt: number, camera: THREE.PerspectiveCamera, lights: ShortLights | null, blastLight = 2600, own: { x: number; z: number } | null = null) {
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
    let nq = 0, no = 0;
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
      // The clear spot over your mech (waveClear m round a point waveClearHeight up on it).
      const C = this.uClear.value;
      C.z = 0;
      if (own && v.waveClear > 0) {
        const p = this.p.set(own.x, this.ground.height(own.x, own.z) + v.waveClearHeight, own.z);
        const dist = camera.position.distanceTo(p);
        p.project(camera);
        if (p.z <= 1 && p.z >= -1) C.set((p.x + 1) / 2, (1 - p.y) / 2, v.waveClear / Math.max(1e-3, 2 * dist * tanH), v.waveClearSoft);
      }
      const O = this.O.array as Float32Array;
      for (const wv of w.waves) {
        if (no >= MAX_ORBS) break;
        const { front, fade } = BlastWaves.shape(wv, v.waveEase);
        if (fade <= 0.002 || front <= 0) continue;
        const H = place(wv.x, wv.y, wv.z);
        if (H <= 0) continue;
        const r = wv.reach * front;
        // Off screen by more than its reach: skip.
        const cu = A[nq * 4], cv = A[nq * 4 + 1], ext = (r / H) * 1.5;
        if (cu < -ext || cu > 1 + ext || cv < -ext || cv > 1 + ext) continue;
        this.m.compose(this.p.set(wv.x, wv.y, wv.z), this.q, this.s.set(r, r, r));
        this.orbs.setMatrixAt(no, this.m);
        const o = no * 4;
        // Thin shell: a sharp edge-only bend; thick: it reaches in towards the middle.
        // The orb fades slower than the old ring did (linear, not squared): it should read while it grows.
        const f = Math.sqrt(fade);
        O[o] = (wv.strength * f) / H; O[o + 1] = Math.min(1, f * 1.6); O[o + 2] = v.waveRim * fade; O[o + 3] = 0.6 / Math.max(0.03, wv.thick);
        no++;
      }
      if (no) { this.orbs.instanceMatrix.needsUpdate = true; this.O.needsUpdate = true; this.O.addUpdateRange(0, no * 4); }
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

      // A blast on the ground lights it for a moment at night.
      if (lights && v.waveGroundLight > 0) for (const wv of w.waves) {
        if (!wv.ground || wv.groundReach <= 0) continue;
        const u = wv.t / Math.max(0.02, v.waveGroundLife);
        if (u >= 1 || u < 0) continue;
        const f = (1 - u) * (1 - u), rad = wv.groundReach * (0.25 + 0.75 * (1 - Math.pow(1 - u, 2)));
        lights.hold(wv.x, this.ground.height(wv.x, wv.z) + 1, wv.z, blastLight * 0.4 * v.waveGroundLight * f, rad * 1.6 + 4, 0xffb070, 0.8, rad);
      }
    }
    this.geo.instanceCount = nq;
    this.bend.visible = nq > 0;
    this.orbs.count = no;
    this.orbs.visible = no > 0;
    this.stats.quads = nq; this.stats.orbs = no; this.stats.copy = nq + no > 0;
  }
}
