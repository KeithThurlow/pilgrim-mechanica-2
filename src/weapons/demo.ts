// A canned firing cycle for viewing a weapon model (the armoury lab): every moving part runs through its motion so
// it can be checked. Not a sim: the weapons' own sims pose the models in play.
// One cycle (period seconds): raise and open, fire (spin, kicks, slides, missiles out one by one, tubes in a ripple,
// lid flaps, heat climbs), then cool, close and lower.
import * as THREE from "three/webgpu";
import type { WeaponModel } from "./weaponModel";

const ss = THREE.MathUtils.smoothstep;
const pulse = (u: number, at: number, len: number) => (u >= at && u < at + len ? Math.sin(((u - at) / len) * Math.PI) : 0);

export class WeaponDemo {
  private lastU = 0;
  constructor(public w: WeaponModel) {}

  /** t: seconds into the cycle clock; period: seconds per cycle; heatRise: heat added per shot. */
  update(t: number, dt: number, period = 5, heatRise = 0.3) {
    const w = this.w, u = ((t / period) % 1 + 1) % 1, prev = this.lastU;
    this.lastU = u;
    const firing = u > 0.18 && u < 0.6;
    const crossed = (at: number) => (prev < at && u >= at) || (prev > u && at <= u);
    // Raise (mortars, racks, launchers) and open the doors before the shots.
    w.setElevation(ss(u, 0.02, 0.16) * (1 - ss(u, 0.82, 0.97)));
    w.setDoors(ss(u, 0.05, 0.16) * (1 - ss(u, 0.8, 0.92)));
    // Spinning guns spin up, fire, spin down.
    if (w.movingParts("spin").length) {
      const s = ss(u, 0.1, 0.2) * (1 - ss(u, 0.6, 0.75));
      w.spin(w.spinRate * s * dt);
      if (firing) w.setHeat(w.heat + dt * heatRise * 1.6);
    }
    // Shots: four through the window (kick, slide, lid flap, heat).
    const shots = [0.2, 0.3, 0.4, 0.5];
    let lid = 0, slide = 0;
    for (const at of shots) {
      if (crossed(at)) { w.kick(0.18); if (!w.movingParts("spin").length) w.setHeat(w.heat + heatRise); }
      lid = Math.max(lid, pulse(u, at, 0.07));
      slide = Math.max(slide, pulse(u, at, 0.035));
    }
    w.setLid(lid);
    w.setSlide(slide);
    // Missiles slide out of their tubes one after another and are gone; back in at the end.
    const n = w.tubes;
    for (let i = 0; i < n; i++) {
      const at = 0.18 + (0.4 * i) / Math.max(1, n), k = ss(u, at, at + 0.05);
      w.setMissile(i, k, k < 0.98 || u > 0.97);
      if (crossed(at + 0.05)) w.kick(0.08);
    }
    if (u > 0.97 || u < 0.02) for (let i = 0; i < n; i++) w.setMissile(i, 0, true);
    // Rack tubes recoil in a ripple.
    for (let i = 0; w.has(`Tube_${i}`); i++) w.setTube(i, pulse(u, 0.2 + i * 0.05, 0.06));
    // Lamps: steady, a flash per shot.
    w.setLamp(1 + 1.5 * Math.max(...shots.map((at) => pulse(u, at, 0.04))));
  }
}
