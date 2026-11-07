// The player's aim and weapons, shared by every lab that puts the player's mech on twin-stick (the combat labs through
// combatLab.ts, the convoy lab), so they can't drift apart (Keith 2026-10-26: the convoy lab had none of the combat
// labs' targeting):
// - MouseButtons: the cursor and both buttons (left click fires the left side, right click the right; Keith 2026-10-25);
// - SoftAim: the soft lock under the cursor (src/game/targeting.ts, over the battlefield's register) with the lead,
//   the reticle on the sand and the orange brackets on the lock; and the target lock (Tab, src/game/targetLock.ts),
//   which holds the aim on one enemy as if the cursor were on it, marked by red brackets, a spinning diamond and a
//   ring on the sand;
// - CameraShake: kicks that decay by themselves (shakeDecay);
// - fitArsenal: the weapons other than the miniguns (src/weapons) on the mech, drawn, with blasts shaking the camera
//   by size and distance.
// Ownership: the cursor, lock and buttons are the player's own input (they become commands to the mech); the marks
// and shake are cosmetic.
import { canvasRect } from "../core/canvasRect";
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import { screenToGround } from "../world/raycast";
import type { Aim } from "../mech/upper";
import type { ToonLook } from "../look/toon";
import type { Battlefield } from "./battlefield";
import type { MechUnit } from "./mechUnit";
import { Targeting, type TargetValues, type Lock } from "./targeting";
import { TargetLock, type LockChange } from "./targetLock";
import { EntryList, Register as Reg, type Filter, type Register } from "./register";
import { Arsenal } from "../weapons/arsenal";
import { ArsenalDraw } from "../weapons/arsenalDraw";
import { playBlast } from "../weapons/weaponSound";
import type { WeaponValues } from "../weapons/tuning";
import { TOUCH_USE, touchState } from "../core/touch";

/**
 * The mouse over the canvas: where it is, and both buttons. Read both from the `buttons` bitmask on every pointer
 * event: a browser sends pointerdown/up only for the first button pressed and the last released, and a second button
 * pressed while one is held arrives as a pointermove, so tracking `button` on down/up lost the second gun (Keith
 * 2026-10-25: couldn't hold both). A button starts firing only when it goes down over the canvas (so dragging a slider
 * onto the field doesn't fire); a release counts anywhere.
 */
export class MouseButtons {
  private pointer: { x: number; y: number } | null = null;
  private leftButton = false;
  private rightButton = false;
  /** The cursor: the mouse, or the touch pad's right stick while it's held (src/core/touch.ts). */
  get mouse() { return touchState.aim ?? this.pointer; }
  set mouse(v: { x: number; y: number } | null) { this.pointer = v; }
  /** The triggers: the mouse buttons, or the right stick pushed (it fires both sides). */
  get left() { return this.leftButton || touchState.fire; }
  set left(v: boolean) { this.leftButton = v; }
  get right() { return this.rightButton || touchState.fire; }
  set right(v: boolean) { this.rightButton = v; }
  private lastButtons = 0;
  private finger = -1;

  /** onUse: the player touched the mouse (the lab stops its demo). */
  constructor(canvas: HTMLCanvasElement, onUse: () => void) {
    const read = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const pressed = e.buttons & ~this.lastButtons;
      this.lastButtons = e.buttons;
      if (e.target === canvas) {
        if (pressed & 1) { this.left = true; onUse(); }
        if (pressed & 2) { this.right = true; onUse(); }
      }
      if (!(e.buttons & 1)) this.left = false;
      if (!(e.buttons & 2)) this.right = false;
    };
    canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { this.mouse = { x: e.clientX, y: e.clientY }; onUse(); } });
    addEventListener("pointerdown", read);
    addEventListener("pointermove", read);
    addEventListener("pointerup", read);
    addEventListener("blur", () => { this.left = false; this.right = false; this.lastButtons = 0; });
    // A finger on the canvas (phones): where it is is the cursor, and it holds the left trigger while it's down.
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || this.finger >= 0) return;
      this.finger = e.pointerId; this.mouse = { x: e.clientX, y: e.clientY }; this.left = true; onUse();
    });
    canvas.addEventListener("pointermove", (e) => { if (e.pointerId === this.finger) this.mouse = { x: e.clientX, y: e.clientY }; });
    const lift = (e: PointerEvent) => { if (e.pointerId === this.finger) { this.finger = -1; this.left = false; } };
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);
    // The right stick: keep its last aim when it's let go, so the guns hold where they pointed.
    addEventListener(TOUCH_USE, () => onUse());
    canvas.ownerDocument.addEventListener("pointerup", () => { if (touchState.aim) this.pointer = { ...touchState.aim }; }, true);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

