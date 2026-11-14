// The shoulder strikes' glue (src/weapons/strikes.ts): turns a strike's events into damage on the battlefield and its
// look and sound. Damage is the host's (rule 12): splash blasts through the targets' own splash(), cold through the
// chills, the well's hold and the quake's stagger through Hittable.slow (released when they end). The effects are
// cosmetic: blast waves, novas, dust, flames and frost, ground marks and heat, night lights, camera shake, and the
// expanding rings the draw shows (src/weapons/strikesDraw.ts reads `rings`).
import * as THREE from "three/webgpu";
import type { Battlefield, Hittable } from "../game/battlefield";
import { splashBlast } from "../game/splash";
import { sheetHits } from "../game/sheetFire";
import type { Sheet, SheetHit } from "../game/sheet";
import { famOfTeam } from "../world/lamps";
import type { StrikeEvent, StrikeKind, StrikeSim, StrikeValues } from "./strikes";

/** An expanding ring on the sand (cosmetic): out to r over life s, in this colour. */
export interface StrikeRing { x: number; z: number; r: number; age: number; life: number; col: number; width: number }

/** Colours (the draw's too). */
export const STRIKE_COL = { quake: 0xffb060, orbital: 0xfff2d0, orbitalAim: 0xff3a2a, stasis: 0x9fe6ff, gravity: 0xb070ff, artillery: 0xff5a2a };

interface Held { target: Hittable; key: number; left: number }

export class StrikeFire {
  readonly rings: StrikeRing[] = [];
  /** Damage dealt by strikes (checks and the lab's readout). */
  dealt = 0;
  private held: Held[] = [];
  private buf: SheetHit<Hittable>[] = [];
  private seen = new Set<string>();
  /** A self strike's ring hits each body once (by target index and key), for this firing. */
  private struck = new Map<StrikeSim, Set<string>>();
  private at = new THREE.Vector3();
  private dir = new THREE.Vector3(0, -1, 0);
  private ro = new THREE.Vector3();
  private rd = new THREE.Vector3();

  constructor(private bf: Battlefield, private team: number, private v: StrikeValues & { freezeTime?: number },
    private shake: (k: number) => void) {}

  private gy(x: number, z: number) { return this.bf.field.height(x, z); }

