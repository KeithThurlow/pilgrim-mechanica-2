// A mech's energy weapons on its battlefield (Keith 2026-11-02): the arsenal (src/weapons/arsenal.ts) hands each side
// that holds one its trigger, muzzle and aim; this runs the timing and energy (src/weapons/energy/energySim.ts, paid
// from the energy bars) and turns the shots into rays, damage and effects. Drawing: energyDraw.ts reads the views here.
//   Pulse laser: a hitscan bolt to the first thing on the line (a body, steel or the sand), armour-piercing.
//   Beam laser: a beam that swings after the aim at beamTrack °/s and burns what it touches in ticks; the sand glows.
//   Nova lance: charges at the muzzle; released, a thick beam to the first thing on the line and a burst there, both by
//   the charge.
// Ownership: host (damage) from the owner's commands (trigger, aim); the views and effects are cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable } from "../../game/battlefield";
import type { MechUnit } from "../../game/mechUnit";
import type { WeaponValues } from "../tuning";
import type { Vec3 } from "../painter";
import { rayGround } from "../../world/raycast";
import { EnergySim, energyStats, type EnergyClass, type EnergyStats } from "./energySim";
import { addEnergySounds } from "./energySound";
import type { Loop } from "../../audio/sfx";

/** A fading shot for the draw: a pulse bolt or a lance's beam, from the muzzle to where it stopped. */
export interface Bolt { cls: EnergyClass; from: Vec3; to: Vec3; age: number; life: number; power: number; hit: boolean }
/** A side's beam now (on, from the muzzle to where it touches) and a lance's charge at the muzzle. */
export interface BeamView { on: boolean; from: Vec3; to: Vec3; hit: boolean; age: number }
export interface ChargeView { on: boolean; at: Vec3; k: number }

interface ESide {
  cls: EnergyClass | null;
  own: Record<string, number> | null;
  sim: EnergySim;
  /** The beam's direction now (it swings after the aim). */
  dir: THREE.Vector3;
  beam: BeamView;
  charge: ChargeView;
  loop: Loop | null;
  whined: boolean;
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const set3 = (o: Vec3, p: { x: number; y: number; z: number }) => { o.x = p.x; o.y = p.y; o.z = p.z; return o; };

/** The first thing on a ray: distance, the body (null: steel or sand), whether it was the ground. */
interface Trace { t: number; target: Hittable | null; ground: boolean; steel: boolean }

export class EnergyGuns {
  readonly sides: [ESide, ESide];
  readonly bolts: Bolt[] = [];
  /** Damage dealt by the last shot or tick per kind (the weapons lab's readout). */
  readonly last: Record<string, number> = {};
  /** Camera shake and the per-shot readout (the arsenal's hooks). */
  onShake: ((k: number) => void) | null = null;
  onFire: ((kind: string) => void) | null = null;
  private d = new THREE.Vector3();
  private want = new THREE.Vector3();
  private at = new THREE.Vector3();
  private n = new THREE.Vector3();
  private g = new THREE.Vector3();
  private tr: Trace = { t: 0, target: null, ground: false, steel: false };

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues) {
    const side = (): ESide => ({ cls: null, own: null, sim: new EnergySim(), dir: new THREE.Vector3(0, 0, 1), beam: { on: false, from: v3(), to: v3(), hit: false, age: 0 },
      charge: { on: false, at: v3(), k: 0 }, loop: null, whined: false });
    this.sides = [side(), side()];
    addEnergySounds(bf.sfx, v);
  }

  configure(i: number, cls: EnergyClass | null, own: Record<string, number> | null) {
    const s = this.sides[i];
    this.quiet(s);
    s.cls = cls; s.own = own; s.sim = new EnergySim();
  }

  stats(i: number): EnergyStats | null { const s = this.sides[i]; return s.cls ? energyStats(s.cls, s.own, this.v) : null; }

