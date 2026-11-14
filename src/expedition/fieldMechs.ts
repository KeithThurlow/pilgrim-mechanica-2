// Bandit mechs on the field (glue; Keith 2026-11-14: more mech enemies, and bandits get mechs too). Two sources:
// - lances (lances.ts) that close with the mech: their Ramparts are put down round where the lance was and fight
//   inside a circle that follows the mech (lanceArena); left far behind or with the mech aboard, the survivors go
//   back to the lance as a point;
// - camp guards: a bandit camp on the field with guard mechs (campMechs) stands them at its centre; they fight when
//   the camp is alert and the mech within campMechWake, inside campMechArena of the camp, and shooting one alerts it.
// Every one is a field rival (src/game/fieldRival.ts): the duel's brain on a rolled loadout, its items relative to
// the player's level and its brain's level from `mechGrade` (danger). At most fieldMechMax at once, nearest first.
// Host owned (rule 12): their health, deaths, loadouts and brains; drawing is cosmetic.
import type * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import { FieldRival, type FieldRivalValues, type RivalSetup } from "../game/fieldRival";
import { FORT_MECH_PAINT } from "./fortMechPosts";
import { campMechs, mechGrade, type Lance, type LanceField, type LanceValues } from "./lances";
import type { BanditCamps } from "./humans";
import type { BanditCamp } from "./banditCamps";

export type FieldMechEvent = { type: "banditMechDown"; id: string; from: "lance" | "camp"; x: number; y: number; z: number };

interface Slot {
  rival: FieldRival;
  /** Stable: `${lance.id}:${k}` or `${camp.id}:m${k}`; null when free. */
  key: string | null;
  pending: boolean;
  lance: Lance | null;
  camp: BanditCamp | null;
  hp: number;
}

export class FieldMechs {
  setup: RivalSetup | null = null;
  onEvent: ((e: FieldMechEvent) => void) | null = null;
  /** Danger at a place with the run's threat in (the loop sets it); left out, a camp's own. Camp guards count and grade by it. */
  dangerAt: ((x: number, z: number) => number) | null = null;
  private slots: Slot[] = [];
  /** Camp guards killed this trip (they don't come back). */
  private dead = new Set<string>();
  private camps: { camp: BanditCamp; state: "asleep" | "idle" | "alert" }[] = [];

  constructor(private v: LanceValues & FieldRivalValues, private bf: Battlefield, private scene: THREE.Scene, private player: MechUnit,
    private lances: LanceField, private bandits: BanditCamps) {}

  /** Every one on the field (alive or a wreck), for the register and the turrets. */
  list(): MechUnit[] { const o: MechUnit[] = []; for (const s of this.slots) if (s.key && s.rival.placed && s.rival.unit) o.push(s.rival.unit); return o; }
  get alive() { let n = 0; for (const s of this.slots) if (s.key && s.rival.alive) n++; return n; }
  objects(): THREE.Object3D[] { return this.slots.flatMap((s) => (s.key ? s.rival.objects() : [])); }

  reset() { for (const s of this.slots) this.free(s); this.dead.clear(); }

  private free(s: Slot) { if (s.key) s.rival.despawn(); s.key = null; s.lance = null; s.camp = null; s.pending = false; }
  private used() { let n = 0; for (const s of this.slots) if (s.key) n++; return n; }
  private has(key: string) { return this.slots.some((s) => s.key === key); }

  private put(key: string, x: number, z: number, face: number, danger: number, seed: number, arena: { x: number; z: number; r: number }, lance: Lance | null, camp: BanditCamp | null): boolean {
    if (!this.setup || this.used() >= Math.round(this.v.fieldMechMax)) return false;
    let s = this.slots.find((q) => !q.key);
    if (!s) {
      const rival = new FieldRival(this.bf, this.scene, this.v, this.player);
      rival.setup = this.setup;
      s = { rival, key: null, pending: false, lance: null, camp: null, hp: 0 };
      this.slots.push(s);
    }
    const slot = s, g = mechGrade(this.v, danger);
    const lvl = Math.max(1, Math.round(this.setup.playerLevel?.() ?? 1));
    slot.key = key; slot.lance = lance; slot.camp = camp; slot.pending = true;
    void slot.rival.put({ seed, x, z, face, level: lvl + g.up, arena, hull: g.hull, ai: g.ai, paint: FORT_MECH_PAINT }).then((ok) => {
      if (slot.key !== key) { if (ok && !slot.key) slot.rival.despawn(); return; }
      slot.pending = false;
      if (!ok) { slot.key = null; slot.lance = null; slot.camp = null; return; }
      slot.hp = slot.rival.unit!.health;
    });
    return true;
  }

