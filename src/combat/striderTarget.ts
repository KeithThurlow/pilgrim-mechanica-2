// The striders as one battlefield target (src/combat/strider.ts; Hittable in src/game/battlefield.ts) and one
// register owner. Hits by part, as the robots: a round stops on the first part it meets: the body (the spine and chest
// up to the head, and the disc head) takes it all, the legs' bones striderLegDamage, the feet striderFootDamage. A
// blast is measured to the nearest part and takes striderBlast of it (full at the part, half at the edge); a round's
// splash never hurts it. Host.
import * as THREE from "three/webgpu";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import { rayCapsule, capsuleNormal } from "../game/mechUnit";
import { KIND, FLAG, ObjectSerials, type Owner, type Register } from "../game/register";
import { STRIDER_FRAME, PART_BODY, PART_LEG, PART_FOOT, type Strider, type Striders } from "./strider";

interface Cap { a: THREE.Vector3; b: THREE.Vector3; r: number; part: number }
const CAPS = 9;

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
    // The disc head: a capsule across it, side to side.
    const h = s.head(A), rx = Math.cos(s.face) * F.headR * 0.62 * S, rz = -Math.sin(s.face) * F.headR * 0.62 * S;
    set(1, B.set(h.x - rx, h.y, h.z - rz), C.set(h.x + rx, h.y, h.z + rz), F.headR * 0.42 * S, PART_BODY);
    let k = 2;
    for (const f of sim.feet) {
      const p = f.pose;
      set(k++, A.copy(p.hip).multiplyScalar(S), B.copy(p.knee).multiplyScalar(S), 0.16 * S, PART_LEG);
      set(k++, A.copy(p.knee).multiplyScalar(S), B.copy(p.hock).multiplyScalar(S), 0.1 * S, PART_LEG);
      set(k++, A.copy(p.hock).multiplyScalar(S), B.copy(p.toe).multiplyScalar(S), 0.11 * S, PART_FOOT);
    }
    return c.slice(0, k);
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

  bars(out: BarEntry[]) {
    for (const s of this.pack.list) {
      if (!s.alive) continue;
      const h = s.head(A);
      out.push({ key: s, x: h.x, y: h.y + 2.5, z: h.z, hp: s.health, max: s.maxHealth, armour: this.armourOf(), width: 6, always: true });
    }
  }

  /** Into the register (the soft lock and the weapons): each standing strider at its chest, its legs' spread as reach. */
  publish(reg: Register) {
    const list = this.pack.list;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (!s.alive) continue;
      const S = s.S, c = s.up(1.5, A), v = s.vel(B);
      const height = (s.sim.v.hipHeight + STRIDER_FRAME.head) * S;
      reg.publishRef = this;
      reg.put(k, this.serials.serial(s, reg), KIND.Unit, this.team, FLAG.Hittable | FLAG.Detectable, c.x, c.y, c.z, STRIDER_FRAME.chestR * S * 1.2,
        S * 1.2, v.x, v.z, height * 0.75);
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