  /** Everything of another team within R of (x, z): one sheet across the disc (as the fire pools find bodies). */
  private inside(x: number, z: number, R: number): SheetHit<Hittable>[] {
    const g = this.bf.field;
    const sheet: Sheet = { ox: x - R, oz: z, dx: 1, dz: 0, from: 0, len: 2 * R, half: R, under: 1,
      top: (t) => g.height(x - R + t, z) + 6, line: (t) => g.height(x - R + t, z) + 1.2, ground: (px, pz) => g.height(px, pz) };
    const found = sheetHits(this.bf.targets, this.team, sheet, null, this.buf, this.bf.register);
    this.seen.clear();
    const out: SheetHit<Hittable>[] = [];
    for (const h of found) {
      const dx = h.x - x, dz = h.z - z;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5) || !h.target.alive) continue;
      const tag = `${this.bf.targets.indexOf(h.target)}:${h.key}`;
      if (this.seen.has(tag)) continue;
      this.seen.add(tag);
      out.push(h);
    }
    return out;
  }
  /** Make this hit's key the one damage and slow act on. */
  private aim(h: SheetHit<Hittable>) {
    if (h.ray) { this.ro.set(h.ray.ox, h.ray.oy, h.ray.oz); this.rd.set(h.ray.dx, h.ray.dy, h.ray.dz); h.target.hitRay(this.ro, this.rd, h.ray.dist + 1e-3); }
    else h.target.pick?.(h.key);
  }
  /** Hold a body at this pace for `time` s (a longer hold already on it wins). */
  private hold(h: SheetHit<Hittable>, pace: number, time: number) {
    if (!h.target.slow) return;
    h.target.slow(h.key, pace);
    const o = this.held.find((x) => x.target === h.target && x.key === h.key);
    if (o) o.left = Math.max(o.left, time); else this.held.push({ target: h.target, key: h.key, left: time });
  }
  private releaseAll() {
    for (const o of this.held) if (o.target.alive) o.target.slow?.(o.key, 1);
    this.held.length = 0;
  }

  private ring(x: number, z: number, r: number, life: number, col: number, width = 1.2) {
    if (this.rings.length > 48) this.rings.shift();
    this.rings.push({ x, z, r, age: 0, life, col, width });
  }
  private splash(x: number, y: number, z: number, r: number, dmg: number, ap: number) {
    if (dmg <= 0) return;
    this.dealt += dmg;
    splashBlast(this.bf.targets, this.team, this.at.set(x, y, z), r, dmg, this.dir, null, ap);
  }
  private sound(name: string, x: number, y: number, z: number, vol: number, rate = 1, delay = 0) {
    this.bf.sfx.playSound(name, this.at.set(x, y, z), vol * this.v.strikeLevel, rate, delay);
  }
  private shakeK(k: number) { this.shake(k * this.v.strikeShake); }

  /** A ring of dust thrown out along the sand at radius r (cosmetic). */
  private dustRing(x: number, z: number, r: number, n: number, out: number, up: number, size: number) {
    const dust = this.bf.dust;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, cx = Math.cos(a), cz = Math.sin(a);
      const px = x + cx * r, pz = z + cz * r;
      dust.emit(1, px, this.gy(px, pz) + 0.2, pz, cx * out * (0.7 + Math.random() * 0.6), up * (0.5 + Math.random()), cz * out * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), 1.5 + Math.random() * 1.5, 0.85);
    }
  }

  /** Step the held bodies and the cosmetic rings. */
  update(dt: number) {
    let keep = 0;
    for (const o of this.held) {
      o.left -= dt;
      if (o.left > 0 && o.target.alive) this.held[keep++] = o;
      else if (o.target.alive) o.target.slow?.(o.key, 1);
    }
    this.held.length = keep;
    keep = 0;
    for (const r of this.rings) if ((r.age += dt) < r.life) this.rings[keep++] = r;
    this.rings.length = keep;
  }

  /** A strike's event: from = where the shoulder is (the orb and the flare leave from it). */
  play(sim: StrikeSim, e: StrikeEvent, from: THREE.Vector3) {
    const kind: StrikeKind = sim.kind, s = sim.stats, v = this.v, bf = this.bf, fam = famOfTeam(this.team);
    const gy = this.gy(e.x, e.z);
    switch (kind) {
      case "quake": {
        if (e.type === "start") { this.sound("strikeCharge", e.x, gy, e.z, 0.7, 2.2); this.struck.set(sim, new Set()); }
        else if (e.type === "ring") {
          const first = e.i === 0;
          this.splash(e.x, gy + 0.6, e.z, e.r, s.damage, s.ap);
          bf.waves.post("mortar", e.x, gy + 0.5, e.z, e.r * 0.55, { ground: true, fam });
          this.ring(e.x, e.z, e.r, 0.45, STRIKE_COL.quake, 1.6 + e.r * 0.06);
          this.dustRing(e.x, e.z, e.r * 0.85, Math.round(26 + e.r * 2), 7, 3, 1.4);
          bf.nightLights?.flash(e.x, gy + 1, e.z, e.r * 0.6, fam);
          if (first) {
            bf.dust.stomp(e.x, gy, e.z, 6);
            bf.marks.blast(e.x, e.z, Math.min(8, s.radius * 0.35));
            this.sound("quakeSlam", e.x, gy, e.z, 1.4, 1);
            this.sound("blastBoom", e.x, gy, e.z, 1.2, 0.7);
          } else this.sound("blastBoom", e.x, gy, e.z, 0.7, 0.8 + e.i * 0.1);
          this.shakeK(v.quakeShake * (first ? 1 : 0.5));
        } else if (e.type === "final") {
          // Everything left standing in reach staggers.
          for (const h of this.inside(e.x, e.z, s.radius)) { this.aim(h); this.hold(h, v.quakeStunPace, v.quakeStun); }
        }
        return;
      }
      case "stasis": {
        if (e.type === "start") {
          this.sound("strikeCharge", e.x, gy, e.z, 0.6, 1.5);
          this.struck.set(sim, new Set());
          for (let k = 0; k < 10; k++) bf.flames.mist(from.x + (Math.random() - 0.5) * 2, from.y, from.z + (Math.random() - 0.5) * 2, 1);
        } else if (e.type === "ring") {
          if (e.i === 0) { this.sound("stasisBurst", e.x, gy, e.z, 1.3, 1); this.shakeK(0.35); }
          bf.waves.post("beam", e.x, gy + 0.5, e.z, e.r * 0.5, { ground: true, fam });
          this.ring(e.x, e.z, e.r, 0.5, STRIKE_COL.stasis, 1.4 + e.r * 0.05);
          const n = Math.round(18 + e.r * 1.6);
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2, px = e.x + Math.cos(a) * e.r, pz = e.z + Math.sin(a) * e.r;
            bf.flames.mist(px, this.gy(px, pz) + 0.4 + Math.random(), pz, 1.2);
          }
          bf.flames.frost(e.x, gy + 1, e.z, e.r * 0.6, 1);
          const seen = this.struck.get(sim) ?? new Set<string>();
          for (const h of this.inside(e.x, e.z, e.r)) {
            const tag = `${bf.targets.indexOf(h.target)}:${h.key}`;
            if (seen.has(tag)) continue;
            seen.add(tag);
            this.aim(h);
            if (s.damage > 0) { h.target.damage(s.damage, this.at.set(h.x, h.y, h.z), this.dir.set(h.x - e.x, 0, h.z - e.z).normalize()); this.dealt += s.damage; }
            if (h.target.alive) bf.chills.hit(h.target, h.key, v.stasisChill, v.stasisColdDps, h.x, h.y, h.z, h.x - e.x, h.z - e.z);
          }
          this.dir.set(0, -1, 0);
        }
        return;
      }
      case "orbital": {
        if (e.type === "start") this.sound("strikeCharge", e.x, gy, e.z, 0.8, 0.9);
        else if (e.type === "live") {
          this.sound("orbitalBeam", e.x, gy, e.z, 1.3, 1);
          this.sound("blastBoom", e.x, gy, e.z, 0.9, 1.3);
          bf.waves.post("beam", e.x, gy + 0.5, e.z, s.radius, { ground: true, fam });
          this.ring(e.x, e.z, s.radius * 2, 0.4, STRIKE_COL.orbital, 1.4);
          this.shakeK(0.35);
        } else if (e.type === "tick") {
          this.splash(e.x, gy + 0.6, e.z, s.radius, s.damage, s.ap);
          // What the beam touches burns on.
          for (const h of this.inside(e.x, e.z, s.radius)) bf.burns.ignite(h.target, h.key, 2, 25, h.x, h.y, h.z);
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2, r = s.radius * 0.6 * Math.sqrt(Math.random());
            bf.flames.lick(e.x + Math.cos(a) * r, gy + 0.3 + Math.random(), e.z + Math.sin(a) * r, 1.5 + Math.random(), 1);
          }
          bf.flames.ember(e.x, gy + 0.5, e.z);
          bf.heat?.spot(e.x, e.z, s.radius * 0.6, 0.8);
          this.dustRing(e.x, e.z, s.radius * 0.5, 6, 6, 4, 1.1);
          bf.nightLights?.flash(e.x, gy + 2, e.z, s.radius * 0.8, fam);
          this.shakeK(0.06);
        } else if (e.type === "final") {
          if (s.finalDamage > 0) { bf.blast(this.team, this.at.set(e.x, gy + 0.5, e.z), s.finalRadius, s.finalDamage, s.ap, "mortar"); this.dealt += s.finalDamage; }
          bf.novas.post(e.x, gy + 3, e.z, gy, s.finalRadius, 1.3, 1.2, 0.6);
          this.ring(e.x, e.z, s.finalRadius * 1.3, 0.6, STRIKE_COL.orbital, 2.2);
          this.sound("blastBoom", e.x, gy, e.z, 1.6, 0.6);
          this.shakeK(1.1);
        }
        return;
      }
      case "gravity": {
        if (e.type === "start") this.sound("rocket", from.x, from.y, from.z, 0.8, 0.55);
        else if (e.type === "live") {
          this.sound("gravityHum", e.x, gy, e.z, 1.2, 1);
          bf.waves.post("beam", e.x, gy + 2, e.z, s.radius * 0.5, { ground: false, fam });
          this.ring(e.x, e.z, s.radius, 0.5, STRIKE_COL.gravity, 1.2);
          this.shakeK(0.3);
        } else if (e.type === "tick") {
          for (const h of this.inside(e.x, e.z, s.radius)) {
            this.aim(h);
            const d = s.damage * e.dt;
            if (d > 0) { h.target.damage(d, this.at.set(h.x, h.y, h.z), this.dir.set(e.x - h.x, 0, e.z - h.z).normalize()); this.dealt += d; }
            if (h.target.alive) this.hold(h, v.gravityHold, e.dt * 1.6);
          }
          this.dir.set(0, -1, 0);
          // Sand pulled in off the rim, an inward ring now and then.
          const dust = bf.dust;
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2, r = s.radius * (0.7 + Math.random() * 0.4), cx = Math.cos(a), cz = Math.sin(a);
            const px = e.x + cx * r, pz = e.z + cz * r;
            dust.emit(1, px, this.gy(px, pz) + 0.3, pz, -cx * r * 1.6, 1.5 + Math.random() * 2, -cz * r * 1.6, 0.6 + Math.random() * 0.6, 0.6, 0.8);
          }
          bf.nightLights?.flash(e.x, gy + 2.5, e.z, 3, fam);
          this.shakeK(0.04);
        } else if (e.type === "final") {
          this.releaseAll();
          if (s.finalDamage > 0) { bf.blast(this.team, this.at.set(e.x, gy + 0.5, e.z), s.finalRadius, s.finalDamage, s.ap, "mortar"); this.dealt += s.finalDamage; }
          bf.novas.post(e.x, gy + 2.5, e.z, gy, s.finalRadius, 1.1, 0.8, 0.4);
          this.ring(e.x, e.z, s.finalRadius * 1.2, 0.5, STRIKE_COL.gravity, 2);
          this.sound("blastBoom", e.x, gy, e.z, 1.5, 0.75);
          this.shakeK(0.9);
        }
        return;
      }
      default: { // artillery
        if (e.type === "start") {
          this.sound("beacon", from.x, from.y, from.z, 0.9, 1);
          this.sound("rocket", from.x, from.y, from.z, 0.6, 1.4);
          for (let k = 0; k < 10; k++) bf.dust.smoke(e.x, gy + 0.3, e.z, (Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5), 0.8, 3, 0.6, 0.2);
          bf.flames.lick(e.x, gy + 0.4, e.z, 1.2, 1);
        } else if (e.type === "live") this.sound("shellWhistle", e.x, gy, e.z, 0.9, 0.9);
        else if (e.type === "shell") {
          const sy = this.gy(e.x, e.z);
          // From high overhead, a little off to one side, so the telegraph ring and the shell's fall read.
          const sh = bf.lob(this.team, this.at.set(e.x + 6, sy + 60, e.z - 4), e.x, e.z, v.artilleryFlight, 2, s.finalRadius, s.damage);
          sh.pierce = s.ap;
          this.dealt += s.damage;
          if (Math.random() < 0.35) this.sound("shellWhistle", e.x, sy, e.z, 0.5, 1 + Math.random() * 0.3);
        }
        return;
      }
    }
  }

  /** Fitted strikes all stopped (refit, death): let go of what they hold. */
  stopAll() { this.releaseAll(); this.struck.clear(); }
}
