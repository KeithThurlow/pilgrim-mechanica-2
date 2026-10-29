// The duel lab's glue between the live fight and the rival's AI (src/combat/rivalAi.ts): what a mech's weapons have
// in the air (from its Arsenal and the battlefield's lobbed shells) as plain-data threats, its own weapons' states,
// and the whole view of the fight from one mech's side. Reads only; the AI's answer goes back as commands.
import type { Arsenal } from "../weapons/arsenal";
import type { Shells } from "../game/shells";
import type { MechUnit } from "../game/mechUnit";
import type { WeaponValues } from "../weapons/tuning";
import type { DuelView, Threat, WeaponState } from "./rivalAi";
import type { KitWeapon } from "./rivalKit";

/**
 * Stable ids for pooled objects (rockets, shells and missiles are reused once spent): the same object keeps its id
 * while its signature (where it was fired from and to) stays the same.
 */
export class ThreatIds {
  private map = new WeakMap<object, { id: number; sig: number }>();
  private next = 1;
  of(o: object, sig: number) {
    const e = this.map.get(o);
    if (e && e.sig === sig) return e.id;
    const id = this.next++;
    this.map.set(o, { id, sig });
    return id;
  }
}

/** Everything a mech's weapons have coming down (team: its team; shells of that team only). */
export function threatsFrom(a: Arsenal, team: number, shells: Shells, v: WeaponValues, ids: ThreatIds): Threat[] {
  const out: Threat[] = [];
  // Lobbed shells (the big mortar): a ring where each lands.
  for (const s of shells.list) {
    if (!s.live || s.team !== team) continue;
    out.push({ id: ids.of(s, s.from.x * 7.1 + s.to.z * 3.3 + s.flight), kind: "ring", x: s.to.x, z: s.to.z, r: s.radius, t: Math.max(0, s.flight - s.t) });
  }
  // Rockets (the launcher and the shoulder rocket): a ring at where each is aimed.
  for (const r of a.rockets.list) {
    if (!r.live || r.team !== team) continue;
    out.push({ id: ids.of(r, r.to.x * 5.3 + r.to.z * 2.9 + r.blast), kind: "ring", x: r.to.x, z: r.to.z, r: r.blast, t: r.left / Math.max(1, r.speed) });
  }
  for (const sh of a.shoulders) {
    // The line mortar's strip, while its rockets are up.
    const st = sh.fired.strip;
    if (sh.line.flying && st) {
      let t = Infinity;
      for (const q of sh.line.rockets) if (q.live) t = Math.min(t, q.launched ? Math.max(0, q.landAt - sh.line.clock) : 1);
      const blast = sh.line.rockets.find((q) => q.live)?.blast ?? v.salvoBlast;
      out.push({ id: ids.of(sh.fired, st.ax * 3.7 + st.bz * 1.9), kind: "line", ax: st.ax, az: st.az, x: st.bx, z: st.bz, r: st.width / 2 + blast * 0.5, t });
    }
    // Missiles: each homes on its target (a ring that follows it down).
    for (const m of sh.swarm.missiles) {
      if (!m.live) continue;
      const t = m.launched ? Math.max(0, m.landAt - sh.swarm.clock) : 1.5;
      out.push({ id: ids.of(m, m.p0.x * 3.1 + m.launchAt), kind: "ring", x: m.p3.x, z: m.p3.z, r: m.blast, t, homing: m.key !== null && m.key !== undefined });
    }
  }
  // A rail charging: its line on the sand out to where the slug would stop.
  a.sides.forEach((s, i) => {
    if (s.kind !== "rail" || !s.rail.holding || s.aimLine.length < 2) return;
    const p0 = s.aimLine[0], p1 = s.aimLine[s.aimLine.length - 1];
    out.push({ id: 1_000_000 + team * 10 + i, kind: "line", ax: p0.x, az: p0.z, x: p1.x, z: p1.z, r: v.railSheetHalf, t: Infinity, rail: true, charge: s.rail.charge });
  });
  return out;
}

/** The state of each weapon in a kit (src/combat/rivalKit.ts kitOf order) on a live arsenal. */
export function weaponStates(a: Arsenal, unit: MechUnit, kit: readonly KitWeapon[]): WeaponState[] {
  return kit.map((k, i) => {
    if ("trigger" in k.ctl) {
      const s = a.sides[k.ctl.trigger], g = unit.upper.guns[k.ctl.trigger];
      if (k.kind === "rail") return { i, ready: s.rail.cooldown <= 0, charge: s.rail.charge };
      if (k.kind === "rpg") return { i, ready: s.cool <= 0, charge: 0 };
      return { i, ready: g.ammo > 0, charge: 0 };
    }
    const key = k.ctl.key, sh = a.shoulders.find((x) => x.key === key);
    if (!sh) return { i, ready: false, charge: 0 };
    const ready = sh.weapon === "linemortar" ? sh.line.ready && !sh.line.flying : sh.weapon === "mortar" ? sh.mortar.ready : sh.weapon === "missiles" ? sh.swarm.ready : sh.cool <= 0;
    return { i, ready, charge: 0 };
  });
}

/** The fight from `self`'s side, against `foe` (with what the foe's weapons have in the air). */
export function duelView(t: number, self: MechUnit, kit: readonly KitWeapon[], selfArsenal: Arsenal, foe: MechUnit, threats: Threat[],
  cover: DuelView["cover"], sees: DuelView["sees"], arena: DuelView["arena"]): DuelView {
  const s = self.sim, f = foe.sim;
  return {
    t, threats, cover, sees, arena,
    self: {
      x: s.pos.x, z: s.pos.z, vx: s.vel.x, vz: s.vel.z, heading: s.heading, health: self.health / self.maxHealth,
      dashCharges: self.dash.charges, canDash: s.canDash, dashing: self.dash.active, walkSpeed: self.v.walkSpeed, kit, weapons: weaponStates(selfArsenal, self, kit),
    },
    foe: {
      x: f.pos.x, y: f.pelvis.y, z: f.pos.z, vx: f.vel.x, vz: f.vel.z, health: foe.health / foe.maxHealth, dashCharges: foe.dash.charges, alive: foe.alive,
      gunsOff: foe.gunsOff, airborne: f.airborne, staggered: f.stagger > 0, r: foe.v.hitRadius,
    },
  };
}
