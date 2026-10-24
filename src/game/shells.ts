// Slow, telegraphed shots (Keith 2026-10-24: give the player a way to use skill, dodging incoming damage, so some
// enemies need slower, telegraphed weapons). A shell is lobbed at a point on the ground, flies a visible arc and
// bursts there; its landing spot is marked from the moment it's fired, so a dash gets you out. Pure: the drawing is
// in `src/fx/shellsDraw.ts`, the burst's effects and damage in the battlefield.
import * as THREE from "three/webgpu";

export interface Shell {
  team: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds in flight so far, and the whole flight. */
  t: number;
  flight: number;
  /** Peak of the arc above the straight line (m). */
  arc: number;
  radius: number;
  damage: number;
  /** Where it is now. */
  pos: THREE.Vector3;
  live: boolean;
}

export class Shells {
  readonly list: Shell[] = [];

  /** Fire a shell from `from` to land on `to` after `flight` seconds. */
  lob(team: number, from: THREE.Vector3, to: THREE.Vector3, flight: number, arc: number, radius: number, damage: number) {
    let s = this.list.find((x) => !x.live);
    if (!s) {
      s = { team, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, flight: 1, arc: 0, radius: 1, damage: 0, pos: new THREE.Vector3(), live: false };
      this.list.push(s);
    }
    s.team = team; s.from.copy(from); s.to.copy(to); s.t = 0; s.flight = Math.max(0.1, flight); s.arc = arc;
    s.radius = radius; s.damage = damage; s.pos.copy(from); s.live = true;
    return s;
  }

  /** Move every shell; calls onLand for each that arrived this step. */
  update(dt: number, onLand: (s: Shell) => void) {
    for (const s of this.list) {
      if (!s.live) continue;
      s.t += dt;
      const u = Math.min(1, s.t / s.flight);
      s.pos.lerpVectors(s.from, s.to, u);
      s.pos.y += 4 * s.arc * u * (1 - u);
      if (u >= 1) { s.live = false; onLand(s); }
    }
  }

  get liveCount() { let n = 0; for (const s of this.list) if (s.live) n++; return n; }
}
