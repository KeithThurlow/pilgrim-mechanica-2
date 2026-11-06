// How a bandit vehicle dies (Keith 2026-11-06: "it's not very satisfying the way that bandit vehicles get destroyed
// now ... it just doesn't really live up to where we're at fidelity-wise"). Three beats instead of one puff:
//   1. Hit: the killing round sparks off it, the engine catches and it coasts on, spitting sparks and smoke, flames
//      licking out of the engine bay, for `deathDelay` s (bigger vehicles a little longer).
//   2. Cook-off: the fuel goes up. A rolling fireball, a spray of sparks, burning fuel thrown out in arcs that splash
//      and burn on the sand, a light flash, the sand cooked under it; the hull is thrown (warband.ts blowUp), wheels
//      and the turret are torn off and fly as their own bodies, panels and scrap are thrown every way trailing smoke,
//      and a pool of burning fuel is left where it stood.
//   3. Burning wreck: flames and embers off the hull, its metal glowing and cooling, a column of black smoke, and a
//      few ammo cook-off pops in the first seconds.
// Ownership: cosmetic (the look, the debris, Math.random), except the fuel pool, which is host state (it burns what
// stands in it) and is set off at a time from the vehicle's stable id, not from Math.random (rule 12).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { DeathPhysics, Dead, PartSpec } from "../physics/deaths";
import type { CarBody } from "../vehicles/carBody";
import { famOfTeam } from "../world/lamps";

export const RAIDER_DEATH_DEFAULTS = {
  deathDelay: 0.55,
  deathFireball: 1,
  deathSparks: 70,
  deathChunks: 9,
  deathChunkSpeed: 12,
  deathWheels: 2,
  deathTurret: 0.7,
  deathPartSpeed: 9,
  deathBurn: 14,
  deathPops: 3,
  deathPoolR: 2.6,
  deathPoolDps: 10,
};
export type RaiderDeathValues = typeof RAIDER_DEATH_DEFAULTS;

const G = "Raider wrecks";
export const RAIDER_DEATH_PARAMS: Param[] = [
  { key: "deathDelay", label: "Cooks off after (s)", min: 0, max: 3, step: 0.05, group: G, tip: "Keith 2026-11-06: a killed vehicle coasts on burning, spitting sparks, before the fuel goes up (bigger ones a little longer; 0 at once)" },
  { key: "deathFireball", label: "Fireball size ×", min: 0, max: 3, step: 0.05, group: G, tip: "The rolling fireball when the fuel goes up, and the burning fuel thrown out of it" },
  { key: "deathSparks", label: "Sparks", min: 0, max: 300, step: 5, group: G },
  { key: "deathChunks", label: "Scrap pieces thrown", min: 0, max: 30, step: 1, group: G, tip: "Panels and scrap blown off every way, trailing smoke (× the vehicle's size; death physics)" },
  { key: "deathChunkSpeed", label: "Scrap thrown (m/s)", min: 0, max: 40, step: 0.5, group: G },
  { key: "deathWheels", label: "Wheels torn off (most)", min: 0, max: 8, step: 1, group: G, tip: "Up to this many wheels fly off as their own bodies (not tracked road wheels)" },
  { key: "deathTurret", label: "Turret blown off (chance)", min: 0, max: 1, step: 0.05, group: G, tip: "The gun on the back thrown up off its ring" },
  { key: "deathPartSpeed", label: "Wheels and turret thrown (m/s)", min: 0, max: 30, step: 0.5, group: G },
  { key: "deathBurn", label: "Wreck burns for (s)", min: 0, max: 40, step: 0.5, group: G, tip: "Flames, glowing metal and black smoke off the wreck" },
  { key: "deathPops", label: "Cook-off pops", min: 0, max: 10, step: 1, group: G, tip: "Ammo going off in the burning wreck in its first seconds" },
  { key: "deathPoolR", label: "Fuel fire size (m)", min: 0, max: 8, step: 0.1, group: G, tip: "Burning fuel left on the sand where it went up (× the vehicle's size, square-rooted)" },
  { key: "deathPoolDps", label: "Fuel fire damage /s", min: 0, max: 100, step: 1, group: G, tip: "What standing in the burning fuel does (to anyone not a bandit)" },
];

