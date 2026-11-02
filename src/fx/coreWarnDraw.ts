// A dying walker's core going unstable before it blows (Keith 2026-11-02: "they kind of become unstable and indicate
// that they're going to explode ... slightly different to the normal explosion one ... so melee players can kill
// these things and then still get out"). Cosmetic, drawn from the host's list of cores counting down (big walkers'
// in RobotSwarm.cores, striders' in StriderField.cores):
// - a hazard ring on the sand at the blast's edge in amber (the pulse's rings are blue and soft, shells' red), blinking
//   like a countdown, slow at first and faster to the bang, each blink a beep and a spit of sparks (onBeep);
// - a second band sweeping outward from the wreck to the edge as the time runs out (the pulse's closes in);
// - a flickering, swelling orange glow on the wreck, jittering harder toward the end.
// The sound and sparks go through the hooks (src/game/robotBeam.ts coreWarnFx) so this file draws only.
import * as THREE from "three/webgpu";
import { SoftRing, glowMaterial } from "../weapons/ribbon";

interface Ground { height(x: number, z: number): number }

/** A core counting down: where (the ground under it), the blast's radius, seconds left of its delay. */
export interface CoreView { id: number; x: number; y: number; z: number; t: number; delay: number; radius: number }

const SEG = 64, AMBER = 0xffa020, HOT = 0xff7a18;

interface Slot { ring: SoftRing; fill: SoftRing; glow: THREE.Mesh; halo: THREE.Mesh; phase: number; seen: boolean }

export class CoreWarnDraw {
  readonly group = new THREE.Group();
  /** A core began its countdown (whine). */
  onStart: ((x: number, y: number, z: number, delay: number) => void) | null = null;
  /** A blink: beep and sparks at the wreck; k 0..1 how far through the countdown. */
  onBeep: ((x: number, y: number, z: number, k: number) => void) | null = null;
  private slots = new Map<number, Slot>();
  private ball = new THREE.SphereGeometry(1, 16, 12);

  constructor(private ground: Ground) {}

  update(dt: number, cores: readonly CoreView[]) {
    for (const s of this.slots.values()) s.seen = false;
    for (const c of cores) {
      let s = this.slots.get(c.id);
      if (!s) {
        s = this.make();
        this.slots.set(c.id, s);
        this.onStart?.(c.x, c.y, c.z, c.delay);
      }
      s.seen = true;
      const u = Math.min(1, Math.max(0, 1 - c.t / Math.max(0.01, c.delay)));
      // Blinks: 1.5 a second at first, 10 at the end; each new cycle beeps.
      const was = s.phase;
      s.phase += dt * (1.5 + 8.5 * u * u);
      if (Math.floor(s.phase) !== Math.floor(was)) this.onBeep?.(c.x, c.y + 1.5, c.z, u);
      const on = s.phase % 1 < 0.45;
      const R = c.radius;
      s.ring.set(c.x, c.z, R - 1.6, R + 0.3, this.ground, 0.8, 0.09);
      s.ring.mat.opacity = on ? 0.55 + 0.45 * u : 0.08;
      s.ring.mesh.visible = true;
      // The sweep: a band from the wreck out to the edge as the countdown runs.
      const rr = Math.max(0.5, R * u);
      s.fill.set(c.x, c.z, Math.max(0, rr - 2.2), rr, this.ground, 0.9, 0.08);
      s.fill.mat.opacity = 0.18 + 0.3 * u;
      s.fill.mesh.visible = true;
      // The core: an orange glow on the wreck, swelling and flickering, jittering harder toward the end.
      const j = 0.15 + 0.6 * u * u, fl = 0.6 + 0.4 * Math.random();
      s.glow.position.set(c.x + (Math.random() - 0.5) * j, c.y + 1.4 + (Math.random() - 0.5) * j, c.z + (Math.random() - 0.5) * j);
      s.glow.scale.setScalar((0.5 + 1.4 * u) * (on ? 1.15 : 0.9));
      (s.glow.material as THREE.MeshBasicMaterial).opacity = (0.55 + 0.45 * u) * fl;
      s.halo.position.copy(s.glow.position);
      s.halo.scale.setScalar((1.6 + 3.5 * u) * (on ? 1.1 : 0.85));
      (s.halo.material as THREE.MeshBasicMaterial).opacity = (0.12 + 0.25 * u) * fl;
      s.glow.visible = s.halo.visible = true;
    }
    for (const [id, s] of this.slots) {
      if (s.seen) continue;
      this.group.remove(s.ring.mesh, s.fill.mesh, s.glow, s.halo);
      s.ring.mesh.geometry.dispose(); s.fill.mesh.geometry.dispose();
      s.ring.mat.dispose(); s.fill.mat.dispose();
      (s.glow.material as THREE.Material).dispose(); (s.halo.material as THREE.Material).dispose();
      this.slots.delete(id);
    }
  }

  private make(): Slot {
    const ring = new SoftRing(SEG, AMBER), fill = new SoftRing(SEG, HOT);
    const glow = new THREE.Mesh(this.ball, glowMaterial(0xffc060, true)), halo = new THREE.Mesh(this.ball, glowMaterial(HOT, true));
    glow.renderOrder = halo.renderOrder = 4;
    this.group.add(ring.mesh, fill.mesh, glow, halo);
    return { ring, fill, glow, halo, phase: 0, seen: true };
  }
}