export interface AimPick {
  /** Where the weapons take the cursor to be: the mouse's point on the sand (+1 m), or under the target lock's target
   *  while it holds; null with neither. */
  cursor: Aim | null;
  /** The mouse's own point on the sand (+1 m), where the reticle sits; null with no mouse over the ground. */
  pointer: Aim | null;
  /** What the lock command did this tick (on, off, lost: the target died or got away; null: nothing). */
  change: LockChange;
  /** Where the arms swing: the cursor, or the lock led by its motion. */
  aim: Aim | null;
  /** Where the rounds go: the lock itself (null: the aim). */
  shotAt: Aim | null;
  lock: Lock | null;
}

/** The soft lock, its lead, the target lock, and the marks for them: the reticle on the sand and brackets round the
 *  lock (orange, thick enough to read from the game camera), red with a spinning diamond and a ring when held. */
export class SoftAim {
  readonly targeting = new Targeting();
  readonly held = new TargetLock();
  readonly reticle: THREE.Mesh;
  readonly lockMark: THREE.Mesh;
  private lockMat: THREE.MeshBasicMaterial;
  private heldMark: THREE.Mesh;
  private heldRing: THREE.Mesh;
  private heldMat: THREE.MeshBasicMaterial;
  /** When the held lock came on (performance.now, s), for its snap-in. */
  private heldAt = -1;
  private ndc = new THREE.Vector2();
  private caster = new THREE.Raycaster();
  private ground = new THREE.Vector3();

