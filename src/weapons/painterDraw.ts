// Draws a paint (src/weapons/painter.ts) bold enough to read from the 40 m game camera, in the red-orange of the
// shells' telegraph rings: the laser from the launcher (a hot core in a wider glow, a bright dot where it lands), the
// strip (a pulsing fill with bright edges, and a light that runs up it from the near end, the way the rockets will
// walk), the ring (fill, edge) and the dotted arc. Grey while the weapon is still cooling down.
import * as THREE from "three/webgpu";
import type { Paint } from "./painter";
import type { WeaponValues } from "./tuning";
import { Ribbon, GroundPatch, glowMaterial, type P3 } from "./ribbon";

interface Ground { height(x: number, z: number): number }

const READY = 0xff4a1f, CORE = 0xffd2a8, COOL = 0x9a958c;

export class PainterDraw {
  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private glow: THREE.Mesh;
  private dot: THREE.Mesh;
  private fill = new GroundPatch(30, 4, READY);
  private edges = [new Ribbon(40, READY), new Ribbon(40, READY), new Ribbon(4, READY), new Ribbon(4, READY)];
  private runner = new GroundPatch(2, 4, CORE, true);
  private disc = new GroundPatch(40, 3, READY);
  private rim = new Ribbon(42, READY);
  private dots: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private pts: P3[] = [];

  constructor(private ground: Ground, private v: WeaponValues) {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.core = new THREE.Mesh(box, glowMaterial(CORE, true));
    this.glow = new THREE.Mesh(box, glowMaterial(READY, true));
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), glowMaterial(CORE, true));
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), glowMaterial(READY, true), 32);
    for (const o of [this.core, this.glow, this.dot, this.dots]) { o.frustumCulled = false; o.renderOrder = 4; }
    this.group.add(this.core, this.glow, this.dot, this.dots, this.fill.mesh, this.runner.mesh, this.disc.mesh, this.rim.mesh, ...this.edges.map((e) => e.mesh));
    this.hideAll();
  }

  private hideAll() { for (const o of this.group.children) o.visible = false; }

  update(p: Paint) {
    this.hideAll();
    if (!p.on) return;
    const v = this.v, g = this.ground;
    const col = p.tint ?? (p.ready ? READY : COOL);
    const pulse = 0.65 + 0.35 * Math.sin(p.held * v.paintPulse * Math.PI * 2) ** 2;
    // A strip already fired at (charge < 1 on a strip) shows dimmer.
    const op = v.paintOpacity * (p.ready ? pulse : 0.55) * (p.strip ? p.charge : 1);
    const setCol = (mat: THREE.Material, c: number, o: number) => { (mat as THREE.MeshBasicMaterial).color.setHex(c); (mat as THREE.MeshBasicMaterial).opacity = o; };

    // The laser.
    this.a.set(p.beamFrom.x, p.beamFrom.y, p.beamFrom.z);
    this.b.set(p.beamTo.x, p.beamTo.y, p.beamTo.z);
    const len = this.a.distanceTo(this.b);
    if (len > 0.1 && v.beamWidth > 0) {
      this.q.setFromUnitVectors(Z, this.b.clone().sub(this.a).normalize());
      const w = v.beamWidth * p.beamScale;
      for (const [mesh, k, o] of [[this.core, 1, 0.95], [this.glow, 3.2 * v.beamGlow, 0.35 * v.beamGlow]] as const) {
        mesh.position.copy(this.a); mesh.quaternion.copy(this.q); mesh.scale.set(w * k, w * k, len);
        setCol(mesh.material as THREE.Material, mesh === this.core ? (p.tint ? 0xffffff : CORE) : col, Math.min(1, o * (p.ready ? 1 : 0.6)));
        mesh.visible = true;
      }
      this.dot.position.copy(this.b); this.dot.scale.setScalar(0.35 + w * 3 + 0.25 * pulse);
      setCol(this.dot.material as THREE.Material, p.tint ? 0xffffff : CORE, 0.9);
      this.dot.visible = true;
    }

    // The strip.
    const s = p.strip;
    if (s) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L, lx = uz, lz = -ux, hw = s.width / 2;
      this.fill.set((u, w, o) => { o.x = s.ax + dx * u + lx * (w - 0.5) * s.width; o.z = s.az + dz * u + lz * (w - 0.5) * s.width; }, g, 0.07);
      setCol(this.fill.mat, col, op * 0.32);
      // Edges: both sides along, and the two ends.
      const side = (k: number) => { const out: P3[] = []; for (let i = 0; i <= 30; i++) { const u = i / 30; out.push({ x: s.ax + dx * u + lx * hw * k, y: 0, z: s.az + dz * u + lz * hw * k }); } return out; };
      const end = (u: number) => [-1, 1].map((k) => ({ x: s.ax + dx * u + lx * hw * k, y: 0, z: s.az + dz * u + lz * hw * k }));
      this.edges[0].set(side(1), v.paintEdge, "ground", g, 0.1);
      this.edges[1].set(side(-1), v.paintEdge, "ground", g, 0.1);
      this.edges[2].set(end(0), v.paintEdge * 1.6, "ground", g, 0.1);
      this.edges[3].set(end(1), v.paintEdge * 1.6, "ground", g, 0.1);
      for (const e of this.edges) setCol(e.mat, col, Math.min(1, op * 1.15));
      // A bright bar running up the strip from the near end: the order the rockets land in.
      if (p.ready) {
        const t = (p.held * 0.9) % 1, bar = Math.min(0.12, 2.5 / L);
        this.runner.set((u, w, o) => { const uu = Math.min(1, t + u * bar); o.x = s.ax + dx * uu + lx * (w - 0.5) * s.width * 0.92; o.z = s.az + dz * uu + lz * (w - 0.5) * s.width * 0.92; }, g, 0.12);
        setCol(this.runner.mat, CORE, 0.55 * v.paintOpacity);
      }
      void ux;
    }

    // The ring.
    const r = p.ring;
    if (r) {
      this.disc.set((u, w, o) => { const a = u * Math.PI * 2, rr = r.r * w; o.x = r.x + Math.cos(a) * rr; o.z = r.z + Math.sin(a) * rr; }, g, 0.07);
      setCol(this.disc.mat, col, op * 0.3);
      this.pts.length = 0;
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; this.pts.push({ x: r.x + Math.cos(a) * r.r, y: 0, z: r.z + Math.sin(a) * r.r }); }
      this.rim.set(this.pts, v.paintEdge * 1.3, "ground", g, 0.1, true);
      setCol(this.rim.mat, col, Math.min(1, op * 1.15));
    }

    // The dotted arc.
    if (p.arc.length) {
      const n = Math.min(32, p.arc.length);
      for (let i = 0; i < n; i++) {
        const q = p.arc[i];
        this.m.makeTranslation(q.x, q.y, q.z);
        this.dots.setMatrixAt(i, this.m);
      }
      this.dots.count = n;
      this.dots.instanceMatrix.needsUpdate = true;
      setCol(this.dots.material as THREE.Material, col, Math.min(1, op));
      this.dots.visible = true;
    }
  }
}

const Z = new THREE.Vector3(0, 0, 1);
