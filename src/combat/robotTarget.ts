// The robot swarm as one target for the battlefield: rounds test every robot's body through the swarm's spatial
// hit test (hubs, medium and big chassis, walkers' legs and feet), the nearest part hit stops the round (steel: rounds
// spark off it there) and its robot takes the damage scaled by the part (Keith 2026-10-26: the body full, legs a
// share, feet less; robotLegDamage, robotFootDamage). Small ones are light (rounds carry on through, splash hurts them
// fully); medium and big ones stop rounds; medium ones take a share of splash, big ones none.
// It is also the swarm's owner in the register (src/game/register.ts): once added (bf.register.add(target)) every hit
// test here (rounds, sheets, splash) tests only the robots the register's grid hands back, not the whole swarm.
import * as THREE from "three/webgpu";
import type { Hittable } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { DOWN, DEAD, SMALL, MID, BIG, RUN, FIRE, PART_BODY, PART_LEG, PART_FOOT, type RobotSwarm } from "./robots";
import { BIG_BODY_H, MID_BODY_H, WALK_LEGS, type V3 } from "./robotLegs";
import { inBand, sheetCircle, sheetSegment, type PenMaterial, type Sheet, type SheetHit } from "../game/sheet";
import { SwarmCull, type Owner, type Register } from "../game/register";

export class RobotTarget implements Hittable, Owner {
  readonly name = "robots";
  readonly surface: HitSurface = "metal";
  alive = true;
  kills = 0;
  /** Rounds that landed on each part since construction (body, leg, foot), for HUDs and checks. */
  readonly partHits = [0, 0, 0];
  private last = -1;
  private lastPart = PART_BODY;
  /** The register's candidates for each hit test (null until added to a register: every robot is tested). */
  readonly cull = new SwarmCull();

  constructor(private swarm: RobotSwarm, readonly team: number) {}

