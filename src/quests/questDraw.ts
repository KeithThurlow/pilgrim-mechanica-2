// Drawing for contracts (cosmetic; docs/proposal-quests.md): a light pillar over each active contract's place (gold;
// a lair's red), the downed mech's hulk on the sand or the cable (a box stand-in, kneeling), the cable, and escape pods
// (capsules with a blinking lamp). Built once; repositioned each frame from the sims' plain data.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import { glowMaterial } from "../weapons/ribbon";

interface Ground { height(x: number, z: number): number }
export interface Beacon { x: number; z: number; color: number }

const MAX_BEACONS = 6, MAX_PODS = 12;

export class QuestDraw {
  readonly group = new THREE.Group();
  private beacons: THREE.Mesh[] = [];
  private hulk = new THREE.Group();
  private cable: THREE.Line;
  private cablePos: THREE.BufferAttribute;
  private pods: THREE.Group[] = [];
  private lamps: THREE.Mesh[] = [];
  private time = 0;

  constructor(private ground: Ground, look: ToonLook) {
    const pillar = new THREE.CylinderGeometry(0.7, 1.4, 70, 10, 1, true).translate(0, 35, 0);
    for (let k = 0; k < MAX_BEACONS; k++) {
      const m = new THREE.Mesh(pillar, glowMaterial(0xffc04a, true));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.32;
      m.visible = false; m.frustumCulled = false;
      this.beacons.push(m); this.group.add(m);
    }
    // The hulk: a Rampart-sized box mech down on its knees, hull tipped forward, in faded convoy paint.
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, color = 0x6d6a5e) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
      look.apply(m);
      look.tint(m, color);
      m.position.set(x, y, z); m.rotation.x = rx;
      this.hulk.add(m);
    };
    part(3.2, 1.8, 3.6, 0, 2.3, 0.3, 0.35);          // hull
    part(1.2, 0.8, 1.4, 0, 3.2, 1.6, 0.35, 0x4b4a44); // sensor
    part(0.8, 2.2, 0.8, 1.4, 1.0, -0.6, -0.9);       // thighs, folded
    part(0.8, 2.2, 0.8, -1.4, 1.0, -0.6, -0.9);
    part(0.9, 0.5, 2.0, 1.5, 0.25, 0.6);             // shins flat on the sand
    part(0.9, 0.5, 2.0, -1.5, 0.25, 0.6);
    part(0.5, 0.5, 2.6, 2.0, 2.0, 1.4, 0.2, 0x4b4a44); // arm stubs
    part(0.5, 0.5, 2.6, -2.0, 2.0, 1.4, 0.2, 0x4b4a44);
    this.hulk.visible = false;
    this.group.add(this.hulk);
    const g = new THREE.BufferGeometry();
    this.cablePos = new THREE.BufferAttribute(new Float32Array(12 * 3), 3);
    g.setAttribute("position", this.cablePos);
    this.cable = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1b1a18 }));
    this.cable.frustumCulled = false; this.cable.visible = false;
    this.group.add(this.cable);
    // Pods: a squat capsule with a lamp on top.
    const shell = new THREE.CapsuleGeometry(0.7, 1.4, 4, 10).rotateZ(Math.PI / 2);
    const lampGeo = new THREE.SphereGeometry(0.22, 8, 6);
    for (let k = 0; k < MAX_PODS; k++) {
      const pg = new THREE.Group();
      const m = new THREE.Mesh(shell);
      look.apply(m); look.tint(m, 0xd8d2c0);
      m.position.y = 0.55; m.rotation.y = k * 1.3;
      const lamp = new THREE.Mesh(lampGeo, glowMaterial(0xff5a3a, true));
      lamp.position.y = 1.35;
      pg.add(m, lamp); pg.visible = false;
      this.pods.push(pg); this.lamps.push(lamp); this.group.add(pg);
    }
  }

  update(dt: number, beacons: Beacon[], hulk: { x: number; y: number; z: number; heading: number } | null, hook: { x: number; y: number; z: number } | null,
    pods: { x: number; z: number }[]) {
    this.time += dt;
    const g = this.ground;
    this.beacons.forEach((m, k) => {
      const b = beacons[k];
      m.visible = !!b;
      if (!b) return;
      m.position.set(b.x, g.height(b.x, b.z), b.z);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(b.color);
      mat.opacity = 0.22 + 0.1 * Math.sin(this.time * 2.4 + k);
    });
    this.hulk.visible = !!hulk;
    if (hulk) { this.hulk.position.set(hulk.x, hulk.y - 0.2, hulk.z); this.hulk.rotation.y = hulk.heading; }
    this.cable.visible = !!(hulk && hook);
    if (hulk && hook) {
      // A sagging line from the mech's back to the hulk's nose.
      const ax = hook.x, ay = hook.y, az = hook.z, bx = hulk.x + Math.sin(hulk.heading) * 1.8, by = hulk.y + 2.4, bz = hulk.z + Math.cos(hulk.heading) * 1.8;
      const n = this.cablePos.count, slack = Math.max(0, 1.5 - Math.hypot(ax - bx, az - bz) * 0.1);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1), sag = Math.sin(t * Math.PI) * (0.6 + slack);
        this.cablePos.setXYZ(k, ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t);
      }
      this.cablePos.needsUpdate = true;
    }
    this.pods.forEach((pg, k) => {
      const p = pods[k];
      pg.visible = !!p;
      if (!p) return;
      pg.position.set(p.x, g.height(p.x, p.z), p.z);
      this.lamps[k].visible = Math.sin(this.time * 6 + k) > -0.2;
    });
  }
}
