// Drawing for the extraction pads (cosmetic; the rules are pads.ts): a slab with a painted H, landing lights, a
// beacon mast, and the stand-in quadcopter (boxes) that flies in, hovers, lowers a cradle onto the mech, lifts and
// flies off. Lights are dim by day and come up with the night (DesertLook.night). Pads are built when one comes
// within drawRange of the mech and dropped when it leaves.
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import { Kit, kitMesh } from "../convoy/kit";
import type { Pad, PadCaller, PadValues } from "./pads";

const CONCRETE = 0x8d887c, PAINT = 0xd8d2c0, DARK = 0x3d3a35, HAZARD = 0xd8a019, STEEL = 0x8f8a7f, BODY = 0xd0642a;
const DRAW_RANGE = 700;
const LIGHT_BASE = new THREE.Color(0xffd27a), BEACON_BASE = new THREE.Color(0xff4a30);

interface PadMesh { group: THREE.Group; y: number; mast: THREE.Mesh; ring: THREE.Mesh }

export class PadDraw {
  readonly group = new THREE.Group();
  private pads = new Map<string, PadMesh>();
  private lightMat = new THREE.MeshBasicMaterial({ color: LIGHT_BASE.clone() });
  private beaconMat = new THREE.MeshBasicMaterial({ color: BEACON_BASE.clone() });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0, depthWrite: false });
  private copter = new THREE.Group();
  private rotors: THREE.Object3D[] = [];
  private cradle = new THREE.Group();
  private ropes: THREE.Mesh[] = [];
  private time = 0;
  /** Where the quadcopter is (for the checks and the lab line), when it is drawn. */
  readonly copterAt = new THREE.Vector3();
  private from = new THREE.Vector2(1, 0);
  private ropeLen = 5;

  constructor(private field: DuneField, scene: THREE.Scene) {
    this.group.name = "extraction pads";
    scene.add(this.group);
    this.buildCopter();
    this.copter.visible = false;
    this.group.add(this.copter);
  }

  private buildCopter() {
    const k = new Kit();
    k.box([2.4, 1.8, 6], [0, 0, 0], BODY);
    k.box([1.8, 0.9, 1.6], [0, 0.3, 2.6], 0x1a1612);
    k.box([0.5, 0.5, 5], [0, 0.4, -5], STEEL);
    k.box([1.8, 0.2, 0.9], [0, 0.9, -7], BODY);
    k.box([9, 0.4, 0.5], [0, 1, 0], DARK);
    k.box([0.5, 0.4, 9], [0, 1, 0], DARK);
    k.box([0.4, 0.8, 4], [1.2, -1.1, 0], STEEL);
    k.box([0.4, 0.8, 4], [-1.2, -1.1, 0], STEEL);
    kitMesh(k.build(), this.copter);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.6, transparent: true, opacity: 0.55 });
    for (const [x, z] of [[4.5, 0], [-4.5, 0], [0, 4.5], [0, -4.5]]) {
      const r = new THREE.Group();
      r.position.set(x, 1.5, z);
      const blade = new THREE.BoxGeometry(5.6, 0.06, 0.34);
      r.add(new THREE.Mesh(blade, bladeMat), new THREE.Mesh(blade, bladeMat).rotateY(Math.PI / 2));
      this.copter.add(r);
      this.rotors.push(r);
    }
    // The cradle: a frame on four ropes, like the convoy crane's.
    const c = new Kit();
    c.box([5, 0.35, 0.35], [0, 0, 2.2], HAZARD);
    c.box([5, 0.35, 0.35], [0, 0, -2.2], HAZARD);
    c.box([0.35, 0.35, 4.4], [2.4, 0, 0], HAZARD);
    c.box([0.35, 0.35, 4.4], [-2.4, 0, 0], HAZARD);
    kitMesh(c.build(), this.cradle);
    const rope = new THREE.CylinderGeometry(0.05, 0.05, 1, 5).translate(0, -0.5, 0);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.7 });
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(rope, ropeMat); this.ropes.push(m); this.group.add(m); }
    this.group.add(this.cradle);
    this.cradle.visible = false;
  }

  private build(p: Pad, v: PadValues): PadMesh {
    const f = this.field, R = v.padRadius;
    let top = -Infinity, low = Infinity;
    for (let a = 0; a < 8; a++) for (const rr of [0, R]) {
      const h = f.height(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr);
      top = Math.max(top, h); low = Math.min(low, h);
    }
    const y = top + 0.15;
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    const k = new Kit();
    // The slab reaches down to the lowest sand under it; the H and the ring are painted on top.
    const depth = y - low + 1;
    k.cyl(R, depth, [0, -depth / 2, 0], CONCRETE, [0, 0, 0], 24);
    k.cyl(R * 0.94, 0.06, [0, 0.03, 0], PAINT, [0, 0, 0], 24);
    k.cyl(R * 0.86, 0.09, [0, 0.045, 0], CONCRETE, [0, 0, 0], 24);
    k.box([0.9, 0.1, R * 1.0], [R * 0.3, 0.1, 0], PAINT);
    k.box([0.9, 0.1, R * 1.0], [-R * 0.3, 0.1, 0], PAINT);
    k.box([R * 0.6, 0.1, 0.9], [0, 0.1, 0], PAINT);
    // The mast.
    k.cyl(0.25, 14, [R - 1.2, 7, 0], DARK, [0, 0, 0], 8);
    k.box([1.4, 0.3, 0.3], [R - 1.2, 11, 0], STEEL);
    kitMesh(k.build(), g);
    // Landing lights round the edge.
    const bulb = new THREE.SphereGeometry(0.28, 8, 6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Mesh(bulb, this.lightMat);
      m.position.set(Math.cos(a) * (R - 0.3), 0.3, Math.sin(a) * (R - 0.3));
      g.add(m);
    }
    const mast = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), this.beaconMat);
    mast.position.set(R - 1.2, 14.4, 0);
    g.add(mast);
    // A glow ring on the slab while a call is on.
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.97, R * 1.25, 40).rotateX(-Math.PI / 2), this.ringMat);
    ring.position.y = 0.2;
    ring.visible = false;
    g.add(ring);
    this.group.add(g);
    return { group: g, y, mast, ring };
  }

  /** Meshes for the hold-V selector. */
  objects(): THREE.Object3D[] { return [...this.pads.values()].map((p) => p.group); }

  /**
   * One frame. `near`: pads in range of the mech; `night` 0..1; `call`: the caller (state, approach, lift time);
   * `mech`: the mech's top (where the cradle clamps); `from`: a direction on the ground pointing toward the convoy,
   * where the quadcopter comes from and goes back to.
   */
  update(dt: number, v: PadValues, near: Pad[], night: number, call: PadCaller, mech: THREE.Vector3, from: { x: number; z: number }) {
    this.time += dt;
    const want = new Set<string>();
    for (const p of near) {
      if (Math.hypot(p.x - mech.x, p.z - mech.z) > DRAW_RANGE) continue;
      want.add(p.id);
      if (!this.pads.has(p.id)) this.pads.set(p.id, this.build(p, v));
    }
    for (const [id, m] of this.pads) if (!want.has(id)) { this.group.remove(m.group); m.group.traverse((o) => { const me = o as THREE.Mesh; if (me.geometry) me.geometry.dispose(); }); this.pads.delete(id); }
    // Lights: dim by day, bright at night; the beacon blinks, and strobes while a call is on that pad.
    const k = 0.1 + 0.9 * night;
    this.lightMat.color.copy(LIGHT_BASE).multiplyScalar(k);
    const calling = call.state !== "idle";
    const strobe = calling ? (Math.sin(this.time * 14) > 0 ? 1 : 0.15) : (Math.sin(this.time * 2.2) > 0.85 ? 1 : 0.25);
    this.beaconMat.color.copy(BEACON_BASE).multiplyScalar(Math.max(0.2, k) * strobe + 0.15);
    this.ringMat.opacity = 0.25 + 0.25 * Math.sin(this.time * 5);
    for (const [id, m] of this.pads) m.ring.visible = calling && call.pad?.id === id;

    const pad = call.pad ?? (call.state === "idle" ? null : call.lastPad);
    const show = !!pad && call.inSight;
    this.copter.visible = show;
    this.cradle.visible = show;
    for (const r of this.ropes) r.visible = show;
    if (!show || !pad) return;
    const pm = this.pads.get(pad.id);
    const gy = pm ? pm.y : this.field.height(pad.x, pad.z);
    // Bearing toward the convoy from the pad.
    this.from.set(from.x - pad.x, from.z - pad.z).normalize();
    const hover = 24, land = 12.5, top = mech.y + 0.3;
    let alt: number, dist: number, rope: number;
    if (call.state === "waiting") {
      // In from 450 m out and 70 m up, easing to the hover.
      const u = call.approach, e = 1 - (1 - u) * (1 - u);
      dist = 450 * (1 - e); alt = hover + 46 * (1 - e); rope = 4;
    } else {
      const lt = call.lt / Math.max(0.5, v.padLift);
      dist = 0; rope = 4;
      if (lt < 0.3) { const s = lt / 0.3, e = s * s * (3 - 2 * s); alt = hover + (land - hover) * e; rope = 4 + (land - 4 - (top - gy)) * e; }
      else if (lt < 0.45) { alt = land; rope = land - (top - gy); }
      else if (lt < 1) { const s = (lt - 0.45) / 0.55, e = s * s * (3 - 2 * s); alt = land + 14 * e; rope = (land - (top - gy)) * (1 - e) + 4 * e; }
      else {
        // Off toward the convoy, climbing.
        const s = Math.min(1, (call.lt - v.padLift) / 5);
        alt = land + 14 + 30 * s; dist = -900 * s * s; rope = 4;
      }
    }
    const px = pad.x + this.from.x * dist, pz = pad.z + this.from.y * dist;
    this.copter.position.set(px, gy + alt, pz);
    this.copterAt.copy(this.copter.position);
    // Face along the flight (toward the pad on the way in, toward the convoy on the way out), nose down a touch.
    const dir = call.state === "waiting" ? -1 : call.lt > v.padLift ? 1 : 0;
    const yaw = dir === 0 ? this.copter.rotation.y : Math.atan2(this.from.x * dir, this.from.y * dir);
    this.copter.rotation.set(dir === 0 ? 0 : 0.12, yaw, 0, "YXZ");
    for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y = this.time * 40 * (i % 2 ? -1 : 1);
    // The cradle hangs `rope` under the copter, over the mech (or the pad's middle on the way in).
    const hang = alt - rope;
    this.cradle.position.set(px, gy + hang, pz);
    const cy = this.copter.position.y - 1;
    const corners: [number, number][] = [[2.4, 2.2], [-2.4, 2.2], [2.4, -2.2], [-2.4, -2.2]];
    const cs = Math.cos(this.cradle.rotation.y), sn = Math.sin(this.cradle.rotation.y);
    this.ropeLen = cy - (gy + hang);
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = corners[i], r = this.ropes[i];
      r.position.set(px + cx * cs + cz * sn, cy, pz - cx * sn + cz * cs);
      r.scale.set(1, Math.max(0.1, this.ropeLen), 1);
    }
  }
}
