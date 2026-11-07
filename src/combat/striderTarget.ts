// The striders as one battlefield target (src/combat/strider.ts; Hittable in src/game/battlefield.ts) and one
// register owner. Hits by part, as the robots: a round stops on the first part it meets: the body (the spine and chest
// up to the head, and the disc head) takes it all, the legs' bones striderLegDamage, the feet striderFootDamage. A
// blast is measured to the nearest part and takes striderBlast of it (full at the part, half at the edge); a round's
// splash never hurts it. Host.
import * as THREE from "three/webgpu";
import type { Hittable, SplashOpts } from "../game/battlefield";
import { inBand, sheetCircle, sheetSegment, type Sheet, type SheetHit } from "../game/sheet";
import type { HitSurface } from "../fx/minigun";
import { HeavyPack } from "../ecs/heavy";
import type { World } from "../ecs/world";
import { armourHit } from "../game/armour";
import { rayCapsule, capsuleNormal } from "../game/mechUnit";
import { KIND, FLAG, ObjectSerials, type Owner, type Register } from "../game/register";
import { STRIDER_FRAME, PART_BODY, PART_LEG, PART_FOOT, type Strider, type Striders } from "./strider";

interface Cap { a: THREE.Vector3; b: THREE.Vector3; r: number; part: number }
const CAPS = 11;