  constructor(scene: THREE.Scene, private camera: THREE.Camera, private canvas: HTMLCanvasElement, private field: DuneField) {
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    this.reticle.renderOrder = 10;
    scene.add(this.reticle);
    this.lockMat = new THREE.MeshBasicMaterial({ color: 0xff6a3d, depthTest: false, transparent: true, toneMapped: false, side: THREE.DoubleSide });
    this.lockMark = new THREE.Mesh(lockBrackets(), this.lockMat);
    this.lockMark.renderOrder = 11;
    scene.add(this.lockMark);
    this.heldMat = new THREE.MeshBasicMaterial({ color: 0xff2a1f, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false, side: THREE.DoubleSide });
    this.heldMark = new THREE.Mesh(lockDiamond(), this.heldMat);
    this.heldMark.renderOrder = 12;
    scene.add(this.heldMark);
    this.heldRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), this.heldMat);
    this.heldRing.renderOrder = 10;
    scene.add(this.heldRing);
  }

  /** Let go of the target lock (the pilot hopped out, the round restarted). */
  release() { this.held.release(); }

  /**
   * The cursor on the sand, and the enemy the guns take: under the cursor ray (a tall walker by its body, or by its
   * footprint), else the one nearest the line of fire from `from`. A lock is led by its motion (the arms trail their
   * aim as they track, so swing them to where it will be by then); the rounds fly straight at the lock itself.
   */
  /**
   * lockCmd: the target lock command this tick (Tab): locks what the soft lock has, or lets go. While the lock holds,
   * the cursor, aim and shots are its target's whatever the mouse does (and with no mouse at all: a pad or touch later).
   */
  pick(mouse: { x: number; y: number } | null, reg: Register, enemies: Filter, from: THREE.Vector3, v: TargetValues & { range: number }, lockCmd = false): AimPick {
    const out: AimPick = { cursor: null, pointer: null, change: null, aim: null, shotAt: null, lock: null };
    let soft: Lock | null = null, rayOk = false;
    if (mouse && screenToGround(mouse.x, mouse.y, this.canvas, this.camera, this.field, this.ground)) {
      const g = this.ground;
      out.pointer = out.cursor = out.aim = { x: g.x, y: g.y + 1, z: g.z };
      const r = canvasRect(this.canvas);
      this.ndc.set(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1);
      this.caster.setFromCamera(this.ndc, this.camera);
      const ray = this.caster.ray;
      rayOk = true;
      soft = this.targeting.pick(reg, enemies, { rayO: ray.origin, rayD: ray.direction, from, cursor: g, range: v.range }, v);
    }
    if (lockCmd) out.change = this.held.toggle(soft ? (soft.target.key as number) : null);
    const held = this.held.resolve(reg, enemies, from, v.lockHold);
    out.change ||= held.change;
    if (out.change === "on") this.heldAt = performance.now() / 1000;
    if (held.view) {
      const t = held.view;
      out.lock = { target: t, how: "held" };
      out.cursor = { x: t.x, y: this.field.height(t.x, t.z) + 1, z: t.z };
      out.aim = out.cursor;
      this.targeting.last = t.key;
    } else out.lock = soft;
    if (out.lock) {
      const t = out.lock.target, L = v.lockLead;
      out.shotAt = { x: t.x, y: t.y, z: t.z };
      // The part of it under the cursor, when that's worth aiming at (a big walker's leg or reactor): the guns go there.
      const ray = this.caster.ray, id = t.key as number, owner = rayOk ? reg.owners[Reg.ownerOf(id) - 1] : undefined;
      if (owner?.aimPart && owner.aimPart(id - Reg.idOf(Reg.ownerOf(id), 0), ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, PART_AT)) {
        out.shotAt = { x: PART_AT.x, y: PART_AT.y, z: PART_AT.z };
      }
      const a = out.shotAt;
      out.aim = { x: a.x + (t.vx ?? 0) * L, y: a.y, z: a.z + (t.vz ?? 0) * L };
    }
    return out;
  }

  /**
   * The reticle where the mouse is (amber while the guns bear and nothing's locked; faint while the target lock holds),
   * brackets on the lock: orange while the guns bear, pale when not (still easy to see on sand); held: red brackets,
   * a diamond turning inside them and a ring on the sand under it, snapping in when the lock comes on.
   */
  draw(pointer: Aim | null, lock: Lock | null, onTarget: boolean) {
    const t = lock?.target ?? null, held = lock?.how === "held";
    const rm = this.reticle.material as THREE.MeshBasicMaterial;
    this.reticle.visible = !!pointer;
    if (pointer) {
      this.reticle.position.set(pointer.x, this.field.height(pointer.x, pointer.z) + 0.06, pointer.z);
      rm.color.setHex(onTarget && !t ? 0xffb347 : 0x9a958c);
      rm.opacity = held ? 0.45 : 0.9;
    }
    this.lockMark.visible = !!t;
    this.heldMark.visible = this.heldRing.visible = !!t && held;
    if (!t) return;
    const s = Math.max(1, t.r * 1.3);
    const now = performance.now() / 1000, snap = held ? Math.max(0, 1 - (now - this.heldAt) / 0.18) : 0;
    this.lockMark.position.set(t.x, t.y, t.z);
    this.lockMark.quaternion.copy(this.camera.quaternion);
    this.lockMark.scale.setScalar(s * (1 + snap * 0.8));
    this.lockMat.color.setHex(held ? 0xff2a1f : onTarget ? 0xff6a3d : 0xffd9a0);
    this.lockMat.opacity = held || onTarget ? 1 : 0.75;
    if (held) {
      this.heldMark.position.copy(this.lockMark.position);
      this.heldMark.quaternion.copy(this.camera.quaternion);
      this.heldMark.rotateZ(now * 1.6);
      this.heldMark.scale.setScalar(s * 0.55 * (1 + snap));
      this.heldRing.position.set(t.x, this.field.height(t.x, t.z) + 0.08, t.z);
      this.heldRing.scale.setScalar(Math.max(1.6, (t.foot ?? 0) * 0.5, t.r * 1.4));
    }
  }
}