/** The death's own state on a raider. */
export interface DeathState {
  /** Seconds after the kill it cooks off; whether it has; the ammo pops left (seconds after the blast). */
  cookAt: number;
  blown: boolean;
  pops: number[];
  /** Spots on the hull (body frame) that burn. */
  fires: THREE.Vector3[];
}

/** What raiderDeath needs from a raider (warband.ts Raider). */
export interface Dying {
  id: string;
  team: number;
  deadFor: number;
  hitDir: THREE.Vector3;
  shape: { blast: number; half: number };
  sim: { pos: THREE.Vector3; quat: THREE.Quaternion; vel: THREE.Vector3; heading: number };
  body: CarBody;
  death: DeathState | null;
}

/** A piece of the vehicle flying on its own: a real wheel or turret (a wrapper group over its mesh), or a box of scrap. */
interface Piece { dead: Dead | null; obj: THREE.Group | null; centre: THREE.Vector3; age: number; smoke: number; vel: THREE.Vector3; spin: THREE.Vector3 }

const UP = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(), at = new THREE.Vector3(), nrm = new THREE.Vector3();
/** Seconds a piece flies before the death physics' cap may freeze it. */
const FLY_FOR = 4;
const SCRAP = [0x2b2724, 0x3a332c, 0x4a3b2e, 0x6b4a2e, 0x55524a];

