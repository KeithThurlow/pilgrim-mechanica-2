// Striders on a battlefield (shared by the robots lab's StriderLab and the expedition's StriderCamps): the pack, its
// hit target, its drawing and its attacks' effects, and its events resolved: the grab's damage on the prey (and the
// strike's shove on the mech), the beam and slam through the battlefield, footfalls as dust and shake, a death as a
// ragdoll (when there's a death world) and a blast. Host for the damage; drawing cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { DeathPhysics } from "../physics/deaths";
import type { Prey } from "../pilot/quarry";
import type { DuneField } from "../world/terrain";
import { Striders, type Strider, type StriderPrey, type StriderValues } from "./strider";
import { StriderBody } from "./striderBody";
import { StriderTarget } from "./striderTarget";
import { StriderFx } from "./striderFx";
import { striderRagdoll } from "./striderRagdoll";
import { footShape } from "../fx/footprint";
import { fireRobotBeam } from "../game/robotBeam";
import { RobotTearFx, type RobotTearValues } from "./robotTearFx";

export type StriderFieldValues = StriderValues & RobotTearValues & { striderBeamReach: number };

export class StriderField {
  readonly pack: Striders;
  readonly target: StriderTarget;
  readonly bodies = new Map<number, StriderBody>();
  /** Grabs that struck and the damage the claws did, since construction. */
  grabs = 0;
  grabDamage = 0;
  /** Called after a strider goes down and is taken off. */
  onDown: ((s: Strider) => void) | null = null;
  private fx: StriderFx;
  private tear: RobotTearFx;
  private hunted: Prey | null = null;
  private sp: StriderPrey = { x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: false };
  private sees: (from: THREE.Vector3, to: THREE.Vector3) => boolean;

  constructor(private v: StriderFieldValues, private bf: Battlefield, private scene: THREE.Scene, private field: DuneField,
    private mech: MechUnit, private deaths: DeathPhysics | null, public shake: (k: number) => void = () => {}, seed = 1, register = true) {
    const pack = (this.pack = new Striders(v, field, seed));
    this.target = new StriderTarget(pack, 3);
    bf.targets.push(this.target);
    if (register) bf.register.add(this.target);
    this.fx = new StriderFx(field);
    scene.add(this.fx.group);
    this.tear = new RobotTearFx(bf.gunFx, bf.sfx, field, v);
    scene.add(this.tear.group);
    this.sees = (from, to) => bf.canSee(from, to);
    pack.onEvent = (e) => this.event(e);
  }

  /** Stand one up at (x, z) facing `heading`. */
  spawn(x: number, z: number, heading: number): Strider {
    const s = this.pack.spawn(x, z, heading);
    const body = new StriderBody();
    this.bodies.set(s.id, body);
    this.scene.add(body.root);
    return s;
  }

  /** Off the field, body and all. */
  remove(s: Strider) {
    this.pack.remove(s);
    const b = this.bodies.get(s.id);
    if (b) { this.scene.remove(b.root); this.bodies.delete(s.id); }
  }

  /** One frame: they hunt `prey` (null: nobody to hunt). */
  update(dt: number, prey: Prey | null) {
    this.hunted = prey;
    const sp = this.sp;
    if (prey) { sp.x = prey.at.x; sp.y = prey.at.y; sp.z = prey.at.z; sp.vx = prey.sim.vel.x; sp.vz = prey.sim.vel.z; sp.alive = prey.alive; }
    else sp.alive = false;
    this.pack.update(dt, prey ? sp : null, this.sees);
    for (const s of this.pack.list) this.bodies.get(s.id)?.update(s, dt);
    this.fx.update(dt, this.pack.list);
    this.tear.update(dt);
  }

  private event(e: Parameters<NonNullable<Striders["onEvent"]>>[0]) {
    const v = this.v, bf = this.bf, pack = this.pack, mp = this.mech.sim.pos;
    if (e.type === "melee") {
      // The claws and blades bite: the damage, sparks and torn plate where they hit, and the strike throws the mech.
      const h = this.hunted;
      if (!h?.alive) return;
      h.unit.damage(e.damage, HIT.set(e.x, e.y, e.z), DIR.set(e.dx, 0, e.dz));
      this.grabDamage += e.damage;
      const src = pack.list.find((x) => x.id === e.id)?.pos(AT);
      this.tear.bite(e.x, e.y, e.z, src?.x ?? e.x, src?.z ?? e.z);
      if (e.kind === "strike") {
        this.grabs++;
        this.tear.bite(e.x, e.y + 0.5, e.z, src?.x ?? e.x, src?.z ?? e.z);
        this.shake(0.6);
        if (h.kind === "mech" && src) this.mech.shoveFrom(src.x, src.z, v.striderMeleeReach * 2, e.shove);
      }
    } else if (e.type === "beam") {
      this.fx.beam(e.id, e.beam);
      fireRobotBeam(bf, e.beam, v.striderBeamReach, undefined, (bf.v as { heatStrider?: number }).heatStrider);
      if (e.beam.release && Math.hypot(mp.x - e.beam.end.x, mp.z - e.beam.end.z) < 80) this.shake(0.25);
    } else if (e.type === "slam") {
      this.fx.slam(e.id, e.x, e.y, e.z);
      bf.blast(3, AT.set(e.x, e.y, e.z), e.radius, e.damage, e.pierce, "beam");
      const d = Math.hypot(mp.x - e.x, mp.z - e.z);
      if (d < 80) this.shake(d < e.radius * 2 ? 1 : 0.3);
    } else if (e.type === "footfall") {
      bf.dust.stomp(e.x, e.y, e.z, 0.5 * Math.min(1.5, e.k));
      // The pad's print (baked by StriderBody from its model), at the strider's size.
      if (!bf.inWater(e.x, e.z)) bf.marks.print(e.x, e.z, 0, e.k, footShape("strider"), v.striderScale, 1.3);
      const d = Math.hypot(mp.x - e.x, mp.z - e.z);
      if (d < 40) this.shake(0.08 * (1 - d / 40));
    } else if (e.type === "down") {
      const s = pack.list.find((x) => x.id === e.id);
      if (!s) return;
      if (this.deaths) {
        const r = striderRagdoll(s, this.field.height(s.pos(AT).x, AT.z));
        this.deaths.ragdoll(r.parts, r.joints, r.x, r.y, r.z, r.yaw, { x: 0, y: 0, z: 0 }, 0, 0, 1);
      }
      bf.blast(3, AT.set(e.x, e.y, e.z), 6, 0, 0, "death");
      this.remove(s);
      this.onDown?.(s);
    }
  }
}

const AT = new THREE.Vector3(), HIT = new THREE.Vector3(), DIR = new THREE.Vector3();
