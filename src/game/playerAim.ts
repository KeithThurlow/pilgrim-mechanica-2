// The player's aim and weapons, shared by every lab that puts the player's mech on twin-stick (the combat labs through
// combatLab.ts, the convoy lab), so they can't drift apart (Keith 2026-10-26: the convoy lab had none of the combat
// labs' targeting):
// - MouseButtons: the cursor and both buttons (left click fires the left side, right click the right; Keith 2026-10-25);
// - SoftAim: the soft lock under the cursor (src/game/targeting.ts) with the lead, the reticle on the sand and the
//   orange brackets on the lock;
// - CameraShake: kicks that decay by themselves (shakeDecay);
// - fitArsenal: the weapons other than the miniguns (src/weapons) on the mech, drawn, with blasts shaking the camera
//   by size and distance.
// Ownership: the cursor, lock and buttons are the player's own input (they become commands to the mech); the marks
// and shake are cosmetic.
import * as THREE from "three/webgpu";
import type { DuneField } from "../world/terrain";
import { screenToGround } from "../world/raycast";
import type { Aim } from "../mech/upper";
import type { ToonLook } from "../look/toon";
import type { Battlefield } from "./battlefield";
import type { MechUnit } from "./mechUnit";
import { Targeting, type TargetCandidate, type TargetValues, type Lock } from "./targeting";
import { Arsenal } from "../weapons/arsenal";
import { ArsenalDraw } from "../weapons/arsenalDraw";
import type { WeaponValues } from "../weapons/tuning";

/**
 * The mouse over the canvas: where it is, and both buttons. Read both from the `buttons` bitmask on every pointer
 * event: a browser sends pointerdown/up only for the first button pressed and the last released, and a second button
 * pressed while one is held arrives as a pointermove, so tracking `button` on down/up lost the second gun (Keith
 * 2026-10-25: couldn't hold both). A button starts firing only when it goes down over the canvas (so dragging a slider
 * onto the field doesn't fire); a release counts anywhere.
 */
export class MouseButtons {
  mouse: { x: number; y: number } | null = null;
  left = false;
  right = false;
  private lastButtons = 0;

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
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

export interface AimPick {
  /** The cursor's point on the sand (+1 m), or null with no mouse over the ground. */
  cursor: Aim | null;
  /** Where the arms swing: the cursor, or the lock led by its motion. */
  aim: Aim | null;
  /** Where the rounds go: the lock itself (null: the aim). */
  shotAt: Aim | null;
  lock: Lock | null;
}

/** The soft lock, its lead, and the marks for it: the reticle on the sand and brackets round the lock. */
export class SoftAim {
  readonly targeting = new Targeting();
  readonly reticle: THREE.Mesh;
  readonly lockMark: THREE.LineSegments;
  private lockMat: THREE.LineBasicMaterial;
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
    this.lockMat = new THREE.LineBasicMaterial({ color: 0xff6a3d, depthTest: false, transparent: true, toneMapped: false });
    this.lockMark = new THREE.LineSegments(lockBrackets(), this.lockMat);
    this.lockMark.renderOrder = 11;
    scene.add(this.lockMark);
  }

  /**
   * The cursor on the sand, and the enemy the guns take: under the cursor ray (a tall walker by its body, or by its
   * footprint), else the one nearest the line of fire from `from`. A lock is led by its motion (the arms trail their
   * aim as they track, so swing them to where it will be by then); the rounds fly straight at the lock itself.
   */
  pick(mouse: { x: number; y: number } | null, targets: readonly TargetCandidate[], from: THREE.Vector3, v: TargetValues & { range: number }): AimPick {
    const out: AimPick = { cursor: null, aim: null, shotAt: null, lock: null };
    if (!mouse || !screenToGround(mouse.x, mouse.y, this.canvas, this.camera, this.field, this.ground)) return out;
    const g = this.ground;
    out.cursor = out.aim = { x: g.x, y: g.y + 1, z: g.z };
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1);
    this.caster.setFromCamera(this.ndc, this.camera);
    const ray = this.caster.ray;
    out.lock = this.targeting.pick(targets, { rayO: ray.origin, rayD: ray.direction, from, cursor: g, range: v.range }, v);
    if (out.lock) {
      const t = out.lock.target, L = v.lockLead;
      out.shotAt = { x: t.x, y: t.y, z: t.z };
      out.aim = { x: t.x + (t.vx ?? 0) * L, y: t.y, z: t.z + (t.vz ?? 0) * L };
    }
    return out;
  }

  /** The reticle where the cursor is (amber while the guns bear and nothing's locked), brackets on the lock. */
  draw(cursor: Aim | null, lock: TargetCandidate | null, onTarget: boolean) {
    this.reticle.visible = !!cursor;
    if (cursor) {
      this.reticle.position.set(cursor.x, this.field.height(cursor.x, cursor.z) + 0.06, cursor.z);
      (this.reticle.material as THREE.MeshBasicMaterial).color.setHex(onTarget && !lock ? 0xffb347 : 0x9a958c);
    }
    this.lockMark.visible = !!lock;
    if (lock) {
      this.lockMark.position.set(lock.x, lock.y, lock.z);
      this.lockMark.quaternion.copy(this.camera.quaternion);
      this.lockMark.scale.setScalar(Math.max(1, lock.r * 1.3));
      this.lockMat.color.setHex(onTarget ? 0xff6a3d : 0xb0a89a);
    }
  }
}

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
  targets: () => TargetCandidate[], shake: CameraShake) {
  const arsenal = new Arsenal(bf, player, v, toon, targets);
  player.weapons = arsenal;
  const draw = new ArsenalDraw(arsenal, bf.field);
  scene.add(draw.group);
  arsenal.onShake = shake.add;
  bf.onBlast = (at, radius) => {
    bf.sfx.playSound("blast", at, Math.min(1.2, 0.5 + radius / 6), 0.85 + Math.random() * 0.2);
    const d = Math.hypot(at.x - player.sim.pos.x, at.z - player.sim.pos.z);
    if (d < v.blastShakeReach) shake.add(v.blastShake * (radius / 2.5) * (1 - d / v.blastShakeReach));
  };
  return { arsenal, draw };
}

/** Four corner brackets on a unit square (the lock mark). */
function lockBrackets() {
  const a = 1, b = 0.45, pts: number[] = [];
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    pts.push(sx * a, sy * a, 0, sx * (a - b), sy * a, 0, sx * a, sy * a, 0, sx * a, sy * (a - b), 0);
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}