  /**
   * One step of side i: `held` its trigger, `blocked` a dash or the sprint (any charge is lost, the beam stops), the
   * muzzle, the flat aim direction and the aim point (the lock or the cursor's ground point, or null).
   */
  step(i: number, dt: number, held: boolean, blocked: boolean, muzzle: THREE.Vector3, flat: THREE.Vector3, aim: Vec3 | null) {
    const s = this.sides[i], u = this.unit, v = this.v;
    if (!s.cls) return;
    const st = energyStats(s.cls, s.own, v);
    if (blocked) { s.sim.drop(); held = false; }
    const out = s.sim.step(dt, held, st, u.dash, v.energyCost < 0.5);
    // Where it points: at the aim point (a body's height over the cursor's sand, so it meets what stands there), else
    // along the barrel.
    const want = this.want;
    if (aim && Math.hypot(aim.x - muzzle.x, aim.z - muzzle.z) > 2) {
      const y = u.lock ? aim.y : aim.y + 1;
      want.set(aim.x - muzzle.x, y - muzzle.y, aim.z - muzzle.z).normalize();
    } else want.copy(flat).normalize();
    const gi = i === 0 ? 0 : 1;

    if (st.cls === "laser") {
      for (let k = 0; k < out.shots; k++) this.pulse(st, muzzle, want, gi);
    } else if (st.cls === "beam") {
      this.stepBeam(s, st, dt, muzzle, want, out.shots);
    } else {
      // The lance: the charge glows at the muzzle and whines; on release it fires.
      s.charge.on = s.sim.holding && s.sim.charge > 0;
      s.charge.k = s.sim.charge;
      set3(s.charge.at, muzzle);
      if (s.sim.holding && !s.whined && s.sim.charge > 0) { s.whined = true; this.bf.sfx.playSound("lanceCharge", muzzle, 1, 1.4 / Math.max(0.3, st.charge)); }
      if (!s.sim.holding) s.whined = false;
      if (out.power > 0) this.lance(st, out.power, muzzle, want, gi);
      if (out.fizzled) this.bf.gunFx.sparksAt(muzzle, want, 6, 3);
    }
  }

  /** Age the fading shots (once a frame, after both sides). */
  age(dt: number) {
    for (const b of this.bolts) b.age += dt;
    for (let k = this.bolts.length - 1; k >= 0; k--) if (this.bolts[k].age > this.bolts[k].life) this.bolts.splice(k, 1);
  }

  /** Everything off: a dead owner, a refit. */
  stop() { for (const s of this.sides) { s.sim.drop(); this.quiet(s); } }

  private quiet(s: ESide) {
    s.beam.on = false; s.charge.on = false; s.charge.k = 0; s.whined = false;
    if (s.loop) { this.bf.sfx.stopLoop(s.loop); s.loop = null; }
  }

  /** The HUD's word for side i: charge, beam, out of energy. */
  stateText(i: number): string {
    const s = this.sides[i];
    if (!s.cls) return "";
    if (s.sim.dry) return `<b style="color:#ff7a5c">no energy</b>`;
    if (s.cls === "lance") return s.sim.cool > 0 ? `${s.sim.cool.toFixed(1)} s` : s.sim.holding ? `charge ${Math.round(s.sim.charge * 100)}%` : "hold to charge";
    if (s.cls === "beam") return s.beam.on ? "burning" : "hold to burn";
    return "hold to fire";
  }

  // ---- Rays ----

  /** The first body of another team, steel wreck or sand along o + d·t up to max. Primes a swarm on its struck unit. */
  private trace(o: THREE.Vector3, d: THREE.Vector3, max: number): Trace {
    const bf = this.bf, team = this.unit.team, tr = this.tr;
    let best = max, hit: Hittable | null = null, ground = false, steel = false;
    for (const t of bf.targets) {
      if (!t.alive || t.team === team) continue;
      const r = t.hitRay(o, d, best);
      if (r >= 0 && r < best) { best = r; hit = t; }
    }
    const g = rayGround(o, d, bf.field, best, this.g);
    if (g) { const gd = o.distanceTo(g); if (gd < best) { best = gd; hit = null; ground = true; } }
    if (bf.wrecks?.hit(o, d, best, this.at, this.n)) { const sd = o.distanceTo(this.at); if (sd < best) { best = sd; hit = null; ground = false; steel = true; } }
    // A swarm's adapter damages the unit its last hitRay struck: strike it again so it's this one.
    if (hit) hit.hitRay(o, d, best + 0.5);
    tr.t = best; tr.target = hit; tr.ground = ground; tr.steel = steel;
    return tr;
  }

  /** Damage what a trace struck, with sparks, cloth or a puff of sand at the point. Returns the damage dealt. */
  private strike(tr: Trace, at: THREE.Vector3, d: THREE.Vector3, damage: number, ap: number, fx: number): number {
    const bf = this.bf;
    if (tr.target) {
      tr.target.damage(damage, at, d, ap);
      if (fx > 0) {
        if (tr.target.surface === "flesh") bf.gunFx.onFleshHit?.(at, d);
        else bf.gunFx.sparksAt(at, this.n.copy(d).negate(), Math.round(4 * fx), 6);
      }
      return damage;
    }
    if (fx > 0 && tr.steel) bf.gunFx.sparksAt(at, this.n.copy(d).negate(), Math.round(5 * fx), 7);
    else if (fx > 0 && tr.ground && !bf.inWater(at.x, at.z)) bf.dust.hit(at.x, bf.field.height(at.x, at.z), at.z, d.x, d.z, 0.6 * fx);
    return 0;
  }

