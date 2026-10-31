// Draws the excavators' charging beam (Keith 2026-10-31; sim in robots.ts). Cosmetic. While it charges: a glow at the
// emitter under the chassis that grows bigger and hotter, and a thin warning line on the sand along the beam's path
// that brightens (and widens to the beam's width once the aim locks), so it reads by day. Then the beam: a white-hot
// core in a red sheath from the emitter to where it strikes, and a scorch along the sand that glows and fades.
// At night it lights the ground through the night lights' one request path (src/world/lamps.ts ShortLights): the
// charging emitter holds a real light at high priority, the line and the scorch glow on the sand.
import * as THREE from "three/webgpu";
import { RobotSwarm, BIG, type BeamLine } from "./robots";
import { Ribbon, glowMaterial, type P3 } from "../weapons/ribbon";
import type { BlastWaves } from "../fx/blastWaves";
import { FAM_ROBOT, type ShortLights } from "../world/lamps";

const SLOTS = 8, SCORCHES = 8, PTS = 48;
const HOT = 0xff2a14, CORE = 0xfff0e0, LINE = 0xff3018;

interface Slot { glow: THREE.Mesh; halo: THREE.Mesh; line: Ribbon; edge: Ribbon; beam: THREE.Mesh; core: THREE.Mesh }
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
  /** The charging and burning beams this frame, for the lights: robot, charge share (0..1, >1 burning). */
  private live: { i: number; u: number; line: BeamLine }[] = [];

  constructor(private swarm: RobotSwarm) {
    this.group.name = "robot beams";
    const tube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    for (let k = 0; k < SLOTS; k++) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), glowMaterial(CORE, true));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), glowMaterial(HOT, true));
      const line = new Ribbon(PTS, LINE, false), edge = new Ribbon(PTS, LINE, true);
      const beam = new THREE.Mesh(tube, glowMaterial(HOT, true)), core = new THREE.Mesh(tube, glowMaterial(CORE, true));
      for (const o of [glow, halo, beam, core]) { o.frustumCulled = false; o.renderOrder = 6; }
      line.mesh.renderOrder = edge.mesh.renderOrder = 3;
      this.group.add(halo, glow, line.mesh, edge.mesh, beam, core);
      this.slots.push({ glow, halo, line, edge, beam, core });
    }
    for (let k = 0; k < SCORCHES; k++) {
      const ribbon = new Ribbon(PTS, 0xff6a20, true);
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
    const sw = this.swarm, v = sw.v, g = sw.ground, C = v.robotBeamCharge, B = Math.max(0.01, v.robotBeamBurn);
    this.time += dt;
    this.live.length = 0;
    let k = 0;
    for (let i = 0; i < sw.hi && i < this.seen.length; i++) {
      const t = sw.beamT[i];
      if (sw.kind[i] !== BIG || t < 0) { this.seen[i] = -1; continue; }
      if (k >= SLOTS) continue;
      const s = this.slots[k++], b = sw.beamLine(i, { ...this.line });
      const u = t / C, locked = t >= C * v.robotBeamLock;
      this.live.push({ i, u, line: b });
      // Caught the moment it fired: leave a scorch.
      if (this.seen[i] < C && t >= C) {
        const sc = this.scorches[this.nextScorch++ % SCORCHES];
        sc.t = 0; sc.sx = b.sx; sc.sz = b.sz; sc.x1 = b.x1; sc.z1 = b.z1; sc.w = v.robotBeamWidth;
        sc.ribbon.set(this.path(b), v.robotBeamWidth * 1.3, "ground", g, 0.1);
      }
      this.seen[i] = t;
      if (t < C) {
        // Charging: the emitter glow grows and heats, flickering faster toward the end.
        const grow = Math.pow(Math.min(1, u), v.robotBeamGrowth), flick = 0.9 + 0.1 * Math.sin(this.time * (20 + 40 * u));
        const r = Math.max(0.15, v.robotBeamGlow * (0.15 + 0.85 * grow)) * flick;
        s.glow.position.set(b.ex, b.ey, b.ez); s.glow.scale.setScalar(r * 0.55);
        s.halo.position.copy(s.glow.position); s.halo.scale.setScalar(r * 1.4);
        (s.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * grow;
        (s.halo.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * grow;
        s.glow.visible = s.halo.visible = true;
        // The warning line: thin and faint while it tracks; at the lock it widens to the beam and pulses.
        const pts = this.path(b);
        const pulse = locked ? 0.75 + 0.25 * Math.sin(this.time * 26) : 1;
        s.line.set(pts, locked ? v.robotBeamWidth : 0.25, "ground", g, 0.09);
        s.line.mat.opacity = v.robotBeamLine * (locked ? 0.35 + 0.35 * u : 0.15 + 0.4 * u) * pulse;
        s.edge.set(pts, locked ? 0.3 : 0.12, "ground", g, 0.11);
        s.edge.mat.opacity = v.robotBeamLine * (0.3 + 0.7 * grow) * pulse;
        s.line.mesh.visible = s.edge.mesh.visible = v.robotBeamLine > 0;
        s.beam.visible = s.core.visible = false;
      } else {
        // The burn: bright, fading over the burn time; the emitter flares with it.
        const f = Math.max(0, 1 - (t - C) / B), w = v.robotBeamWidth * (0.55 + 0.45 * f);
        this.d.set(b.x1 - b.ex, b.y1 - b.ey, b.z1 - b.ez);
        const len = this.d.length();
        this.q.setFromUnitVectors(Z, this.d.divideScalar(len || 1));
        for (const [m, kw, o] of [[s.beam, 0.5, 0.75], [s.core, 0.18, 1]] as const) {
          m.position.set(b.ex, b.ey, b.ez); m.quaternion.copy(this.q); m.scale.set(w * kw, w * kw, len);
          (m.material as THREE.MeshBasicMaterial).opacity = o * f;
          m.visible = true;
        }
        s.glow.position.set(b.ex, b.ey, b.ez); s.glow.scale.setScalar(v.robotBeamGlow * (0.6 + 0.6 * f));
        s.halo.position.copy(s.glow.position); s.halo.scale.setScalar(v.robotBeamGlow * (1.2 + 1.2 * f));
        (s.glow.material as THREE.MeshBasicMaterial).opacity = f; (s.halo.material as THREE.MeshBasicMaterial).opacity = 0.6 * f;
        s.glow.visible = s.halo.visible = true;
        s.line.mesh.visible = s.edge.mesh.visible = false;
      }
    }
    for (; k < SLOTS; k++) {
      const s = this.slots[k];
      s.glow.visible = s.halo.visible = s.line.mesh.visible = s.edge.mesh.visible = s.beam.visible = s.core.visible = false;
    }
    // Scorches: hot at first, cooling to a dull ember glow, then gone.
    const T = Math.max(0.05, v.robotBeamScorch);
    for (const sc of this.scorches) {
      sc.t += dt;
      const f = 1 - sc.t / T;
      sc.ribbon.mesh.visible = f > 0;
      if (f <= 0) continue;
      sc.ribbon.mat.opacity = 0.9 * f * f;
      this.c.setHex(0xff6a20).lerp(this.c2.setHex(0x801008), 1 - f);
      sc.ribbon.mat.color.copy(this.c);
    }
  }
  private c2 = new THREE.Color();

  /** The night lights: the emitter holds a real light at high priority while it charges, the line glows, the burn flares. */
  private lights(L: ShortLights) {
    const v = this.swarm.v;
    for (const { u, line: b } of this.live) {
      if (u < 1) {
        const grow = Math.pow(u, v.robotBeamGrowth);
        L.hold(b.ex, b.ey, b.ez, v.robotBeamLight * (0.12 + 0.88 * grow), 10 + 16 * grow, u > 0.8 ? 0xff6a50 : HOT, v.robotBeamPrio);
        if (v.robotBeamLine > 0) L.telegraphLine(b.sx, b.sz, b.x1, b.z1, u >= v.robotBeamLock ? v.robotBeamWidth : 0.6, u, FAM_ROBOT);
      } else {
        const f = Math.max(0, 1 - (u - 1) * v.robotBeamCharge / Math.max(0.01, v.robotBeamBurn));
        L.hold(b.ex, b.ey, b.ez, v.robotBeamFlash * 0.5 * f, 20, 0xffd0c0, v.robotBeamPrio);
        // Along the beam: a few lights where it is low, merged by the clustering where they're close.
        const n = 3;
        for (let k = 1; k <= n; k++) {
          const t = k / n, x = b.sx + (b.x1 - b.sx) * t, y = b.sy + (b.y1 - b.sy) * t, z = b.sz + (b.z1 - b.sz) * t;
          L.hold(x, y + 1, z, v.robotBeamFlash * f / n, 14, 0xff5030, v.robotBeamPrio * 0.5);
        }
      }
    }
    const T = Math.max(0.05, v.robotBeamScorch);
    for (const sc of this.scorches) if (sc.t < T) L.telegraphLine(sc.sx, sc.sz, sc.x1, sc.z1, sc.w * 1.4, 0.6 * (1 - sc.t / T), FAM_ROBOT);
  }
}

const Z = new THREE.Vector3(0, 0, 1);
