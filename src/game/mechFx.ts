// A mech's looks and sounds, apart from its rules (stage 7c, docs/proposal-stage7.md: the MechUnit split, first part).
// MechUnit (src/game/mechUnit.ts) steps the legs, torso, dash, reactor, health and weapons' rules and tells its `fx`
// what happened at the moment it happens: a footfall, a landing, a foot lifting off, a dash's bang, a death, a reset,
// the guns' loop. MechFxView plays it all on the battlefield: dust, prints, furrows and toe digs, splashes and wakes,
// the hover drive's downwash, thumps, the minigun loop, the wreck in the death physics and its thuds. Nothing here
// changes the game (cosmetic; Math.random is fine here), so a mech with `fx = null` plays the same game: a headless
// host, a worker's copy (stage 7d sends these calls across as plain data instead), tools/mechfx-check.ts.
// Still with MechUnit: posing the model (`body.update`), because the rounds fly from the posed model's muzzles.
import * as THREE from "three/webgpu";
import type { Landing } from "../mech/walker";
import type { Trigger } from "../mech/upper";
import { triggerOf } from "../mech/upper";
import type { Battlefield } from "./battlefield";
import type { MechUnit } from "./mechUnit";
import type { ToonLook } from "../look/toon";
import type { Dead } from "../physics/deaths";
import { mechWreckSpec, mechWreckThrow, mechWreckThuds, seedOf, legPart, BODY, type MechPose } from "../physics/mechWreck";
import { MechWreckRig } from "../physics/mechWreckDraw";

/** What a mech tells its looks, as it happens (plain data: foot indices, the landing, dt). */
export interface MechFx {
  /** Foot `foot` came down with strength k (wet: in the shallows). */
  footfall(foot: number, k: number, wet: boolean): void;
  /** A landing (a drop, a crest, a jump, a sprint stride's). */
  land(l: Landing): void;
  /** Foot `foot` pushed off with strength k (only above 0.15). */
  liftOff(foot: number, k: number, wet: boolean): void;
  /** A dash went off. */
  dashed(): void;
  /** After the legs and guns moved this step: wading wake, hover downwash, skidding feet. */
  step(dt: number): void;
  /** The miniguns' loop (the player's), after the step's rounds; trigger as the guns saw it. */
  guns(dt: number, trigger: Trigger): void;
  /** Weapons cold: the gun loops fade out. */
  cold(): void;
  /** Destroyed: paint, smoke, the wreck falls. */
  destroyed(): void;
  /** A step while destroyed: the wreck's pose and thuds. */
  dead(): void;
  /** The wreck out of the death physics (before a reset). */
  clearWreck(): void;
  /** Reset (rebuilt or respawned): lights' streams cleared, painted again. */
  reset(): void;
  /** The wreck falling in the death physics, while destroyed. */
  readonly wreck: { dead: Dead; rig: MechWreckRig } | null;
}

/** The mech's looks and sounds on its battlefield. */
export class MechFxView implements MechFx {
  wreck: { dead: Dead; rig: MechWreckRig } | null = null;
  /** How many times this mech has died (seeds its fall). */
  private deaths = 0;
  private wakeAcc = 0;
  /** The hover drive's downwash puffs carried over (fractional). */
  private washAcc = 0;
  /** Each foot's skid point for the dash furrow (x, z, then 1 while skidding). */
  private skidFrom = [new THREE.Vector3(), new THREE.Vector3()];
  /** Each foot's slide dust carry-over (fractional puffs). */
  private slideAcc = [0, 0];
  private a = new THREE.Vector3();

  constructor(private bf: Battlefield, private u: MechUnit, private look: ToonLook) {}

