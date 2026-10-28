// Night lights (Keith 2026-10-28, first pass): at night a few real lights pick things out of the dark. Cosmetic
// (drawing only, every peer makes its own): a pool of point lights shared by the convoy's deck lamps and brief blast
// flashes, plus a headlamp spot from the mech's sensor head lamps. The pool is made the first time night falls and
// then stays (lights at 0 in the day), so the shaders change once, not at every dusk; its size is a slider.
// Muzzle flashes already carry their own lights (src/fx/minigun.ts); loot beams and lit glows are unlit, so they stand
// out on their own as the scene darkens.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

export const NIGHT_LIGHT_DEFAULTS = {
  nightLightCap: 6,
  lampStrength: 22,
  lampRange: 14,
  headlamp: 1,
  headlampStrength: 220,
  headlampRange: 50,
  headlampAngle: 30,
  headlampDip: 24,
  blastLight: 900,
  blastLightTime: 0.45,
  nightLightsFrom: 0.15,
};
export type NightLightValues = typeof NIGHT_LIGHT_DEFAULTS;

const G = "Night lights";
export const NIGHT_LIGHT_PARAMS: Param[] = [
  { key: "nightLightCap", label: "Lights at once", min: 0, max: 16, step: 1, group: G, tip: "Point lights shared by deck lamps and blast flashes (each costs every lit pixel a little)" },
  { key: "lampStrength", label: "Deck lamp strength", min: 0, max: 100, step: 1, group: G },
  { key: "lampRange", label: "Deck lamp reach (m)", min: 2, max: 40, step: 0.5, group: G },
  { key: "headlamp", label: "Mech headlamp on", min: 0, max: 1, step: 1, group: G },
  { key: "headlampStrength", label: "Headlamp strength", min: 0, max: 2000, step: 10, group: G },
  { key: "headlampRange", label: "Headlamp reach (m)", min: 5, max: 120, step: 1, group: G },
  { key: "headlampAngle", label: "Headlamp cone (°)", min: 5, max: 60, step: 1, group: G },
  { key: "headlampDip", label: "Headlamp dip (°)", min: 0, max: 60, step: 1, group: G, tip: "How far below the head's facing the beam points" },
  { key: "blastLight", label: "Blast flash", min: 0, max: 5000, step: 10, group: G, tip: "A blast's light at radius 2.5 m (scales with the blast)" },
  { key: "blastLightTime", label: "Blast flash time (s)", min: 0.05, max: 2, step: 0.05, group: G },
  { key: "nightLightsFrom", label: "On from night amount", min: 0, max: 1, step: 0.01, group: G, tip: "Lights fade in from this much night (0 day .. 1 full night)" },
];

const LAMP_COLOR = 0xfff1c8;
interface Lamp { list: () => Iterable<THREE.Object3D>; color: number; k: number }
interface Flash { x: number; y: number; z: number; r: number; t: number; T: number }

export class NightLights {
  readonly group = new THREE.Group();
  private lamps: Lamp[] = [];
  private flashes: Flash[] = [];
  private pool: THREE.PointLight[] = [];
  private spot: THREE.SpotLight | null = null;
  private tracked: THREE.Object3D | null = null;
  private headLamps: THREE.Object3D[] = [];
  private rescan = 0;
  private made = false;
  private p = new THREE.Vector3();
  private q = new THREE.Vector3();
  private m = new THREE.Matrix4();
  /** How many lights were lit last frame (for the HUD). */
  lit = 0;

  constructor(public v: NightLightValues) { this.group.name = "night lights"; }

  /** Lamps riding these objects (their world positions each frame, the list asked again each frame), e.g. the convoy's deck lamps. */
  addLamps(list: () => Iterable<THREE.Object3D>, color = 0xffd9a0, k = 1) { this.lamps.push({ list, color, k }); }
  /** The mech whose sensor head lamps become a headlamp (re-found each second: the sensor can be swapped). */
  track(root: THREE.Object3D | null) { this.tracked = root; this.rescan = 0; }
  /** A blast at (x, y, z) of this radius lights the ground for a moment. */
  flash(x: number, y: number, z: number, radius: number) {
    if (this.flashes.length > 24) this.flashes.shift();
    this.flashes.push({ x, y, z, r: radius, t: 0, T: this.v.blastLightTime });
  }

