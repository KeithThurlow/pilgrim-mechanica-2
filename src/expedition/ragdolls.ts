// The dead out on the expedition go to the death physics (glue; cosmetic, src/physics/deaths.ts), as in the combat labs
// (Keith 2026-11-01: everything from the labs in the convoy): robots fall apart into their body and leg parts, bandits
// ragdoll in their cloth colour. Chained in front of whatever the swarm already does on a death (loot, kills, quests).
import type { DeathPhysics } from "../physics/deaths";
import type { RobotSwarm } from "../combat/robots";
import { SMALL } from "../combat/robots";
import type { InfantrySwarm } from "../combat/infantry";
import { robotRagdoll, BANDIT_PARTS, BANDIT_JOINTS } from "../physics/bodies";
import { ROBOT_RAG } from "../combat/robotShapes";
import { CLOTH } from "../combat/infantryDraw";
import { ReactorWrecks } from "../game/reactorWrecks";

/**
 * Robots killed become ragdolls (small ones fly, walkers fold where they stand, big ones topple from height). A wreck
 * with a reactor (big ones, weapon quads: RobotSwarm.cores) is pushed to tip over along its fall, and its hull is
 * where the reactor goes up, blowing it apart (Keith 2026-11-06, src/game/reactorWrecks.ts).
 */
export function robotRagdolls(sw: RobotSwarm, deaths: DeathPhysics) {
  const prev = sw.onDeath, wrecks = new ReactorWrecks(deaths);
  sw.hideDead = true;
  sw.reactors = wrecks;
  sw.onDeath = (i, nx, nz, speed) => {
    const kind = sw.kind[i], [body, leg] = ROBOT_RAG[kind];
    const { parts, joints } = robotRagdoll(sw, i, body, leg);
    const reactor = sw.cores.find((c) => c.id === sw.uid[i]) ?? null;
    const fx = reactor ? reactor.fx : nx, fz = reactor ? reactor.fz : nz;
    const d = deaths.ragdoll(parts, joints, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
      { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, fx, fz, kind === SMALL ? Math.max(3, speed) : 1, reactor ? reactor.angV : 0);
    if (reactor) wrecks.add(reactor.id, d);
    prev?.(i, nx, nz, speed);
  };
}

/** Bandits killed become ragdolls in their cloth colour. */
export function banditRagdolls(sw: InfantrySwarm, deaths: DeathPhysics) {
  const prev = sw.onDeath;
  sw.hideDead = true;
  sw.onDeath = (i, nx, nz, speed) => {
    deaths.ragdoll(BANDIT_PARTS(CLOTH[sw.look[i] & 3]), BANDIT_JOINTS, sw.px[i], sw.py[i], sw.pz[i], sw.heading[i],
      { x: sw.vx[i] * 0.3, y: 0, z: sw.vz[i] * 0.3 }, nx, nz, speed);
    prev?.(i, nx, nz, speed);
  };
}
