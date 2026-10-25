// A mech's weapons other than the miniguns (docs/proposal-weapons.md), on its battlefield: whatever the loadout fitted
// (src/game/loadoutApply.ts calls configure), stepped with the mech (MechUnit.weapons). It reads the buttons the mech
// unit carries (trigger: the guns; heavy: the right button for the back weapon), fills the painter, runs the sims in
// this folder and turns what they do into blasts, damage, dust, sound and shake. Drawing: src/weapons/arsenalDraw.ts.
//
// - Rail cannon (a gun side, Light or Medium): hold the trigger to charge, release to fire along the gun.
// - Autocannon (a gun side): fires on the gun's clock; each round is a shell aimed at the lock's intercept.
// - Line rocket salvo (back): hold right to paint the strip, release to fire.
// - Mortar (back): hold right for the ring and arc, release to lob.
import * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit, MechWeapons } from "../game/mechUnit";
import type { Aim } from "../mech/upper";
import type { Resolved } from "../items/loadout";
import type { ToonLook } from "../look/toon";
import type { TargetCandidate } from "../game/targeting";
import type { WeaponValues } from "./tuning";
import { newPaint, clearPaint, type Paint, type Strip, type Vec3 } from "./painter";
import { SalvoSim, planStrip, type SalvoStats } from "./salvo";
import { RailSim, railPath, railFire, type RailStats } from "./rail";
import { MortarSim, mortarAim, lobArc, lobPoint, type MortarStats } from "./mortar";
import { CannonShells, leadPoint, type CannonStats } from "./autocannon";
import { weaponModel, type WeaponModel, type ModelKind } from "./models";
import { addWeaponSounds } from "./weaponSound";

type SideKind = "rail" | "autocannon" | null;

/** One fired rail beam, for drawing: its path and how long ago. */
export interface RailShot { path: Vec3[]; from: Vec3; age: number; power: number }

interface Side {
  kind: SideKind;
  light: boolean;
  own: Record<string, number> | null;
  rail: RailSim;
  paint: Paint;
  model: WeaponModel | null;
  /** Charge whine played this hold. */
  whined: boolean;
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });
/** The rail cannon's energy colour (its charge preview, coils and beam). */
export const RAIL_GLOW = 0x7fe0ff;

