// Enemy health bars (Keith 2026-10-31: kill times of 12-20 s are fine only with health bars, so the player sees
// progress). A thin bar over any enemy that has taken damage, fading a few seconds after its last hurt; always on for
// the big ones (excavators, turret trucks, the party bus, enemy mechs). An armoured one carries a steel chip at the
// bar's left end, wider the more armour it has. Scrappers and bandits die to a hit or two and get none.
// Cheap: every bar is three quads in one instanced mesh (one draw call), facing the camera; each target adapter pushes
// its own bars (Hittable.bars, src/game/battlefield.ts), so every lab with a battlefield gets them. Cosmetic, local.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Hittable } from "../game/battlefield";

/** One bar: where (its centre, m), health now and full, armour, width (m), and whether it always shows. */
export interface BarEntry { key: unknown; x: number; y: number; z: number; hp: number; max: number; armour: number; width: number; always: boolean }

export const BAR_DEFAULTS = {
  barShow: 1,
  barFade: 4,
  barHeight: 0.32,
  barScale: 1,
};
export type BarValues = typeof BAR_DEFAULTS;
export const BAR_PARAMS: Param[] = [
  { key: "barShow", label: "Enemy health bars (0/1)", min: 0, max: 1, step: 1, group: "Health bars" },
  { key: "barFade", label: "Bar shows after a hit for (s)", min: 0.5, max: 20, step: 0.5, group: "Health bars", tip: "Then fades; the big ones (excavators, turret trucks, the party bus, enemy mechs) always show theirs" },
  { key: "barHeight", label: "Bar height (m)", min: 0.05, max: 1.5, step: 0.01, group: "Health bars" },
  { key: "barScale", label: "Bar width ×", min: 0.3, max: 3, step: 0.05, group: "Health bars" },
];

const CAP = 400;
const BACK = new THREE.Color(0x1a1714), FILL = new THREE.Color(0xe8553a), LOW = new THREE.Color(0xffb347), CHIP = new THREE.Color(0xa9bccd);

export class HealthBars {
  readonly mesh: THREE.InstancedMesh;
  private list: BarEntry[] = [];
  private seen = new Map<unknown, { hp: number; at: number; frame: number }>();
  private t = 0;
  private frame = 0;
  private m = new THREE.Matrix4(); private p = new THREE.Vector3(); private s = new THREE.Vector3(); private right = new THREE.Vector3();

  constructor(scene: THREE.Scene, private camera: THREE.Camera, private targets: () => readonly Hittable[], private team: number, public v: BarValues) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false, transparent: true, opacity: 0.92 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, CAP * 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, BACK);
    scene.add(this.mesh);
  }

  /** Each frame, after the sims: gather every enemy's bar, keep the hurt and the always-on ones, draw them. */
  update(dt: number) {
    const v = this.v;
    this.t += dt; this.frame++;
    this.list.length = 0;
    if (v.barShow > 0) for (const t of this.targets()) if (t.team !== this.team && t.bars) t.bars(this.list);
    const q = this.camera.quaternion;
    this.right.set(1, 0, 0).applyQuaternion(q);
    let n = 0;
    for (const b of this.list) {
      // Hurt: its health went down since we last saw it (a new unit in a reused slot starts full: not hurt).
      let st = this.seen.get(b.key);
      if (!st) { st = { hp: b.hp, at: -1e9, frame: 0 }; this.seen.set(b.key, st); }
      if (b.hp < st.hp - 1e-3) st.at = this.t;
      st.hp = b.hp; st.frame = this.frame;
      const age = this.t - st.at;
      if (!b.always && (age > v.barFade || b.hp >= b.max)) continue;
      if (n + 3 > CAP * 3) break;
      // Shrink away over the last half second of its fade.
      const k = b.always ? 1 : Math.min(1, (v.barFade - age) / 0.5);
      const W = b.width * v.barScale, H = v.barHeight * k, f = Math.max(0, Math.min(1, b.hp / Math.max(1, b.max)));
      this.put(n++, b.x, b.y, b.z, 0, W + H * 0.5, H * 1.6, q, BACK);
      this.put(n++, b.x, b.y, b.z, -W / 2 + (W * f) / 2, W * f, H, q, f < 0.3 ? LOW : FILL);
      if (b.armour > 0) {
        const cw = H * (1.2 + Math.min(2, b.armour / 8));
        this.put(n++, b.x, b.y, b.z, -W / 2 - H * 0.25 - cw / 2, cw, H * 2.2, q, CHIP);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // Forget what's gone (dead, despawned) now and then.
    if (this.frame % 120 === 0) for (const [k, s] of this.seen) if (this.frame - s.frame > 120) this.seen.delete(k);
  }

  private put(i: number, x: number, y: number, z: number, along: number, w: number, h: number, q: THREE.Quaternion, c: THREE.Color) {
    this.p.set(x, y, z).addScaledVector(this.right, along);
    this.s.set(Math.max(1e-4, w), Math.max(1e-4, h), 1);
    this.m.compose(this.p, q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, c);
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
