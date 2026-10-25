// One weapon in the scene: its parts hung on their pivots, its sockets, and setters for everything that moves
// (barrel spin, pod doors and missiles, slides, recoil, a mortar's barrel), glows (lamps, barrel heat) or points
// (the targeting laser). The sims own timing; this only poses. `tick(dt)` adds the easing a viewer needs (heat
// cools, kick returns) when nothing else drives them.
// Each part is a pivot group (on its pivot) holding a motion group (identity at rest) holding the mesh and the parts
// that ride it, so posing never needs rest values and anything can set a motion group straight (`recoil` is one).
import * as THREE from "three/webgpu";
import type { ModelDef, Moving } from "./parts";
import { WeaponPaint, type WeaponLook } from "./weaponLook";
import type { CatalogEntry } from "./catalog";
import { LaserSight } from "./laserSight";

const D2R = Math.PI / 180;
const AX = new THREE.Vector3();

export class WeaponModel {
  /** At the mount point; scale = the entry's fit to the Rampart (times any scale set on it). */
  readonly root = new THREE.Group();
  /** What kicks back along -Z: the model's Recoil part if it has one, else everything. Ease .position.z to 0. */
  readonly recoil: THREE.Group;
  /** Motion groups by part name (identity at rest). */
  readonly parts: Record<string, THREE.Group> = {};
  readonly sockets: Record<string, THREE.Object3D> = {};
  /** Muzzle_0..n in order (one per barrel cluster or tube; the pods' tubes row by row from the top left). */
  readonly muzzles: THREE.Object3D[] = [];
  /** Glow_0..n: lamps and heat points the game can light (a point light, a flare). */
  readonly glows: THREE.Object3D[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly paint: WeaponPaint;
  /** Compatibility with the stand-ins' interface (src/weapons/models.ts): lamps glow through `setLamp` instead. */
  readonly glow: THREE.MeshBasicMaterial[] = [];
  laser: LaserSight | null = null;
  /** Barrel heat 0..1 (cools by tick). */
  heat = 0;
  /** Where the root sits (ModelDef.rootAt): on the mount joint, or on the gun's own axis (the old kit's guns). */
  readonly rootAt: "joint" | "trunnion";
  private body = new THREE.Group();
  private spinAngle = 0;
  private moving = new Map<string, Moving>();

  constructor(readonly entry: CatalogEntry, def: ModelDef, private look: WeaponLook, scheme?: number) {
    this.root.name = `weapon-${entry.id}`;
    this.root.scale.setScalar(entry.fit);
    this.root.add(this.body);
    this.rootAt = def.rootAt ?? "joint";
    this.paint = new WeaponPaint(scheme ?? look.v.weaponScheme, def.palette);
    const pivots: Record<string, THREE.Vector3> = {};
    for (const p of def.parts) {
      const pivot = new THREE.Group(), motion = new THREE.Group();
      pivot.name = p.name;
      motion.name = `${p.name}:motion`;
      const host = p.parent ? this.parts[p.parent] : undefined;
      pivot.position.copy(p.pivot).sub(host && p.parent ? pivots[p.parent] : new THREE.Vector3());
      pivots[p.name] = p.pivot;
      const mesh = new THREE.Mesh(p.geometry);
      mesh.name = `${entry.id}:${p.name}`;
      motion.add(mesh);
      pivot.add(motion);
      (host ?? this.body).add(pivot);
      this.parts[p.name] = motion;
      this.meshes.push(mesh);
    }
    this.recoil = this.parts.Recoil ?? this.body;
    look.apply(this.meshes, this.paint);
    for (const [name, s] of Object.entries(def.sockets)) {
      const o = new THREE.Object3D();
      const [hostName, own] = name.includes("/") ? name.split("/") : [null, name];
      o.name = own;
      o.position.copy(s.pos);
      if (s.fwd) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.fwd.clone().normalize());
      ((hostName && this.parts[hostName]) || this.body).add(o);
      this.sockets[own] = o;
    }
    for (let i = 0; this.sockets[`Muzzle_${i}`]; i++) this.muzzles.push(this.sockets[`Muzzle_${i}`]);
    for (let i = 0; this.sockets[`Glow_${i}`]; i++) this.glows.push(this.sockets[`Glow_${i}`]);
    for (const m of def.moving) this.moving.set(m.node, m);
    if (this.sockets.Laser) {
      this.laser = new LaserSight();
      this.sockets.Laser.add(this.laser.group);
    }
  }

