// Fire's look (Keith 2026-11-05; cosmetic, local, Math.random allowed): the flamers' stream, flames licking off burning
// things and pools, embers, smoke. Camera-facing quads in two instanced meshes (the flames added on, the smoke drawn
// over) plus the solid flame balls and the nozzle cone (src/fx/flameBlobs.ts). The battlefield owns one (bf.flames)
// and feeds it burning targets and pools every frame; the flamers emit their gobs into it.
// The stream is burning fuel thrown under gravity (Keith 2026-11-05, the rebuild: "arcing out from the mech,
// accounting for gravity ... it can either hit the ground and splash ... or if it's really far out ... it just
// starts igniting and rising up into the air, because it's burnt out before it's hit the ground"). Each gob flies a
// real ballistic arc (fireGuns aims it to come down on the aim) and breaks up into branches as it goes; one that comes
// down while still burning splashes (droplets thrown on) and burns on the sand as a low fire licking flames up; one
// that runs out of fuel in the air (aimed past the reach) lets go of its arc and rises as a growing fireball that
// turns to smoke. Smoke only from fire that's burning down.
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, uv, smoothstep, float, sin, positionWorld, time } from "three/tsl";
import { FlameBlobs } from "./flameBlobs";
import { FlameStreams } from "./flameStream";
import { FlameTube } from "./flameTube";

export const FLAME_MAX = 4096;

interface Ground { height(x: number, z: number): number }

/** Particle kinds: a stream gob, a flame lick (burning thing, pool), an ember, a smoke puff, a splash droplet. */
const GOB = 0, LICK = 1, EMBER = 2, SMOKE = 3, DROP = 4;
/** A gob's state: flying (burning fuel on its arc), on the sand (a ground fire), burnt out in the air (rising). */
export const FLY = 0, GROUND = 1, RISE = 2;

/** The upward speed that brings fuel thrown at horizontal speed `vh` down `dy` m higher (negative: lower), `dist` m
 *  off, under gravity `G`: at most a 35° lob (Keith 2026-11-05: the fuel arcs out and lands on the aim). */
export function lobVy(dy: number, dist: number, vh: number, G: number) {
  const T = dist / Math.max(1, vh);
  return Math.min(vh * 0.7, dy / T + 0.5 * G * T);
}

/** The look values (Flame look sliders; the battlefield hands them in with tune()). */
export interface FlameLook {
  flameRise: number; flameGravity: number; flameDrag: number; flameBreak: number; flameSplashDrops: number;
  flameGroundLife: number; flameSlide: number; flameGroundDrag: number; flameRiseLife: number; flameBuoy: number;
  flameStretch: number; flameGrowFly: number; flameGrowGround: number; flameGrowRise: number; flameLicks: number;
  flameLightEvery: number; flameBallLights: number; flameBlob: number; flameLump: number; flameHalo: number;
  flameSmoke: number; flameSmokeRise: number; flameSmokeSize: number;
  flameTube: number; flameTubeNear: number; flameTubeFar: number; flameTubeLump: number; flameTubeEvery: number;
  flameShed: number; flameEndFire: number; flameEndSize: number;
}
const LOOK: FlameLook = {
  flameRise: 3, flameGravity: 9.8, flameDrag: 0.15, flameBreak: 1.2, flameSplashDrops: 2,
  flameGroundLife: 5.5, flameSlide: 0.3, flameGroundDrag: 4, flameRiseLife: 0.9, flameBuoy: 6,
  flameStretch: 0.08, flameGrowFly: 1.6, flameGrowGround: 2.2, flameGrowRise: 3, flameLicks: 0.4,
  flameLightEvery: 12, flameBallLights: 6, flameBlob: 1, flameLump: 0.5, flameHalo: 0.25,
  flameSmoke: 1, flameSmokeRise: 1.6, flameSmokeSize: 3.2,
  flameTube: 1, flameTubeNear: 0.1, flameTubeFar: 1, flameTubeLump: 0.6, flameTubeEvery: 0.025,
  flameShed: 2.5, flameEndFire: 0.85, flameEndSize: 0.75,
};