export class StriderTarget implements Hittable, Owner {
  readonly team: number;
  readonly surface: HitSurface = "metal";
  readonly name = "striders";
  /** Hits by part since construction: body, leg, foot. */
  readonly partHits = [0, 0, 0];
  private caps: Cap[] = Array.from({ length: CAPS }, () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, part: 0 }));
  private last: { s: Strider | null; cap: Cap } = { s: null, cap: this.caps[0] };
  private lastCap: Cap = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, part: 0 };
  private serials = new ObjectSerials();

  constructor(readonly pack: Striders, team = 3) { this.team = team; }

  get alive() { return this.pack.alive > 0; }

  /** A strider's hit capsules (world), in this.caps. */
  private capsules(s: Strider): Cap[] {
    const F = STRIDER_FRAME, S = s.S, sim = s.sim, c = this.caps;
    const set = (k: number, a: THREE.Vector3, b: THREE.Vector3, r: number, part: number) => { c[k].a.copy(a); c[k].b.copy(b); c[k].r = r; c[k].part = part; };
    s.up(F.waist, c[0].a); s.up(F.chestTop, c[0].b); c[0].r = F.chestR * 1.05 * S; c[0].part = PART_BODY;
    // The hull disc: two flat capsules crossing it, side to side and front to back.
    const h = s.head(A), rx = Math.cos(s.face) * F.headR * 0.75 * S, rz = -Math.sin(s.face) * F.headR * 0.75 * S, r = F.headR * 0.28 * S;
    set(1, B.set(h.x - rx, h.y, h.z - rz), C.set(h.x + rx, h.y, h.z + rz), r, PART_BODY);
    set(10, B.set(h.x + rz, h.y, h.z - rx), C.set(h.x - rz, h.y, h.z + rx), r, PART_BODY);
    // The long arms: shoulder to hand, a limb's share.
    set(2, s.shoulder(1, A), s.hand(1, B), 0.12 * S, PART_LEG);
    set(3, s.shoulder(-1, A), s.hand(-1, B), 0.12 * S, PART_LEG);
    let k = 4;
    for (const f of sim.feet) {
      const p = f.pose;
      set(k++, A.copy(p.hip).multiplyScalar(S), B.copy(p.knee).multiplyScalar(S), 0.16 * S, PART_LEG);
      set(k++, A.copy(p.knee).multiplyScalar(S), B.copy(p.hock).multiplyScalar(S), 0.1 * S, PART_LEG);
      set(k++, A.copy(p.hock).multiplyScalar(S), B.copy(p.foot).multiplyScalar(S), 0.11 * S, PART_FOOT);
    }
    return c.slice(0, 11);
  }

  /**
   * Sheet hits (src/game/sheet.ts), as the robots (Keith 2026-11-01: "I just can't seem to hit it very well with the
   * miniguns"): the generic fan of 15 rays spaced the sheet's half-width across and ~4 m up slipped between its thin
   * legs and under or over its disc. One hit per strider: its body when the line crosses the disc's footprint (the hull
   * hangs over the spine), else the nearest limb bone the line passes within its radius + the sheet's half-width.
   * Key: strider index × 16 + capsule.
   */
  sheet(s: Sheet, out: SheetHit<Hittable>[]) {
    const list = this.pack.list, F = STRIDER_FRAME;
    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (!st.alive) continue;
      const S = st.S, m = st.up(0, A);
      // Quick reject: the legs' and arms' reach round the pelvis.
      const reach = (st.sim.v.hipHeight + 1) * S, qx = m.x - s.ox, qz = m.z - s.oz, c = qx * s.dx + qz * s.dz;
      if (Math.abs(qx * s.dz - qz * s.dx) > reach + s.half || c < s.from - reach || c > s.len + reach) continue;
      const caps = this.capsules(st);
      // The body: the disc's footprint, standing from the waist to the disc's top.
      const h = caps[1], hx = (h.a.x + h.b.x) / 2, hz = (h.a.z + h.b.z) / 2, hy = (h.a.y + h.b.y) / 2;
      const b = sheetCircle(s, hx, hz, F.headR * S);
      if (b && inBand(s, b.along, s.ox + s.dx * b.along, s.oz + s.dz * b.along, caps[0].a.y, hy + F.headH * S)) {
        out.push({ target: this, key: i * 16 + 1, along: b.along, chord: b.chord, material: "excavator", x: s.ox + s.dx * b.along, y: hy, z: s.oz + s.dz * b.along });
        continue;
      }
      // The limbs: the nearest bone the line crosses.
      let best: SheetHit<Hittable> | null = null;
      for (let k = 2; k < 10; k++) {
        const cp = caps[k], q = sheetSegment(s, cp.a.x, cp.a.y, cp.a.z, cp.b.x, cp.b.y, cp.b.z);
        if (!q) continue;
        const R = cp.r + s.half;
        if (q.across > R) continue;
        const px = s.ox + s.dx * q.along, pz = s.oz + s.dz * q.along;
        if (!inBand(s, q.along, px, pz, q.y - cp.r, q.y + cp.r)) continue;
        if (best && best.along <= q.along) continue;
        const chord = Math.max(0.2 * cp.r, 2 * Math.sqrt(R * R - q.across * q.across) * (cp.r / R));
        best = { target: this, key: i * 16 + k, along: Math.max(s.from, q.along - chord / 2), chord, material: "excavator", x: px, y: q.y, z: pz };
      }
      if (best) out.push(best);
    }
  }

  /** A sheet hit's strider and capsule, for the damage that follows. */
  pick(key: number) {
    const s = this.pack.list[key >> 4];
    if (!s) { this.last.s = null; return; }
    const c = this.capsules(s)[key & 15];
    this.last.s = s;
    this.lastCap.a.copy(c.a); this.lastCap.b.copy(c.b); this.lastCap.r = c.r; this.lastCap.part = c.part;
    this.last.cap = this.lastCap;
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = -1;
    for (const s of this.pack.list) {
      if (!s.alive) continue;
      // Cheap reject: the ray's closest pass to the strider's middle.
      const m = s.up(1, A), r = (s.sim.v.hipHeight + STRIDER_FRAME.head) * s.S;
      const t = Math.max(0, B.subVectors(m, o).dot(d));
      if (B.copy(o).addScaledVector(d, Math.min(t, maxDist)).distanceTo(m) > r) continue;
      for (const c of this.capsules(s)) {
        const hit = rayCapsule(o, d, c.a, c.b, c.r, best >= 0 ? best : maxDist);
        if (hit >= 0 && (best < 0 || hit < best)) {
          best = hit;
          this.last.s = s;
          this.lastCap.a.copy(c.a); this.lastCap.b.copy(c.b); this.lastCap.r = c.r; this.lastCap.part = c.part;
          this.last.cap = this.lastCap;
        }
      }
    }
    return best;
  }

  armourOf() { return this.pack.v.striderArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const s = this.last.s;
    if (!s || !s.alive) return;
    const part = this.last.cap.part;
    this.partHits[part]++;
    this.pack.hit(s, armourHit(amount * s.partShare(part), this.armourOf(), pierce));
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.last.cap.a, this.last.cap.b, out); }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    if (!o?.blast) return 0;
    let n = 0;
    for (const s of this.pack.list) {
      if (!s.alive) continue;
      let near = Infinity, part = PART_BODY;
      for (const c of this.capsules(s)) {
        const d = segDist(at, c.a, c.b) - c.r;
        if (d < near) { near = d; part = c.part; }
      }
      if (near > radius) continue;
      const m = s.up(1, A);
      if (o.cover?.(m.x, m.y, m.z) && near > 1.5) continue;
      const share = 1 - 0.5 * Math.max(0, near) / Math.max(0.1, radius);
      this.pack.hit(s, armourHit(damage * share * s.partShare(part) * this.pack.v.striderBlast, this.armourOf(), o.pierce));
      n++;
    }
    return n;
  }

  /** The striders as entities in the host world (src/ecs/heavy.ts, stage 5c): Transform at the disc (its head),
   *  Health, Team, Collider (as the register measures them), Armour and an always-on health bar over the disc. */
  readonly heavies = new HeavyPack<Strider>(KIND.Unit, { width: 6, lift: 2.5, always: true });
  syncWorld(world: World) {
    this.heavies.sync(world, this.pack.list, (s) => s.alive, (s, st) => {
      const h = s.head(A), S = s.S;
      st.x = h.x; st.y = h.y; st.z = h.z; st.heading = s.sim.heading;
      st.hp = s.health; st.max = s.maxHealth; st.team = this.team; st.armour = this.armourOf();
      st.radius = STRIDER_FRAME.headR * S * 0.8; st.reach = S * 1.6; st.height = (s.sim.v.hipHeight + STRIDER_FRAME.head) * S * 0.75;
    });
  }
  leaveWorld() { this.heavies.leave(); }

  /** Into the register (the soft lock and the weapons): each standing strider at its disc (the guns' centre mass), the disc's footprint as its body, its legs' spread as reach. */
  publish(reg: Register) {
    const list = this.pack.list;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (!s.alive) continue;
      const S = s.S, c = s.head(A), v = s.vel(B);
      const height = (s.sim.v.hipHeight + STRIDER_FRAME.head) * S;
      reg.publishRef = this;
      reg.put(k, this.serials.serial(s, reg), KIND.Unit, this.team, FLAG.Hittable | FLAG.Detectable, c.x, c.y, c.z, STRIDER_FRAME.headR * S * 0.8,
        S * 1.6, v.x, v.z, height * 0.75);
    }
    reg.publishRef = null;
  }
}

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2));
  const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y, z = a.z + abz * t - p.z;
  return Math.sqrt(x * x + y * y + z * z);
}

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
