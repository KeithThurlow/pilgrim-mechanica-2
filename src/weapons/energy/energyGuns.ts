// A mech's energy weapons on its battlefield (Keith 2026-11-02): the arsenal (src/weapons/arsenal.ts) hands each side
// that holds one its trigger, muzzle and aim; this runs the timing and energy (src/weapons/energy/energySim.ts, paid
// from the energy bars) and turns the shots into rays, damage and effects. Drawing: energyDraw.ts reads the views here.
//   Pulse laser: a hitscan bolt to the first thing on the line (a body, steel or the sand), armour-piercing.
//   Beam laser: a beam that swings after the aim at beamTrack °/s and burns what it touches in ticks; the sand glows.
//   Nova lance: charges at the muzzle; released, a thick beam to the first thing on the line and a burst there, both by
//   the charge.
//   Plasma cannon: a glowing bolt flown at its speed, swept each step with the same ray; it bursts on the first thing it
//   meets (the body struck takes its damage, a splash round it a share by distance) or fizzles at its range.
//   Particle orb: a slow ball drifting at hover height over the sand along the aim, burning everything of another team
//   within its radius in ticks as it passes through them (it isn't stopped by bodies), popping at its range.
//   Arc caster: lightning to the lock, else the enemy nearest the aim point (within arcAim m, in range); from there it
//   jumps to the nearest enemy not yet struck within jump reach, damage × keep each jump. No target: it grounds at
//   the aim. Targets come from the register (or the lab's candidates when the register is empty).
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
import { splashBlast } from "../../game/splash";
import { FLAG, KIND, kindBit, type Filter } from "../../game/register";
import type { TargetCandidate } from "../../game/targeting";

