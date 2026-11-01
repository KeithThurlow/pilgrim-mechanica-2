// The crushers as one battlefield target (src/combat/crusher.ts; Hittable in src/game/battlefield.ts) and one register
// owner, as the striders (src/combat/striderTarget.ts). A round stops on the first part it meets: the shell takes it
// all, the legs crusherLegDamage, the maw crusherMawDamage while it's open (spinning; its weak spot) and the full hit
// when shut. A blast is measured to the nearest part and takes crusherBlast of it; a round's splash never hurts it. Host.
import * as THREE from "three/webgpu";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import type { BarEntry } from "../ui/healthBars";
import { armourHit } from "../game/armour";
import { rayCapsule, capsuleNormal } from "../game/mechUnit";
import { KIND, FLAG, ObjectSerials, type Owner, type Register } from "../game/register";
import { CRUSHER_FRAME, PART_BODY, PART_LEG, PART_MAW, type Crusher, type Crushers } from "./crusher";
import type { V3 } from "./robotLegs";

interface Cap { a: THREE.Vector3; b: THREE.Vector3; r: number; part: number }
const CAPS = 11;

export class CrusherTarget implements Hittable, Owner {
  readonly team: number;
  readonly surface: HitSurface = "metal";
  readonly name = "crushers";
  /** Hits by part since construction: shell, leg, maw. */
  readonly partHits = [0, 0, 0];
  private caps: Cap[] = Array.from({ length: CAPS }, () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, part: 0 }));
  private last: Crusher | null = null;
  private lastCap: Cap = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, part: 0 };
  private serials = new ObjectSerials();

  constructor(readonly pack: Crushers, team = 3) { this.team = team; }

  get alive() { return this.pack.alive > 0; }

  /** A crusher's hit capsules (world). */
  private capsules(c: Crusher): Cap[] {
    const W = c.W, caps = this.caps, s = Math.sin(c.heading), co = Math.cos(c.heading);
    const set = (k: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, part: number) => {
      caps[k].a.set(ax, ay, az); caps[k].b.set(bx, by, bz); caps[k].r = r; caps[k].part = part;
    };
    const y = c.bodyY + 0.03 * W;
    // The shell: a capsule across it and one along it.
    const rx = co * 0.3 * W, rz = -s * 0.3 * W, fx = s * 0.16 * W, fz = co * 0.16 * W;
    set(0, c.x - rx, y, c.z - rz, c.x + rx, y, c.z + rz, 0.2 * W, PART_BODY);
    set(1, c.x - fx, y, c.z - fz, c.x + fx, y, c.z + fz, 0.22 * W, PART_BODY);
    // The maw: a ball at its face.
    const m = c.maw(MW);
    set(2, m.x, m.y, m.z, m.x, m.y, m.z, CRUSHER_FRAME.mawR * 1.15 * W, PART_MAW);
    let k = 3;
    for (let l = 0; l < 4; l++) {
      c.leg(l, HIP, KNEE, TIP, FOOT);
      set(k++, HIP.x, HIP.y, HIP.z, KNEE.x, KNEE.y, KNEE.z, 0.09 * W, PART_LEG);
      set(k++, KNEE.x, KNEE.y, KNEE.z, FOOT.x, FOOT.y, FOOT.z, 0.065 * W, PART_LEG);
    }
    return caps.slice(0, k);
  }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = -1;
    for (const c of this.pack.list) {
      if (!c.alive) continue;
      const m = A.set(c.x, c.bodyY, c.z), r = c.W * 1.6 + c.H;
      const t = Math.max(0, B.subVectors(m, o).dot(d));
      if (B.copy(o).addScaledVector(d, Math.min(t, maxDist)).distanceTo(m) > r) continue;
      for (const cap of this.capsules(c)) {
        const hit = rayCapsule(o, d, cap.a, cap.b, cap.r, best >= 0 ? best : maxDist);
        if (hit >= 0 && (best < 0 || hit < best)) {
          best = hit;
          this.last = c;
          this.lastCap.a.copy(cap.a); this.lastCap.b.copy(cap.b); this.lastCap.r = cap.r; this.lastCap.part = cap.part;
        }
      }
    }
    return best;
  }

  armourOf() { return this.pack.v.crusherArmour; }

  damage(amount: number, _at: THREE.Vector3, _dir: THREE.Vector3, pierce?: number) {
    const c = this.last;
    if (!c || !c.alive) return;
    const part = this.lastCap.part;
    this.partHits[part]++;
    this.pack.hit(c, armourHit(amount * c.partShare(part), this.armourOf(), pierce));
  }

  normalAt(at: THREE.Vector3, out: THREE.Vector3) { return capsuleNormal(at, this.lastCap.a, this.lastCap.b, out); }

  splash(at: THREE.Vector3, radius: number, damage: number, _dir: THREE.Vector3, o?: SplashOpts): number {
    if (!o?.blast) return 0;
    let n = 0;
    for (const c of this.pack.list) {
      if (!c.alive) continue;
      let near = Infinity, part = PART_BODY;
      for (const cap of this.capsules(c)) {
        const d = segDist(at, cap.a, cap.b) - cap.r;
        if (d < near) { near = d; part = cap.part; }
      }
      if (near > radius) continue;
      if (o.cover?.(c.x, c.bodyY, c.z) && near > 1.5) continue;
      const share = 1 - 0.5 * Math.max(0, near) / Math.max(0.1, radius);
      this.pack.hit(c, armourHit(damage * share * c.partShare(part) * this.pack.v.crusherBlast, this.armourOf(), o.pierce));
      n++;
    }
    return n;
  }

  bars(out: BarEntry[]) {
    for (const c of this.pack.list) {
      if (!c.alive) continue;
      out.push({ key: c, x: c.x, y: c.bodyY + c.W * 0.5 + 1.5, z: c.z, hp: c.health, max: c.maxHealth, armour: this.armourOf(), width: 5, always: true });
    }
  }

  /** Into the register (the soft lock and the weapons): each standing crusher at its shell, its stance as reach. */
  publish(reg: Register) {
    const list = this.pack.list;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (!c.alive) continue;
      reg.publishRef = this;
      reg.put(k, this.serials.serial(c, reg), KIND.Unit, this.team, FLAG.Hittable | FLAG.Detectable, c.x, c.bodyY, c.z, c.W * 0.45,
        c.W * 0.6, c.vx, c.vz, c.H + c.W * 0.25);
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

const A = new THREE.Vector3(), B = new THREE.Vector3();
const MW: V3 = { x: 0, y: 0, z: 0 }, HIP: V3 = { x: 0, y: 0, z: 0 }, KNEE: V3 = { x: 0, y: 0, z: 0 }, TIP: V3 = { x: 0, y: 0, z: 0 }, FOOT: V3 = { x: 0, y: 0, z: 0 };
