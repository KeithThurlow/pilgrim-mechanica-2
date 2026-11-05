// Fire's look (Keith 2026-11-05; cosmetic, local, Math.random allowed): flame particles for the flamers' stream (fuel
// that flies dark from the fuel nozzle until the igniter's flame catches it, then burns along it), flames licking off
// burning things and pools, embers. Camera-facing quads in two instanced meshes: the flames added on (bright, no depth
// write), the unlit fuel and soot drawn over (dark). One draw call each. The battlefield owns one (bf.flames) and feeds
// it burning targets and pools every frame; the flamers emit their gobs into it.
// The solid look (Keith 2026-11-05): each pouring nozzle draws a thin emissive cone and each lit gob a boiling ball of
// flame (src/fx/flameBlobs.ts), the flat particles round them as a glow. A landing gob burns on and slides along the
// sand, runs downhill, and flows toward burning things near it (the battlefield hands those in as attractors each
// frame), ringing round them and running between ones close together; a gob flying into one splats there. Lit flames
// throw dirty smoke that billows up. All cheap per-particle maths on the gobs already alive; no fluid grid.
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, uv, smoothstep, float, sin, positionWorld, time } from "three/tsl";
import { FlameBlobs } from "./flameBlobs";

export const FLAME_MAX = 4096;

interface Ground { height(x: number, z: number): number }

/** Particle kinds: a stream gob (dark fuel, then flame), a flame lick (burning thing, pool), an ember. */
const GOB = 0, LICK = 1, EMBER = 2, SMOKE = 3;
const ATTRACT_MAX = 96;
/** Where a stream's fire on the sand flows to (Keith 2026-11-05): the plane through the aim point (x, z), square to the
 *  shooter's line to it (nx, nz: from the shooter toward the aim). */
export interface FlowGoal { x: number; z: number; nx: number; nz: number }
/** The neighbour grid for the swarm's spacing: cells this wide (m), a hash table this big. */
const CELL = 1, HASH = 1024;

/** The look values (Flame look sliders; the battlefield hands them in with tune()). */
export interface FlameLook {
  flameRise: number; flameDrag: number; flameGravity: number; flameFall: number; flameLicks: number; flameBlob: number; flameLump: number; flameHalo: number;
  flameGroundLife: number; flameSlide: number; flameGroundDrag: number; flameDownhill: number; flamePull: number;
  flamePullRange: number; flameSmoke: number; flameSmokeRise: number; flameSmokeSize: number;
  flameFlow: number; flameFlowSpeed: number; flameSeparate: number; flameSepDist: number;
}
const LOOK: FlameLook = {
  flameRise: 3, flameDrag: 1.6, flameGravity: 4, flameFall: 4, flameLicks: 1.5, flameBlob: 1, flameLump: 0.3, flameHalo: 0.25, flameGroundLife: 1.4,
  flameSlide: 0.8, flameGroundDrag: 1.2, flameDownhill: 5, flamePull: 16, flamePullRange: 2.2,
  flameSmoke: 1, flameSmokeRise: 1.6, flameSmokeSize: 3.2,
  flameFlow: 3, flameFlowSpeed: 9, flameSeparate: 6, flameSepDist: 0.9,
};

export class FlameFx {
  readonly group = new THREE.Group();
  private hot: THREE.InstancedMesh;
  private dark: THREE.InstancedMesh;
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
  /** Seconds since a gob landed on the sand (-1: still flying). */
  private onG = new Float32Array(FLAME_MAX);
  private seed = new Float32Array(FLAME_MAX);
  /** Each gob's flow goal (see FlowGoal; gnx = gnz = 0: none). */
  private gx = new Float32Array(FLAME_MAX); private gz = new Float32Array(FLAME_MAX);
  private gnx = new Float32Array(FLAME_MAX); private gnz = new Float32Array(FLAME_MAX);
  /** The neighbour grid of gobs on the sand (built at the top of each update from last frame's places). */
  private head = new Int32Array(HASH); private next = new Int32Array(FLAME_MAX);
  /** Burning things this frame (x, y, z), that fire on the sand gathers round. */
  private att = new Float32Array(ATTRACT_MAX * 3);
  private na = 0;
  private pend: number[] = [];
  private pendL: number[] = [];
  readonly blobs = new FlameBlobs();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** This frame's heat glows (hot metal: a soft red-orange halo where it burned; drawn once, then cleared). */
  private glows: number[] = [];
  /** Look values (the Flame stream sliders; the arsenal sets them). */
  look: FlameLook = { ...LOOK };