const PART_AT = { x: 0, y: 0, z: 0 };

/** Camera shake: kicks take the biggest, and settle at shakeDecay per second. */
export class CameraShake {
  k = 0;
  add = (k: number) => { this.k = Math.max(this.k, k); };
  apply(camera: THREE.Camera, rawDt: number, decay: number) {
    if (this.k <= 1e-3) { this.k = 0; return; }
    camera.position.x += (Math.random() - 0.5) * this.k;
    camera.position.y += (Math.random() - 0.5) * this.k * 0.6;
    camera.position.z += (Math.random() - 0.5) * this.k;
    this.k *= Math.exp(-rawDt * decay);
  }
}

/**
 * The player's weapons other than the miniguns: nothing until a loadout fits one (src/game/loadoutApply.ts). Rail
 * shots and launches shake the camera, and every blast near the mech shakes it by its size and distance.
 */
export function fitArsenal(bf: Battlefield, player: MechUnit, v: MechUnit["v"] & WeaponValues, toon: ToonLook, scene: THREE.Scene,
  enemies: Filter, shake: CameraShake) {
  // The weapons' view of the register: one list per tick (the line mortar's snap, the missile picks), and a lookup by
  // id for each missile's target (no list rebuilt per missile).
  const list = new EntryList(bf.register, enemies);
  const arsenal = new Arsenal(bf, player, v, toon, () => list.get());
  arsenal.findTarget = (key) => list.find(key);
  player.weapons = arsenal;
  const draw = new ArsenalDraw(arsenal, bf.field, () => bf.nightLights);
  scene.add(draw.group);
  arsenal.onShake = shake.add;
  bf.onBlast = (at, radius) => {
    playBlast(bf.sfx, at, radius, v);
    const d = Math.hypot(at.x - player.sim.pos.x, at.z - player.sim.pos.z);
    if (d < v.blastShakeReach) shake.add(v.blastShake * (radius / 2.5) * (1 - d / v.blastShakeReach));
  };
  return { arsenal, draw };
}

/** Flat quads (x0, y0, x1, y1 each) as one mesh in the xy plane: marks with real thickness (a line is 1 px in WebGPU,
 *  too thin to read from the game camera). */
function quads(rects: number[][]) {
  const pos: number[] = [], idx: number[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    const n = pos.length / 3;
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
}

/** Four corner brackets on a unit square (the lock mark), each arm `w` thick. */
function lockBrackets() {
  const a = 1, b = 0.42, w = 0.085, r: number[][] = [];
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    r.push([Math.min(sx * a, sx * (a - b)), Math.min(sy * a, sy * (a - w)), Math.max(sx * a, sx * (a - b)), Math.max(sy * a, sy * (a - w))]);
    r.push([Math.min(sx * a, sx * (a - w)), Math.min(sy * a, sy * (a - b)), Math.max(sx * a, sx * (a - w)), Math.max(sy * a, sy * (a - b))]);
  }
  return quads(r);
}

/** Four short ticks pointing in at the centre, round a unit circle (the held lock's turning diamond). */
function lockDiamond() {
  const w = 0.09, r = quads([[-w, 0.55, w, 1], [-w, -1, w, -0.55], [0.55, -w, 1, w], [-1, -w, -0.55, w]]);
  return r.rotateZ(Math.PI / 4);
}