  get mount() { return this.sockets.Mount ?? this.root; }
  get eject() { return this.sockets.Eject ?? null; }
  get grips() { return { R: this.sockets.Grip_R ?? null, L: this.sockets.Grip_L ?? null }; }
  get feedIn() { return this.sockets.FeedIn ?? null; }

  /** Names of the moving parts, by kind. */
  movingParts(kind?: Moving["kind"]) { return [...this.moving.values()].filter((m) => (!kind || m.kind === kind) && this.parts[m.node]).map((m) => m.node); }
  /** Rockets or missiles loaded (Missile_n parts; doors share the index). */
  get tubes() { return this.movingParts().filter((n) => n.startsWith("Missile_")).length; }
  has(node: string) { return !!this.parts[node]; }

  /** Pose one moving part: k 0 = rest, 1 = its full travel or angle (for a spin, k is the angle in radians). */
  set(node: string, k: number) {
    const m = this.moving.get(node), p = this.parts[node];
    if (!m || !p) return;
    const a = m.axis;
    if (m.kind === "spin") p.quaternion.setFromAxisAngle(AX.set(...(a ?? [0, 0, 1])).normalize(), k);
    else if (m.kind === "hinge") p.quaternion.setFromAxisAngle(AX.set(...(a ?? [1, 0, 0])).normalize(), (m.angleDeg ?? 0) * D2R * k);
    else p.position.copy(AX.set(...(a ?? [0, 0, -1])).normalize().multiplyScalar((m.travel ?? 0) * k));
  }

  /** Spin every spinning part by an angle (radians): the minigun's barrels. */
  spin(dAngle: number) {
    this.spinAngle += dAngle;
    for (const n of this.movingParts("spin")) this.set(n, this.spinAngle);
  }
  /** Suggested spin at full rate (rad/s), from the kit's rpm. */
  get spinRate() { const m = [...this.moving.values()].find((x) => x.kind === "spin"); return ((m?.rpm ?? 600) * 2 * Math.PI) / 60; }

  /** Open a pod door (0 shut, 1 open), or all of them. */
  setDoor(i: number, k: number) { this.set(`Door_${i}`, k); }
  setDoors(k: number) { for (const n of this.movingParts("hinge")) if (n.startsWith("Door_")) this.set(n, k); }
  /** Slide a missile or rocket out of its tube (0 seated, 1 out); hide it once fired. */
  setMissile(i: number, k: number, visible = true) {
    this.set(`Missile_${i}`, k);
    const p = this.parts[`Missile_${i}`];
    if (p) p.visible = visible;
  }
  /** The hand cannon's cycle: slide back, hammer cocked, barrel tipped (0 in battery, 1 fully back). */
  setSlide(k: number) {
    this.set("Slide", k);
    this.set("Hammer", Math.min(1, k * 1.5));
    if (this.moving.get("Barrel")?.kind === "hinge" && this.entry.cls === "HandCannon") this.set("Barrel", Math.min(1, k / 0.4));
  }
  /** Raise a mortar's or rack's barrel (0 stowed, 1 firing elevation) or a launcher's elevation. */
  setElevation(k: number) { for (const n of ["Barrel", "Launcher"]) if (this.moving.get(n)?.kind === "hinge") this.set(n, k); }
  /** A rack tube's own recoil (0 rest, 1 full). */
  setTube(i: number, k: number) { this.set(`Tube_${i}`, k); }
  /** The rear blast cover (0 shut, 1 open). */
  setLid(k: number) { this.set("Lid", k); }
  /** Kick back along -Z by metres (the Recoil part along its axis if there is one); eases back in tick. */
  kick(m: number) {
    const r = this.moving.get("Recoil");
    if (r && this.parts.Recoil) this.set("Recoil", Math.min(1.5, m / Math.max(1e-3, r.travel ?? 0.15)));
    else this.recoil.position.z = -m;
  }
  setHeat(h: number) { this.heat = THREE.MathUtils.clamp(h, 0, 1); this.paint.heat.value = this.heat; }
  /** Lamps and lenses: 0 off, 1 normal, more for a flash (ready lamps, a charging rail's coils). */
  setLamp(b: number) { this.paint.lamp.value = b; }
  setScheme(i: number) { this.paint.setScheme(i); }

  /** Easing for viewers: heat cools over coolTime seconds, the kick returns. */
  tick(dt: number, coolTime = 4) {
    if (this.heat > 0) this.setHeat(this.heat - dt / Math.max(0.1, coolTime));
    const k = Math.min(1, dt * 10);
    this.recoil.position.multiplyScalar(1 - k);
  }

  dispose() {
    this.root.removeFromParent();
    this.look.release(this.paint);
    this.laser?.dispose();
  }
}