  /** Takes the Flame stream and Flame look sliders (any values object holding them; missing keys keep the default). */
  tune(v: Partial<FlameLook>) { for (const k in LOOK) { const x = (v as Record<string, number>)[k]; (this.look as unknown as Record<string, number>)[k] = typeof x === "number" ? x : LOOK[k as keyof FlameLook]; } }

  /** A burning thing at (x, y, z) this frame: fire on the sand near it flows to it. */
  attract(x: number, y: number, z: number) {
    if (this.na >= ATTRACT_MAX) return;
    const o = this.na++ * 3; this.att[o] = x; this.att[o + 1] = y; this.att[o + 2] = z;
  }

  /** A pouring nozzle's cone this frame (src/fx/flameBlobs.ts). */
  cone(from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, cold: boolean) {
    this.blobs.cone(from.x, from.y, from.z, dir.x, dir.y, dir.z, len, r, 0.85 + Math.random() * 0.3, cold);
  }

  /** A puff of dirty smoke, `k` × the Smoke size. */
  smoke(x: number, y: number, z: number, k = 1) {
    const L = this.look;
    this.add(SMOKE, x, y, z, (Math.random() - 0.5) * 0.6, L.flameSmokeRise * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.6,
      1.6 + Math.random() * 1.4, L.flameSmokeSize * 0.3 * k * (0.7 + Math.random() * 0.6), 3.3, -1);
  }

