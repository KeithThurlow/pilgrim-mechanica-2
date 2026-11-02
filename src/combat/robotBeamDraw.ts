// Draws the excavators' charging beam (Keith 2026-10-31; sim in robots.ts). Cosmetic. While it charges: a glow at the
// emitter under the chassis that grows bigger and hotter, and a thin warning line on the sand along the beam's path
// that brightens (and widens to the beam's width once the aim locks), so it reads by day. Then the beam: a white-hot
// core in a blue sheath from the emitter to where it strikes, and a scorch along the sand that glows and fades.
// Keith 2026-11-01: narrower, a thin thread of the beam already showing from the lock as it charges, and a big walker's
// beam keeps firing for robotBeamSweep, flickering, while its strike drags toward the mech, then fades.
// Blue since 2026-11-01 (Keith: red for the robots' seeking, blue for their terraforming weapons). The big walkers'
// terraform pulse draws here too: a beam straight down into the sand, a ring on the ground at the blast's edge and a
// second ring closing in on it as the charge runs out, then a wide flash of the column.
// Keith 2026-11-02: fine beams, not wide tubes: a thin white-hot core in a soft glow (src/fx/beamStrand.ts), wavering
// and flickering, with wisps spiralling along it, and a bright melt flash where it strikes the sand, throwing molten
// spatter (src/fx/meltSparks.ts). The light it casts on the ground is a quarter of what it was; the old blue scorch
// ribbon is off by default (the hot sand, src/fx/groundHeat.ts, shows the melt and cools point by point).
// At night it lights the ground through the night lights' one request path (src/world/lamps.ts ShortLights): the
// charging emitter holds a real light at high priority, the line and the scorch glow on the sand.
import * as THREE from "three/webgpu";
import { RobotSwarm, BIG, type BeamLine } from "./robots";
import { beamPower, beamWidthShare } from "./beamCore";
import { Ribbon, SoftRing, glowMaterial, type P3 } from "../weapons/ribbon";
import type { BlastWaves } from "../fx/blastWaves";
import { FAM_ROBOT, type ShortLights } from "../world/lamps";
import { BeamStrand, type StrandShape } from "../fx/beamStrand";
import { MeltSparks } from "../fx/meltSparks";

const SLOTS = 16, SCORCHES = 8, PTS = 48;
const WISPS = 3, MELT = 0xffc890, MELT_HALO = 0xff7a20;
const HOT = 0x2a8cff, CORE = 0xe0f6ff, LINE = 0x3aa8ff, EMBER = 0x5ab8ff, EMBER_COLD = 0x0a2a60;

interface Slot {
  glow: THREE.Mesh; halo: THREE.Mesh; line: Ribbon; edge: Ribbon; beam: THREE.Mesh; core: THREE.Mesh; ring: Ribbon; reach: SoftRing; wave: SoftRing;
  /** The fine beam: a soft glow round a thin core, and wisps along it. */
  sGlow: BeamStrand; sCore: BeamStrand; wisps: BeamStrand[];
  /** The melt flash where it strikes: a white-hot point, an orange bloom, a flat glow on the sand. */
  hit: THREE.Mesh; hitHalo: THREE.Mesh; hitPool: THREE.Mesh;
  sparkAcc: number;
}
interface Scorch { ribbon: Ribbon; t: number; sx: number; sz: number; x1: number; z1: number; w: number }

