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
import { MERGE_PARTS, mergeParts } from "../look/mergeGeometry";

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
  /** Merged: one mesh of every moving part at rest, shown while they all are; the parts' own meshes otherwise. */
  private restMesh: THREE.Mesh | null = null;
  private restParts: string[] = [];
  private restLive: THREE.Mesh[] = [];
  private atRest = false;

  constructor(readonly entry: CatalogEntry, def: ModelDef, private look: WeaponLook, scheme?: number) {
    this.root.name = `weapon-${entry.id}`;
    this.root.scale.setScalar(entry.fit);
    this.root.add(this.body);
    this.rootAt = def.rootAt ?? "joint";
    this.paint = new WeaponPaint(scheme ?? look.v.weaponScheme, def.palette);
    const pivots: Record<string, THREE.Vector3> = {};
    // Merged (MERGE_PARTS): parts that don't move on their own join the moving part they ride (or the body's one
    // mesh), and while every moving part is at rest one more mesh draws them all (see planFor).
    const plan = MERGE_PARTS ? planFor(def) : null;
    if (plan?.base) {
      const base = new THREE.Mesh(plan.base);
      base.name = `${entry.id}:base`;
      this.body.add(base);
      this.meshes.push(base);
    }
    for (const p of def.parts) {
      const pivot = new THREE.Group(), motion = new THREE.Group();
      pivot.name = p.name;
      motion.name = `${p.name}:motion`;
      const host = p.parent ? this.parts[p.parent] : undefined;
      pivot.position.copy(p.pivot).sub(host && p.parent ? pivots[p.parent] : new THREE.Vector3());
      pivots[p.name] = p.pivot;
      pivot.add(motion);
      (host ?? this.body).add(pivot);
      this.parts[p.name] = motion;
      const geo = plan ? plan.own.get(p.name) : p.geometry;
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo);
      mesh.name = `${entry.id}:${p.name}`;
      motion.add(mesh);
      this.meshes.push(mesh);
      if (plan?.restParts.includes(p.name)) this.restLive.push(mesh);
    }
    if (plan?.rest) {
      this.restMesh = new THREE.Mesh(plan.rest);
      this.restMesh.name = `${entry.id}:rest`;
      this.body.add(this.restMesh);
      this.meshes.push(this.restMesh);
      this.restParts = plan.restParts;
      this.showRest(true);
      // Before every draw (the scene's matrix update reaches here first), whatever moved the parts this frame.
      const own = this.body.updateMatrixWorld.bind(this.body);
      this.body.updateMatrixWorld = (force?: boolean) => { this.syncRest(); own(force); };
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

  /** Rest mesh or the moving parts' own meshes: rest only while every one sits at rest and shows. */
  private syncRest() {
    let at = true;
    for (const n of this.restParts) {
      const p = this.parts[n];
      if (!p.visible || p.position.lengthSq() > 1e-8 || Math.abs(p.quaternion.w) < 1 - 1e-7) { at = false; break; }
    }
    if (at !== this.atRest) this.showRest(at);
  }
  private showRest(at: boolean) {
    this.atRest = at;
    this.restMesh!.visible = at;
    for (const m of this.restLive) m.visible = !at;
  }

  dispose() {
    this.root.removeFromParent();
    this.look.release(this.paint);
    this.laser?.dispose();
  }
}

/**
 * How a model's parts merge (once per model, shared by its instances). Anchors are the parts that move on their own
 * (its moving list, plus Recoil and a clip's Clip, which the game moves or hides); every other part joins the nearest
 * anchor it rides, or the body (base, always drawn). rest: every anchor that doesn't ride a spinning part, at rest,
 * as one geometry; null when there's no base to hold the per-frame hooks or nothing moves.
 */
interface Plan { own: Map<string, THREE.BufferGeometry | null>; base: THREE.BufferGeometry | null; rest: THREE.BufferGeometry | null; restParts: string[] }
const plans = new WeakMap<ModelDef, Plan>();
function planFor(def: ModelDef): Plan {
  let plan = plans.get(def);
  if (plan) return plan;
  const byName = new Map(def.parts.map((p) => [p.name, p]));
  const kinds = new Map(def.moving.map((m) => [m.node, m.kind]));
  const isAnchor = (n: string) => kinds.has(n) || n === "Recoil" || n === "Clip";
  const anchorOf = (n: string) => { for (let p = byName.get(n); p; p = p.parent ? byName.get(p.parent) : undefined) if (isAnchor(p.name)) return p.name; return ""; };
  const spins = (a: string) => { for (let p = byName.get(a); p; p = p.parent ? byName.get(p.parent) : undefined) if (kinds.get(p.name) === "spin") return true; return false; };
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const p of def.parts) {
    const a = anchorOf(p.name), at = a ? byName.get(a)!.pivot : new THREE.Vector3();
    const g = p.geometry.clone().translate(p.pivot.x - at.x, p.pivot.y - at.y, p.pivot.z - at.z);
    (groups.get(a) ?? groups.set(a, []).get(a)!).push(g);
  }
  const own = new Map<string, THREE.BufferGeometry | null>();
  for (const p of def.parts) own.set(p.name, isAnchor(p.name) ? mergeParts(groups.get(p.name) ?? []) : null);
  const base = mergeParts(groups.get("") ?? []);
  const restParts = base ? def.parts.filter((p) => isAnchor(p.name) && own.get(p.name) && !spins(p.name)).map((p) => p.name) : [];
  const rest = restParts.length
    ? mergeParts([...restParts.map((n) => { const v = byName.get(n)!.pivot; return own.get(n)!.clone().translate(v.x, v.y, v.z); })])
    : null;
  plan = { own, base, rest, restParts: rest ? restParts : [] };
  plans.set(def, plan);
  return plan;
}
