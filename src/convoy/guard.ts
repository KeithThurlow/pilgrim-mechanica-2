// The convoy's guns firing (Keith 2026-11-01: "the Convoy doesn't seem to defend itself ... have the Convoy destroy
// the enemies ... tanks ... defending the Convoy"). Glue between the turrets (defence.ts), the escorts (escort.ts and
// their bodies) and the battlefield.
//
// - Turrets: defence.ts slews them at the nearest threat and calls onFire when one is on target; here the twin guns
//   put a round at the target (a little spread) and the heavy guns on the bays' cabs fire a shell that bursts on it.
// - Escorts: each one's gun turns toward the nearest threat in its range at a capped rate and fires once on target:
//   machine guns on the cars and trucks (both of a war rig's), a heavy shell from the tanks (held while a dune is in
//   the way). They shoot from station; they don't break off to chase (escort `mode` is the hook for that).
// The convoy's rounds fly as the player's side (TEAM.player): they pass through the player's mech, the pilot and the
// guardians and never hurt them, and what they kill counts as the player's (no kill credit is kept yet).
// Spread is seeded (rule 12). Ownership: host (damage); the turret and gun angles are cosmetic but come from the sim.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import { TEAM } from "../game/factions";
import type { Defence, Turret } from "./defence";
import type { EscortGroup } from "./escort";
import type { EscortBodies } from "./escortBody";

export const GUARD_DEFAULTS = {
  turretDamage: 12,
  turretPierce: 0.4,
  turretSpread: 1.2,
  heavyDamage: 110,
  heavyBlast: 4.5,
  escortGunsOn: 1,
  escortGunRange: 90,
  escortGunRate: 5,
  escortGunDamage: 9,
  escortGunSpread: 2,
  escortGunTurn: 150,
  tankRange: 140,
  tankRate: 0.33,
  tankDamage: 160,
  tankBlast: 6,
  tankTurn: 45,
};
export type GuardValues = typeof GUARD_DEFAULTS;

const T = "Turret fire", E = "Escort guns";
export const GUARD_PARAMS: Param[] = [
  { key: "turretDamage", label: "Twin gun: damage per round", min: 0, max: 60, step: 0.5, group: T, tip: "Shots per second, turn rate and range are in Defences" },
  { key: "turretPierce", label: "Twin gun: armour pierce", min: 0, max: 1, step: 0.05, group: T },
  { key: "turretSpread", label: "Twin gun: spread (°)", min: 0, max: 8, step: 0.1, group: T },
  { key: "heavyDamage", label: "Heavy gun: shell damage", min: 0, max: 500, step: 5, group: T, tip: "The bays' cab guns: a shell that bursts on the target" },
  { key: "heavyBlast", label: "Heavy gun: blast radius (m)", min: 0.5, max: 12, step: 0.25, group: T },
  { key: "escortGunsOn", label: "Escorts shoot", min: 0, max: 1, step: 1, group: E },
  { key: "escortGunRange", label: "Machine guns: range (m)", min: 10, max: 200, step: 5, group: E },
  { key: "escortGunRate", label: "Machine guns: rounds per second", min: 0.5, max: 20, step: 0.5, group: E },
  { key: "escortGunDamage", label: "Machine guns: damage per round", min: 0, max: 60, step: 0.5, group: E },
  { key: "escortGunSpread", label: "Machine guns: spread (°)", min: 0, max: 10, step: 0.1, group: E },
  { key: "escortGunTurn", label: "Machine guns: turn rate (°/s)", min: 10, max: 400, step: 5, group: E },
  { key: "tankRange", label: "Tanks: range (m)", min: 20, max: 300, step: 5, group: E },
  { key: "tankRate", label: "Tanks: shots per second", min: 0.05, max: 2, step: 0.01, group: E },
  { key: "tankDamage", label: "Tanks: shell damage", min: 0, max: 600, step: 5, group: E },
  { key: "tankBlast", label: "Tanks: blast radius (m)", min: 0.5, max: 15, step: 0.25, group: E },
  { key: "tankTurn", label: "Tanks: turret turn rate (°/s)", min: 5, max: 180, step: 1, group: E },
];
export const GUARD_GROUPS = [T, E];

const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Gun { yaw: number; pitch: number; clock: number; los: boolean; losT: number }

export class ConvoyGuns {
  /** Rounds and shells fired so far (checks, HUD). */
  shots = 0; shells = 0;
  private guns: Gun[][] = [];
  private threats: THREE.Vector3[] = [];
  private seed = 0x2f6b9a1;
  private slot = 2;
  private from = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private at = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(private bf: Battlefield, readonly v: GuardValues & { defenceRange: number }, defence: Defence, readonly escorts: EscortGroup, readonly bodies: EscortBodies) {
    defence.onFire = (t, from) => this.turretFire(t, from);
    bodies.turretAim = (i, k) => this.guns[i]?.[k] ?? null;
  }

  /** The threats for this frame (the same list the turrets track). */
  target(points: THREE.Vector3[]) { this.threats = points; }