  private build() {
    for (const l of this.pool) this.group.remove(l);
    this.pool = [];
    for (let i = 0; i < Math.round(this.v.nightLightCap); i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 10, 2);
      this.pool.push(l); this.group.add(l);
    }
    if (!this.spot) {
      this.spot = new THREE.SpotLight(0xfff1dc, 0, 40, 0.5, 0.6, 2);
      this.group.add(this.spot, this.spot.target);
    }
    this.made = true;
  }

  private findLamps() {
    this.headLamps = [];
    this.tracked?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData.glow || !o.visible) return;
      const c = (mesh.material as THREE.MeshBasicMaterial).color;
      if (c && c.getHex() === new THREE.Color(LAMP_COLOR).getHex()) this.headLamps.push(o);
    });
  }

  /** night: 0 day .. 1 full night (from the look). focus: where the camera looks, for picking the nearest lamps. */
  update(dt: number, night: number, focus: THREE.Vector3) {
    const v = this.v;
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.T);
    const n = Math.max(0, Math.min(1, (night - v.nightLightsFrom) / Math.max(0.01, 1 - v.nightLightsFrom)));
    if (n <= 0 && !this.made) { this.lit = 0; return; }
    if (!this.made || this.pool.length !== Math.round(v.nightLightCap)) this.build();

    // Pool: blast flashes first (brightest first), then the lamps nearest the focus.
    let used = 0;
    const flashes = [...this.flashes].sort((a, b) => b.r * (1 - b.t / b.T) - a.r * (1 - a.t / a.T));
    for (const f of flashes) {
      if (used >= this.pool.length) break;
      const l = this.pool[used++], k = 1 - f.t / f.T;
      l.position.set(f.x, f.y, f.z);
      l.color.setHex(0xffa860);
      l.distance = f.r * 5 + 6;
      l.intensity = v.blastLight * (f.r / 2.5) * k * k * n;
    }
    if (used < this.pool.length && this.lamps.length) {
      const near: { L: Lamp; d: number; x: number; y: number; z: number }[] = [];
      for (const L of this.lamps) for (const o of L.list()) {
        o.getWorldPosition(this.p);
        const d = this.p.distanceToSquared(focus);
        if (d < 120 * 120) near.push({ L, d, x: this.p.x, y: this.p.y, z: this.p.z });
      }
      near.sort((a, b) => a.d - b.d);
      for (const e of near) {
        if (used >= this.pool.length) break;
        const l = this.pool[used++];
        l.position.set(e.x, e.y, e.z);
        l.color.setHex(e.L.color);
        l.distance = v.lampRange;
        l.intensity = v.lampStrength * e.L.k * n;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].intensity = 0;
    this.lit = n > 0 ? used : 0;

    // Headlamp: from the sensor head's lamps, along the head's facing, dipped toward the ground.
    const s = this.spot!;
    this.rescan -= dt;
    if (this.rescan <= 0) { this.findLamps(); this.rescan = 1; }
    if (v.headlamp > 0.5 && this.headLamps.length && n > 0) {
      this.p.set(0, 0, 0);
      for (const o of this.headLamps) { o.getWorldPosition(this.q); this.p.add(this.q); }
      this.p.divideScalar(this.headLamps.length);
      this.m.extractRotation(this.headLamps[0].matrixWorld);
      const fwd = this.q.set(0, 0, 1).applyMatrix4(this.m);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const dip = (v.headlampDip * Math.PI) / 180;
      s.position.copy(this.p).addScaledVector(fwd, 0.3);
      s.target.position.copy(s.position).addScaledVector(fwd, Math.cos(dip) * 10);
      s.target.position.y -= Math.sin(dip) * 10;
      s.angle = (v.headlampAngle * Math.PI) / 180;
      s.distance = v.headlampRange;
      s.intensity = v.headlampStrength * n;
      this.lit++;
    } else s.intensity = 0;
  }
}