  constructor(private ground: Ground) {
    const mk = (data: THREE.InstancedBufferAttribute, additive: boolean) => {
      data.setUsage(THREE.DynamicDrawUsage);
      const d = instancedBufferAttribute<"vec4">(data);
      const r = uv().mul(2).sub(1).length();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      mat.colorNode = d.xyz;
      const soft = float(1).sub(smoothstep(additive ? 0.15 : 0.35, 1, r)).mul(d.w);
      // Smoke and soot billow: noise in world space frays the dark puffs as they drift through it.
      // (Cheap: a couple of sines in world space, no per-pixel noise; Keith 2026-11-05 saw the frame rate drop.)
      const pw = positionWorld, fray = sin(pw.x.mul(2.3).add(time.mul(0.7))).mul(sin(pw.z.mul(2.1).sub(pw.y.mul(1.7)))).mul(0.3).add(0.85);
      mat.opacityNode = additive ? soft : soft.mul(fray);
      if (additive) mat.blending = THREE.AdditiveBlending;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, FLAME_MAX);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = additive ? 5 : 4;
      return mesh;
    };
    this.dark = mk(this.darkData, false);
    this.hot = mk(this.hotData, true);
    this.group.add(this.dark, this.hot, this.blobs.group);
  }

  private add(k: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, ign: number, heat = 1, cold = 0): number {
    if (this.n >= FLAME_MAX) return -1;
    const i = this.n++;
    this.cold[i] = cold;
    this.kind[i] = k; this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.onG[i] = -1; this.seed[i] = Math.random() * 100; this.gnx[i] = 0; this.gnz[i] = 0;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.grow[i] = grow; this.ign[i] = ign; this.heat[i] = heat;
    return i;
  }

  /** A gob of the stream: leaves at (x, y, z) at velocity v, dark until `ign` s, then flame (growing `grow` × over life). */
  gob(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, ign: number, cold = false,
    goal: FlowGoal | null = null) {
    const i = this.add(GOB, x, y, z, vx, vy, vz, life, size, grow, cold ? -1 : ign, 1, cold ? 1 : 0);
    if (i >= 0 && goal) { const h = Math.hypot(goal.nx, goal.nz) || 1; this.gx[i] = goal.x; this.gz[i] = goal.z; this.gnx[i] = goal.nx / h; this.gnz[i] = goal.nz / h; }
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

  private ax = 0; private az = 0;
  /** Swerving round burning things (the swarm's obstacles): within `R` of one, pushed out from it and along its side
   *  the gob is already heading, so the flow parts round it and closes behind. Adds to (ax, az) into this.ax, this.az. */
  private around(i: number, R: number, ax: number, az: number) {
    const att = this.att, push = this.look.flamePull, x = this.px[i], z = this.pz[i];
    const vx = this.vx[i] || this.gnx[i], vz = this.vz[i] || this.gnz[i];
    for (let j = 0; j < this.na; j++) {
      const dx = x - att[j * 3], dz = z - att[j * 3 + 2], d2 = dx * dx + dz * dz;
      if (d2 > R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), ux = dx / d, uz = dz / d, k = push * (1 - d / R);
      // The side it passes on: the tangent that goes with its heading.
      const tx = -uz, tz = ux, sg = tx * vx + tz * vz >= 0 ? 1 : -1;
      ax += (ux + tx * sg * 0.8) * k; az += (uz + tz * sg * 0.8) * k;
    }
    this.ax = ax; this.az = az;
  }

  update(dt: number, camera: THREE.Camera) {
    const g = this.ground, L = this.look;
    const R = L.flamePullRange, na = this.na;
    // The swarm's neighbour grid: gobs on the sand by cell (last frame's places; indices hold until the compaction).
    const head = this.head, next = this.next, sepD = L.flameSepDist;
    head.fill(-1);
    if (L.flameSeparate > 0) for (let i = 0; i < this.n; i++) if (this.kind[i] === GOB && this.onG[i] >= 0) {
      const h = cellHash(Math.floor(this.px[i] / CELL), Math.floor(this.pz[i] / CELL));
      next[i] = head[h]; head[h] = i;
    }
    let keep = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const k = this.kind[i], lit = this.age[i] >= this.ign[i], cold = this.cold[i] === 1;
      const grounded = this.onG[i] >= 0;
      if (k === SMOKE) {
        const dr = Math.exp(-0.9 * dt);
        this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr + L.flameSmokeRise * 0.45 * dt;
      } else if (k === GOB && grounded) {
        // On the sand, a swarm (Keith 2026-11-05: "a swarm that will try to navigate ... towards a plane that's
        // perpendicular to the cursor from the player"): each gob steers on toward its stream's goal plane, keeps
        // its distance from its neighbours, flows round burning things (and gathers at them), runs downhill.
        this.onG[i] += dt;
        const dr = Math.exp(-L.flameGroundDrag * dt);
        let ax = 0, az = 0;
        if (L.flameDownhill > 0) {
          const h0 = g.height(this.px[i], this.pz[i]);
          ax -= (g.height(this.px[i] + 0.5, this.pz[i]) - h0) * 2 * L.flameDownhill;
          az -= (g.height(this.px[i], this.pz[i] + 0.5) - h0) * 2 * L.flameDownhill;
        }
        // On in the fire's direction (Keith 2026-11-05: "path through things, but then continue moving in that general
        // direction"): steered to the flow speed along the stream's line, past the aim and on, never back.
        const nx = this.gnx[i], nz = this.gnz[i];
        if (L.flameFlow > 0 && (nx !== 0 || nz !== 0)) {
          const has = this.vx[i] * nx + this.vz[i] * nz, a = Math.max(0, L.flameFlowSpeed - has) * L.flameFlow;
          ax += nx * a; az += nz * a;
        }
        if (na) { this.around(i, R, ax, az); ax = this.ax; az = this.az; }
        // Spacing: pushed off neighbours closer than the spacing distance.
        if (L.flameSeparate > 0) {
          const cx = Math.floor(this.px[i] / CELL), cz = Math.floor(this.pz[i] / CELL);
          for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            for (let j = head[cellHash(cx + ox, cz + oz)], c = 0; j >= 0 && c < 6; j = next[j], c++) {
              if (j === i) continue;
              const dx = this.px[i] - this.px[j], dz = this.pz[i] - this.pz[j], d2 = dx * dx + dz * dz;
              if (d2 > sepD * sepD || d2 < 1e-6) continue;
              const d = Math.sqrt(d2), f = L.flameSeparate * (1 - d / sepD) / d;
              ax += dx * f; az += dz * f;
            }
          }
        }
        this.vx[i] = this.vx[i] * dr + ax * dt; this.vz[i] = this.vz[i] * dr + az * dt;
        this.vy[i] = 0;
      } else {
        const drag = Math.exp(-(k === GOB ? (lit ? L.flameDrag * 1.6 : L.flameDrag * 0.3) : 1.5) * dt);
        this.vx[i] *= drag; this.vz[i] *= drag;
        if (k === GOB && lit) {
          // Burning fuel is heavy gel (and the freeze ray's mist dense cold air): it arcs on down to the sand (the flames licking off it rise; Flame look › Burning
          // fuel falls), slowed less up and down than along.
          this.vy[i] = this.vy[i] * Math.exp(-L.flameDrag * 0.4 * dt) - L.flameFall * dt;
        } else
        // Mist sinks a little where flames rise.
        this.vy[i] = this.vy[i] * drag + (k === GOB && !lit ? -L.flameGravity : k === EMBER ? -0.5 : cold ? -0.6 : L.flameRise) * dt;
        // A lit gob flying at something burning swerves round it and flies on (the damage is the gun's rays, not this).
        if (k === GOB && lit && na) { this.around(i, R, 0, 0); this.vx[i] += this.ax * dt; this.vz[i] += this.az * dt; }
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const gy = g.height(this.px[i], this.pz[i]);
      if (k === SMOKE) { if (this.py[i] < gy + 0.3) this.py[i] = gy + 0.3; }
      else if (this.py[i] < gy + 0.05 || grounded) {
        // On the sand: a lit gob lands, keeps much of its speed sliding, and burns on a while; the rest splash.
        this.py[i] = gy + 0.05;
        if (k === GOB && lit && !grounded) {
          this.onG[i] = 0;
          this.vx[i] *= L.flameSlide; this.vz[i] *= L.flameSlide;
          this.life[i] = Math.max(this.life[i], this.age[i] + L.flameGroundLife * (0.7 + Math.random() * 0.6));
        } else if (!grounded) {
          if (this.vy[i] < 0) this.vy[i] = k === GOB ? 0.6 : 0;
          this.vx[i] *= 0.5; this.vz[i] *= 0.5;
        }
      }
      // Fire on the sand licks flames up off it.
      if (k === GOB && this.onG[i] >= 0 && L.flameLicks > 0 && Math.random() < dt * L.flameLicks) this.pendL.push(this.px[i], this.py[i] + 0.1, this.pz[i], this.size[i] * 1.6);
      // Lit flames throw dirty smoke as they burn down.
      if (L.flameSmoke > 0 && !cold && (k === GOB ? lit : k === LICK) && this.age[i] > this.life[i] * 0.35 &&
        Math.random() < dt * L.flameSmoke * (k === LICK ? 0.5 : 1)) this.pend.push(this.px[i], this.py[i] + this.size[i] * this.grow[i] * 0.4, this.pz[i], k === LICK ? 0.8 : 1);
      if (keep !== i) this.copy(keep, i);
      keep++;
    }
    this.n = keep;
    for (let j = 0; j < this.pend.length; j += 4) this.smoke(this.pend[j], this.pend[j + 1], this.pend[j + 2], this.pend[j + 3]);
    this.pend.length = 0;
    for (let j = 0; j < this.pendL.length; j += 4) this.lick(this.pendL[j], this.pendL[j + 1], this.pendL[j + 2], this.pendL[j + 3], 0.95);
    this.pendL.length = 0;
    this.na = 0;
    // Draw: hot (lit gobs, licks, embers) and dark (unlit fuel, soot from old flames).
    this.q.copy(camera.quaternion);
    const ha = this.hotData.array as Float32Array, da = this.darkData.array as Float32Array;
    let nh = 0, nd = 0;
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
      // Lit: from the moment it caught (gobs) or was made.
      const lt = k === GOB ? Math.min(1, (this.age[i] - Math.max(0, this.ign[i])) / Math.max(0.05, this.life[i] - Math.max(0, this.ign[i]))) : t;
      const sz = this.size[i] * (1 + (this.grow[i] - 1) * Math.sqrt(lt));
      const h = this.heat[i];
      let r: number, gg: number, b: number, a: number;
      if (this.cold[i]) { const u = lt; r = 0.45 + 0.35 * u; gg = 0.7 + 0.2 * u; b = 1.15 - 0.2 * u; a = 0.55 * (1 - u * u); }
      else if (k === EMBER) { r = 1.6; gg = 0.7; b = 0.25; a = 1 - t; }
      else if (lt < 0.15) { const u = lt / 0.15; r = 1.8; gg = 1.5 - 0.5 * u; b = 0.8 - 0.6 * u; a = 0.9; }
      else if (lt < 0.6) { const u = (lt - 0.15) / 0.45; r = 1.8 - 0.6 * u; gg = 1.0 - 0.65 * u; b = 0.2 - 0.15 * u; a = 0.9 - 0.3 * u; }
      else { const u = (lt - 0.6) / 0.4; r = 1.2 - 0.9 * u; gg = 0.35 - 0.3 * u; b = 0.05; a = 0.6 * (1 - u); }
      // The stream's lit gobs: a solid boiling ball (blue at the nozzle, white-yellow, orange, dying red), the flat
      // particle round it as a glow.
      let halo = 1;
      if (k === GOB && !this.cold[i] && L.flameBlob > 0) {
        halo = L.flameHalo;
        let br: number, bg: number, bb: number;
        // Keith 2026-11-05: start bluer, go very white-hot yellow, then yellow (orange only as it dies).
        if (lt < 0.12) { const u = lt / 0.12; br = 0.3 + 1.9 * u; bg = 0.5 + 1.5 * u; bb = 2.0 - 0.8 * u; }
        else if (lt < 0.5) { const u = (lt - 0.12) / 0.38; br = 2.2 - 0.2 * u; bg = 2.0 - 0.5 * u; bb = 1.2 - 0.9 * u; }
        else { const u = (lt - 0.5) / 0.5; br = 2.0 - 0.6 * u; bg = 1.5 - 0.8 * u; bb = 0.3 - 0.2 * u; }
        const ba = lt < 0.7 ? 0.95 : 0.95 * (1 - (lt - 0.7) / 0.3);
        const flat = this.onG[i] >= 0 ? Math.min(1, this.onG[i] * 5) : 0;
        this.blobs.blob(this.px[i], this.py[i] + sz * 0.25 * L.flameBlob * (1 - flat * 0.5), this.pz[i], sz * 0.42 * L.flameBlob,
          this.vx[i], this.vy[i], this.vz[i], flat, br * h, bg * h, bb * h, ba, this.seed[i], L.flameLump, Math.max(0, 1 - lt * 1.4));
      }
      if (halo > 0.01) {
        this.m.compose(this.p, this.q, this.s.set(sz, sz * (k === LICK ? 1.4 : 1), sz));
        this.hot.setMatrixAt(nh, this.m);
        const o = nh * 4; ha[o] = r * h; ha[o + 1] = gg * h; ha[o + 2] = b * h; ha[o + 3] = a * halo;
        nh++;
      }
      // The tail of a big flame leaves a puff of soot over it.
      if (k === LICK && !this.cold[i] && lt > 0.7 && sz > 0.8 && nd < FLAME_MAX) {
        this.p.y += sz * 0.4;
        this.m.compose(this.p, this.q, this.s.set(sz * 0.9, sz * 0.9, sz * 0.9));
        this.dark.setMatrixAt(nd, this.m);
        const od = nd * 4; da[od] = 0.08; da[od + 1] = 0.07; da[od + 2] = 0.06; da[od + 3] = 0.35 * (1 - (lt - 0.7) / 0.3);
        nd++;
      }
    }
    for (let g = 0; g + 5 < this.glows.length + 1 && nh < FLAME_MAX; g += 6) {
      const h = this.glows[g + 4], sz = this.glows[g + 3];
      this.p.set(this.glows[g], this.glows[g + 1], this.glows[g + 2]);
      this.m.compose(this.p, this.q, this.s.set(sz, sz, sz));
      this.hot.setMatrixAt(nh, this.m);
      const o = nh * 4;
      if (this.glows[g + 5]) { ha[o] = 0.3 + 0.5 * h; ha[o + 1] = 0.55 + 0.4 * h; ha[o + 2] = 0.9 + 0.4 * h; ha[o + 3] = 0.2 + 0.35 * h; }
      else { ha[o] = 0.9 + 0.6 * h; ha[o + 1] = 0.12 + 0.45 * h * h; ha[o + 2] = 0.03 + 0.15 * h * h * h; ha[o + 3] = 0.25 + 0.45 * h; }
      nh++;
    }
    this.glows.length = 0;
    this.blobs.flush();
    for (const [mesh, data, n] of [[this.hot, this.hotData, nh], [this.dark, this.darkData, nd]] as const) {
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
    this.onG[a] = this.onG[b]; this.seed[a] = this.seed[b];
    this.gx[a] = this.gx[b]; this.gz[a] = this.gz[b]; this.gnx[a] = this.gnx[b]; this.gnz[a] = this.gnz[b];
  }
}

function cellHash(x: number, z: number) { return ((x * 73856093) ^ (z * 19349663)) & (HASH - 1); }
