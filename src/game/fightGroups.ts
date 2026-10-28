// Adapters that let the fight director (src/game/factions.ts) steer a group of each sim: robots of a camp or pack
// (RobotSwarm slots), a bandit camp (InfantrySwarm slots) and a war band column (Warband). Each hands its members a
// target of their own instead of the player (the sims' setTarget / targetFor), except a share of them who keep going for
// the player when he is in reach too. No state of their own beyond "am I steering".
import * as THREE from "three/webgpu";
import { DEAD as ROBOT_DEAD, type RobotSwarm } from "../combat/robots";
import { DEAD as BANDIT_DEAD, type InfantrySwarm } from "../combat/infantry";
import type { Raider, Warband, WarTarget } from "../combat/warband";
import type { MechUnit } from "./mechUnit";
import { FACTION, TEAM, type Faction, type FightGroup, type FightTarget } from "./factions";

/** Member k stays on its usual enemy when its golden-ratio fraction is under the share (spread evenly through the group). */
const keeps = (k: number, share: number) => (k * 0.618034) % 1 < share;

export class RobotGroup implements FightGroup {
  readonly faction: Faction = FACTION.robots;
  readonly team = TEAM.robots;
  /** Fighting another group now. */
  fighting = false;
  constructor(readonly id: string, private sw: RobotSwarm, private slots: () => readonly number[]) {}

  at(out: { x: number; z: number }): boolean {
    const sw = this.sw;
    let x = 0, z = 0, n = 0;
    for (const i of this.slots()) if (sw.state[i] < ROBOT_DEAD && !sw.frozen[i]) { x += sw.px[i]; z += sw.pz[i]; n++; }
    if (!n) return false;
    out.x = x / n; out.z = z / n;
    return true;
  }

  aim(t: FightTarget | null, share: number) {
    const sw = this.sw, list = this.slots();
    this.fighting = !!t;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (sw.state[i] >= ROBOT_DEAD) continue;
      if (t && !keeps(k, share)) sw.setTarget(i, t.x, t.y, t.z, t.r); else sw.clearTarget(i);
    }
  }
}

export class BanditGroup implements FightGroup {
  readonly faction: Faction = FACTION.raiders;
  readonly team = TEAM.raiders;
  fighting = false;
  /** The camp's home and how far from it they chase: an enemy out beyond is ignored (territorial). */
  constructor(readonly id: string, private sw: InfantrySwarm, private slots: () => readonly number[],
    private home: () => { x: number; z: number }, private leash: () => number) {}

  at(out: { x: number; z: number }): boolean {
    const sw = this.sw;
    let x = 0, z = 0, n = 0;
    for (const i of this.slots()) if (sw.state[i] < BANDIT_DEAD && !sw.frozen[i]) { x += sw.px[i]; z += sw.pz[i]; n++; }
    if (!n) return false;
    out.x = x / n; out.z = z / n;
    return true;
  }

  aim(t: FightTarget | null, share: number) {
    const sw = this.sw, list = this.slots(), h = this.home();
    const ok = !!t && Math.hypot(t.x - h.x, t.z - h.z) <= this.leash();
    this.fighting = ok;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (sw.state[i] >= BANDIT_DEAD) continue;
      if (ok && !keeps(k, share)) sw.setTarget(i, t!.x, t!.y, t!.z, Math.max(t!.r, 1)); else if (sw.calm[i] === 0) sw.clearTarget(i);
    }
  }
}

export class WarGroup implements FightGroup {
  readonly faction: Faction = FACTION.raiders;
  readonly team = TEAM.raiders;
  fighting = false;
  private proxies = new WeakMap<Raider | MechUnit, WarTarget>();
  constructor(readonly id: string, private wb: Warband) {
    wb.targetFor = (u) => this.proxies.get(u) ?? null;
  }

  private members(): (Raider | MechUnit)[] {
    return [...this.wb.raiders.filter((r) => r.alive), ...this.wb.mechs.filter((m) => m.alive)];
  }

  at(out: { x: number; z: number }): boolean {
    let x = 0, z = 0, n = 0;
    for (const r of this.wb.raiders) if (r.alive) { x += r.sim.pos.x; z += r.sim.pos.z; n++; }
    for (const m of this.wb.mechs) if (m.alive) { x += m.sim.pos.x; z += m.sim.pos.z; n++; }
    if (!n) return false;
    out.x = x / n; out.z = z / n;
    return true;
  }

  aim(t: FightTarget | null, share: number) {
    this.fighting = !!t;
    const list = this.members();
    for (let k = 0; k < list.length; k++) {
      const u = list[k];
      if (!t || keeps(k, share)) { this.proxies.delete(u); continue; }
      let p = this.proxies.get(u);
      if (!p) { p = { alive: true, sim: { pelvis: new THREE.Vector3(), pos: new THREE.Vector3(), vel: new THREE.Vector3() } }; this.proxies.set(u, p); }
      p.sim.pelvis.set(t.x, t.y, t.z);
      p.sim.pos.set(t.x, t.y - t.r * 0.5, t.z);
      p.sim.vel.set(t.vx, 0, t.vz);
    }
  }
}
