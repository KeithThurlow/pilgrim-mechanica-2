// Draws the bandit swarm (infantry.ts). Two looks on a slider (banditLook):
//  1 Vanguard (Keith 2026-10-24): Mixamo's Vanguard baked to an animation texture (banditVat.ts), all bandits in
//    one instanced mesh, each with its own clip, time and rate, crossfading on a change: run in (speed-matched to
//    the sim), sprint away when fleeing, rifle aim when standing to shoot, walk-and-fire when moving in the band
//    (played backward when backing off), a flinch when hit. The armour plates take the raider cloth colour.
//  0 boxes: the merged low-poly stand-in, running as a bob, a lean and a sway.
// Downed bandits topple flat along the way they were thrown (the pose frozen) and get back up; the dead lie flat,
// then sink into the sand (unless the death physics draws them: hideDead).
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Param } from "../core/tweaks";
import { InfantrySwarm, INFANTRY_MAX, DOWN, DEAD, EMPTY, FIRING, FLEEING } from "./infantry";
import { BanditVatMesh, type BanditVatData } from "./banditVat";
import { BanditAnim, type AnimClip } from "./banditAnim";
import { VAT_CLIPS, type VatClipName } from "./banditVatFormat";

/** Raider cloth: rust, dusty khaki, faded indigo, olive. */
export const CLOTH = [0x9a4a2c, 0xb59c72, 0x4e5a78, 0x6b6a3e];

export const BANDIT_LOOK_DEFAULTS = {
  banditLook: 1,
  banditAnimSpeed: 1,
  banditFade: 0.2,
  banditScale: 1.8,
};
export type BanditLookValues = typeof BANDIT_LOOK_DEFAULTS;
export const BANDIT_LOOK_PARAMS: Param[] = [
  { key: "banditLook", label: "Look (0 boxes, 1 Vanguard)", min: 0, max: 1, step: 1, group: "Bandits: look", tip: "Vanguard is the Mixamo character baked to an animation texture" },
  { key: "banditAnimSpeed", label: "Play speed ×", min: 0.2, max: 3, step: 0.05, group: "Bandits: look", tip: "On top of matching the run to the bandit's speed" },
  { key: "banditFade", label: "Crossfade on clip change (s)", min: 0, max: 1, step: 0.01, group: "Bandits: look" },
  { key: "banditScale", label: "Height (m)", min: 1.2, max: 2.6, step: 0.01, group: "Bandits: look", tip: "Drawn height; the hit cylinder is Hit height under Bandits" },
];

/** Look values that aren't feel (kept here; the lead can promote any to sliders). */
const BOB = 0.07, LEAN = 0.14, SWAY = 0.06, STRIDE = 1.6, FALL_RATE = 6, SINK = 0.7;
/** Below this a bandit stands (aim); rates for the moving clips stay within these. */
const STAND = 0.6, RATE_MIN = 0.4, RATE_MAX = 2.2, FLINCH_MAX_SPEED = 2;