export class RobotBeamDraw {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private scorches: Scorch[] = [];
  private nextScorch = 0;
  /** Last seen charge time per robot (to catch the moment it fires). */
  private seen = new Float32Array(4096).fill(-1);
  private line: BeamLine = { ex: 0, ey: 0, ez: 0, sx: 0, sy: 0, sz: 0, x1: 0, y1: 0, z1: 0 };
  private pts: P3[] = [];
  private q = new THREE.Quaternion();
  private d = new THREE.Vector3();
  private c = new THREE.Color();
  private time = 0;
  private sparks: MeltSparks;
  /** The beam being laid now, for the strand shapes (set before each strand's set). */
  private cur = { L: 1, w: 1, seed: 0, waver: 0, flick: 0, wisp: 0, j: 0 };
  private shapeCore: StrandShape = (t, o) => {
    const c = this.cur, T = this.time, x = t * c.L, env = Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.05)));
    o.a = c.waver * env * (0.6 * Math.sin(x * 0.45 + T * 17 + c.seed) + 0.4 * Math.sin(x * 1.1 - T * 31 + c.seed * 2));
    o.b = c.waver * env * (0.6 * Math.sin(x * 0.5 - T * 13 + c.seed * 3) + 0.4 * Math.sin(x * 0.95 + T * 37));
    // Flicker runs down it in pulses, the emitter end steadier.
    o.k = 1 - c.flick * 0.6 * (0.5 + 0.5 * Math.sin(x * 0.7 - T * 70 + c.seed)) * Math.min(1, t * 3);
  };
  private shapeGlow: StrandShape = (t, o) => {
    this.shapeCore(t, o);
    o.a *= 0.7; o.b *= 0.7;
    o.k = 1 - this.cur.flick * 0.35 * (0.5 + 0.5 * Math.sin(t * this.cur.L * 0.3 - this.time * 25 + this.cur.seed));
  };
  private shapeWisp: StrandShape = (t, o) => {
    const c = this.cur, T = this.time, j = c.j, x = t * c.L, dir = j & 1 ? 1 : -1;
    const r = c.w * (0.18 + 0.12 * Math.sin(T * 3 + j * 2 + x * 0.2)) * Math.min(1, t * 6);
    const ph = dir * x * (0.5 + 0.15 * j) - T * (6 + 2.5 * j) + j * 2.1 + c.seed;
    o.a = r * Math.cos(ph); o.b = r * Math.sin(ph);
    // Broken into drifting puffs.
    const puff = Math.max(0, Math.sin(x * (0.35 + 0.1 * j) - T * (9 + 3 * j) + j * 4 + c.seed));
    o.k = c.wisp * puff * puff * puff * Math.min(1, t * 4) * Math.min(1, (1 - t) * 8 + 0.3);
  };

  /**
   * The fine beam on slot s for robot i from (b.ex..) to the strike: a soft glow `w` wide round a thin core, wisps,
   * brightness `a` (0..1), and the melt flash where it strikes with power p (0..1); dt for the spatter.
   */
  private fine(s: Slot, i: number, b: BeamLine, w: number, a: number, p: number, dt: number, wisps = true) {
    const v = this.swarm.v, c = this.cur;
    const L = Math.hypot(b.x1 - b.ex, b.y1 - b.ey, b.z1 - b.ez);
    const fl = v.robotBeamFlicker ?? 0.4, wob = 1 - fl * 0.25 * (0.5 + 0.5 * Math.sin(this.time * 53 + i * 1.7)) * (0.5 + 0.5 * Math.sin(this.time * 19 + i));
    c.L = L; c.w = w; c.seed = (i * 0.618) % 1 * 20; c.waver = (v.robotBeamWaver ?? 0.07) * Math.min(1, w * 2.5); c.flick = fl; c.wisp = (v.robotBeamWisps ?? 0.7) * a;
    const coreW = Math.max(0.03, w * (v.robotBeamCoreW ?? 0.3)), haloW = Math.max(0.1, w * (v.robotBeamHaloW ?? 1.6));
    s.sCore.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, coreW, this.shapeCore);
    s.sCore.mat.opacity = Math.min(1, a * wob);
    s.sGlow.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, haloW, this.shapeGlow);
    s.sGlow.mat.opacity = (v.robotBeamHaloK ?? 0.45) * a * wob;
    for (let j = 0; j < WISPS; j++) {
      const m = s.wisps[j];
      if (!wisps || c.wisp <= 0.01) { m.mesh.visible = false; continue; }
      c.j = j;
      m.set(b.ex, b.ey, b.ez, b.x1, b.y1, b.z1, Math.max(0.04, w * 0.14), this.shapeWisp);
      m.mat.opacity = 0.8;
    }
    // The melt flash: white-hot at the point, an orange bloom, the sand glowing round it; spatter thrown up.
    const H = (v.robotBeamHit ?? 1.4) * p * a, fk = 0.75 + 0.25 * Math.sin(this.time * 47 + i) * Math.sin(this.time * 29);
    const show = H > 0.03;
    s.hit.visible = s.hitHalo.visible = s.hitPool.visible = show;
    if (show) {
      const gy = this.swarm.ground.height(b.x1, b.z1);
      s.hit.position.set(b.x1, Math.max(b.y1, gy) + 0.1, b.z1); s.hit.scale.setScalar(H * 0.45 * fk);
      s.hitHalo.position.copy(s.hit.position); s.hitHalo.scale.setScalar(H * 1.1 * fk);
      (s.hit.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.6 + 0.4 * p);
      (s.hitHalo.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * p;
      s.hitPool.position.set(b.x1, gy + 0.12, b.z1); s.hitPool.scale.set(H * 1.6, 1, H * 1.6);
      (s.hitPool.material as THREE.MeshBasicMaterial).opacity = 0.7 * fk;
      s.sparkAcc += (v.robotBeamSparks ?? 90) * p * a * dt;
      const n = Math.floor(s.sparkAcc);
      if (n > 0) {
        s.sparkAcc -= n;
        const fx = b.x1 - b.ex, fz = b.z1 - b.ez, fh = Math.hypot(fx, fz) || 1;
        this.sparks.emit(n, b.x1, gy, b.z1, 3 + 4 * p, fx / fh, fz / fh);
      }
    }
  }

  private hideFine(s: Slot) {
    s.sGlow.mesh.visible = s.sCore.mesh.visible = s.hit.visible = s.hitHalo.visible = s.hitPool.visible = false;
    for (const w of s.wisps) w.mesh.visible = false;
  }

  /** The charging and burning beams this frame, for the lights: robot, charge share (0..1, >1 burning). */
  private live: { i: number; u: number; line: BeamLine; f?: number }[] = [];

  constructor(private swarm: RobotSwarm) {
    this.group.name = "robot beams";
    const tube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let k = 0; k < SLOTS; k++) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), glowMaterial(CORE, true));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), glowMaterial(HOT, true));
      const line = new Ribbon(PTS, LINE, false), edge = new Ribbon(PTS, LINE, true), ring = new Ribbon(PTS, LINE, true);
      const beam = new THREE.Mesh(tube, glowMaterial(HOT, true)), core = new THREE.Mesh(tube, glowMaterial(CORE, true));
      for (const o of [glow, halo, beam, core]) { o.frustumCulled = false; o.renderOrder = 6; }
      line.mesh.renderOrder = edge.mesh.renderOrder = ring.mesh.renderOrder = 3;
      ring.mesh.visible = false;
      const reach = new SoftRing(PTS, LINE), wave = new SoftRing(PTS, CORE);
      const sGlow = new BeamStrand(40, HOT, 0.3), sCore = new BeamStrand(40, CORE, 0.2);
      const wisps = Array.from({ length: WISPS }, () => new BeamStrand(56, 0x8cd0ff, 0.3));
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(0xfff4e0, true));
      const hitHalo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(MELT_HALO, true));
      const hitPool = new THREE.Mesh(POOL_GEO, poolMaterial());
      for (const o of [hit, hitHalo, hitPool]) { o.frustumCulled = false; o.renderOrder = 7; o.visible = false; }
      hitPool.renderOrder = 4;
      this.group.add(halo, glow, line.mesh, edge.mesh, ring.mesh, beam, core, reach.mesh, wave.mesh, sGlow.mesh, sCore.mesh, ...wisps.map((w) => w.mesh), hitPool, hitHalo, hit);
      this.slots.push({ glow, halo, line, edge, beam, core, ring, reach, wave, sGlow, sCore, wisps, hit, hitHalo, hitPool, sparkAcc: 0 });
    }
    this.sparks = new MeltSparks(swarm.ground);
    this.group.add(this.sparks.mesh);
    for (let k = 0; k < SCORCHES; k++) {
      const ribbon = new Ribbon(PTS, EMBER, true);
      ribbon.mesh.visible = false;
      this.group.add(ribbon.mesh);
      this.scorches.push({ ribbon, t: 1e9, sx: 0, sz: 0, x1: 0, z1: 0, w: 1 });
    }
    // The night lights find this and ask it for its lights each frame.
    this.group.userData.shortLights = (L: ShortLights) => this.lights(L);
    // Heat shimmer over the emitter while it charges and down the line while it burns (src/fx/blastWavesDraw.ts finds this).
    this.group.userData.heat = (w: BlastWaves) => this.heat(w);
  }

  private heat(w: BlastWaves) {
    const s = w.v.waveBeamHeat, v = this.swarm.v;
    if (s <= 0) return;
    for (const { u, line: b } of this.live) {
      if (u < 1) w.heat(b.ex, b.ey + 0.6, b.ez, 2 + 2 * u, s * (0.3 + 0.7 * Math.pow(u, v.robotBeamGrowth)));
      else for (let k = 0; k < 3; k++) {
        const t = Math.random(), x = b.sx + (b.x1 - b.sx) * t, y = b.sy + (b.y1 - b.sy) * t, z = b.sz + (b.z1 - b.sz) * t;
        w.heat(x, y + 1, z, 3, s);
      }
    }
  }

  private path(b: { sx: number; sz: number; x1: number; z1: number }): P3[] {
    const pts = this.pts; pts.length = 0;
    const L = Math.hypot(b.x1 - b.sx, b.z1 - b.sz), n = Math.max(2, Math.min(PTS, Math.ceil(L / 2) + 1));
    for (let k = 0; k < n; k++) { const t = k / (n - 1); pts.push({ x: b.sx + (b.x1 - b.sx) * t, y: 0, z: b.sz + (b.z1 - b.sz) * t }); }
    return pts;
  }

  update(dt: number) {
    const sw = this.swarm, v = sw.v, g = sw.ground, B = Math.max(0.01, v.robotBeamBurn);
    this.time += dt;
    this.live.length = 0;
    let k = 0;
    for (let i = 0; i < sw.hi && i < this.seen.length; i++) {
      const t = sw.beamT[i];
      if (sw.kind[i] === BIG && sw.pulseT[i] >= 0 && k < SLOTS) { this.pulse(this.slots[k++], i); this.seen[i] = -1; continue; }
      if (t < 0) { this.seen[i] = -1; continue; }
      if (k >= SLOTS) continue;
      // Per robot: a big one's beam, or a weapon quad's laser or rail (thinner, a smaller glow).
      const spec = sw.beamSpec(i), C = spec.charge, W = spec.width, G = v.robotBeamGlow * (sw.kind[i] === BIG ? 1 : 0.3);
      const s = this.slots[k++], b = sw.beamLine(i, { ...this.line });
      s.ring.mesh.visible = s.reach.mesh.visible = s.wave.mesh.visible = false;
      const D = sw.beamSweep(i), u = t / C, locked = t >= C * v.robotBeamLock;
      this.live.push({ i, u, line: b });
      // Caught the moment it fired: leave a scorch.
      if (this.seen[i] < C && t >= C) {
        const sc = this.scorches[this.nextScorch++ % SCORCHES];
        sc.t = 0; sc.sx = b.sx; sc.sz = b.sz; sc.x1 = b.x1; sc.z1 = b.z1; sc.w = W;
        if ((v.robotBeamScorchGlow ?? 0) > 0) sc.ribbon.set(this.path(b), W * 1.3, "ground", g, 0.1);
      }
      this.seen[i] = t;
      if (t < C) {
        // Charging: the emitter glow grows and heats, flickering faster toward the end.
        const grow = Math.pow(Math.min(1, u), v.robotBeamGrowth), flick = 0.9 + 0.1 * Math.sin(this.time * (20 + 40 * u));
        const r = Math.max(0.15, G * (0.15 + 0.85 * grow)) * flick;
        s.glow.position.set(b.ex, b.ey, b.ez); s.glow.scale.setScalar(r * 0.55);
        s.halo.position.copy(s.glow.position); s.halo.scale.setScalar(r * 1.4);
        (s.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * grow;
        (s.halo.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * grow;
        s.glow.visible = s.halo.visible = true;
        if (sw.kind[i] === BIG) {
          // A big one (Keith 2026-11-01: the real beam, not a line on the sand): live from the start, thin and
          // flickering, thickening and brightening with its power to the release (src/combat/beamCore.ts).
          const sh = sw.bigBeamShape(), ws = beamWidthShare(t, sh), p = beamPower(t, sh);
          this.fine(s, i, b, W * ws, 0.55 + 0.45 * p, p, dt);
          s.beam.visible = s.core.visible = false;
          s.line.mesh.visible = s.edge.mesh.visible = false;
          continue;
        }
        // The warning line: thin and faint while it tracks; at the lock it widens to the beam and pulses.
        const pts = this.path(b);
        const pulse = locked ? 0.75 + 0.25 * Math.sin(this.time * 26) : 1;
        s.line.set(pts, locked ? W : 0.25, "ground", g, 0.09);
        s.line.mat.opacity = v.robotBeamLine * (locked ? 0.35 + 0.35 * u : 0.15 + 0.4 * u) * pulse;
        s.edge.set(pts, locked ? 0.3 : 0.12, "ground", g, 0.11);
        s.edge.mat.opacity = v.robotBeamLine * (0.3 + 0.7 * grow) * pulse;
        s.line.mesh.visible = s.edge.mesh.visible = v.robotBeamLine > 0;
        s.beam.visible = s.core.visible = false;
        // Charged up: from the lock a thin thread of the beam, emitter to strike, thickening and brightening to the release.
        if (locked) {
          const k = Math.min(1, (t - C * v.robotBeamLock) / Math.max(0.01, C * (1 - v.robotBeamLock)));
          this.fine(s, i, b, W * (0.15 + 0.35 * k), 0.35 + 0.5 * k, 0.15 * k, dt, false);
        } else this.hideFine(s);
      } else {
        // The burn: full and flickering while it sweeps, then fading over the burn time; the emitter flares with it.
        const f = t < C + D ? 0.9 + 0.1 * Math.sin(this.time * 60 + i) : Math.max(0, 1 - (t - C - D) / B), w = W * (0.55 + 0.45 * f);
        this.live[this.live.length - 1].f = f;
        this.d.set(b.x1 - b.ex, b.y1 - b.ey, b.z1 - b.ez);
        this.fine(s, i, b, w, f, f, dt);
        s.beam.visible = s.core.visible = false;
        s.glow.position.set(b.ex, b.ey, b.ez); s.glow.scale.setScalar(G * (0.6 + 0.6 * f));
        s.halo.position.copy(s.glow.position); s.halo.scale.setScalar(G * (1.2 + 1.2 * f));
        (s.glow.material as THREE.MeshBasicMaterial).opacity = f; (s.halo.material as THREE.MeshBasicMaterial).opacity = 0.6 * f;
        s.glow.visible = s.halo.visible = true;
        // The sand under the strike glows red-hot on its own (src/fx/groundHeat.ts): no ring.
        s.line.mesh.visible = s.edge.mesh.visible = false;
      }
    }
    for (; k < SLOTS; k++) {
      const s = this.slots[k];
      s.glow.visible = s.halo.visible = s.line.mesh.visible = s.edge.mesh.visible = s.beam.visible = s.core.visible = s.ring.mesh.visible = false;
      s.reach.mesh.visible = s.wave.mesh.visible = false;
      this.hideFine(s);
    }
    this.sparks.update(dt);
    // Scorches: hot at first, cooling to a dull ember glow, then gone.
    const T = Math.max(0.05, v.robotBeamScorch);
    for (const sc of this.scorches) {
      sc.t += dt;
      const f = 1 - sc.t / T;
      sc.ribbon.mesh.visible = f > 0 && (v.robotBeamScorchGlow ?? 0) > 0;
      if (!sc.ribbon.mesh.visible) continue;
      sc.ribbon.mat.opacity = 0.9 * f * f * v.robotBeamScorchGlow;
      this.c.setHex(EMBER).lerp(this.c2.setHex(EMBER_COLD), 1 - f);
      sc.ribbon.mat.color.copy(this.c);
    }
  }
  private c2 = new THREE.Color();
  private ep = { x: 0, y: 0, z: 0 };

  /**
   * A terraform pulse on slot s for robot i (Keith 2026-11-01: show it with the real thing, not a strip on the sand): a
   * very thin beam straight down that brightens as it charges, a bright pulse running down it at the end, then the blast
   * as a burst of light (the column flares wide, the emitter blazes). The blast's reach is a faint soft ring, three
   * thin rings fading inward (robotPulseRing).
   */
  private pulse(s: Slot, i: number) {
    this.hideFine(s);
    const sw = this.swarm, v = sw.v, g = sw.ground, C = Math.max(0.05, v.robotPulseCharge), t = sw.pulseT[i];
    const e = sw.beamFrom(i, this.ep), gy = g.height(e.x, e.z), len = Math.max(0.5, e.y - gy), R = v.robotPulseRadius;
    const u = Math.min(1, t / C), grow = Math.pow(u, v.robotBeamGrowth);
    this.live.push({ i, u: t < C ? u : 1 + (t - C) / C, line: { ex: e.x, ey: e.y, ez: e.z, sx: e.x, sy: gy, sz: e.z, x1: e.x, y1: gy, z1: e.z } });
    const f = t < C ? 0 : Math.max(0, 1 - (t - C) / Math.max(0.05, v.robotPulseHold));
    this.q.setFromUnitVectors(Z, this.d.set(0, -1, 0));
    // The thin beam down; at the blast a wide flare.
    const w = t < C ? (0.05 + 0.12 * grow) * (0.8 + 0.2 * Math.sin(this.time * 50)) : 0.6 + 5 * f * f;
    s.core.position.set(e.x, e.y, e.z); s.core.quaternion.copy(this.q); s.core.scale.set(w, w, len);
    (s.core.material as THREE.MeshBasicMaterial).opacity = t < C ? 0.55 + 0.45 * grow : f;
    s.core.visible = t < C || f > 0.01;
    // The pulse running down (the end of the charge), then the flare's sheath.
    const D = Math.min(C, Math.max(0.05, v.robotPulseDrop)), k = (t - (C - D)) / D;
    if (t < C && k >= 0) {
      const seg = Math.min(len, 2.5), y = e.y - (len - seg) * Math.min(1, k);
      s.beam.position.set(e.x, y, e.z); s.beam.quaternion.copy(this.q); s.beam.scale.set(0.5, 0.5, seg);
      (s.beam.material as THREE.MeshBasicMaterial).opacity = 0.9;
      s.beam.visible = true;
    } else if (t >= C && f > 0.01) {
      const ww = 1.2 + 9 * f * f;
      s.beam.position.set(e.x, e.y, e.z); s.beam.quaternion.copy(this.q); s.beam.scale.set(ww, ww, len);
      (s.beam.material as THREE.MeshBasicMaterial).opacity = 0.7 * f;
      s.beam.visible = true;
    } else s.beam.visible = false;
    // The emitter: a small hot glow that grows; a blaze of light at the blast.
    const r = Math.max(0.2, v.robotBeamGlow * (t < C ? 0.2 + 0.5 * grow : 1 + 3 * f));
    s.glow.position.set(e.x, e.y, e.z); s.glow.scale.setScalar(r * 0.55);
    s.halo.position.copy(s.glow.position); s.halo.scale.setScalar(r * 1.4);
    (s.glow.material as THREE.MeshBasicMaterial).opacity = t < C ? 0.5 + 0.5 * grow : f;
    (s.halo.material as THREE.MeshBasicMaterial).opacity = t < C ? 0.2 + 0.4 * grow : 0.7 * f;
    s.glow.visible = s.halo.visible = true;
    // The reach: a faint soft ring at the blast's edge, fading inward; and the time left (Keith 2026-11-01, round 3): a soft
    // front growing out from under it to the edge as the charge runs, brightest at its leading edge. Gone with the blast.
    s.edge.mesh.visible = s.ring.mesh.visible = s.line.mesh.visible = false;
    const A = v.robotPulseRing * (t < C ? 0.5 + 0.5 * grow : f);
    s.reach.mesh.visible = A > 0.005;
    if (s.reach.mesh.visible) { s.reach.set(e.x, e.z, R - 3, R + 0.4, g, 0.85); s.reach.mat.opacity = A; }
    s.wave.mesh.visible = t < C && v.robotPulseRing > 0;
    if (s.wave.mesh.visible) {
      const rr = Math.max(0.6, R * u);
      s.wave.set(e.x, e.z, rr - Math.min(rr, 2.5 + 2 * u), rr, g, 0.88);
      s.wave.mat.opacity = v.robotPulseRing * (0.8 + 0.8 * u);
    }
  }



  /** The night lights: the emitter holds a real light at high priority while it charges, the line glows, the burn flares. */
  private lights(L: ShortLights) {
    const v = this.swarm.v;
    for (const { i, u, line: b, f: lf } of this.live) {
      if (u < 1) {
        const grow = Math.pow(u, v.robotBeamGrowth);
        L.hold(b.ex, b.ey, b.ez, v.robotBeamLight * (0.12 + 0.88 * grow), 10 + 16 * grow, u > 0.8 ? 0x80c8ff : HOT, v.robotBeamPrio);
        if (v.robotBeamLine > 0 && this.swarm.kind[i] !== BIG) L.telegraphLine(b.sx, b.sz, b.x1, b.z1, u >= v.robotBeamLock ? v.robotBeamWidth : 0.6, u, FAM_ROBOT);
      } else {
        const f = lf ?? Math.max(0, 1 - (u - 1) * v.robotBeamCharge / Math.max(0.01, v.robotBeamBurn));
        L.hold(b.ex, b.ey, b.ez, v.robotBeamFlash * 0.5 * f, 20, 0xd0ecff, v.robotBeamPrio);
        // Keith 2026-11-02: a quarter of the light on the ground it used to cast; most of it from the melt at the strike.
        L.hold(b.x1, b.y1 + 0.8, b.z1, v.robotBeamFlash * 0.18 * f, 10, MELT, v.robotBeamPrio * 0.5);
        L.hold((b.sx + b.x1) / 2, (b.sy + b.y1) / 2 + 1, (b.sz + b.z1) / 2, v.robotBeamFlash * 0.07 * f, 14, 0x4090ff, v.robotBeamPrio * 0.3);
      }
    }
    const T = Math.max(0.05, v.robotBeamScorch);
    const sg = v.robotBeamScorchGlow ?? 0;
    if (sg > 0) for (const sc of this.scorches) if (sc.t < T) L.telegraphLine(sc.sx, sc.sz, sc.x1, sc.z1, sc.w * 1.4, 0.6 * sg * (1 - sc.t / T), FAM_ROBOT);
  }
}

const Z = new THREE.Vector3(0, 0, 1);

/** A flat soft disc on the sand (the melt's glow round the strike). */
const POOL_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let poolTex: THREE.DataTexture | null = null;
function poolMaterial() {
  if (!poolTex) {
    const N = 64, data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = Math.min(1, Math.hypot((i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1));
      const c = Math.round(255 * Math.min(1, Math.exp(-(r * r) / 0.04) * 0.9 + 0.35 * Math.pow(1 - r, 2.5)));
      data.set([c, c, c, 255], (j * N + i) * 4);
    }
    poolTex = new THREE.DataTexture(data, N, N);
    poolTex.magFilter = poolTex.minFilter = THREE.LinearFilter;
    poolTex.needsUpdate = true;
  }
  const m = glowMaterial(MELT, true);
  m.map = poolTex;
  return m;
}