/** A fading shot for the draw: a pulse bolt or a lance's beam, from the muzzle to where it stopped. */
export interface Bolt { cls: EnergyClass; from: Vec3; to: Vec3; age: number; life: number; power: number; hit: boolean }
/** A side's beam now (on, from the muzzle to where it touches) and a lance's charge at the muzzle. */
export interface BeamView { on: boolean; from: Vec3; to: Vec3; hit: boolean; age: number }
export interface ChargeView { on: boolean; at: Vec3; k: number }
/** A plasma bolt or a particle orb in flight (host: its damage; the draw reads pos). */
export interface Orb { cls: "plasma" | "orb"; pos: THREE.Vector3; dir: THREE.Vector3; speed: number; left: number; damage: number; ap: number; radius: number; pop: number; tick: number; ticks: number; age: number; seed: number }
/** A lightning strike for the draw: the chain of points from the muzzle through each target (or to the sand). */
export interface Arc { pts: Vec3[]; age: number; life: number; seed: number }

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
  /** Plasma bolts and particle orbs in flight, and recent lightning. */
  readonly orbs: Orb[] = [];
  readonly arcs: Arc[] = [];
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

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues,
    /** Targets when the register is empty (the lab's candidates). */
    private candidates: () => TargetCandidate[] = () => []) {
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
    const out = s.sim.step(dt, held, st, u.reactor, v.energyCost < 0.5);
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
    } else if (st.cls === "plasma" || st.cls === "orb") {
      for (let k = 0; k < out.shots; k++) this.launch(st, muzzle, st.cls === "orb" ? flat : want, gi);
    } else if (st.cls === "arc") {
      for (let k = 0; k < out.shots; k++) this.zap(st, muzzle, want, aim, gi);
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

  /** Age the fading shots and fly the bolts and orbs (once a step, after both sides). */
  age(dt: number) {
    for (const b of this.bolts) b.age += dt;
    for (let k = this.bolts.length - 1; k >= 0; k--) if (this.bolts[k].age > this.bolts[k].life) this.bolts.splice(k, 1);
    for (const a of this.arcs) a.age += dt;
    for (let k = this.arcs.length - 1; k >= 0; k--) if (this.arcs[k].age > this.arcs[k].life) this.arcs.splice(k, 1);
    for (let k = this.orbs.length - 1; k >= 0; k--) if (!this.fly(this.orbs[k], dt)) this.orbs.splice(k, 1);
  }

  /** Everything off: a dead owner, a refit. */
  stop() { for (const s of this.sides) { s.sim.drop(); this.quiet(s); } }
  // (Bolts and orbs already in flight carry on: they're shots, not the gun.)

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

  // ---- Plasma and orbs ----

  private launch(st: EnergyStats, muzzle: THREE.Vector3, d: THREE.Vector3, gi: number) {
    const bf = this.bf, u = this.unit, orb = st.cls === "orb";
    this.onFire?.(st.cls);
    const dir = d.clone();
    if (orb) { dir.y = 0; dir.normalize(); }
    this.orbs.push({ cls: orb ? "orb" : "plasma", pos: muzzle.clone(), dir, speed: st.speed, left: st.range, damage: st.damage, ap: st.ap, radius: st.radius,
      pop: st.blastDamage, tick: 0, ticks: st.ticks, age: 0, seed: Math.random() * 100 });
    bf.sfx.playSound(orb ? "orbLaunch" : "plasmaShot", muzzle, 0.8, 1);
    bf.gunFx.sparksAt(muzzle, dir, orb ? 4 : 3, 4);
    u.upper.guns[gi].kick = Math.max(u.upper.guns[gi].kick, orb ? 0.12 : 0.08);
  }

  /** One step of a plasma bolt or an orb; false when it's gone. */
  private fly(o: Orb, dt: number): boolean {
    const bf = this.bf, team = this.unit.team;
    o.age += dt;
    const step = Math.min(o.left, o.speed * dt);
    if (o.cls === "plasma") {
      const tr = this.trace(o.pos, o.dir, step);
      if (tr.t < step - 1e-4) {
        const at = this.at.copy(o.pos).addScaledVector(o.dir, tr.t);
        this.burst(o, at, tr);
        return false;
      }
      o.pos.addScaledVector(o.dir, step);
      o.left -= step;
      if (o.left <= 1e-3) { this.burst(o, o.pos, null); return false; }
      return true;
    }
    // The orb drifts at hover height over the sand (rising over a dune, sinking into a hollow) and burns as it goes.
    o.pos.x += o.dir.x * step; o.pos.z += o.dir.z * step;
    const want = bf.field.height(o.pos.x, o.pos.z) + this.v.orbHover;
    o.pos.y += (want - o.pos.y) * Math.min(1, dt * 6);
    o.pos.y = Math.max(o.pos.y, want - this.v.orbHover * 0.5);
    o.left -= step;
    o.tick -= dt;
    const gap = 1 / Math.max(1, o.ticks);
    while (o.tick <= 0) {
      o.tick += gap;
      splashBlast(bf.targets, team, o.pos, o.radius, o.damage * gap, o.dir, null, o.ap);
      bf.heat?.spot(o.pos.x, o.pos.z, o.radius * 0.35, this.v.beamHeat * 0.4, gap);
    }
    if (o.left <= 1e-3) {
      // Its pop: a small burst of everything it held.
      if (o.pop > 0) bf.blast(team, o.pos.clone(), o.radius * 0.9, o.pop, o.ap, "beam");
      return false;
    }
    return true;
  }

  /** A plasma bolt bursting: the body struck takes its damage, a splash round it a share by distance. */
  private burst(o: Orb, at: THREE.Vector3, tr: Trace | null) {
    const bf = this.bf;
    if (tr) this.last.plasma = this.strike(tr, at, o.dir, o.damage, o.ap, 1.5);
    if (o.radius > 0) splashBlast(bf.targets, this.unit.team, at, o.radius, o.damage * 0.6, o.dir, tr?.target ?? null, o.ap);
    bf.gunFx.sparksAt(at, this.n.copy(o.dir).negate(), 10, 8);
    if (tr?.ground || !tr) {
      const g = bf.field.height(at.x, at.z);
      if (at.y - g < 1.5) { bf.heat?.spot(at.x, at.z, Math.max(0.4, o.radius * 0.4), this.v.beamHeat * 0.8); bf.marks.crater(at.x, at.z, 0.8); }
    }
    bf.sfx.playSound("plasmaHit", at, 0.7, 1);
  }

  // ---- Arcs ----

  private filter: Filter = { all: FLAG.Hittable, kinds: kindBit(KIND.Unit) | kindBit(KIND.Vehicle) | kindBit(KIND.Mech) | kindBit(KIND.Prop) };
  private nearBuf: number[] = [];

  /** Enemy points near (x, z) within R: from the register, else the lab's candidates. */
  private enemiesNear(x: number, z: number, R: number, out: { x: number; y: number; z: number; id: unknown }[]) {
    out.length = 0;
    const reg = this.bf.register;
    if (reg.stamp > 0 && reg.count > 0) {
      this.filter.notTeam = this.unit.team;
      reg.near(x, z, R, this.filter, this.nearBuf);
      for (const e of this.nearBuf) out.push({ x: reg.x[e], y: reg.y[e], z: reg.z[e], id: reg.id[e] });
      return out;
    }
    for (const c of this.candidates()) if (Math.hypot(c.x - x, c.z - z) <= R) out.push({ x: c.x, y: c.y, z: c.z, id: c.key });
    return out;
  }
  private found: { x: number; y: number; z: number; id: unknown }[] = [];

  private zap(st: EnergyStats, muzzle: THREE.Vector3, d: THREE.Vector3, aim: Vec3 | null, gi: number) {
    const bf = this.bf, u = this.unit, team = u.team;
    this.onFire?.("arc");
    const pts: Vec3[] = [set3(v3(), muzzle)];
    const hit = new Set<unknown>();
    // The first target: the lock, else the enemy nearest the aim point within reach.
    let cur: { x: number; y: number; z: number } | null = null;
    if (u.lock && Math.hypot(u.lock.x - muzzle.x, u.lock.z - muzzle.z) <= st.range + (u.lock.r ?? 0)) { cur = { x: u.lock.x, y: u.lock.y, z: u.lock.z }; hit.add(u.lock.key); }
    else {
      const ax = aim ? aim.x : muzzle.x + d.x * st.range * 0.6, az = aim ? aim.z : muzzle.z + d.z * st.range * 0.6;
      let bd = Infinity, first: unknown = null;
      for (const e of this.enemiesNear(ax, az, st.seek, this.found)) {
        if (Math.hypot(e.x - muzzle.x, e.z - muzzle.z) > st.range) continue;
        const q = Math.hypot(e.x - ax, e.z - az);
        if (q < bd) { bd = q; cur = { x: e.x, y: e.y, z: e.z }; first = e.id; }
      }
      if (cur) hit.add(first);
    }
    const dir = this.d;
    let dealt = 0;
    if (!cur) {
      // Nothing to strike: it grounds at the aim (or at its reach along the barrel), stinging whatever stands there.
      const flatD = Math.hypot(d.x, d.z) || 1;
      let gx = aim ? aim.x : muzzle.x + (d.x / flatD) * st.range, gz = aim ? aim.z : muzzle.z + (d.z / flatD) * st.range;
      const L = Math.hypot(gx - muzzle.x, gz - muzzle.z);
      if (L > st.range) { gx = muzzle.x + ((gx - muzzle.x) / L) * st.range; gz = muzzle.z + ((gz - muzzle.z) / L) * st.range; }
      const g = this.at.set(gx, bf.field.height(gx, gz), gz);
      pts.push(set3(v3(), g));
      dir.set(gx - muzzle.x, 0, gz - muzzle.z).normalize();
      splashBlast(bf.targets, team, g, 1.2, st.damage * 0.5, dir, null, st.ap);
      bf.heat?.spot(gx, gz, 0.4, this.v.beamHeat * 0.5);
      bf.gunFx.sparksAt(g, this.n.set(0, 1, 0), 5, 5);
    } else {
      let damage = st.damage;
      for (let hop = 0; cur && hop <= st.hops; hop++) {
        const prev = pts[pts.length - 1];
        const p = this.at.set(cur.x, cur.y, cur.z);
        dir.set(p.x - prev.x, p.y - prev.y, p.z - prev.z).normalize();
        pts.push(set3(v3(), p));
        splashBlast(bf.targets, team, p, 1.2, damage, dir, null, st.ap);
        dealt += damage;
        bf.gunFx.sparksAt(p, this.n.set(0, 1, 0), 4, 6);
        damage *= st.keep;
        if (hop === st.hops || damage < 0.5) break;
        // The next: the nearest enemy not yet struck within jump reach.
        let next: { x: number; y: number; z: number; id: unknown } | null = null, bd = Infinity;
        for (const e of this.enemiesNear(p.x, p.z, st.hopRange, this.found)) {
          if (hit.has(e.id)) continue;
          const q = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
          if (q > 0.04 && q < bd) { bd = q; next = e; }
        }
        if (!next) break;
        hit.add(next.id);
        cur = { x: next.x, y: next.y, z: next.z };
      }
    }
    this.last.arc = dealt;
    this.last.arcHits = pts.length - 1;
    this.arcs.push({ pts, age: 0, life: this.v.arcShow, seed: Math.random() * 1000 });
    bf.sfx.playSound("arcZap", muzzle, 0.8, 0.9 + Math.random() * 0.2);
    u.upper.guns[gi].kick = Math.max(u.upper.guns[gi].kick, 0.04);
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
