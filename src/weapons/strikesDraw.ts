// Draws the shoulder strikes (src/weapons/strikes.ts) of one arsenal: the orbital lance (a thin red targeting beam
// from the sky, then a bright column with a white core and a flare where it meets the sand), the singularity (the orb
// flying out, then a black core in a violet halo with a spinning ring), the artillery beacon's flare, and the rings
// that race out over the sand from the quake hammer, the cryo bomb and the big blasts (StrikeFire.rings). Cosmetic.
import * as THREE from "three/webgpu";
import type { Arsenal } from "./arsenal";
import { Ribbon, glowMaterial } from "./ribbon";
import { STRIKE_COL } from "./strikeFire";

interface Ground { height(x: number, z: number): number }

const MAX = 3, MAX_RINGS = 16, RING_PTS = 48, SKY = 160;

interface Lance { aim: THREE.Mesh; glow: THREE.Mesh; core: THREE.Mesh; flare: THREE.Mesh }
interface Well { core: THREE.Mesh; halo: THREE.Mesh; disc: THREE.Mesh; orb: THREE.Mesh }

export class StrikesDraw {
  readonly group = new THREE.Group();
  private lances: Lance[] = [];
  private wells: Well[] = [];
  private flares: THREE.Mesh[] = [];
  private rings: Ribbon[] = [];
  private pts: { x: number; y: number; z: number }[] = Array.from({ length: RING_PTS }, () => ({ x: 0, y: 0, z: 0 }));
  private t = 0;