  publish(reg: Register) { this.swarm.publish(reg, this.team); }
  attach(reg: Register, owner: number) { this.cull.attach(reg, owner); }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const only = this.cull.segment(o.x, o.z, d.x, d.y, d.z, maxDist);
    const h = only && only.length === 0 ? null : this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist, only);
    this.last = h ? h.index : -1;
    this.lastPart = h ? h.part : PART_BODY;
    return h ? h.dist : -1;
  }

  /** A sheet hit's key: robot index × 4 + part. */
  pick(key: number) { this.last = key >> 2; this.lastPart = key & 3; }

  private hp: V3 = { x: 0, y: 0, z: 0 }; private kn: V3 = { x: 0, y: 0, z: 0 };
  private tp: V3 = { x: 0, y: 0, z: 0 }; private ft: V3 = { x: 0, y: 0, z: 0 }; private lw: V3 = { x: 0, y: 0, z: 0 };

  /**
   * Sheet hits (src/game/sheet.ts): one hit per robot. Its body when the line crosses its body's footprint (the hit
   * ellipsoid's mean radius) and the body reaches into the band; else the nearest leg bone the line crosses (a walker's
   * boom and stick or thigh and shin; bucket or the shin's low quarter as its foot). Small ones are scrappers, medium
   * cutters, big excavators for penetration.
   */
  sheet(s: Sheet, out: SheetHit<Hittable>[]) {
    const sw = this.swarm, k = sw.v.robotHitScale;
    const only = this.cull.line(s.ox, s.oz, s.dx, s.dz, s.from, s.len, s.half);
    for (let j = 0, n = only ? only.length : sw.hi; j < n; j++) {
      const i = only ? only[j] : j;
      const st = sw.state[i];
      if (st >= DEAD) continue;
      const S = sw.size[i], kind = sw.kind[i];
      const material: PenMaterial = kind === SMALL ? "scrapper" : kind === MID ? "cutter" : "excavator";
      // Quick reject: the whole robot's reach round its centre.
      const reach = kind === SMALL ? S : sw.heightOf(i) * 1.3 + S;
      const qx = sw.px[i] - s.ox, qz = sw.pz[i] - s.oz, c = qx * s.dx + qz * s.dz;
      if (Math.abs(qx * s.dz - qz * s.dx) > reach + s.half || c < s.from - reach || c > s.len + reach) continue;
      // The body.
      let r: number, y0: number, y1: number, cy: number;
      if (kind === SMALL) {
        const flat = st === RUN || st === FIRE || st === DOWN;
        r = S * (flat ? 0.45 : 0.34) * k; const hh = S * (flat ? 0.22 : 0.34) * k;
        cy = sw.hubY[i]; y0 = cy - hh; y1 = cy + hh;
      } else {
        const big = kind === BIG;
        r = S * (big ? 0.5 : 0.44) * k; const hh = S * (big ? BIG_BODY_H * 0.75 : MID_BODY_H) * k;
        cy = sw.hubY[i] + S * 0.05; y0 = cy - hh; y1 = cy + hh;
      }
      const b = sheetCircle(s, sw.px[i], sw.pz[i], r);
      if (b && inBand(s, b.along, s.ox + s.dx * b.along, s.oz + s.dz * b.along, y0, y1)) {
        out.push({ target: this, key: i * 4 + PART_BODY, along: b.along, chord: b.chord, material, x: s.ox + s.dx * b.along, y: Math.min(Math.max(cy, y0), y1), z: s.oz + s.dz * b.along });
        continue;
      }
      if (kind === SMALL || (kind === MID && st === DOWN)) continue;
      // The legs: the nearest bone the line crosses.
      const big = kind === BIG, lr = big ? sw.v.robotBigLegHit : sw.v.robotMidLegHit;
      if (lr <= 0) continue;
      let best: SheetHit<Hittable> | null = null;
      const bone = (a: V3, e: V3, rr: number, part: number) => {
        const q = sheetSegment(s, a.x, a.y, a.z, e.x, e.y, e.z);
        if (!q) return;
        const R = rr + s.half;
        if (q.across > R) return;
        const px = s.ox + s.dx * q.along, pz = s.oz + s.dz * q.along;
        if (!inBand(s, q.along, px, pz, q.y - rr, q.y + rr)) return;
        if (best && best.along <= q.along) return;
        const chord = Math.max(0.2 * rr, 2 * Math.sqrt(R * R - q.across * q.across) * (rr / R));
        best = { target: this, key: i * 4 + part, along: Math.max(s.from, q.along - chord / 2), chord, material, x: px, y: q.y, z: pz };
      };
      const hip = this.hp, knee = this.kn, tip = this.tp, foot = this.ft, low = this.lw;
      for (let g = 0; g < WALK_LEGS; g++) {
        sw.legPose(i, g, hip, knee, tip, foot);
        bone(hip, knee, lr, PART_LEG);
        if (big) { bone(knee, tip, lr, PART_LEG); bone(tip, foot, lr * 1.6, PART_FOOT); }
        else {
          low.x = knee.x + (tip.x - knee.x) * 0.75; low.y = knee.y + (tip.y - knee.y) * 0.75; low.z = knee.z + (tip.z - knee.z) * 0.75;
          bone(knee, low, lr, PART_LEG); bone(low, tip, lr * 1.2, PART_FOOT);
        }
      }
      if (best) out.push(best);
    }
  }

  /**
   * Robots whose body is within radius of the point: small ones take it all, medium ones a share (robotMidSplash,
   * measured to the chassis' edge), big ones shrug it off.
   */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3) {
    const sw = this.swarm, midK = sw.v.robotMidSplash;
    let n = 0;
    const only = this.cull.round(at.x, at.z, radius);
    for (let j = 0, m = only ? only.length : sw.hi; j < m; j++) {
      const i = only ? only[j] : j;
      if (sw.state[i] >= DOWN) continue;
      const kind = sw.kind[i];
      if (kind !== SMALL && (kind !== MID || midK <= 0)) continue;
      const dx = sw.px[i] - at.x, dy = sw.hubY[i] - at.y, dz = sw.pz[i] - at.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - (kind === MID ? sw.size[i] * 0.4 : 0));
      if (d > radius) continue;
      const k = kind === MID ? midK : 1;
      if (sw.damage(i, damage * k * (1 - (0.5 * d) / radius), dir.x, dir.z)) this.kills++;
      n++;
    }
    return n;
  }

  /** The round's damage, scaled by the part it struck (body full, legs and feet a share). */
  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    this.partHits[this.lastPart]++;
    if (this.swarm.damage(this.last, amount * this.swarm.partShare(this.lastPart), dir.x, dir.z)) this.kills++;
  }
}