  footfall(foot: number, k: number, wet: boolean) {
    const { bf, u } = this, sim = u.sim, v = u.v, f = sim.feet[foot], dust = bf.dust;
    // In the shallows: a splash and rings instead of a print and dust.
    if (wet) { bf.water!.splash(f.planted.x, f.planted.z, 0.6 + k * 0.5, sim.vel.x * 0.1, sim.vel.z * 0.1); return; }
    bf.marks.print(f.planted.x, f.planted.z, f.plantedYaw, k, u.body.footprint?.(f.side) ?? null, u.body.printScale?.() ?? 1);
    // Sprint strides come quickly: each throws less than a walking stomp (boundDust).
    dust.stomp(f.planted.x, f.planted.y, f.planted.z, k * (sim.bounding ? v.boundDust * v.sprintKick : sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1), sim.vel.x, sim.vel.z);
    // Sprinting, each footfall lands with weight: a thump.
    if (sim.running && sim.runK > 0.5 && v.sprintThump > 0) bf.sfx.play("brap", f.planted, v.sprintThump * Math.min(1.5, k), 0.32 + 0.04 * Math.random(), true);
  }

  land(l: Landing) {
    const { bf, u } = this, sim = u.sim, v = u.v, dust = bf.dust;
    const k = Math.min(2.2, 0.4 + l.impact / 6);
    // A sprint stride's landing already stomped foot by foot: here only the extra burst and the sound.
    if (l.bound) {
      for (const f of sim.feet) if (!bf.inWater(f.pos.x, f.pos.z)) dust.stomp(f.pos.x, f.pos.y, f.pos.z, k * 0.8, sim.vel.x, sim.vel.z);
      this.a.set(l.x, l.y, l.z);
      bf.sfx.play("brap", this.a, Math.min(1.8, 0.5 + l.hard * 1.1), 0.4, false);
      return;
    }
    if (l.impact <= 1.5) return;
    for (const f of sim.feet) {
      if (bf.inWater(f.planted.x, f.planted.z)) { bf.water!.splash(f.planted.x, f.planted.z, 0.6 + k * 0.6, sim.vel.x * 0.1, sim.vel.z * 0.1); continue; }
      bf.marks.print(f.planted.x, f.planted.z, f.plantedYaw, k, u.body.footprint?.(f.side) ?? null, u.body.printScale?.() ?? 1);
      dust.stomp(f.planted.x, f.planted.y, f.planted.z, k * 1.2, sim.vel.x + sim.skid.x, sim.vel.z + sim.skid.z);
    }
    if (l.impact > v.landSoft) {
      this.a.set(l.x, l.y, l.z);
      bf.sfx.play("brap", this.a, Math.min(1.8, 0.5 + l.hard * 1.1), 0.4, false);
    }
  }

  liftOff(foot: number, k: number, wet: boolean) {
    const { bf, u } = this, sim = u.sim, v = u.v, f = sim.feet[foot], dust = bf.dust;
    if (wet) { bf.water!.splash(f.pos.x, f.pos.z, 0.25 * k, -Math.sin(sim.heading) * 0.5, -Math.cos(sim.heading) * 0.5, 0.6); return; }
    const hd = sim.heading;
    dust.kick(f.pos.x, f.pos.y, f.pos.z, -Math.sin(hd), -Math.cos(hd), Math.min(1.6, k) * (sim.bounding ? v.boundDust * v.sprintKick : sim.speed > v.walkSpeed + 0.5 ? v.sprintKick : 1));
    // Sprinting, the push-off throws the mech on: sand burst back off the toes, and the toes dig in (Keith 21:54).
    if (sim.running && sim.runK > 0.5) {
      const t = f.pose.toe;
      if (v.sprintPushDust > 0) dust.kick(t.x, t.y, t.z, -Math.sin(sim.course), -Math.cos(sim.course), Math.min(2, k) * v.sprintPushDust);
      bf.marks.dig(t.x, t.z, sim.course, k * v.sprintToeDig);
    }
  }

  dashed() {
    const u = this.u;
    // The hydraulics bang: a burst of sand off both feet.
    for (const f of u.sim.feet) this.bf.dust.stomp(f.pos.x, f.pos.y, f.pos.z, 1.3, -u.dash.dirX * 4, -u.dash.dirZ * 4);
    this.bf.sfx.play("brap", u.sim.pelvis, 0.9, 0.35, false);
  }