  /** Seeded 0..1. */
  private rand() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** Unit direction from `from` to `to`, spread up to `deg` (seeded), into this.dir. */
  private aimAt(from: THREE.Vector3, to: THREE.Vector3, deg: number) {
    const d = this.dir.subVectors(to, from).normalize();
    if (deg <= 0) return d;
    const s = this.side.set(-d.z, 0, d.x).normalize(), u = this.up.crossVectors(s, d);
    const a = this.rand() * Math.PI * 2, r = Math.tan(deg * D2R) * Math.sqrt(this.rand());
    return d.addScaledVector(s, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r).normalize();
  }

  private nextSlot() { this.slot = this.slot >= 19 ? 2 : this.slot + 1; return this.slot; }

  /** A turret on target (defence.ts): a round at it from the twin guns, a bursting shell from a heavy. */
  private turretFire(t: Turret, pivot: { x: number; y: number; z: number }) {
    const q = t.target;
    if (!q) return;
    const v = this.v, to = this.at.set(q.x, q.y, q.z);
    const from = this.from.set(pivot.x, pivot.y, pivot.z);
    const heavy = t.kind === "heavy";
    const d = this.aimAt(from, to, heavy ? 0 : v.turretSpread);
    from.addScaledVector(d, heavy ? 2.4 : 1.2);
    if (heavy) {
      if (!this.bf.canSee(from, to)) return;
      this.cannon(from, d, to, v.heavyDamage, v.heavyBlast, from.distanceTo(to));
      return;
    }
    this.shots++;
    this.bf.fire(this.nextSlot(), TEAM.player, from, d, v.defenceRange + 10, v.turretDamage, { voice: "other", flashScale: 0.9, hitScale: 0.6, pierce: v.turretPierce });
  }

  /** A cannon shell: the tracer and flash, and the burst on the target (the round itself is just the look). */
  private cannon(from: THREE.Vector3, d: THREE.Vector3, to: THREE.Vector3, damage: number, radius: number, dist: number) {
    this.shells++;
    this.bf.fire(this.nextSlot(), TEAM.player, from, d, dist + 2, 0, { voice: "none", flashScale: 2.4, hitScale: 0.01 });
    this.bf.sfx.play("brap", from, 1.3, 0.45, false);
    // Lands on the sand at the target's feet (or the body, for a vehicle up on its wheels).
    const ground = this.bf.field.height(to.x, to.z);
    this.at.set(to.x, Math.min(to.y, ground + 1), to.z);
    this.bf.blast(TEAM.player, this.at, radius, damage, 0.5, "turret");
  }

  /** The escorts' guns: turn toward the nearest threat in reach, fire when on it. */
  update(dt: number) {
    const v = this.v, list = this.escorts.list, bodies = this.bodies.bodies;
    while (this.guns.length < list.length) this.guns.push([]);
    this.guns.length = list.length;
    const on = v.escortGunsOn >= 0.5;
    list.forEach((e, i) => {
      const b = bodies[i];
      if (!b) return;
      const n = b.turretCount;
      const gs = this.guns[i];
      while (gs.length < n) gs.push({ yaw: 0, pitch: 0, clock: 0, los: true, losT: (i * 0.07) % 0.25 });
      const tank = e.kind === "tank", s = e.sim;
      const range = tank ? v.tankRange : v.escortGunRange;
      // The nearest threat to the vehicle in its gun's reach.
      let best: THREE.Vector3 | null = null, bd = range;
      if (on) for (const q of this.threats) { const d = Math.hypot(q.x - s.pos.x, q.z - s.pos.z); if (d < bd) { bd = d; best = q; } }
      const turn = (tank ? v.tankTurn : v.escortGunTurn) * D2R * dt;
      for (let k = 0; k < n; k++) {
        const g = gs[k];
        b.muzzle(this.from, k);
        let wantYaw = 0, wantPitch = 0;
        if (best) {
          const dx = best.x - this.from.x, dy = best.y - this.from.y, dz = best.z - this.from.z;
          wantYaw = wrap(Math.atan2(dx, dz) - s.heading);
          wantPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -10 * D2R, 40 * D2R);
        }
        g.yaw = wrap(g.yaw + clamp(wrap(wantYaw - g.yaw), -turn, turn));
        g.pitch += clamp(wantPitch - g.pitch, -turn, turn);
        if (!best || Math.abs(wrap(wantYaw - g.yaw)) > 5 * D2R) { g.clock = Math.min(g.clock, 1); continue; }
        // Hold fire while a dune is in the way (checked a few times a second).
        g.losT -= dt;
        if (g.losT <= 0) { g.losT = 0.25; g.los = this.bf.canSee(this.from, best); }
        if (!g.los) continue;
        g.clock += dt * (tank ? v.tankRate : v.escortGunRate);
        while (g.clock >= 1) {
          g.clock -= 1;
          if (tank) {
            const d = this.aimAt(this.from, best, 0);
            this.cannon(this.from, d, best, v.tankDamage, v.tankBlast, this.from.distanceTo(best));
            this.bf.dust.stomp(s.pos.x, s.pos.y - s.v.rideHeight, s.pos.z, 1.2);
            break;
          }
          this.shots++;
          const d = this.aimAt(this.from, best, v.escortGunSpread);
          this.bf.fire(this.nextSlot(), TEAM.player, this.from, d, range + 6, v.escortGunDamage, { voice: "other", flashScale: 1.2, hitScale: 0.7, pierce: 0.3 });
        }
      }
    });
  }
}
