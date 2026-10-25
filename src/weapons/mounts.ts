// Where weapon models hang on the Rampart, found through its public parts (src/mech/rampart.ts regions()), so this
// needs no change to the mech: a gun side's pivot (the stock pod's kick group: it aims and kicks with the gun),
// the hull top for shoulder weapons, and the back group (over the drums) for back weapons. Offsets are sliders.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { RampartBody } from "../mech/rampart";
import type { WeaponModel } from "./weaponModel";

export const MOUNT_DEFAULTS = {
  weaponScale: 1,
  hullOut: 0.92, hullUp: -0.32, hullFwd: 0.0,
  handOut: 0.95, handUp: -0.75, handFwd: 0.35,
  shoulderX: 0.78, shoulderY: 2.05, shoulderZ: -0.55, shoulderTilt: 0,
  podTilt: 30,
  backY: 1.42, backZ: -0.15,
};
export type MountValues = typeof MOUNT_DEFAULTS;

export const MOUNT_PARAMS: Param[] = [
  { key: "weaponScale", label: "Weapon scale", min: 0.5, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "Times each model's fit (1 = the old kit's game size, which is the Rampart's)" },
  { key: "hullOut", label: "Hull gun outboard (m)", min: 0, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "The old kit's centred hull guns (minigun M): from the shoulder joint to the gun's trunnion. Models rooted on the joint ignore these" },
  { key: "hullUp", label: "Hull gun up (m)", min: -1.5, max: 1, step: 0.01, group: "Fit on the Rampart" },
  { key: "hullFwd", label: "Hull gun forward (m)", min: -1, max: 1.5, step: 0.01, group: "Fit on the Rampart" },
  { key: "handOut", label: "Hand gun outboard (m)", min: 0, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "Hand, forearm and two-handed guns (the Rampart has no hands: shown on the gun pivot)" },
  { key: "handUp", label: "Hand gun up (m)", min: -2, max: 1, step: 0.01, group: "Fit on the Rampart" },
  { key: "handFwd", label: "Hand gun forward (m)", min: -1, max: 2, step: 0.01, group: "Fit on the Rampart" },
  { key: "shoulderX", label: "Shoulder mount across (m)", min: 0, max: 1.6, step: 0.01, group: "Fit on the Rampart" },
  { key: "shoulderY", label: "Shoulder mount height (m)", min: 1, max: 3, step: 0.01, group: "Fit on the Rampart", tip: "Above the waist" },
  { key: "shoulderZ", label: "Shoulder mount forward (m)", min: -1.5, max: 1, step: 0.01, group: "Fit on the Rampart" },
  { key: "shoulderTilt", label: "Shoulder weapon tilt (°)", min: -10, max: 60, step: 1, group: "Fit on the Rampart" },
  { key: "podTilt", label: "Missile pod face up (°)", min: 0, max: 60, step: 1, group: "Fit on the Rampart", tip: "Keith wants pods to fire up over the shoulder (asset list W4)" },
  { key: "backY", label: "Back weapon height (m)", min: 0, max: 2.5, step: 0.01, group: "Fit on the Rampart", tip: "Above the back mount (the drums)" },
  { key: "backZ", label: "Back weapon forward (m)", min: -1.5, max: 1, step: 0.01, group: "Fit on the Rampart" },
];

export type Slot = "left" | "right" | "shoulderLeft" | "shoulderRight" | "back";

/** The Rampart's mount groups (no change to rampart.ts needed). */
export function rampartHosts(r: RampartBody) {
  const reg = r.regions();
  const kickOf = (yaw: THREE.Object3D) => yaw.children[0];
  return {
    left: kickOf(reg.gunLeft[0]), right: kickOf(reg.gunRight[0]),
    hull: reg.hull[1].parent!, back: reg.back[0],
  };
}

/** Hide or show the Rampart's own minigun pod on a side (a fitted weapon takes its place on the same pivot). */
export function showStockGun(r: RampartBody, side: "left" | "right", on: boolean) {
  const kick = rampartHosts(r)[side];
  for (const o of kick.children) if (!o.userData.weapon) o.visible = on;
}

/** The slot a weapon model sits in by its mount, on a side. */
export function slotFor(w: WeaponModel, side: "left" | "right"): Slot {
  const m = w.entry.mount;
  if (m === "shoulder") return side === "left" ? "shoulderLeft" : "shoulderRight";
  if (m === "back" || m === "projectile" || m === "belt") return "back";
  return side;
}

/** Hang a weapon on the Rampart: in its slot, at the slot's offset, the stock pod hidden where it replaces it. */
export function mountOnRampart(w: WeaponModel, r: RampartBody, side: "left" | "right", v: MountValues = MOUNT_DEFAULTS) {
  const hosts = rampartHosts(r), slot = slotFor(w, side);
  const host = slot === "left" || slot === "right" ? hosts[slot] : slot === "back" ? hosts.back : hosts.hull;
  w.root.userData.weapon = true;
  host.add(w.root);
  if (slot === "left" || slot === "right") showStockGun(r, slot, false);
  placeOnRampart(w, side, v);
  return slot;
}

/** Re-apply the slot offsets (call when the fit sliders change). */
export function placeOnRampart(w: WeaponModel, side: "left" | "right", v: MountValues) {
  const sd = side === "left" ? 1 : -1, m = w.entry.mount, D2R = Math.PI / 180;
  const R = w.root;
  R.rotation.set(0, 0, 0);
  R.scale.setScalar(w.entry.fit * v.weaponScale);
  // Models rooted on the joint (the asset-list contract, the stand-ins, the desktop GLBs) sit right on the pivot; the
  // old kit's centred guns (rooted on their own axis) hang outboard by the offsets.
  const centred = w.rootAt === "trunnion";
  if (m === "hull") R.position.set(centred ? sd * v.hullOut : 0, centred ? v.hullUp : 0, centred ? v.hullFwd : 0);
  else if (m === "hand" || m === "forearm" || m === "two_handed") R.position.set(m === "two_handed" ? sd * v.handOut * 0.6 : sd * v.handOut, v.handUp, v.handFwd);
  else if (m === "shoulder") {
    R.position.set(sd * v.shoulderX, v.shoulderY, v.shoulderZ);
    R.rotation.x = -(w.entry.cls === "MissilePod" ? v.podTilt : v.shoulderTilt) * D2R;
  } else R.position.set(0, v.backY, v.backZ);
}
