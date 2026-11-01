// Crushers on a battlefield (shared by the crusher lab and the expedition's CrusherSites): the pack, its hit target,
// its drawing and suction, and its events resolved: the grind and the pincers' damage on the prey (× damageK), the
// pull on the mech (it slides toward the maw), footfalls as dust and shake, eating salvage (the caller's food list
// and onAte), a death as a blast with the wreck left lying a while. Host for the damage; drawing cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { Prey } from "../pilot/quarry";
import type { DuneField } from "../world/terrain";
import { Crushers, type Crusher, type CrusherEvent, type CrusherFood, type CrusherPrey, type CrusherValues } from "./crusher";
import { CrusherBody } from "./crusherBody";
import { CrusherTarget } from "./crusherTarget";
import { CrusherFx } from "./crusherFx";
import { RobotTearFx, type RobotTearValues } from "./robotTearFx";
import { bakeDiscFoot, footShapeOr } from "../fx/footprint";

export type CrusherFieldValues = CrusherValues & RobotTearValues;

/** How long a dead crusher's wreck lies before it goes (s). */
const WRECK_TIME = 12;

export class CrusherField {
  readonly pack: Crushers;
  readonly target: CrusherTarget;
  readonly bodies = new Map<number, CrusherBody>();
  /** Damage on the prey is multiplied by this (the expedition's crushers are milder than the lab's). */
  damageK = 1;
  /** Called when one eats a heap (the caller takes it off its food list). */
  onAte: ((food: number, c: Crusher) => void) | null = null;
  /** Called when one goes down (before its wreck is taken off). */
  onDown: ((c: Crusher) => void) | null = null;
  /** The pull on the mech this frame (m/s, all crushers). */
  readonly pull = { x: 0, z: 0 };
  private fx: CrusherFx;
  private tear: RobotTearFx;
  private hunted: Prey | null = null;
  private cp: CrusherPrey = { x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: false };
  private wrecks: { c: Crusher; t: number }[] = [];

  constructor(v: CrusherFieldValues, private bf: Battlefield, private scene: THREE.Scene, private field: DuneField,
    private mech: MechUnit, public shake: (k: number) => void = () => {}, seed = 1, register = true) {
    const pack = (this.pack = new Crushers(v, field, seed));
    this.target = new CrusherTarget(pack, 3);
    bf.targets.push(this.target);
    if (register) bf.register.add(this.target);
    this.fx = new CrusherFx(field);
    scene.add(this.fx.group);
    this.tear = new RobotTearFx(bf.gunFx, bf.sfx, field, v);
    scene.add(this.tear.group);
    pack.onEvent = (e) => this.event(e);
  }

  spawn(x: number, z: number, heading: number): Crusher {
    const c = this.pack.spawn(x, z, heading);
    const body = new CrusherBody();
    this.bodies.set(c.id, body);
    this.scene.add(body.root);
    return c;
  }

  remove(c: Crusher) {
    this.pack.remove(c);
    const b = this.bodies.get(c.id);
    if (b) { this.scene.remove(b.root); this.bodies.delete(c.id); }
    this.wrecks = this.wrecks.filter((w) => w.c !== c);
  }

  /** One frame: they hunt `prey` (null: nobody) and eat from `food`. */
  update(dt: number, prey: Prey | null, food: readonly CrusherFood[] = []) {
    this.hunted = prey;
    const cp = this.cp;
    if (prey) { cp.x = prey.at.x; cp.y = prey.at.y; cp.z = prey.at.z; cp.vx = prey.sim.vel.x; cp.vz = prey.sim.vel.z; cp.alive = prey.alive; }
    else cp.alive = false;
    this.pack.update(dt, prey ? cp : null, food);
    // The pull: the mech slides toward the maw (the pilot on foot isn't pulled).
    let px = 0, pz = 0;
    for (const c of this.pack.list) { px += c.pullX; pz += c.pullZ; }
    this.pull.x = px; this.pull.z = pz;
    if ((px || pz) && prey?.kind === "mech" && this.mech.alive) {
      const s = this.mech.sim, dx = px * dt, dz = pz * dt;
      const dy = this.field.height(s.pos.x + dx, s.pos.z + dz) - this.field.height(s.pos.x, s.pos.z);
      s.carry(dx, dy, dz, 0, 0, 0);
      this.shake(0.03);
    }
    for (const w of [...this.wrecks]) if ((w.t -= dt) <= 0) this.remove(w.c);
    for (const c of this.pack.list) this.bodies.get(c.id)?.update(c, dt);
    this.fx.update(dt, this.pack.list);
    this.tear.update(dt);
  }

  private event(e: CrusherEvent) {
    const bf = this.bf, h = this.hunted, mp = this.mech.sim.pos;
    if (e.type === "grind") {
      if (!h?.alive) return;
      h.unit.damage(e.damage * this.damageK, HIT.set(e.x, e.y, e.z), DOWN, e.pierce);
      this.tear.bite(e.x, e.y, e.z, h.at.x, h.at.z);
      this.tear.bite(e.x, e.y, e.z, h.at.x, h.at.z);
      this.shake(0.2);
    } else if (e.type === "claw") {
      if (e.hit && h?.alive) {
        h.unit.damage(e.damage * this.damageK, HIT.copy(h.at), DOWN, e.pierce);
        this.tear.bite(h.at.x, h.at.y, h.at.z, h.at.x, h.at.z);
        this.shake(0.45);
      }
      bf.dust.stomp(e.x, this.field.height(e.x, e.z), e.z, 0.6);
    } else if (e.type === "ate") {
      const c = this.pack.list.find((x) => x.id === e.id);
      this.tear.bite(e.x, e.y + 1, e.z, e.x, e.z);
      if (c) this.onAte?.(e.food, c);
    } else if (e.type === "footfall") {
      bf.dust.stomp(e.x, e.y, e.z, 0.6);
      // A spike's print: a deep round hole about the spike's width (crusherBody: W × 0.1 across).
      if (!bf.inWater(e.x, e.z)) bf.marks.print(e.x, e.z, 0, 1, footShapeOr("crusher-spike", () => bakeDiscFoot("crusher-spike", 0.5)), this.pack.v.crusherSize * 0.08, 1.6);
      const d = Math.hypot(mp.x - e.x, mp.z - e.z);
      if (d < 30) this.shake(0.06 * (1 - d / 30));
    } else if (e.type === "down") {
      bf.blast(3, HIT.set(e.x, e.y, e.z), 6, 0, 0, "death");
      const c = this.pack.list.find((x) => x.id === e.id);
      if (!c) return;
      this.wrecks.push({ c, t: WRECK_TIME });
      this.onDown?.(c);
    }
  }
}

const HIT = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