function part(w: number, h: number, d: number, x: number, y: number, z: number, rgb: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(rgb), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** The stand-in figure, feet at y = 0, facing +Z. White parts take the instance's cloth colour. */
function figure(): THREE.BufferGeometry {
  const cloth = 0xffffff, skin = 0x8a6448, dark = 0x2a2522, wrap = 0xd8ccb4;
  const g = mergeGeometries([
    part(0.18, 0.85, 0.2, 0.12, 0.43, 0, cloth),     // legs
    part(0.18, 0.85, 0.2, -0.12, 0.43, 0, cloth),
    part(0.2, 0.12, 0.3, 0.12, 0.06, 0.05, dark),    // boots
    part(0.2, 0.12, 0.3, -0.12, 0.06, 0.05, dark),
    part(0.46, 0.62, 0.28, 0, 1.15, 0, cloth),       // torso
    part(0.5, 0.14, 0.32, 0, 0.92, 0, dark),         // belt
    part(0.12, 0.5, 0.14, 0.3, 1.18, 0.12, cloth),   // arms, forward onto the rifle
    part(0.12, 0.5, 0.14, -0.3, 1.18, 0.12, cloth),
    part(0.22, 0.24, 0.24, 0, 1.6, 0, skin),         // head
    part(0.27, 0.12, 0.28, 0, 1.69, -0.01, wrap),    // head wrap
    part(0.07, 0.09, 0.85, 0.08, 1.33, 0.45, dark),  // rifle
  ]);
  g.computeVertexNormals();
  return g;
}

export class InfantryDraw {
  readonly group = new THREE.Group();
  /** The box look. */
  readonly boxes: THREE.InstancedMesh;
  /** The baked look (null when the bake didn't load). */
  readonly vat: BanditVatMesh | null = null;
  private anim: BanditAnim | null = null;
  private clipId = {} as Record<VatClipName, number>;
  private tilt = new Float32Array(INFANTRY_MAX);
  private phase = new Float32Array(INFANTRY_MAX);
  private gen = new Uint32Array(INFANTRY_MAX);
  private lastHp = new Float32Array(INFANTRY_MAX);
  private rows = new Float32Array(8);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qa = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private ax = new THREE.Vector3(1, 0, 0);
  private ay = new THREE.Vector3(0, 1, 0);
  private az = new THREE.Vector3(0, 0, 1);

  constructor(private swarm: InfantrySwarm, public look: BanditLookValues = { ...BANDIT_LOOK_DEFAULTS }, vat: BanditVatData | null = null) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.boxes = new THREE.InstancedMesh(figure(), mat, INFANTRY_MAX);
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boxes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(INFANTRY_MAX * 3), 3);
    this.boxes.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.boxes.castShadow = true;
    this.boxes.receiveShadow = true;
    this.boxes.frustumCulled = false;
    this.boxes.count = 0;
    this.group.add(this.boxes);

    if (vat) {
      this.vat = new BanditVatMesh(vat, INFANTRY_MAX);
      const h = vat.header;
      const clips: AnimClip[] = VAT_CLIPS.map((name, k) => {
        this.clipId[name] = k;
        return { ...h.clips[name], cycle: name !== "aim" && name !== "flinch" };
      });
      this.anim = new BanditAnim(clips, INFANTRY_MAX);
      const ref = h.clothRef;
      CLOTH.forEach((hex, k) => { const c = new THREE.Color(hex); this.vat!.tints[k].setRGB(c.r / ref[0], c.g / ref[1], c.b / ref[2]); });
      this.vat.mesh.raycast = (rc, hits) => this.pick(rc, hits);
      this.group.add(this.vat.mesh);
    }
  }

  /** The look being drawn (for the hold-V selector). */
  get mesh(): THREE.Object3D { return this.useVat ? this.vat!.mesh : this.boxes; }

  private get useVat(): boolean { return !!this.vat && this.look.banditLook >= 0.5; }

  update(dt: number): void {
    const sw = this.swarm, v = sw.v, vat = this.useVat ? this.vat : null, anim = this.anim, L = this.look;
    this.boxes.visible = !vat;
    if (this.vat) this.vat.mesh.visible = !!vat;
    const bakedH = this.vat?.data.header.height ?? 1.8;
    let n = 0;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      const fresh = this.gen[i] !== sw.gen[i];
      if (fresh) {
        this.gen[i] = sw.gen[i]; this.tilt[i] = 0; this.phase[i] = sw.seed[i] * 6.283; this.lastHp[i] = sw.hp[i];
        if (anim) anim.reset(i, this.clipId.run, sw.seed[i] * 2);
      }

      const speed = Math.hypot(sw.vx[i], sw.vz[i]);
      const flat = st === DOWN || st === DEAD;
      // Topple fast, get up a little slower.
      const want = flat ? 1 : 0;
      this.tilt[i] += Math.sign(want - this.tilt[i]) * Math.min(Math.abs(want - this.tilt[i]), dt * (flat ? FALL_RATE : FALL_RATE * 0.6));
      const tilt = this.tilt[i];

      let y = sw.py[i], scale = 1;
      if (st === DEAD) {
        const left = v.bodyLife - sw.stateTime[i];
        if (left < v.sinkTime) {
          const k = 1 - Math.max(0, left) / Math.max(0.01, v.sinkTime);
          y -= k * SINK;
          scale = 1 - k * k;
        }
      }
      const size = 0.94 + sw.seed[i] * 0.12;
      const hit = sw.hp[i] < this.lastHp[i] - 1e-4;
      this.lastHp[i] = sw.hp[i];

      if (tilt > 0.001) {
        // Lie along the fall: the figure's up turns toward fallYaw.
        this.q.setFromAxisAngle(this.ay, sw.fallYaw[i]);
        this.qa.setFromAxisAngle(this.ax, tilt * Math.PI * 0.5);
        this.q.multiply(this.qa);
        y += tilt * 0.18;
      } else if (vat) {
        this.q.setFromAxisAngle(this.ay, sw.heading[i]);
      } else {
        // Run cycle: bob, lean into the run, sway side to side.
        this.phase[i] += (speed / STRIDE) * Math.PI * dt;
        const run = Math.min(1, speed / 4);
        y += Math.abs(Math.sin(this.phase[i])) * BOB * run;
        this.q.setFromAxisAngle(this.ay, sw.heading[i]);
        this.qa.setFromAxisAngle(this.ax, LEAN * run);
        this.q.multiply(this.qa);
        this.qa.setFromAxisAngle(this.az, Math.sin(this.phase[i]) * SWAY * run);
        this.q.multiply(this.qa);
      }

      if (vat && anim) {
        const s = (L.banditScale / bakedH) * size * scale;
        this.choose(i, st, speed, hit, s);
        anim.step(i, dt, L.banditFade);
        anim.rows(i, this.rows, 0);
        vat.place.setXYZW(n, sw.px[i], y, sw.pz[i], s);
        vat.turn.setXYZW(n, this.q.x, this.q.y, this.q.z, this.q.w);
        vat.animA.setXYZW(n, this.rows[0], this.rows[1], this.rows[2], this.rows[3]);
        const shade = (0.85 + sw.seed[i] * 0.3) * (st === DEAD ? 0.7 : 1);
        vat.animB.setXYZW(n, this.rows[4], this.rows[5], this.rows[6], (sw.look[i] & 3) * 4 + shade);
      } else {
        this.p.set(sw.px[i], y, sw.pz[i]);
        this.s.setScalar(scale * size);
        this.m.compose(this.p, this.q, this.s);
        this.boxes.setMatrixAt(n, this.m);
        this.c.setHex(CLOTH[sw.look[i] & 3]).multiplyScalar(0.85 + sw.seed[i] * 0.3);
        if (st === DEAD) this.c.multiplyScalar(0.7);
        this.boxes.setColorAt(n, this.c);
      }
      n++;
    }
    if (vat) vat.count = n;
    else {
      this.boxes.count = n;
      this.boxes.instanceMatrix.needsUpdate = true;
      if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
    }
  }

  /** Pick bandit i's clip and rate from what the sim says it's doing. s: its drawn scale against the bake. */
  private choose(i: number, st: number, speed: number, hit: boolean, s: number): void {
    const anim = this.anim!, id = this.clipId, clips = anim.clips, sw = this.swarm, k = this.look.banditAnimSpeed;
    const matched = (clip: number, along: number) => {
      const r = along / Math.max(0.1, clips[clip].speed * s);
      return Math.sign(r || 1) * Math.min(RATE_MAX, Math.max(RATE_MIN, Math.abs(r))) * k;
    };
    if (st === DOWN || st === DEAD) { anim.play(i, anim.clip[i], 0); return; } // pose held while toppled
    if (anim.clip[i] === id.flinch && anim.left(i) > 0 && speed < FLINCH_MAX_SPEED) { anim.play(i, id.flinch, k); return; }
    if (hit && speed < FLINCH_MAX_SPEED) { anim.play(i, id.flinch, k, true); return; }
    if (st === FLEEING) { anim.play(i, id.sprint, matched(id.sprint, speed)); return; }
    if (speed < STAND) { anim.play(i, id.aim, k); return; }
    if (st === FIRING) {
      // Moving while shooting: forward or back along the way it faces (backing off plays the walk backward).
      const h = sw.heading[i], along = sw.vx[i] * Math.sin(h) + sw.vz[i] * Math.cos(h);
      const signed = Math.sign(along || 1) * Math.max(Math.abs(along), speed * 0.5);
      if (along > 2.5) anim.play(i, id.runFire, matched(id.runFire, along));
      else anim.play(i, id.walkFire, matched(id.walkFire, signed));
      return;
    }
    anim.play(i, id.run, matched(id.run, speed));
  }

  /** Hold-V picking: each drawn bandit as a sphere round its middle. */
  private pick(rc: THREE.Raycaster, hits: THREE.Intersection[]): void {
    const sw = this.swarm, c = new THREE.Vector3(), sphere = new THREE.Sphere(c, 0.6), at = new THREE.Vector3();
    let best: THREE.Intersection | null = null;
    for (let i = 0; i < sw.hi; i++) {
      const st = sw.state[i];
      if (st === EMPTY || (st === DEAD && sw.hideDead)) continue;
      c.set(sw.px[i], sw.py[i] + 0.9, sw.pz[i]);
      if (!rc.ray.intersectSphere(sphere, at)) continue;
      const d = rc.ray.origin.distanceTo(at);
      if (d >= rc.near && d <= rc.far && (!best || d < best.distance)) best = { distance: d, point: at.clone(), object: this.vat!.mesh };
    }
    if (best) hits.push(best);
  }
}