  // ---- The weapons ----

  private pulse(st: EnergyStats, muzzle: THREE.Vector3, d: THREE.Vector3, gi: number) {
    const bf = this.bf, u = this.unit;
    this.onFire?.("laser");
    const tr = this.trace(muzzle, d, st.range);
    const at = this.at.copy(muzzle).addScaledVector(d, tr.t);
    this.last.laser = this.strike(tr, at, d, st.damage, st.ap, 1);
    if (tr.ground) bf.heat?.spot(at.x, at.z, 0.35, this.v.beamHeat * 0.6);
    this.bolts.push({ cls: "laser", from: set3(v3(), muzzle), to: set3(v3(), at), age: 0, life: this.v.pulseFlash, power: 1, hit: !!tr.target });
    bf.sfx.playSound("pulseZap", muzzle, 0.8, 1);
    u.upper.guns[gi].kick = Math.max(u.upper.guns[gi].kick, 0.05);
  }

  private stepBeam(s: ESide, st: EnergyStats, dt: number, muzzle: THREE.Vector3, want: THREE.Vector3, ticks: number) {
    const bf = this.bf, v = this.v;
    if (!s.sim.on) {
      s.dir.copy(want);
      if (s.beam.on) this.quiet(s);
      return;
    }
    // Swing after the aim at beamTrack °/s.
    if (!s.beam.on) s.dir.copy(want);
    const ang = s.dir.angleTo(want), max = (v.beamTrack * Math.PI / 180) * dt;
    if (ang > 1e-4) s.dir.lerp(want, Math.min(1, max / ang)).normalize();
    const d = this.d.copy(s.dir);
    const tr = this.trace(muzzle, d, st.range);
    const at = this.at.copy(muzzle).addScaledVector(d, tr.t);
    if (!s.beam.on) { s.beam.age = 0; this.onFire?.("beam"); }
    s.beam.on = true; s.beam.age += dt; s.beam.hit = !!tr.target;
    set3(s.beam.from, muzzle); set3(s.beam.to, at);
    let dealt = 0;
    for (let k = 0; k < ticks; k++) dealt += this.strike(tr, at, d, st.damage, st.ap, k === 0 ? 0.7 : 0);
    if (ticks) this.last.beam = dealt;
    // The sand where it touches glows, held there; a wisp of smoke now and then.
    if (tr.ground) {
      bf.heat?.spot(at.x, at.z, 0.7, v.beamHeat, dt);
      if (Math.random() < dt * 10) bf.dust.smoke(at.x, at.y + 0.1, at.z, (Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5, 0.25, 0.8, 0.45, 0.85);
    }
    // Its hum: a loop while it burns.
    if (!s.loop) s.loop = bf.sfx.startSoundLoop("beamHum", Math.random());
    if (s.loop) bf.sfx.setSoundLoop(s.loop, "beamHum", muzzle, 0.7, s.beam.hit ? 1.08 : 1);
    this.unit.upper.guns[s === this.sides[0] ? 0 : 1].kick = 0.015;
  }

  private lance(st: EnergyStats, power: number, muzzle: THREE.Vector3, d: THREE.Vector3, gi: number) {
    const bf = this.bf, u = this.unit, v = this.v;
    this.onFire?.("lance");
    const tr = this.trace(muzzle, d, st.range);
    const at = this.at.copy(muzzle).addScaledVector(d, tr.t);
    this.last.lance = this.strike(tr, at, d, st.damage * power, st.ap, 3);
    // The burst where it lands, by the charge (a lance at full makes a crater; a quick one only a pop).
    const r = st.blast * (0.4 + 0.6 * power);
    if (r > 0.3 && st.blastDamage > 0) bf.blast(u.team, at.clone(), r, st.blastDamage * power, st.ap, "beam");
    if (tr.ground) bf.heat?.spot(at.x, at.z, 0.8 + r * 0.25, v.beamHeat * (0.6 + 0.4 * power));
    this.bolts.push({ cls: "lance", from: set3(v3(), muzzle), to: set3(v3(), at), age: 0, life: 0.35 + 0.25 * power, power, hit: !!tr.target });
    bf.gunFx.sparksAt(muzzle, d, Math.round(6 + 10 * power), 10);
    bf.sfx.playSound("lanceFire", muzzle, 0.6 + 0.4 * power, 1.1 - 0.15 * power);
    u.upper.guns[gi].kick = v.railKick * (0.5 + 0.5 * power);
    u.upper.shake = Math.min(0.08, u.upper.shake + 0.04 * power);
    this.onShake?.(v.lanceShake * power);
  }
}
