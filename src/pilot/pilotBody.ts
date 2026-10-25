// The pilot's look: Vanguard (the same Mixamo character the bandits are, baked to an animation texture:
// src/combat/banditVat.ts) as one instance, in his own colours so he never reads as a raider. Clips: the rifle aim
// idle as his stand pose, the walk (walk-and-fire, speed-matched), the sprint when running. No climb clip in the bake:
// getting in and out is the stand pose moved along a path (mount.ts climbPath), turned to face the hatch.
// A thin ring on the ground under him keeps him readable from the game camera.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { BanditVatMesh, type BanditVatData } from "../combat/banditVat";
import { BanditAnim, type AnimClip } from "../combat/banditAnim";
import { VAT_CLIPS, type VatClipName } from "../combat/banditVatFormat";

export const PILOT_LOOK_DEFAULTS = {
  pilotSuitR: 0.16,
  pilotSuitG: 0.5,
  pilotSuitB: 0.86,
  pilotShade: 1.1,
  pilotRing: 0.7,
  pilotRingSize: 0.75,
  pilotFade: 0.18,
};
export type PilotLookValues = typeof PILOT_LOOK_DEFAULTS;
const G = "Pilot: look";
export const PILOT_LOOK_PARAMS: Param[] = [
  { key: "pilotSuitR", label: "Suit red", min: 0, max: 1, step: 0.01, group: G, tip: "His armour plates' colour (the bandits wear rust, khaki, indigo and olive)" },
  { key: "pilotSuitG", label: "Suit green", min: 0, max: 1, step: 0.01, group: G },
  { key: "pilotSuitB", label: "Suit blue", min: 0, max: 1, step: 0.01, group: G },
  { key: "pilotShade", label: "Brightness", min: 0.3, max: 1.9, step: 0.01, group: G },
  { key: "pilotRing", label: "Ground ring strength", min: 0, max: 1, step: 0.05, group: G, tip: "A ring on the sand under him so he reads from the game camera (0 off)" },
  { key: "pilotRingSize", label: "Ground ring radius (m)", min: 0.3, max: 2, step: 0.05, group: G },
  { key: "pilotFade", label: "Clip crossfade (s)", min: 0, max: 1, step: 0.01, group: G },
];

/** Below this he stands; walks up to WALK_TOP, runs above. */
const STAND = 0.25, WALK_TOP = 2.6, RATE_MIN = 0.4, RATE_MAX = 2.2;

export class PilotBody {
  readonly group = new THREE.Group();
  readonly vat: BanditVatMesh | null;
  private anim: BanditAnim | null = null;
  private ids = {} as Record<VatClipName, number>;
  private rows = new Float32Array(8);
  private q = new THREE.Quaternion();
  private Y = new THREE.Vector3(0, 1, 0);
  /** Box stand-in when the bake didn't load. */
  private box: THREE.Mesh | null = null;
  readonly ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private bakedH = 1.8;

  constructor(data: BanditVatData | null, public v: PilotLookValues & { pilotHeight: number }) {
    this.group.name = "pilot";
    if (data) {
      this.vat = new BanditVatMesh(data, 1);
      this.vat.mesh.name = "pilot";
      const clips: AnimClip[] = VAT_CLIPS.map((name, k) => { this.ids[name] = k; return { ...data.header.clips[name], cycle: name !== "aim" && name !== "flinch" }; });
      this.anim = new BanditAnim(clips, 1);
      this.anim.reset(0, this.ids.aim, 0);
      this.bakedH = data.header.height;
      this.group.add(this.vat.mesh);
    } else {
      this.vat = null;
      this.box = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2a7fd8, roughness: 0.8 }));
      this.box.castShadow = true;
      this.group.add(this.box);
    }
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
  }

  /** Hold-V picking. */
  meshes(): THREE.Object3D[] { return [this.vat?.mesh ?? this.box!, this.ring]; }

  /**
   * Draw him at feet (x, y, z) facing heading, moving at speed (over his surface), running or not; hurt flashes him.
   * shown: false hides him (inside the mech). ringOn: the ground ring (only on foot).
   */
  update(dt: number, x: number, y: number, z: number, heading: number, speed: number, running: boolean, shown: boolean, ringOn: boolean, dead = false) {
    const v = this.v;
    this.group.visible = shown;
    if (!shown) return;
    this.q.setFromAxisAngle(this.Y, heading);
    this.ring.visible = ringOn && v.pilotRing > 0.01 && !dead;
    this.ring.position.set(x, y + 0.05, z);
    this.ring.scale.setScalar(v.pilotRingSize);
    this.ringMat.opacity = v.pilotRing;
    if (this.box) {
      this.box.position.set(x, y + 0.88, z);
      this.box.quaternion.copy(this.q);
      if (dead) this.box.rotation.x = Math.PI / 2;
      return;
    }
    const vat = this.vat!, anim = this.anim!, ids = this.ids, s = v.pilotHeight / this.bakedH;
    // Pick the clip: stand, walk (walk-and-fire, speed-matched), run (the sprint).
    const matched = (clip: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, speed / Math.max(0.1, anim.clips[clip].speed * s)));
    if (dead) anim.play(0, ids.flinch, 1);
    else if (speed < STAND) anim.play(0, ids.aim, 1);
    else if (speed < WALK_TOP && !running) anim.play(0, ids.walkFire, matched(ids.walkFire));
    else anim.play(0, speed < 3.4 ? ids.run : ids.sprint, matched(speed < 3.4 ? ids.run : ids.sprint));
    anim.step(0, dt, v.pilotFade);
    anim.rows(0, this.rows, 0);
    // The suit colour into tint 0 (each channel over the baked cloth colour, so the plates come out in it).
    const ref = vat.data.header.clothRef;
    vat.tints[0].setRGB(v.pilotSuitR / ref[0], v.pilotSuitG / ref[1], v.pilotSuitB / ref[2]);
    let qq = this.q;
    if (dead) qq = this.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    vat.place.setXYZW(0, x, y + (dead ? 0.15 : 0), z, s);
    vat.turn.setXYZW(0, qq.x, qq.y, qq.z, qq.w);
    vat.animA.setXYZW(0, this.rows[0], this.rows[1], this.rows[2], this.rows[3]);
    vat.animB.setXYZW(0, this.rows[4], this.rows[5], this.rows[6], 0 * 4 + Math.min(1.99, v.pilotShade));
    vat.count = 1;
  }
}