/** A steady 0..1 from a stable id (the cook-off time is host-visible: the fuel pool burns). */
function hash01(s: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

export class RaiderDeaths {
  private pieces: Piece[] = [];

  constructor(private bf: Battlefield, private v: RaiderDeathValues, private deaths: DeathPhysics | null, private group: THREE.Group) {}

  /** Beat 1, the moment it's killed: sparks off the hit, the engine catches. */
  start(r: Dying) {
    const big = r.shape.blast, half = r.shape.half;
    r.death = {
      cookAt: Math.max(0, this.v.deathDelay) * (0.75 + 0.5 * hash01(r.id, 1)) * (0.8 + 0.2 * Math.min(2.2, big)),
      blown: false, pops: [],
      // Engine bay up front, the cab, the back: in the body's own frame (+Z forward).
      fires: [new THREE.Vector3(0, 1.0, half * 0.6), new THREE.Vector3(0.3, 1.2, 0), new THREE.Vector3(-0.3, 1.0, -half * 0.55)],
    };
    this.world(r, r.death.fires[0], at);
    nrm.set(-r.hitDir.x, 0.8, -r.hitDir.z).normalize();
    this.bf.gunFx?.sparksAt?.(at, nrm, Math.round(18 * Math.sqrt(big)), 9);
    this.bf.sfx?.play?.("brap", at, 1.1, 0.75, false);
    for (let k = 0; k < 6; k++) this.bf.dust.smoke(at.x, at.y, at.z, (Math.random() - 0.5) * 1.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5, 0.6, 2.5, 0.8, 0.9);
  }

  /** Beat 1 going on: spitting sparks and smoke, flames out of the engine bay, faster toward the blast. True when it's time. */
  cook(r: Dying, dt: number): boolean {
    const d = r.death!;
    const u = d.cookAt > 0 ? Math.min(1, r.deadFor / d.cookAt) : 1;
    this.world(r, d.fires[0], at);
    if (Math.random() < dt * (10 + 30 * u)) this.bf.flames?.lick(at.x + (Math.random() - 0.5) * 0.8, at.y, at.z + (Math.random() - 0.5) * 0.8, 0.8 + u, 1);
    if (Math.random() < dt * (3 + 10 * u)) this.bf.gunFx?.sparksAt?.(at, UP, 4 + Math.round(6 * u), 6);
    if (Math.random() < dt * 10) this.bf.dust.smoke(at.x, at.y + 0.3, at.z, (Math.random() - 0.5), 2 + Math.random(), (Math.random() - 0.5), 0.5, 2.5, 0.8, 0.9);
    this.bf.flames?.glow(at.x, at.y, at.z, 1.2, 0.4 + 0.5 * u);
    return r.deadFor >= d.cookAt;
  }

  /** Beat 2: the fuel goes up (warband.ts blowUp throws the hull and digs the crater). */
  blast(r: Dying) {
    const bf = this.bf, v = this.v, d = r.death!, s = r.sim, p = s.pos, big = r.shape.blast, k = Math.sqrt(big);
    d.blown = true;
    const cy = p.y + 0.9;
    at.set(p.x, cy, p.z);
    // The rolling fireball: gobs of burning fuel spent at once rise as fireballs; more thrown out in arcs land burning.
    const fb = v.deathFireball;
    if (fb > 0 && bf.flames) {
      const n = Math.round(9 * k * fb);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5 * k;
        bf.flames.gob(p.x + Math.cos(a) * 0.6, cy + Math.random() * 0.8, p.z + Math.sin(a) * 0.6, Math.cos(a) * sp + s.vel.x * 0.5, 2 + Math.random() * 3, Math.sin(a) * sp + s.vel.z * 0.5,
          1e-4, (1.0 + Math.random() * 0.8) * k * fb, 0);
      }
      const m = Math.round(10 * k * fb);
      for (let i = 0; i < m; i++) {
        const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 8 * k;
        bf.flames.gob(p.x, cy, p.z, Math.cos(a) * sp, 5 + Math.random() * 7, Math.sin(a) * sp, 0.8 + Math.random() * 1.2, (0.3 + Math.random() * 0.3) * fb, 0);
      }
      for (let i = 0; i < 16 * k; i++) bf.flames.ember(p.x + (Math.random() - 0.5) * 2, cy, p.z + (Math.random() - 0.5) * 2);
    }
    if (v.deathSparks > 0) {
      bf.gunFx?.sparksAt?.(at, UP, Math.round(v.deathSparks * k), 16);
      nrm.set(r.hitDir.x, 0.5, r.hitDir.z).normalize();
      bf.gunFx?.sparksAt?.(at, nrm, Math.round(v.deathSparks * 0.5 * k), 22);
    }
    // Light, sound, heat.
    bf.nightLights?.flash(p.x, cy + 1, p.z, 9 + 6 * big, famOfTeam(r.team));
    bf.sfx?.playSound?.("blastBoom", at, 0.5 + 0.35 * big, 0.95 + Math.random() * 0.15 - 0.08 * big);
    bf.sfx?.playSound?.("blast", at, 0.6 + 0.3 * big, 0.8 + Math.random() * 0.15);
    bf.sfx?.play?.("brap", at, 1.6, 0.5, false);
    const h = bf.heat;
    if (h) { h.spot(p.x, p.z, 1.6 * k, 900); h.scorchSpot(p.x, p.z, 2.8 * k, 0.8); }
    // Burning fuel left on the sand (host state: it burns what stands in it).
    if (v.deathPoolR > 0 && v.deathBurn > 0) bf.pools?.add(r.team, p.x, p.z, v.deathPoolR * k, v.deathBurn * 0.6, v.deathPoolDps, 2, v.deathPoolDps * 0.4, true);
    // Ammo pops while it burns.
    const pops = Math.round(v.deathPops * (0.5 + Math.random() * 0.7));
    for (let i = 0; i < pops; i++) d.pops.push(0.6 + Math.random() * Math.min(5, v.deathBurn * 0.4));
    this.shed(r);
  }

  /** Beat 3: the wreck burning out. */
  burn(r: Dying, dt: number) {
    const bf = this.bf, v = this.v, d = r.death!, big = r.shape.blast, k = Math.sqrt(big);
    const t = r.deadFor - d.cookAt, life = Math.max(0.01, v.deathBurn);
    for (let i = d.pops.length - 1; i >= 0; i--) {
      if (t < d.pops[i]) continue;
      d.pops.splice(i, 1);
      const f = d.fires[Math.floor(Math.random() * d.fires.length)];
      this.world(r, f, at);
      bf.gunFx?.sparksAt?.(at, UP, 25, 12);
      bf.flames?.gob(at.x, at.y, at.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 1e-4, 0.8 * k, 0);
      bf.sfx?.playSound?.("blast", at, 0.35, 1.3 + Math.random() * 0.3);
      bf.nightLights?.flash(at.x, at.y, at.z, 5, famOfTeam(r.team));
    }
    if (t > life) return;
    const fade = 1 - t / life, hot = Math.max(0, 1 - t / (life * 0.6));
    for (const f of d.fires) {
      this.world(r, f, at);
      if (Math.random() < dt * 9 * fade * k) bf.flames?.lick(at.x + (Math.random() - 0.5) * 1.2, at.y - 0.2, at.z + (Math.random() - 0.5) * 1.2, (0.8 + 0.8 * fade) * k, 0.7 + 0.3 * fade);
      if (Math.random() < dt * 2 * fade) bf.flames?.ember(at.x, at.y, at.z);
      if (hot > 0) bf.flames?.glow(at.x, at.y, at.z, 1.4 * k, hot);
    }
    // The black smoke column, thick at first, thinning out.
    if (Math.random() < dt * (3 + 9 * fade) * k) {
      this.world(r, d.fires[1], at);
      bf.dust.smoke(at.x + (Math.random() - 0.5), at.y + 0.5, at.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8, 0.6 + 0.4 * fade, (3 + 2 * fade) * k, 0.8, 0.92);
    }
    if (fade > 0.4 && Math.random() < dt * 3 * fade) bf.flames?.smoke(at.x, at.y + 1, at.z, 0.8 * k);
  }

  /** The debris flying and lying: each piece follows its body (or its own throw), trails smoke for a while, then goes. */
  update(dt: number) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const pc = this.pieces[i];
      pc.age += dt;
      if (pc.dead) {
        const D = pc.dead;
        // Kept out of the physics' cap while flying (a band dying at once would freeze its scrap in mid-air), then
        // handed back to freeze, sink and clear like any body.
        if (D.keep && pc.age > FLY_FOR) D.keep = false;
        // A thin piece that slipped through the dune floor at speed: gone.
        if (!D.done && D.pos[0].y < this.bf.field.height(D.pos[0].x, D.pos[0].z) - 1) { D.keep = true; this.deaths?.remove(D); }
        if (pc.obj) {
          pc.obj.quaternion.copy(D.quat[0]);
          pc.obj.position.copy(pc.centre).applyQuaternion(D.quat[0]).negate().add(D.pos[0]);
          pc.obj.position.y -= D.sink;
        }
        ts.copy(D.pos[0]);
      } else if (pc.obj) this.fly(pc, dt);
      if (pc.age < pc.smoke && Math.random() < dt * 14) {
        const src = pc.dead ? ts : pc.obj!.position;
        this.bf.dust.smoke(src.x, src.y, src.z, 0, 0.6, 0, 0.35, 1.2, 0.7, 0.9);
        if (pc.age < pc.smoke * 0.5 && Math.random() < 0.5) this.bf.flames?.lick(src.x, src.y, src.z, 0.4, 0.9);
      }
      const done = pc.dead ? pc.dead.done : pc.age > 20;
      if (done) { if (pc.obj) this.group.remove(pc.obj); this.pieces.splice(i, 1); }
    }
  }

  /** Every piece off the field (the band cleared). */
  clear() {
    for (const pc of this.pieces) if (pc.obj) this.group.remove(pc.obj);
    this.pieces.length = 0;
  }

  get pieceCount() { return this.pieces.length; }

  /** A point in the vehicle's frame to the world. */
  private world(r: Dying, local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(r.sim.quat).add(r.sim.pos);
  }

  /** Tear the wheels and turret off and throw scrap. */
  private shed(r: Dying) {
    const v = this.v, s = r.sim, big = r.shape.blast, k = Math.sqrt(big);
    r.body.root.updateMatrixWorld(true);
    const { wheels, turrets, wheelR } = r.body.pieces();
    // Wheels: the ones nearest the blast side go first, a random pick of them.
    const nW = Math.min(wheels.length, Math.floor(Math.random() * (v.deathWheels + 1)));
    const pool = wheels.slice();
    for (let i = 0; i < nW; i++) {
      const w = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      this.tear(w, new THREE.Vector3(), [0.2, wheelR, wheelR], 0x1c1a18, s, v.deathPartSpeed, 0.4);
    }
    for (const t of turrets) {
      if (Math.random() >= v.deathTurret) continue;
      const box = new THREE.Box3().setFromObject(t);
      const hh: [number, number, number] = [0.45, Math.max(0.15, (box.max.y - box.min.y) / 2), 0.6];
      this.tear(t, new THREE.Vector3(0, hh[1], 0).add(t.position), hh, 0x2b2724, s, v.deathPartSpeed * 1.3, 0.8);
    }
    // Scrap: boxes thrown out every way (drawn by the death physics' own instanced boxes).
    if (!this.deaths) return;
    const n = Math.round(v.deathChunks * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = v.deathChunkSpeed * (0.4 + Math.random() * 0.8);
      const part: PartSpec = {
        half: [0.1 + Math.random() * 0.35, 0.03 + Math.random() * 0.08, 0.1 + Math.random() * 0.4], at: [0, 0, 0],
        color: SCRAP[Math.floor(Math.random() * SCRAP.length)], mass: 400,
        rot: tq.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)).toArray() as [number, number, number, number],
      };
      const vel = { x: s.vel.x * 0.5 + Math.cos(a) * sp, y: 3 + Math.random() * sp * 0.8, z: s.vel.z * 0.5 + Math.sin(a) * sp };
      const D = this.deaths.ragdoll([part], [], s.pos.x + Math.cos(a) * 0.5, s.pos.y + 0.8 + Math.random() * 0.6, s.pos.z + Math.sin(a) * 0.5, 0, vel, 0, 0, 0);
      this.spin(D, 12);
      this.pieces.push({ dead: D, obj: null, centre: new THREE.Vector3(), age: 0, smoke: Math.random() < 0.5 ? 1.5 + Math.random() * 1.5 : 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
  }

  /**
   * Pull a part off the body: a group placed where its parent was, holding the mesh as it sat, thrown up and out.
   * centre: the part's middle in its parent's frame; half: its box for the physics.
   */
  private tear(obj: THREE.Object3D, centre: THREE.Vector3, half: [number, number, number], color: number, s: Dying["sim"], speed: number, up: number) {
    const parent = obj.parent;
    if (!parent) return;
    const wrap = new THREE.Group();
    parent.matrixWorld.decompose(wrap.position, wrap.quaternion, tv);
    this.group.add(wrap);
    wrap.add(obj);
    const c = tv.copy(centre).applyQuaternion(wrap.quaternion).add(wrap.position);
    const ox = c.x - s.pos.x, oz = c.z - s.pos.z, ol = Math.hypot(ox, oz) || 1;
    const sp = speed * (0.6 + Math.random() * 0.6);
    const vel = new THREE.Vector3(s.vel.x * 0.6 + (ox / ol) * sp, sp * up + 3, s.vel.z * 0.6 + (oz / ol) * sp);
    const pc: Piece = { dead: null, obj: wrap, centre: centre.clone(), age: 0, smoke: 2.5, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14) };
    if (this.deaths) {
      const part: PartSpec = { half, at: [0, 0, 0], color, mass: 500, rot: wrap.quaternion.toArray() as [number, number, number, number] };
      const D = this.deaths.ragdoll([part], [], c.x, c.y, c.z, 0, vel, 0, 0, 0);
      D.kind = "vehicle"; // drawn by its own mesh, not the instanced boxes
      this.spin(D, 10);
      pc.dead = D;
    }
    this.pieces.push(pc);
  }

  /** Set a fresh debris body spinning (and keep it moving while it flies). */
  private spin(D: Dead, w: number) {
    D.keep = true;
    const ang = { x: (Math.random() - 0.5) * w, y: (Math.random() - 0.5) * w * 0.5, z: (Math.random() - 0.5) * w };
    if (D.bodies[0]) D.bodies[0].setAngvel(ang, true);
    else if (D.pending) D.pending.ang[0] = ang;
  }

  /** Without the death physics: a part thrown on a simple arc, bouncing to rest on the sand. */
  private fly(pc: Piece, dt: number) {
    const o = pc.obj!, g = this.bf.field;
    pc.vel.y -= 9.8 * dt;
    o.position.addScaledVector(pc.vel, dt);
    const w = pc.spin.length();
    if (w > 1e-4) o.quaternion.premultiply(tq.setFromAxisAngle(tv.copy(pc.spin).divideScalar(w), w * dt));
    const floor = g.height(o.position.x, o.position.z) + 0.3;
    if (o.position.y < floor) {
      o.position.y = floor;
      if (pc.vel.y < 0) pc.vel.y *= -0.3;
      pc.vel.x *= 0.6; pc.vel.z *= 0.6; pc.spin.multiplyScalar(0.5);
    }
  }
}