export class FlameFx {
  readonly group = new THREE.Group();
  private hot: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
  /** Flame and mist billboards drawn over the scene, not added to it (Keith's render pass 2026-11-05: added HDR fire
   *  clipped to white on the bright sand), so their colour survives in daylight. */
  private lit: THREE.InstancedMesh;
  private litData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_MAX * 4), 4);
  private hotData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_MAX * 4), 4);
  private darkData = new THREE.InstancedBufferAttribute(new Float32Array(FLAME_MAX * 4), 4);
  // Particles (structure of arrays).
  n = 0;
  private px = new Float32Array(FLAME_MAX); private py = new Float32Array(FLAME_MAX); private pz = new Float32Array(FLAME_MAX);
  private vx = new Float32Array(FLAME_MAX); private vy = new Float32Array(FLAME_MAX); private vz = new Float32Array(FLAME_MAX);
  private age = new Float32Array(FLAME_MAX); private life = new Float32Array(FLAME_MAX);
  private size = new Float32Array(FLAME_MAX); private grow = new Float32Array(FLAME_MAX);
  /** Gobs: seconds before the flame catches (<0: lit from the start). */
  private ign = new Float32Array(FLAME_MAX);
  private kind = new Uint8Array(FLAME_MAX);
  private heat = new Float32Array(FLAME_MAX);
  /** The freeze ray's mist (Keith 2026-11-05): drawn icy blue-white instead of fire. */
  private cold = new Uint8Array(FLAME_MAX);
  /** Gobs: FLY, GROUND or RISE; when it got there (s of age); its size then (m); how long it burns in the air (s);
   *  whether it has split off a branch yet. */
  private st = new Uint8Array(FLAME_MAX);
  private tS = new Float32Array(FLAME_MAX);
  private s0 = new Float32Array(FLAME_MAX);
  private burn = new Float32Array(FLAME_MAX);
  private split = new Uint8Array(FLAME_MAX);
  private seed = new Float32Array(FLAME_MAX);
  private pend: number[] = [];
  private pendL: number[] = [];
  private pendD: number[] = [];
  private pendB: number[] = [];
  /** Lights in among the fireballs this frame (x, y, z, size): one every flameLightEvery lit balls, flameBallLights at most;
   *  the battlefield hangs a night light on each (Keith 2026-11-05). */
  readonly lightPts = new Float32Array(16 * 4);
  nLight = 0;
  private litN = 0;
  readonly blobs = new FlameBlobs();
  /** The flamers' fuel lines (Keith 2026-11-05: one continuous line arcing out, not bits) and their tube. */
  readonly streams = new FlameStreams();
  readonly tube = new FlameTube();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** This frame's heat glows (hot metal: a soft red-orange halo where it burned; drawn once, then cleared). */
  private glows: number[] = [];
  /** Look values (the Flame stream sliders; the arsenal sets them). */
  look: FlameLook = { ...LOOK };
  /** For the headless check: told where each gob lands (GROUND) or burns out in the air (RISE). */
  probe: ((what: number, x: number, y: number, z: number) => void) | null = null;

  /** Takes the Flame stream and Flame look sliders (any values object holding them; missing keys keep the default). */
  tune(v: Partial<FlameLook>) { for (const k in LOOK) { const x = (v as Record<string, number>)[k]; (this.look as unknown as Record<string, number>)[k] = typeof x === "number" ? x : LOOK[k as keyof FlameLook]; } }

  /** A pouring nozzle's cone this frame (src/fx/flameBlobs.ts). */
  cone(from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, cold: boolean, cut = 1) {
    this.blobs.cone(from.x, from.y, from.z, dir.x, dir.y, dir.z, len, r, 0.85 + Math.random() * 0.3, cold, cut);
  }

  /** A puff of dirty smoke, `k` × the Smoke size. */
  smoke(x: number, y: number, z: number, k = 1) {
    const L = this.look;
    this.add(SMOKE, x, y, z, (Math.random() - 0.5) * 0.6, L.flameSmokeRise * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.6,
      1.6 + Math.random() * 1.4, L.flameSmokeSize * 0.3 * k * (0.7 + Math.random() * 0.6), 3.3, -1);
  }

  /** Where the particles land: the battlefield hands in its look ground (the drawn chunks) once it has one. */
  constructor(public ground: Ground) {
    const mk = (data: THREE.InstancedBufferAttribute, additive: boolean, fray = !additive) => {
      data.setUsage(THREE.DynamicDrawUsage);
      const d = instancedBufferAttribute<"vec4">(data);
      const r = uv().mul(2).sub(1).length();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      mat.colorNode = d.xyz;
      const soft = float(1).sub(smoothstep(additive ? 0.15 : 0.35, 1, r)).mul(d.w);
      // Smoke and soot billow: noise in world space frays the dark puffs as they drift through it.
      // (Cheap: a couple of sines in world space, no per-pixel noise; Keith 2026-11-05 saw the frame rate drop.)
      const pw = positionWorld, frayN = sin(pw.x.mul(2.3).add(time.mul(0.7))).mul(sin(pw.z.mul(2.1).sub(pw.y.mul(1.7)))).mul(0.3).add(0.85);
      mat.opacityNode = fray ? soft.mul(frayN) : soft;
      if (additive) mat.blending = THREE.AdditiveBlending;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, FLAME_MAX);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = additive ? 5 : 4;
      return mesh;
    };
    this.dark = mk(this.darkData, false);
    this.hot = mk(this.hotData, true);
    this.lit = mk(this.litData, false, false);
    this.lit.renderOrder = 5;
    this.group.add(this.dark, this.lit, this.hot, this.blobs.group, this.tube.mesh);
  }

  private add(k: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, ign: number, heat = 1, cold = 0): number {
    if (this.n >= FLAME_MAX) return -1;
    const i = this.n++;
    this.cold[i] = cold;
    this.kind[i] = k; this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.st[i] = FLY; this.tS[i] = 0; this.s0[i] = size; this.burn[i] = life; this.split[i] = 0; this.seed[i] = Math.random() * 100;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.grow[i] = grow; this.ign[i] = ign; this.heat[i] = heat;
    return i;
  }

  /** A gob of the stream: thrown from (x, y, z) at velocity v, burning `burn` s in the air before its fuel is spent,
   *  `size` m across, dark until `ign` s (the fuel nozzle's gel before the igniter catches it). */
  gob(x: number, y: number, z: number, vx: number, vy: number, vz: number, burn: number, size: number, ign: number, cold = false) {
    const i = this.add(GOB, x, y, z, vx, vy, vz, burn + this.look.flameRiseLife, size, 1, cold ? -1 : ign, 1, cold ? 1 : 0);
    if (i >= 0) this.burn[i] = burn;
  }

  /** A nozzle pours this frame (`key`: the gun's side, kept across frames): the line's near end is at (x, y, z) and it
   *  throws fuel at (vx, vy, vz) that burns `burn` s; `width` scales the line (the hull guns' is bigger). */
  pour(key: object, x: number, y: number, z: number, vx: number, vy: number, vz: number, burn: number, width: number, cold = false) {
    this.streams.pour(key, x, y, z, vx, vy, vz, burn, width, cold);
  }

  /** A wisp of freezing mist (chilled things, the freeze ray's nozzle). */
  mist(x: number, y: number, z: number, k = 1) {
    this.add(LICK, x, y, z, (Math.random() - 0.5) * 0.5, -0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.5, (0.3 + Math.random() * 0.3) * k, 2.4, -1, 0.6, 1);
  }

  /** The igniter's pilot flame: a tiny lick at the nozzle (every frame while fitted). */
  pilot(x: number, y: number, z: number, k = 1) {
    this.add(LICK, x, y, z, (Math.random() - 0.5) * 0.2, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.08, 0.1 * k, 1.6, -1, 0.9);
  }

  /** Flames licking up at a point (a burning thing, a pool): `k` scales how big, `heat` how bright (0..1). */
  lick(x: number, y: number, z: number, k = 1, heat = 1) {
    this.add(LICK, x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.35, (0.35 + Math.random() * 0.35) * k, 2.2, -1, heat);
  }

  /** Hot metal glowing at a point this frame: `size` m across, heat 0..1 (red, then orange-white). */
  glow(x: number, y: number, z: number, size: number, heat: number) { if (this.glows.length < 6 * 512) this.glows.push(x, y, z, size * (0.6 + 0.4 * heat), heat, 0); }
  /** Frost on a chilled thing this frame: k 0..1 (1: frozen solid, brighter). */
  frost(x: number, y: number, z: number, size: number, k: number) { if (k > 0.03 && this.glows.length < 6 * 512) this.glows.push(x, y, z, size * (0.6 + 0.4 * k), k, 1); }

  ember(x: number, y: number, z: number) {
    this.add(EMBER, x, y, z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.9, 0.06 + Math.random() * 0.05, 1, -1);
  }

  update(dt: number, camera: THREE.Camera) {
    const g = this.ground, L = this.look, G = L.flameGravity;
    let keep = 0;
    const nIn = this.n;
    for (let i = 0; i < nIn; i++) {
      this.age[i] += dt;
      const k = this.kind[i], cold = this.cold[i] === 1;
      if (this.age[i] >= this.life[i]) {
        // A ground fire or a burnt-out fireball goes up in smoke where it ends (smoke only from fire burning down).
        if (k === GOB && !cold && this.st[i] !== FLY && L.flameSmoke > 0 && Math.random() < 0.6 * L.flameSmoke) this.pend.push(this.px[i], this.py[i] + 0.4, this.pz[i], this.st[i] === RISE ? 1.5 : 1.1);
        continue;
      }
      const lit = this.age[i] >= this.ign[i], st = this.st[i];
      if (k === SMOKE) {
        const dr = Math.exp(-0.9 * dt);
        this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr + L.flameSmokeRise * 0.45 * dt;
      } else if (k === GOB && st === GROUND) {
        // A ground fire: slides a little from where it splashed, then burns in place.
        const dr = Math.exp(-L.flameGroundDrag * dt);
        this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = 0;
      } else if (k === GOB && st === RISE) {
        // Burnt out in the air: the heat lifts it, it slows along and spreads.
        const dr = Math.exp(-1.5 * dt);
        this.vx[i] *= dr; this.vz[i] *= dr;
        this.vy[i] = this.vy[i] * Math.exp(-0.6 * dt) + (cold ? -0.4 : L.flameBuoy) * dt;
      } else if (k === GOB || k === DROP) {
        // Flying fuel (and splash droplets): a ballistic arc, a little air drag.
        const dr = Math.exp(-L.flameDrag * dt);
        this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr - G * dt;
        if (k === GOB && this.age[i] >= this.burn[i]) {
          // Its fuel spent before it came down: it lets go of the arc and rises.
          this.st[i] = RISE; this.tS[i] = this.age[i]; this.s0[i] = this.drawnSize(i);
          this.probe?.(RISE, this.px[i], this.py[i], this.pz[i]);
          this.vy[i] = Math.max(this.vy[i] * 0.2, 0); this.vx[i] *= 0.6; this.vz[i] *= 0.6;
          this.life[i] = this.age[i] + L.flameRiseLife * (0.7 + Math.random() * 0.6);
        } else if (k === GOB && lit && !this.split[i] && this.age[i] > 0.1 && L.flameBreak > 0 && Math.random() < dt * L.flameBreak) {
          // The stream breaks up: a branch splits off a little to the side.
          this.split[i] = 1;
          this.pendB.push(this.px[i], this.py[i], this.pz[i], this.vx[i] + (Math.random() - 0.5) * 3, this.vy[i] + (Math.random() - 0.3) * 1.5, this.vz[i] + (Math.random() - 0.5) * 3,
            this.life[i], this.size[i] * 0.65, this.age[i], this.burn[i] * (0.8 + Math.random() * 0.3), this.cold[i]);
        }
      } else {
        const drag = Math.exp(-1.5 * dt);
        this.vx[i] *= drag; this.vz[i] *= drag;
        // Mist sinks a little where flames rise.
        this.vy[i] = this.vy[i] * drag + (k === EMBER ? -0.5 : cold ? -0.6 : L.flameRise) * dt;
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const gy = g.height(this.px[i], this.pz[i]);
      if (k === SMOKE) { if (this.py[i] < gy + 0.3) this.py[i] = gy + 0.3; }
      else if (this.py[i] < gy + 0.05 || (k === GOB && st === GROUND)) {
        this.py[i] = gy + 0.05;
        if (k === GOB && st === FLY) {
          // Came down still burning: it splashes (droplets thrown on and up) and burns on the sand.
          if (lit && !cold) {
            const sp = Math.hypot(this.vx[i], this.vz[i]);
            for (let d = Math.round(L.flameSplashDrops * (0.6 + Math.random() * 0.8)); d > 0; d--) {
              const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 2.5;
              this.pendD.push(this.px[i], gy + 0.15, this.pz[i], this.vx[i] * 0.35 + Math.cos(a) * r, 2 + Math.random() * 3 + sp * 0.05, this.vz[i] * 0.35 + Math.sin(a) * r, this.size[i] * 0.45);
            }
          }
          this.st[i] = GROUND; this.tS[i] = this.age[i]; this.s0[i] = this.drawnSize(i);
          this.probe?.(GROUND, this.px[i], this.py[i], this.pz[i]);
          this.vx[i] *= L.flameSlide; this.vz[i] *= L.flameSlide; this.vy[i] = 0;
          this.life[i] = this.age[i] + L.flameGroundLife * (0.7 + Math.random() * 0.6) * (lit ? 1 : 0.4);
        } else if (k === DROP) {
          // A droplet lands: a little flame where it fell.
          if (Math.random() < 0.6) this.pendL.push(this.px[i], gy + 0.1, this.pz[i], this.size[i] * 2);
          continue;
        } else if (k !== GOB) {
          if (this.vy[i] < 0) this.vy[i] = 0;
          this.vx[i] *= 0.5; this.vz[i] *= 0.5;
        }
      }
      if (k === GOB && !cold && st !== FLY) {
        const u = (this.age[i] - this.tS[i]) / Math.max(0.05, this.life[i] - this.tS[i]);
        // A ground fire licks flames up off it; fire burning down (past halfway) throws dirty smoke.
        if (st === GROUND && L.flameLicks > 0 && Math.random() < dt * L.flameLicks) this.pendL.push(this.px[i], this.py[i] + 0.1, this.pz[i], this.s0[i] * 1.2);
        if (L.flameSmoke > 0 && u > 0.5 && Math.random() < dt * L.flameSmoke * (st === RISE ? 2.5 : 0.25)) this.pend.push(this.px[i], this.py[i] + this.s0[i] * 0.6, this.pz[i], st === RISE ? 1.2 : 0.9);
      }
      if (k === LICK && !cold && L.flameSmoke > 0 && this.age[i] > this.life[i] * 0.35 && Math.random() < dt * L.flameSmoke * 0.5) this.pend.push(this.px[i], this.py[i] + this.size[i], this.pz[i], 0.8);
      if (keep !== i) this.copy(keep, i);
      keep++;
    }
    // What the step made waits in the pending lists (nothing is added mid-loop): branches, droplets, smoke, licks.
    this.n = keep;
    for (let q = 0; q < this.pendB.length; q += 11) {
      const B = this.pendB;
      const j = this.add(GOB, B[q], B[q + 1], B[q + 2], B[q + 3], B[q + 4], B[q + 5], B[q + 6], B[q + 7], 1, -1, 1, B[q + 10]);
      if (j >= 0) { this.age[j] = B[q + 8]; this.burn[j] = B[q + 9]; this.split[j] = 1; }
    }
    this.pendB.length = 0;
    for (let j = 0; j < this.pendD.length; j += 7) {
      const d = this.pendD;
      this.add(DROP, d[j], d[j + 1], d[j + 2], d[j + 3], d[j + 4], d[j + 5], 0.35 + Math.random() * 0.3, d[j + 6], 1, -1);
    }
    this.pendD.length = 0;
    for (let j = 0; j < this.pend.length; j += 4) this.smoke(this.pend[j], this.pend[j + 1], this.pend[j + 2], this.pend[j + 3]);
    this.pend.length = 0;
    for (let j = 0; j < this.pendL.length; j += 4) this.lick(this.pendL[j], this.pendL[j + 1], this.pendL[j + 2], this.pendL[j + 3], 0.95);
    this.pendL.length = 0;
    this.stepLines(dt);
    this.nLight = 0;
    // Lights hang along the lines too (every 10th point), before the ground fires and fireballs take the rest.
    for (const l of this.streams.lines.values()) {
      if (l.cold) continue;
      for (let i = l.n - 6; i >= 0 && this.nLight < L.flameBallLights; i -= 16) {
        const o = this.nLight++ * 4; this.lightPts[o] = l.px[i]; this.lightPts[o + 1] = l.py[i] + 0.5; this.lightPts[o + 2] = l.pz[i]; this.lightPts[o + 3] = 0.8 * l.width;
      }
    }
    this.draw(camera);
  }

  /** The fuel lines fly on: where a point lands a ground fire splashes (some of them), where one burns out in the air a
   *  fireball rises; flames and, near the far end, smoke come off the line as it goes. */
  private stepLines(dt: number) {
    const L = this.look;
    this.streams.step(dt, L.flameGravity, L.flameDrag, L.flameTubeEvery, this.ground, (line, what, x, y, z, vx, vy, vz) => {
      const sz = L.flameEndSize * line.width * (0.8 + Math.random() * 0.4);
      if (what === "land") { if (Math.random() < L.flameEndFire) this.gob(x, y + 0.04, z, vx, Math.min(vy, -1), vz, 9, sz, 0, line.cold); }
      else this.gob(x, y, z, vx, vy, vz, 1e-4, sz, 0, line.cold);
    });
    for (const l of this.streams.lines.values()) for (let i = 0; i < l.n; i++) {
      const u = l.age[i] / Math.max(0.05, l.burn[i]);
      if (u < 0.12) continue;
      if (L.flameShed > 0 && Math.random() < dt * L.flameShed) {
        if (l.cold) this.mist(l.px[i], l.py[i], l.pz[i], 0.6 * l.width);
        else this.add(LICK, l.px[i], l.py[i], l.pz[i], l.vx[i] * 0.35 + (Math.random() - 0.5), l.vy[i] * 0.2 + 0.8 + Math.random(), l.vz[i] * 0.35 + (Math.random() - 0.5),
          0.25 + Math.random() * 0.25, (0.25 + u * 0.6) * l.width, 2.2, -1, 0.95);
      }
      if (!l.cold && u > 0.6 && L.flameSmoke > 0 && Math.random() < dt * L.flameSmoke * 0.7) this.smoke(l.px[i], l.py[i] + 0.3, l.pz[i], 0.6 + u * 0.6);
    }
  }

  /** A gob's size now (m), by its state: grows a little in flight, more as a ground fire or a rising fireball. */
  private drawnSize(i: number) {
    const L = this.look, st = this.st[i];
    if (st === FLY) return this.size[i] * (1 + (L.flameGrowFly - 1) * Math.min(1, this.age[i] / Math.max(0.05, this.burn[i])));
    const u = Math.min(1, (this.age[i] - this.tS[i]) / Math.max(0.05, this.life[i] - this.tS[i]));
    return this.s0[i] * (1 + ((st === GROUND ? L.flameGrowGround : L.flameGrowRise) - 1) * Math.sqrt(u));
  }

  private draw(camera: THREE.Camera) {
    const L = this.look;
    this.q.copy(camera.quaternion);
    const ha = this.hotData.array as Float32Array, da = this.darkData.array as Float32Array, la = this.litData.array as Float32Array;
    let nh = 0, nd = 0, nl = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i], k = this.kind[i];
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      if (k === SMOKE) {
        // Dirty smoke: brown-black, thickening in, thinning out as it billows up and spreads.
        const sz = this.size[i] * (1 + (this.grow[i] - 1) * Math.sqrt(t));
        this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
        this.dark.setMatrixAt(nd, this.m);
        const o = nd * 4, dirt = 0.5 + (this.seed[i] % 1) * 0.5;
        da[o] = 0.05 + 0.05 * dirt; da[o + 1] = 0.04 + 0.035 * dirt; da[o + 2] = 0.03 + 0.02 * dirt;
        da[o + 3] = 0.78 * Math.min(1, t / 0.12) * (1 - t) * (1 - t);
        nd++;
        continue;
      }
      if (k === GOB && this.age[i] < this.ign[i]) {
        // Unlit fuel: a dark amber streak of gel.
        const sz = this.size[i] * 0.45;
        this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
        this.dark.setMatrixAt(nd, this.m);
        const o = nd * 4; da[o] = 0.22; da[o + 1] = 0.13; da[o + 2] = 0.05; da[o + 3] = 0.85;
        nd++;
        continue;
      }
      const h = this.heat[i], cold = this.cold[i] === 1;
      let sz: number, r: number, gg: number, b: number, a: number;
      if (k === GOB || k === DROP) {
        const st = k === DROP ? FLY : this.st[i];
        sz = k === DROP ? this.size[i] : this.drawnSize(i);
        // How far through its part: along its burn in flight, through its ground fire or its rise after.
        const u = st === FLY ? (k === DROP ? t : Math.min(1, this.age[i] / Math.max(0.05, this.burn[i])))
          : Math.min(1, (this.age[i] - this.tS[i]) / Math.max(0.05, this.life[i] - this.tS[i]));
        // Fire: blue just out of the cone, white-hot yellow along the arc; a ground fire yellow-orange; a burnt-out
        // fireball orange, darkening to smoke.
        let br: number, bg: number, bb: number, ba = 0.95, core: number;
        if (st === FLY) {
          if (u < 0.08) { const w = u / 0.08; br = 0.4 + 1.8 * w; bg = 0.6 + 1.4 * w; bb = 2.0 - 0.8 * w; }
          else { const w = (u - 0.08) / 0.92; br = 2.2 - 0.2 * w; bg = 2.0 - 0.6 * w; bb = 1.2 - 0.9 * w; }
          core = 1 - u * 0.5;
        } else if (st === GROUND) {
          br = 2.0 - 0.9 * u; bg = 1.3 - 0.95 * u; bb = 0.3 - 0.25 * u; core = 0.5 * (1 - u);
          ba = u < 0.7 ? 0.95 : 0.95 * (1 - (u - 0.7) / 0.3);
        } else {
          br = 1.9 - 1.3 * u; bg = 1.1 - 0.95 * u; bb = 0.22 - 0.18 * u; core = 0.3 * (1 - u);
          ba = u < 0.6 ? 0.9 : 0.9 * (1 - (u - 0.6) / 0.4);
        }
        r = br * 0.7; gg = bg * 0.6; b = bb * 0.5; a = ba * 0.8;
        if (cold) { r = 0.62 + 0.2 * u; gg = 0.8 + 0.1 * u; b = 0.95; a = 0.3 * (1 - u * u); sz *= st === FLY ? 1.6 : 2; }
        else if (L.flameBlob > 0) {
          // The solid ball: stretched along its flight by its speed (a stream of fuel), flat as a ground fire.
          const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
          const stretch = st === FLY ? 1 + Math.min(3.5, sp * L.flameStretch) : 1;
          const flat = st === GROUND ? Math.min(1, (this.age[i] - this.tS[i]) * 6) * 0.8 : 0;
          if (k === GOB && this.nLight < L.flameBallLights && (this.litN++ % Math.max(1, L.flameLightEvery)) === 0) {
            const o = this.nLight++ * 4; this.lightPts[o] = this.px[i]; this.lightPts[o + 1] = this.py[i] + 0.6; this.lightPts[o + 2] = this.pz[i]; this.lightPts[o + 3] = sz;
          }
          this.blobs.blob(this.px[i], this.py[i] + sz * 0.25 * L.flameBlob * (1 - flat * 0.6), this.pz[i], sz * 0.42 * L.flameBlob / Math.sqrt(stretch),
            this.vx[i], this.vy[i], this.vz[i], flat, Math.min(1, br * h / 2.2), Math.min(1, bg * h / 2.2), Math.min(1, bb * h / 2.2), ba, this.seed[i], L.flameLump * (st === FLY ? 0.6 : 1.2), core, stretch);
          a *= L.flameHalo;
        }
      } else {
        // Licks, embers, mist: the flat particles.
        sz = this.size[i] * (1 + (this.grow[i] - 1) * Math.sqrt(t));
        if (cold) { r = 0.62 + 0.2 * t; gg = 0.8 + 0.1 * t; b = 0.95; a = 0.3 * (1 - t * t); }
        else if (k === EMBER) { r = 1.6; gg = 0.7; b = 0.25; a = 1 - t; }
        else if (t < 0.15) { const u = t / 0.15; r = 1.8; gg = 1.5 - 0.5 * u; b = 0.8 - 0.6 * u; a = 0.9; }
        else if (t < 0.6) { const u = (t - 0.15) / 0.45; r = 1.8 - 0.6 * u; gg = 1.0 - 0.65 * u; b = 0.2 - 0.15 * u; a = 0.9 - 0.3 * u; }
        else { const u = (t - 0.6) / 0.4; r = 1.2 - 0.9 * u; gg = 0.35 - 0.3 * u; b = 0.05; a = 0.6 * (1 - u); }
      }
      if (a > 0.01 && k === EMBER && nh < FLAME_MAX) {
        // Embers stay added (tiny sparks, they should glow).
        this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
        this.hot.setMatrixAt(nh, this.m);
        const o = nh * 4; ha[o] = r * h; ha[o + 1] = gg * h; ha[o + 2] = b * h; ha[o + 3] = a;
        nh++;
      } else if (a > 0.01 && k !== EMBER && nl < FLAME_MAX) {
        // Licks, halos and mist: drawn over, in colours that fit 0..1 (the fire's HDR values over 1.8 as full).
        this.m.compose(this.p, this.q, this.s.set(sz, sz * (k === LICK ? 1.4 : 1), sz));
        this.lit.setMatrixAt(nl, this.m);
        const o = nl * 4, f = cold ? 1 : h / 1.8;
        la[o] = Math.min(1, r * f); la[o + 1] = Math.min(1, gg * f); la[o + 2] = Math.min(1, b * f); la[o + 3] = cold ? a : a * 0.85;
        nl++;
      }
    }
    for (let g = 0; g + 5 < this.glows.length + 1 && nh < FLAME_MAX; g += 6) {
      const h = this.glows[g + 4], sz = this.glows[g + 3];
      this.p.set(this.glows[g], this.glows[g + 1], this.glows[g + 2]);
      this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
      this.hot.setMatrixAt(nh, this.m);
      const o = nh * 4;
      if (this.glows[g + 5]) { ha[o] = 0.04 + 0.1 * h; ha[o + 1] = 0.15 + 0.2 * h; ha[o + 2] = 0.4 + 0.35 * h; ha[o + 3] = 0.2 + 0.35 * h; } // cold: a blue haze, not added white
      else { ha[o] = 0.9 + 0.6 * h; ha[o + 1] = 0.12 + 0.45 * h * h; ha[o + 2] = 0.03 + 0.15 * h * h * h; ha[o + 3] = 0.25 + 0.45 * h; }
      nh++;
    }
    this.glows.length = 0;
    this.blobs.flush();
    this.tube.draw(this.streams.lines.values(), L);
    for (const [mesh, data, n] of [[this.hot, this.hotData, nh], [this.dark, this.darkData, nd], [this.lit, this.litData, nl]] as const) {
      mesh.count = n;
      if (n) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        data.clearUpdateRanges(); data.addUpdateRange(0, n * 4); data.needsUpdate = true;
      }
    }
  }

  private copy(a: number, b: number) {
    this.kind[a] = this.kind[b]; this.px[a] = this.px[b]; this.py[a] = this.py[b]; this.pz[a] = this.pz[b];
    this.vx[a] = this.vx[b]; this.vy[a] = this.vy[b]; this.vz[a] = this.vz[b]; this.age[a] = this.age[b]; this.life[a] = this.life[b];
    this.size[a] = this.size[b]; this.grow[a] = this.grow[b]; this.ign[a] = this.ign[b]; this.heat[a] = this.heat[b]; this.cold[a] = this.cold[b];
    this.st[a] = this.st[b]; this.tS[a] = this.tS[b]; this.s0[a] = this.s0[b]; this.burn[a] = this.burn[b]; this.split[a] = this.split[b]; this.seed[a] = this.seed[b];
  }
}