  step(dt: number) {
    const { bf, u } = this, sim = u.sim, v = u.v, dash = u.dash;
    // Wading: the body pushes a wake (rings dropped as it moves, overlapping into a V).
    if (bf.water) {
      const moved = Math.hypot(sim.vel.x, sim.vel.z) * dt + Math.hypot(dash.vx, dash.vz) * dt;
      if (moved > 0 && bf.inWater(sim.pos.x, sim.pos.z, 0.15)) {
        this.wakeAcc = bf.water.wake(sim.pos.x, sim.pos.z, moved, this.wakeAcc, 0.7, 1.4);
        if (dash.active && Math.random() < dt * 25) for (const f of sim.feet) bf.water.splash(f.pos.x, f.pos.z, 0.8, dash.dirX, dash.dirZ, 0.8);
      }
    }
    // Hovering (src/mech/hover.ts): the drive's downwash blows sand out from under it, fading with height.
    if (sim.hovering && v.hoverDust > 0) {
      const gy = bf.field.height(sim.pos.x, sim.pos.z), up = sim.pelvis.y - gy - v.hipHeight - v.hoverLift;
      const k = v.hoverDust * Math.max(0, 1 - up / Math.max(0.1, v.hoverDustReach));
      this.washAcc += dt * v.hoverDustRate;
      for (; this.washAcc >= 1; this.washAcc--) {
        if (k <= 0 || bf.inWater(sim.pos.x, sim.pos.z)) continue;
        const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 1.2, x = sim.pos.x + Math.cos(a) * r, z = sim.pos.z + Math.sin(a) * r;
        bf.dust.kick(x, bf.field.height(x, z), z, Math.cos(a), Math.sin(a), k);
      }
    }
    // Any skidding foot (the dash's slide, a drift in the sprint, a landing skid, sliding down a face) carves the ground:
    // sand thrown along it by the slide's speed and the surface, and a furrow in the dents (Keith 2026-10-26 18:28).
    sim.feet.forEach((f, i) => {
      const from = this.skidFrom[i], sp = Math.hypot(f.slide.x, f.slide.z);
      if (f.swinging || sp < v.slideMin) { from.z = 0; this.slideAcc[i] = 0; return; }
      if (bf.inWater(f.pos.x, f.pos.z)) { if (Math.random() < dt * 20) bf.water!.splash(f.pos.x, f.pos.z, 0.6, f.slide.x / sp, f.slide.z / sp, 0.6); from.z = 0; return; }
      this.slideAcc[i] = bf.dust.slide(f.pos.x, f.pos.y, f.pos.z, f.slide.x, f.slide.z, dt, this.slideAcc[i]);
      // A furrow from where the foot was last frame (a skid that just started begins here).
      if (from.z === 0) from.set(f.pos.x, f.pos.z, 1);
      bf.marks.skid(from.x, from.y, f.pos.x, f.pos.z, f.yaw, u.body.footprint?.(f.side) ?? null, dt, u.body.printScale?.() ?? 1);
      from.set(f.pos.x, f.pos.z, 1);
    });
  }

  guns(dt: number, trigger: Trigger) {
    const u = this.u, body = u.body;
    if (!u.player || !body.armed) return;
    const guns = u.upper.guns.filter((g) => g.enabled && (!g.stats?.cls || g.stats.cls === "minigun"));
    this.bf.gunAudio.update(u, dt, guns.some((g) => triggerOf(trigger, g.side === 1 ? 0 : 1)), guns, guns.map((g) => body.muzzle(g.side, new THREE.Vector3())));
  }

  cold() { this.bf.gunAudio.release(this.u); }

