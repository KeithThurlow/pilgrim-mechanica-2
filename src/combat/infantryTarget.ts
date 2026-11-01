// The bandit swarm as one target for the battlefield: rounds test every bandit's capsule through the swarm's spatial
// hit test, and the nearest one hit takes the damage. Also the swarm's owner in the register (src/game/register.ts):
// once added (bf.register.add(target)) every hit test here tests only the bandits the grid hands back.
import * as THREE from "three/webgpu";
import type { Hittable, SplashOpts } from "../game/battlefield";
import type { HitSurface } from "../fx/minigun";
import { DOWN, type InfantrySwarm } from "./infantry";
import { inBand, sheetCircle, type PenMaterial, type Sheet, type SheetHit } from "../game/sheet";
import { SwarmCull, type Owner, type Register } from "../game/register";

export class InfantryTarget implements Hittable, Owner {
  readonly name: string;
  readonly surface: HitSurface;
  private pen: PenMaterial;
  alive = true;
  kills = 0;
  private last = -1;
  /** The register's candidates for each hit test (null until added to a register: every bandit is tested). */
  readonly cull = new SwarmCull();

  /** look: what the swarm is made of (the humanoid robots, src/combat/droids.ts: metal that stops rounds like a cutter). */
  constructor(private swarm: InfantrySwarm, readonly team: number, look: { name: string; surface: HitSurface; material: PenMaterial } = { name: "bandits", surface: "flesh", material: "flesh" }) {
    this.name = look.name; this.surface = look.surface; this.pen = look.material;
  }

  publish(reg: Register) { this.swarm.publish(reg, this.team); }
  attach(reg: Register, owner: number) { this.cull.attach(reg, owner); }

  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const only = this.cull.segment(o.x, o.z, d.x, d.y, d.z, maxDist);
    const h = only && only.length === 0 ? null : this.swarm.hitRay(o.x, o.y, o.z, d.x, d.y, d.z, maxDist, only);
    this.last = h ? h.index : -1;
    return h ? h.dist : -1;
  }

  /** A sheet hit's key: the bandit's index. */
  pick(key: number) { this.last = key; }

  /** Sheet hits (src/game/sheet.ts): every standing bandit whose circle the line crosses and who stands in the band. */
  sheet(s: Sheet, out: SheetHit<Hittable>[]) {
    const sw = this.swarm, r = sw.v.banditRadius, H = sw.v.banditHeight;
    const only = this.cull.line(s.ox, s.oz, s.dx, s.dz, s.from, s.len, s.half);
    for (let j = 0, n = only ? only.length : sw.hi; j < n; j++) {
      const i = only ? only[j] : j;
      if (sw.state[i] >= DOWN) continue;
      const c = sheetCircle(s, sw.px[i], sw.pz[i], r);
      if (!c) continue;
      const x = s.ox + s.dx * c.along, z = s.oz + s.dz * c.along;
      if (!inBand(s, c.along, x, z, sw.py[i], sw.py[i] + H)) continue;
      out.push({ target: this, key: i, along: c.along, chord: c.chord, material: this.pen, x, y: sw.py[i] + H * 0.6, z });
    }
  }

  /**
   * Every standing bandit whose body (a vertical line from feet to head) is within radius of the point; an explosive's
   * blast (o.blast) also catches the knocked-down ones lying in it (2026-11-01: a bandit knocked flat by a stomp or a
   * dash took no rocket: they aren't in the register, so they get their own pass), and spares those behind cover
   * (o.cover: a dune, wall or wreck between).
   */
  splash(at: THREE.Vector3, radius: number, damage: number, dir: THREE.Vector3, o?: SplashOpts) {
    const sw = this.swarm, H = sw.v.banditHeight, r2 = radius * radius;
    let n = 0;
    const hit = (i: number, down: boolean) => {
      const dx = sw.px[i] - at.x, dz = sw.pz[i] - at.z;
      const top = down ? 0.5 : H;
      const dy = Math.max(sw.py[i] - at.y, 0, at.y - (sw.py[i] + top));
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > r2) return;
      if (o?.cover?.(sw.px[i], sw.py[i] + top * 0.6, sw.pz[i])) return;
      // Full share at the centre, half at the edge.
      if (sw.damage(i, damage * (1 - 0.5 * Math.sqrt(d2) / radius), dir.x, dir.z)) this.kills++;
      n++;
    };
    const only = this.cull.round(at.x, at.z, radius);
    for (let j = 0, m = only ? only.length : sw.hi; j < m; j++) {
      const i = only ? only[j] : j;
      if (sw.state[i] < DOWN) hit(i, false);
    }
    if (o?.blast) for (let i = 0; i < sw.hi; i++) if (sw.state[i] === DOWN) hit(i, true);
    return n;
  }

  /** The mech's body (trample): bandit i takes amount, thrown along (dirX, dirZ) at speed if it dies. */
  crush(i: number, amount: number, dirX: number, dirZ: number, speed: number): boolean {
    const k = this.swarm.damage(i, amount, dirX, dirZ, speed);
    if (k) this.kills++;
    return k;
  }

  damage(amount: number, _at: THREE.Vector3, dir: THREE.Vector3) {
    if (this.last < 0) return;
    if (this.swarm.damage(this.last, amount, dir.x, dir.z)) this.kills++;
  }
}
