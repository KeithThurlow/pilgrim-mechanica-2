// Wrecks with a reactor in them (Keith 2026-11-06): the death physics' ragdoll of a dead machine whose reactor is
// counting down (src/combat/reactorFall.ts), so the reactor goes up where its hull has fallen to, and the blast throws
// the wreck apart. Glue between a sim's reactors (by id) and the death physics; cosmetic (the blast's damage is the
// host's, at the hull's position, which only moves with the ragdoll's fall).
import type { Dead, DeathPhysics } from "../physics/deaths";

type V3 = { x: number; y: number; z: number };

export class ReactorWrecks {
  private map = new Map<number, Dead>();
  /** part: the ragdoll part holding the reactor (the hull or chest, part 0 by default). */
  constructor(private deaths: DeathPhysics, private part = 0) {}

  add(id: number, d: Dead) { this.map.set(id, d); }

  /** Where the hull of id's wreck is now; false when there is no wreck for it. */
  at(id: number, out: V3): boolean {
    const d = this.map.get(id), p = d && !d.done ? d.pos[this.part] : null;
    if (!p) return false;
    out.x = p.x; out.y = p.y; out.z = p.z;
    return true;
  }

  /** id's reactor went up at (x, y, z): its wreck is thrown apart and forgotten. */
  blow(id: number, x: number, y: number, z: number, radius: number) {
    const d = this.map.get(id);
    this.map.delete(id);
    if (d && !d.done) this.deaths.burst(d, x, y, z, radius, this.deaths.v.reactorFling ?? 14);
  }
}