  destroyed() {
    const u = this.u;
    u.body.paint(this.look, WRECK);
    // A burst of dark smoke and sand where it went down.
    const p = u.sim.pelvis, dust = this.bf.dust;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      dust.smoke(p.x + Math.cos(a), p.y - 1 + Math.random() * 2, p.z + Math.sin(a), Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s,
        0.8 + Math.random() * 0.8, 3 + Math.random() * 3, 0.85, 0.75);
    }
    this.bf.dust.stomp(p.x, p.y - 3, p.z, 2.5);
    this.fall();
  }

  /**
   * Hand the body to the death physics as a heavy wreck (src/physics/mechWreck.ts): it buckles and topples the way the
   * killing hit pushed it (or the way it was going) and the model follows the parts. Only with a death world and a
   * model that can be posed (not the stand-in walker).
   */
  private fall() {
    const u = this.u, deaths = this.bf.deaths, v = u.v, body = u.body;
    if (!deaths || !v.mechWreckOn || !body.deadRig) return;
    this.clearWreck();
    const rig = body.deadRig(), sim = u.sim;
    rig.hull.updateWorldMatrix(true, false);
    const hp = rig.hull.getWorldPosition(new THREE.Vector3()), hq = rig.hull.getWorldQuaternion(new THREE.Quaternion());
    const pose: MechPose = {
      pelvis: sim.pelvis.clone(), pelvisQ: sim.pelvisQ.clone(), hull: hp, hullQ: hq, hullBox: rig.hullBox,
      legs: sim.feet.map((f) => ({ hip: f.pose.hip, knee: f.pose.knee, hock: f.pose.hock, ankle: f.pose.ankle, foot: f.pose.foot, footQ: f.pose.footQ })),
      vel: sim.vel,
    };
    const { parts, joints } = mechWreckSpec(pose, v.mechBendLimit);
    // Pushed away from the last hit; with none, the way it faces.
    let dx = u.lastHit.x, dz = u.lastHit.z;
    if (dx === 0 && dz === 0) { dx = Math.sin(sim.heading); dz = Math.cos(sim.heading); }
    const g = sim.ground.height(sim.pos.x, sim.pos.z);
    const { lin, ang } = mechWreckThrow(parts, pose, v, dx, dz, seedOf(`${u.uid}:${this.deaths++}`), g);
    const dead = deaths.heavy(parts, joints, lin, ang, { damping: v.mechWreckDamping, moveFor: v.mechMoveFor, hold: v, thud: mechWreckThuds(parts) });
    const objs: { obj: THREE.Object3D; part: number }[] = [{ obj: rig.pelvis, part: BODY }, { obj: rig.hull, part: BODY }];
    rig.legs.forEach((L, i) => objs.push({ obj: L.thigh, part: legPart(i, 0) }, { obj: L.shin, part: legPart(i, 1) }, { obj: L.cannon, part: legPart(i, 2) }, { obj: L.foot, part: legPart(i, 2) }));
    this.wreck = { dead, rig: new MechWreckRig(objs, dead) };
    // For checking from the console (and the headless smoke run): the newest wreck's state.
    (globalThis as { __wreck?: () => unknown }).__wreck = () => ({ live: dead.live, age: +dead.age.toFixed(2), pelvis: rig.pelvis.position.toArray().map((x) => +x.toFixed(2)), body: dead.pos[0].toArray().map((x) => +x.toFixed(2)) });
  }

  /** Pose the model on the wreck; each slam into the sand kicks up dust, thuds and calls onThud (camera shake). */
  dead() {
    const w = this.wreck;
    if (!w) return;
    w.rig.apply();
    const hits = w.dead.thud?.impacts;
    if (!hits?.length) return;
    for (const h of hits.splice(0)) {
      const k = Math.min(2, h.speed / 5) * this.u.v.mechThud;
      if (k <= 0.05) continue;
      this.a.set(h.x, this.u.sim.ground.height(h.x, h.z), h.z);
      this.bf.dust.stomp(this.a.x, this.a.y, this.a.z, 1.5 * k);
      this.bf.sfx.play("brap", this.a, Math.min(1.8, 0.6 + k * 0.7), 0.3, false);
      this.bf.onThud?.(this.a, k);
    }
  }

  clearWreck() {
    if (!this.wreck) return;
    this.bf.deaths?.remove(this.wreck.dead);
    this.wreck = null;
  }

  reset() {
    this.bf.nightLights?.streams.clear();
    this.u.body.paint(this.look, this.u.paint);
  }
}

/** A destroyed mech's paint. */
export const WRECK = 0x3b3531;
