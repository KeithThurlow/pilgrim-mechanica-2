// Register owners for things that are objects rather than swarm slots (src/game/register.ts): a list of objects
// published by a function each (the range's dummies and trucks), and mechs (the player's). The swarms and the war
// band publish themselves (RobotSwarm.publish, InfantrySwarm.publish, Warband.publish).
import { KIND, FLAG, ObjectSerials, type Owner, type Register } from "./register";
import type { MechUnit } from "./mechUnit";

/** An owner over a list of objects: put(reg, thing, index, serial) for each live one (a new serial per life). */
export function listOwner<T extends { alive: boolean }>(name: string, items: () => readonly T[],
  put: (reg: Register, t: T, index: number, serial: number) => void): Owner {
  const serials = new ObjectSerials();
  return {
    name,
    publish(reg) {
      const list = items();
      for (let k = 0; k < list.length; k++) if (list[k].alive) put(reg, list[k], k, serials.serial(list[k], reg));
    },
  };
}

/** A mech at its hull's centre (the pelvis + 0.6 m), its hit radius, hittable and seen. */
export function putMech(reg: Register, m: MechUnit, index: number, serial: number) {
  const p = m.sim.pelvis;
  reg.put(index, serial, KIND.Mech, m.team, FLAG.Hittable | FLAG.Detectable, p.x, p.y + 0.6, p.z, m.v.hitRadius, 0, m.sim.vel.x, m.sim.vel.z);
}

export const mechOwner = (name: string, mechs: () => readonly MechUnit[]) => listOwner(name, mechs, putMech);