  constructor(private arsenal: Arsenal, private ground: Ground) {
    const col = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
    const ball = new THREE.SphereGeometry(1, 20, 14);
    const torus = new THREE.TorusGeometry(1, 0.08, 6, 40).rotateX(Math.PI / 2);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, order = 6) => {
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.visible = false; m.renderOrder = order; this.group.add(m); return m;
    };
    for (let i = 0; i < MAX; i++) {
      this.lances.push({ aim: mk(col, glowMaterial(STRIKE_COL.orbitalAim, true)), glow: mk(col, glowMaterial(0xffc890, true)), core: mk(col, glowMaterial(0xffffff, true)), flare: mk(ball, glowMaterial(0xfff0d0, true)) });
      const dark = new THREE.MeshBasicMaterial({ color: 0x050008 });
      this.wells.push({ core: mk(ball, dark, 5), halo: mk(ball, glowMaterial(STRIKE_COL.gravity, true)), disc: mk(torus, glowMaterial(0xd8b0ff, true)), orb: mk(ball, glowMaterial(STRIKE_COL.gravity, true)) });
      this.flares.push(mk(ball, glowMaterial(STRIKE_COL.artillery, true)));
    }
    for (let i = 0; i < MAX_RINGS; i++) { const r = new Ribbon(RING_PTS + 1, 0xffffff, true); this.rings.push(r); this.group.add(r.mesh); r.mesh.visible = false; }
  }

  update(dt: number) {
    this.t += dt;
    const a = this.arsenal, v = a.v, t = this.t, k = v.strikeGlow;
    let nl = 0, nw = 0, nf = 0;
    for (const sh of a.shoulders) {
      const sim = sh.strike;
      if (!sim || !sim.busy) continue;
      const gy = this.ground.height(sim.x, sim.z);
      if (sim.kind === "orbital" && nl < MAX) {
        const L = this.lances[nl++], W = v.orbitalWidth;
        if (sim.phase === "warn") {
          const w = 0.08 + 0.25 * sim.warnShare(v) + 0.05 * Math.sin(t * 60);
          L.aim.visible = true; L.aim.position.set(sim.x, gy, sim.z); L.aim.scale.set(w, SKY, w);
          (L.aim.material as THREE.MeshBasicMaterial).opacity = 0.6 * k;
          L.glow.visible = L.core.visible = L.flare.visible = false;
        } else {
          const live = sim.liveShare(), end = Math.min(1, (1 - live) * 6), pulse = 1 + 0.12 * Math.sin(t * 40) + 0.06 * Math.sin(t * 13);
          L.aim.visible = false;
          L.glow.visible = L.core.visible = L.flare.visible = true;
          L.glow.position.set(sim.x, gy, sim.z); L.glow.scale.set(W * pulse * end, SKY, W * pulse * end);
          L.core.position.set(sim.x, gy, sim.z); L.core.scale.set(W * 0.3 * pulse, SKY, W * 0.3 * pulse);
          L.flare.position.set(sim.x, gy + 0.6, sim.z); L.flare.scale.set(W * 2 * pulse, W * 0.9 * pulse, W * 2 * pulse);
          (L.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
          (L.core.material as THREE.MeshBasicMaterial).opacity = 0.95 * k;
          (L.flare.material as THREE.MeshBasicMaterial).opacity = 0.7 * k;
        }
      } else if (sim.kind === "gravity" && nw < MAX) {
        const G = this.wells[nw++];
        if (sim.phase === "warn") {
          // The orb flies out from the mech in a low arc.
          const u = sim.warnShare(v), x = sim.fx + (sim.x - sim.fx) * u, z = sim.fz + (sim.z - sim.fz) * u;
          const y0 = this.ground.height(sim.fx, sim.fz) + 6, y1 = gy + 2.5, y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 4;
          G.orb.visible = true; G.orb.position.set(x, y, z); G.orb.scale.setScalar(0.6 + 0.1 * Math.sin(t * 30));
          (G.orb.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
          G.core.visible = G.halo.visible = G.disc.visible = false;
        } else {
          const live = sim.liveShare(), grow = Math.min(1, live * 8), end = live > 0.9 ? 1 + (live - 0.9) * 10 * -0.6 : 1;
          const R = sim.stats.radius, s = grow * end;
          G.orb.visible = false;
          G.core.visible = G.halo.visible = G.disc.visible = true;
          G.core.position.set(sim.x, gy + 2.5, sim.z); G.core.scale.setScalar((1.2 + 0.15 * Math.sin(t * 9)) * s);
          G.halo.position.copy(G.core.position); G.halo.scale.setScalar((2.1 + 0.3 * Math.sin(t * 17)) * s);
          (G.halo.material as THREE.MeshBasicMaterial).opacity = 0.35 * k;
          G.disc.position.copy(G.core.position); G.disc.scale.setScalar(Math.max(0.1, R * 0.28) * s); G.disc.rotation.set(0.25 * Math.sin(t), t * 3, 0.2);
          (G.disc.material as THREE.MeshBasicMaterial).opacity = 0.75 * k;
        }
      } else if (sim.kind === "artillery" && nf < MAX) {
        const f = this.flares[nf++];
        f.visible = true; f.position.set(sim.x, gy + 0.6 + (sim.phase === "warn" ? sim.warnShare(v) * 3 : 3), sim.z);
        f.scale.setScalar(0.4 + 0.15 * Math.sin(t * 25));
        (f.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
      }
    }
    for (let i = nl; i < MAX; i++) { const L = this.lances[i]; L.aim.visible = L.glow.visible = L.core.visible = L.flare.visible = false; }
    for (let i = nw; i < MAX; i++) { const G = this.wells[i]; G.core.visible = G.halo.visible = G.disc.visible = G.orb.visible = false; }
    for (let i = nf; i < MAX; i++) this.flares[i].visible = false;

    // Rings racing out over the sand.
    const rs = a.strikeFx.rings;
    let n = 0;
    for (let i = Math.max(0, rs.length - MAX_RINGS); i < rs.length; i++) {
      const r = rs[i], u = r.age / r.life, R = Math.max(0.3, r.r * (1 - (1 - u) * (1 - u)));
      for (let j = 0; j < RING_PTS; j++) {
        const ang = (j / RING_PTS) * Math.PI * 2, p = this.pts[j];
        p.x = r.x + Math.cos(ang) * R; p.z = r.z + Math.sin(ang) * R; p.y = 0;
      }
      const rib = this.rings[n++];
      rib.mat.color.setHex(r.col);
      rib.mat.opacity = Math.max(0, 1 - u) * 0.9 * k;
      rib.set(this.pts, r.width * (1 - 0.5 * u), "ground", this.ground, 0.15, true);
    }
    for (let i = n; i < MAX_RINGS; i++) this.rings[i].mesh.visible = false;
  }
}