  /** A lance closed with the mech: its Ramparts down round where it is (as many as there's room for). */
  bring(l: Lance) {
    const P = this.player.sim.pelvis;
    const face = Math.atan2(P.x - l.x, P.z - l.z);
    let put = 0;
    for (let k = 0; k < l.n; k++) {
      const a = face + Math.PI / 2, off = (k - (l.n - 1) / 2) * 14;
      const x = l.x + Math.sin(a) * off, z = l.z + Math.cos(a) * off;
      if (this.put(`${l.id}:${k}`, x, z, face, l.danger, l.seed + k * 7919, { x: P.x, z: P.z, r: this.v.lanceArena }, l, null)) put++;
    }
    // No room on the field for the rest: they stay out there.
    l.n = put;
  }

  /** One frame. hunting: the expedition's say (the mech out and alive). */
  update(dt: number, hunting: boolean) {
    if (!this.setup) return;
    const v = this.v, P = this.player.sim.pelvis;
    // Camp guards: wanted for camps on the field (not asleep), nearest first.
    this.bandits.liveCamps(this.camps);
    this.camps.sort((a, b) => Math.hypot(a.camp.x - P.x, a.camp.z - P.z) - Math.hypot(b.camp.x - P.x, b.camp.z - P.z));
    for (const s of this.slots) if (s.camp && !s.pending && !this.camps.some((c) => c.camp.id === s.camp!.id && c.state !== "asleep")) this.free(s);
    for (const { camp: c, state } of this.camps) {
      if (state === "asleep") continue;
      const dg = Math.max(c.danger, this.dangerAt?.(c.x, c.z) ?? 0);
      const n = campMechs(v, c.seed, dg);
      for (let k = 0; k < n; k++) {
        const key = `${c.id}:m${k}`;
        if (this.dead.has(key) || this.has(key)) continue;
        const a = (c.seed % 628) / 100 + k * 2.4, r = c.radius + 6;
        this.put(key, c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, a, dg, c.seed + k * 104729, { x: c.x, z: c.z, r: v.campMechArena }, null, c);
      }
    }
    // Step them.
    for (const s of this.slots) {
      if (!s.key || s.pending || !s.rival.placed) continue;
      const u = s.rival.unit!, p = u.sim.pelvis;
      const near = Math.hypot(p.x - P.x, p.z - P.z);
      let fight = hunting;
      if (s.camp) {
        if (u.alive && u.health < s.hp - 1e-3) this.bandits.alarmCamp(s.camp.id);
        const st = this.camps.find((c) => c.camp.id === s.camp!.id)?.state;
        fight = hunting && st === "alert" && near < v.campMechWake;
      } else {
        s.rival.arena.x = P.x; s.rival.arena.z = P.z; s.rival.arena.r = v.lanceArena;
      }
      s.hp = u.health;
      s.rival.step(dt, fight);
      s.rival.stepSummons(dt);
      if (s.rival.died) {
        s.rival.died = false;
        if (s.camp) this.dead.add(s.key);
        else if (s.lance) s.lance.n = Math.max(0, s.lance.n - 1);
        this.onEvent?.({ type: "banditMechDown", id: s.key, from: s.camp ? "camp" : "lance", x: p.x, y: p.y, z: p.z });
      }
    }
    // Wrecks of lance mechs left far behind: off the field (the slot is free again).
    for (const s of this.slots) if (s.key && s.lance && !s.pending && s.rival.placed && !s.rival.alive && s.rival.unit!.sim.pelvis.distanceTo(P) > 200) this.free(s);
    // Lances left behind (or the mech aboard): survivors back out there as a point; wiped out: gone.
    for (const l of this.lances.lances) {
      if (l.state !== "live") continue;
      const mine = this.slots.filter((s) => s.lance === l && s.key);
      if (!mine.length) { if (l.n > 0) this.lances.handBack(l, l.n, l.x, l.z); continue; }
      if (mine.some((s) => s.pending)) continue;
      const alive = mine.filter((s) => s.rival.alive);
      if (!alive.length) continue;
      let sx = 0, sz = 0;
      for (const s of alive) { sx += s.rival.unit!.sim.pelvis.x; sz += s.rival.unit!.sim.pelvis.z; }
      l.x = sx / alive.length; l.z = sz / alive.length;
      if (!hunting || Math.hypot(l.x - P.x, l.z - P.z) > v.lanceGiveUp) {
        for (const s of mine) this.free(s);
        this.lances.handBack(l, alive.length, l.x, l.z);
      }
    }
  }
}