export class Arsenal implements MechWeapons {
  readonly salvo: SalvoSim;
  readonly mortar: MortarSim;
  readonly shells = new CannonShells();
  /** Back weapon: which, and its own stats (null: the sliders). */
  back: "salvo" | "mortar" | null = null;
  backOwn: Record<string, number> | null = null;
  backModel: WeaponModel | null = null;
  /** The back weapon's paint (strip or ring), and the strip it would fire at now. */
  readonly backPaint = newPaint();
  /** The strip the last salvo was fired at, shown until its rockets are down. */
  readonly firedPaint = newPaint();
  strip: Strip | null = null;
  private ringAt = { x: 0, z: 0 };
  readonly sides: [Side, Side];
  /** Rail beams fired recently (the draw fades them). */
  readonly railShots: RailShot[] = [];
  /** Camera shake asked for (the lab decays it). */
  onShake: ((k: number) => void) | null = null;
  /** Called as a weapon fires (rail, salvo, mortar, autocannon), before its damage lands: the lab's per-shot readout. */
  onFire: ((kind: string) => void) | null = null;
  /** Every blast this arsenal set off, for the lab's readouts: when, and the damage it did. */
  readonly events: { t: number; kind: string; damage: number; x: number; z: number }[] = [];
  /** Damage of the last shot by kind (rail: the whole beam; salvo: the whole salvo so far). */
  last: Record<string, number> = {};
  private heldBefore = false;
  private clock = 0;
  private salvoId = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues, private look: ToonLook,
    /** Targets the snap and leads can see (the lab's candidates). */
    public candidates: () => TargetCandidate[] = () => []) {
    this.salvo = new SalvoSim(v);
    this.mortar = new MortarSim(v);
    const side = (): Side => ({ kind: null, light: false, own: null, rail: new RailSim(v), paint: newPaint(), model: null, whined: false });
    this.sides = [side(), side()];
    addWeaponSounds(bf.sfx, v);
  }

  // ---- What's fitted ----

  configure(r: Resolved) {
    const body = this.unit.body;
    const guns = [r.guns.left, r.guns.right];
    this.sides.forEach((s, i) => {
      const g = guns[i];
      const kind: SideKind = g?.cls === "rail" ? "rail" : g?.cls === "autocannon" ? "autocannon" : null;
      const mk: ModelKind | null = kind === "rail" ? (g!.light ? "railLight" : "rail") : kind === "autocannon" ? "autocannon" : null;
      if (s.model && (s.model.kind !== mk)) { s.model.root.removeFromParent(); s.model = null; }
      s.kind = kind; s.light = !!g?.light; s.own = g?.own ?? null;
      if (mk && !s.model && body.mount) { s.model = weaponModel(mk, this.look); body.mount(i === 0 ? "left" : "right").add(s.model.root); }
      body.showPod?.(i === 0 ? 1 : -1, !kind);
      s.rail.charge = 0; s.rail.holding = false;
    });
    this.back = r.back?.weapon ?? null;
    this.backOwn = r.back?.own ?? null;
    const bk: ModelKind | null = this.back;
    if (this.backModel && this.backModel.kind !== bk) { this.backModel.root.removeFromParent(); this.backModel = null; }
    if (bk && !this.backModel && body.mount) { this.backModel = weaponModel(bk, this.look); body.mount("back").add(this.backModel.root); }
    this.salvo.cooldown = 0; this.mortar.cooldown = 0;
  }

  /** Meshes of the fitted stand-ins (for the hold-V selector). */
  meshes(): THREE.Object3D[] {
    return [...this.sides.map((s) => s.model?.root), this.backModel?.root].filter((x): x is THREE.Group => !!x);
  }

  // ---- Stats: the item's own when rolled, else the sliders ----

  railStats(s: Side): RailStats {
    const v = this.v, o = s.own;
    if (o) return { damage: o.damage, charge: o.charge, cooldown: o.cooldown, range: o.range };
    const lk = s.light ? v.railLightDamage : 1, lc = s.light ? v.railLightCharge : 1;
    return { damage: v.railDamage * lk, charge: v.railCharge * lc, cooldown: v.railCooldown, range: v.railRange * (s.light ? 0.85 : 1) };
  }
  salvoStats(): SalvoStats {
    const v = this.v, o = this.backOwn;
    return o ? { rockets: o.rockets, damage: o.damage, cooldown: o.cooldown, length: o.stripLength, blast: o.blast }
      : { rockets: v.salvoRockets, damage: v.salvoDamage, cooldown: v.salvoCooldown, length: v.salvoLength, blast: v.salvoBlast };
  }
  mortarStats(): MortarStats {
    const v = this.v, o = this.backOwn;
    return o ? { shells: o.shells, damage: o.damage, cooldown: o.cooldown, blast: o.blast } : { shells: v.mortarShells, damage: v.mortarDamage, cooldown: v.mortarCooldown, blast: v.mortarBlast };
  }
  cannonStats(s: Side): CannonStats {
    const v = this.v, o = s.own;
    return o ? { damage: o.damage, speed: o.shellSpeed, splash: o.splash, range: o.range, spread: o.spread } : { damage: v.acDamage, speed: v.acSpeed, splash: v.acSplash, range: v.acRange, spread: v.acSpread };
  }

  // ---- Each frame ----

  step(dt: number, _aim: Aim | null, trigger: boolean) {
    this.clock += dt;
    const u = this.unit, bf = this.bf, v = this.v;
    while (this.events.length && this.clock - this.events[0].t > 10) this.events.shift();
    for (const r of this.railShots) r.age += dt;
    while (this.railShots.length && this.railShots[0].age > v.railTrail + 0.2) this.railShots.shift();
    const alive = u.alive;

    // Gun sides: rail cannons charge and fire; autocannon shells fly.
    this.sides.forEach((s, i) => {
      const side: 1 | -1 = i === 0 ? 1 : -1;
      const g = u.upper.guns[i];
      for (const mat of s.model?.glow ?? []) mat.opacity = s.kind === "rail" ? 0.25 + 0.75 * s.rail.charge : 0.9;
      if (s.model) s.model.recoil.position.z += (0 - s.model.recoil.position.z) * Math.min(1, dt * 8);
      if (s.kind !== "rail") { clearPaint(s.paint); return; }
      const st = this.railStats(s);
      const held = alive && trigger && g.enabled;
      if (held && !s.rail.holding && s.rail.cooldown <= 0 && !s.whined) { s.whined = true; bf.sfx.playSound("railCharge", u.sim.pelvis, 1, 1 / Math.max(0.3, st.charge)); }
      if (!held) s.whined = false;
      const fired = s.rail.update(dt, held, st);
      const muzzle = this.muzzleOf(s, side, this.tmp);
      const dir = u.body.barrel(side, this.dir);
      const flat = Math.hypot(dir.x, dir.z) || 1;
      // The preview: a thin beam along the gun out to range, thickening as it charges.
      const p = s.paint;
      if (s.rail.holding) {
        p.on = true; p.held += dt; p.charge = s.rail.charge; p.ready = s.rail.charge >= v.railMinCharge;
        p.tint = p.ready ? RAIL_GLOW : null;
        p.beamScale = 0.35 + 1.3 * s.rail.charge * s.rail.charge;
        const path = railPath(bf.field, muzzle, { x: dir.x / flat, z: dir.z / flat }, st.range, v);
        p.beamFrom = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
        const end = path[path.length - 1] ?? { x: muzzle.x + dir.x / flat * 4, y: muzzle.y, z: muzzle.z + dir.z / flat * 4 };
        p.beamTo = { ...end };
        p.strip = null; p.ring = null; p.arc.length = 0;
      } else clearPaint(p);
      if (fired !== null) this.fireRail(s, side, muzzle, dir, st, fired);
    });

    this.shells.update(dt, v.acGravity, bf.field, bf.targets, (sh, at, t) => this.cannonBurst(sh.team, at, t, sh.damage, sh.splash, sh.vel));

    // The back weapon: hold to paint, release to fire.
    const heavy = alive && u.heavy && !!this.back && !!u.cursor;
    const bp = this.backPaint;
    if (heavy) {
      const from = u.sim.pos, cur = u.cursor!;
      const launch = this.backMuzzle(0, this.tmp2);
      bp.on = true; bp.held += dt; bp.charge = 1;
      bp.beamFrom = { x: launch.x, y: launch.y, z: launch.z };
      bp.beamScale = 1;
      if (this.back === "salvo") {
        const st = this.salvoStats();
        this.strip = planStrip(from, cur, st.length, v, this.candidates());
        bp.strip = this.strip; bp.ring = null; bp.arc.length = 0;
        bp.ready = this.salvo.ready;
        bp.beamTo = { x: cur.x, y: bf.field.height(cur.x, cur.z) + 0.1, z: cur.z };
      } else {
        const st = this.mortarStats();
        const c = mortarAim(from, cur, u.lock ? { x: u.lock.x, z: u.lock.z, vx: u.lock.vx, vz: u.lock.vz } : null, v);
        this.ringAt = c;
        bp.ring = { x: c.x, z: c.z, r: v.mortarRing };
        bp.strip = null;
        bp.ready = this.mortar.ready;
        const to = { x: c.x, y: bf.field.height(c.x, c.z), z: c.z };
        const arc = lobArc(bf.field, launch, to, v.mortarArc, v.mortarClear);
        bp.arc.length = 0;
        for (let k = 1; k < 24; k++) bp.arc.push(lobPoint(launch, to, arc, k / 24, v3()));
        bp.beamTo = { ...to };
        void st;
      }
    } else if (this.heldBefore && alive && this.back) {
      // Released: fire at what was painted (if ready).
      if (this.back === "salvo" && this.strip) {
        if (this.salvo.fire(this.strip, this.salvoStats(), bf.field, ++this.salvoId)) { this.last.salvo = 0; this.onFire?.("salvo"); this.firedPaint.strip = { ...this.strip }; this.firedPaint.held = 0; }
      } else if (this.back === "mortar") {
        if (this.mortar.fire(this.ringAt.x, this.ringAt.z, this.mortarStats())) this.onFire?.("mortar");
      }
      clearPaint(bp);
    } else clearPaint(bp);
    this.heldBefore = heavy;

    // The strip a salvo was fired at stays painted (dimmer, no laser) until its last rocket lands.
    const fp = this.firedPaint;
    fp.on = this.salvo.flying && !!fp.strip;
    if (fp.on) { fp.held += dt; fp.ready = true; fp.charge = 0.6; fp.beamTo = fp.beamFrom; }

    // Rockets and mortar shells in flight.
    this.salvo.update(dt, (i, out) => { const m = this.backMuzzle(i, this.tmp2); out.x = m.x; out.y = m.y; out.z = m.z; }, (r) => {
      const at = this.tmp.set(r.pos.x, r.pos.y, r.pos.z);
      const dealt = this.blast(at, r.blast, r.damage, "salvo");
      this.last.salvo = (this.last.salvo ?? 0) + dealt;
    }, (r) => {
      bf.sfx.playSound("rocket", this.tmp.set(r.p0.x, r.p0.y, r.p0.z), 0.9, 0.9 + Math.random() * 0.2);
      for (let k = 0; k < 3; k++) bf.dust.smoke(r.p0.x, r.p0.y, r.p0.z, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.9, 0.7, 0.3);
      if (this.backModel) this.backModel.recoil.position.z = -0.06;
    });
    if (v.salvoSmoke > 0) for (const r of this.salvo.rockets) {
      if (!r.live || !r.launched) continue;
      const n = Math.max(1, Math.round(3 * v.salvoSmoke));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        bf.dust.smoke(r.prev.x + (r.pos.x - r.prev.x) * t, r.prev.y + (r.pos.y - r.prev.y) * t, r.prev.z + (r.pos.z - r.prev.z) * t,
          (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, 0.22 * v.salvoSmoke, 1.1 + Math.random() * 0.6, 0.55, 0.15);
      }
    }
    const mst = this.mortarStats();
    this.mortar.update(dt, (x, z) => {
      const from = this.backMuzzle(0, this.tmp2).clone();
      const to = { x, y: bf.field.height(x, z), z };
      const arc = lobArc(bf.field, from, to, v.mortarArc, v.mortarClear);
      bf.shells.lob(u.team, from, this.tmp.set(to.x, to.y, to.z), v.mortarFlight, arc, mst.blast, mst.damage);
      bf.sfx.playSound("mortar", from, 1);
      for (let k = 0; k < 6; k++) bf.dust.smoke(from.x, from.y + 0.3, from.z, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.4, 1.4, 0.75, 0.6);
      this.onShake?.(0.12);
      if (this.backModel) this.backModel.recoil.position.y = -0.25;
    });
    if (this.backModel) this.backModel.recoil.position.y += (0 - this.backModel.recoil.position.y) * Math.min(1, dt * 6);
    for (const mat of this.backModel?.glow ?? []) mat.opacity = (this.back === "salvo" ? this.salvo.ready : this.mortar.ready) ? 0.95 : 0.15;
  }

  /** A gun side of another class fired a round on its clock (the autocannon). */
  shot(side: 1 | -1) {
    const s = this.sides[side === 1 ? 0 : 1];
    if (s.kind !== "autocannon") return;
    const u = this.unit, v = this.v, st = this.cannonStats(s);
    const m = this.muzzleOf(s, side, new THREE.Vector3());
    const d = u.body.barrel(side, this.dir);
    const lock = u.lock;
    if (lock) {
      const lp = leadPoint(m, lock, { x: lock.vx ?? 0, y: 0, z: lock.vz ?? 0 }, st.speed, v.acGravity, v.acLead);
      d.set(lp.x - m.x, lp.y - m.y, lp.z - m.z).normalize();
    } else if (u.cursor) {
      // No lock: along the gun, pitched to come down on the cursor (with the drop).
      const c = u.cursor, flat = Math.hypot(c.x - m.x, c.z - m.z), hl = Math.hypot(d.x, d.z) || 1;
      const t = flat / st.speed, y = c.y + 1 + 0.5 * v.acGravity * t * t;
      d.set((d.x / hl) * flat, y - m.y, (d.z / hl) * flat).normalize();
    }
    const spread = (st.spread * Math.PI) / 180;
    const j = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.tan(spread) * Math.random());
    d.add(j.addScaledVector(d, -j.dot(d))).normalize();
    this.shells.fire(u.team, m, d, st);
    this.onFire?.("autocannon");
    this.bf.sfx.playSound("cannon", m, 1);
    this.bf.dust.smoke(m.x, m.y, m.z, d.x * 3, d.y * 3 + 0.5, d.z * 3, 0.3, 0.6, 0.6, 0.4);
    if (s.model) s.model.recoil.position.z = -0.3;
    this.onShake?.(0.04);
  }

  // ---- Effects ----

  private fireRail(s: Side, side: 1 | -1, muzzle: THREE.Vector3, dir: THREE.Vector3, st: RailStats, charge: number) {
    const bf = this.bf, u = this.unit, v = this.v;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const path = railPath(bf.field, muzzle, { x: dir.x / flat, z: dir.z / flat }, st.range, v);
    this.onFire?.("rail");
    const hits = railFire(path, bf.targets, u.team, st.damage * charge, v);
    const dealt = hits.reduce((a, h) => a + h.damage, 0);
    this.last.rail = dealt;
    this.events.push({ t: this.clock, kind: "rail", damage: dealt, x: muzzle.x, z: muzzle.z });
    this.railShots.push({ path, from: { x: muzzle.x, y: muzzle.y, z: muzzle.z }, age: 0, power: charge });
    // Sparks where it went through, dust kicked up all along its line, a flash at the end.
    for (const h of hits) bf.gunFx.sparksAt(h.at, this.tmp2.copy(dir).negate(), 10, 9);
    for (let k = 0; k < path.length; k += 2) {
      const p = path[k];
      if (bf.inWater(p.x, p.z)) { bf.water?.splash(p.x, p.z, 0.5, dir.x, dir.z, 0.8); continue; }
      bf.dust.kick(p.x, p.y - v.railHeight, p.z, dir.x / flat, dir.z / flat, 0.6 + charge * 0.6);
    }
    const end = path[path.length - 1];
    if (end) { bf.dust.hit(end.x, end.y - v.railHeight, end.z, dir.x / flat, dir.z / flat, 2.5); bf.marks.crater(end.x, end.z, 1.5); }
    bf.sfx.playSound("rail", muzzle, 0.6 + 0.4 * charge, 1.1 - 0.15 * charge);
    u.upper.guns[side === 1 ? 0 : 1].kick = v.railKick;
    u.upper.shake = Math.min(0.06, u.upper.shake + 0.04 * charge);
    if (s.model) s.model.recoil.position.z = -v.railKick * 1.5;
    this.onShake?.(v.railShake * charge);
  }

  /** An autocannon shell bursts: the target it struck takes the shell, everything near takes a share. */
  private cannonBurst(team: number, at: THREE.Vector3, t: import("../game/battlefield").Hittable | null, damage: number, splash: number, vel: THREE.Vector3) {
    const bf = this.bf, v = this.v;
    const d = this.dir.copy(vel).normalize();
    let dealt = 0;
    if (t) { t.damage(damage, at, d); dealt += damage; bf.gunFx.sparksAt(at, this.tmp2.copy(d).negate(), 8, 7); }
    if (splash > 0) for (const o of bf.targets) if (o !== t && o.alive && o.team !== team && o.splash) dealt += o.splash(at, splash, damage * v.acSplashShare, d) > 0 ? damage * v.acSplashShare * 0.75 : 0;
    if (!t && bf.inWater(at.x, at.z)) bf.water?.splash(at.x, at.z, 1, d.x, d.z, 1.2);
    else { bf.dust.hit(at.x, at.y, at.z, d.x, d.z, 1.8); if (!t) bf.marks.crater(at.x, at.z, 1.3); }
    for (let k = 0; k < 4; k++) bf.dust.smoke(at.x, at.y + 0.3, at.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.3, 0.8, 0.7, 0.75);
    bf.sfx.play("brap", at, 0.9, 0.8, true);
    this.events.push({ t: this.clock, kind: "autocannon", damage: dealt, x: at.x, z: at.z });
  }

  /** A rocket or shell's blast through the battlefield's blast (crater, dust, sound, splash damage). Returns damage dealt (roughly, for the HUD). */
  private blast(at: THREE.Vector3, radius: number, damage: number, kind: string): number {
    const bf = this.bf;
    const before = this.healthSum();
    // (The big boom and the shake come from the battlefield's onBlast, which the lab hears for every blast.)
    bf.blast(this.unit.team, at, radius, damage);
    const dealt = Math.max(0, before - this.healthSum());
    this.events.push({ t: this.clock, kind, damage: dealt, x: at.x, z: at.z });
    return dealt;
  }

  /** Sum of the health the battlefield's targets report (for damage readouts; targets without health count 0). */
  private healthSum() {
    let s = 0;
    for (const t of this.bf.targets) { const h = (t as unknown as { health?: number; hp?: number }); s += h.health ?? h.hp ?? 0; }
    return s;
  }

  private muzzleOf(s: Side, side: 1 | -1, out: THREE.Vector3) {
    return s.model?.muzzles[0] ? s.model.muzzles[0].getWorldPosition(out) : this.unit.body.muzzle(side, out);
  }

  /** Tube i of the back weapon (the rocket pod's grid, the mortar's one tube), or over the hull. */
  backMuzzle(i: number, out: THREE.Vector3) {
    const m = this.backModel?.muzzles;
    if (m?.length) return m[i % m.length].getWorldPosition(out);
    return out.copy(this.unit.sim.pelvis).setY(this.unit.sim.pelvis.y + 2);
  }

  /** One line for the HUD: what's fitted and its state. */
  hudText(): string {
    const parts: string[] = [];
    this.sides.forEach((s, i) => {
      if (!s.kind) return;
      const n = i === 0 ? "L" : "R";
      if (s.kind === "rail") parts.push(`${n} rail ${s.rail.cooldown > 0 ? `cooling ${s.rail.cooldown.toFixed(1)} s` : s.rail.holding ? `charge ${Math.round(s.rail.charge * 100)}%` : "ready (hold left)"}${this.last.rail !== undefined ? ` · last beam ${Math.round(this.last.rail)}` : ""}`);
      else parts.push(`${n} autocannon · shells in flight ${this.shells.list.filter((x) => x.live).length}`);
    });
    if (this.back === "salvo") parts.push(`salvo ${this.salvo.ready ? "ready (hold right)" : `reload ${this.salvo.cooldown.toFixed(1)} s`}${this.last.salvo !== undefined ? ` · last salvo ${Math.round(this.last.salvo)}` : ""}`);
    if (this.back === "mortar") parts.push(`mortar ${this.mortar.ready ? "ready (hold right)" : `reload ${this.mortar.cooldown.toFixed(1)} s`}`);
    return parts.join(" · ");
  }
}
