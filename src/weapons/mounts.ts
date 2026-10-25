// Where weapon models hang on the Rampart: its own mounts (src/mech/rampart.ts mount()): a gun side's pivot (it aims
// and kicks with the gun; the stock pod hidden), a shoulder mount on the hull, the top of the back mount. Models
// rooted on their mount (the asset-list contract, the stand-ins, the desktop GLBs) sit right on it; the old kit's
// centred guns (rooted on their own axis) hang outboard by the offsets. Offsets and the pod tilt are sliders.
import type { Param } from "../core/tweaks";
import type { RampartBody } from "../mech/rampart";
import type { WeaponModel } from "./weaponModel";

export const MOUNT_DEFAULTS = {
  weaponScale: 1,
  hullOut: 0.94, hullUp: -0.32, hullFwd: 0.0,
  handOut: 0.95, handUp: -0.75, handFwd: 0.35,
  shoulderTilt: 0,
  podTilt: 30,
};
export type MountValues = typeof MOUNT_DEFAULTS;

export const MOUNT_PARAMS: Param[] = [
  { key: "weaponScale", label: "Weapon scale", min: 0.5, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "Times each model's fit (1 = the old kit's game size, which is the Rampart's)" },
  { key: "hullOut", label: "Centred hull gun outboard (m)", min: 0, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "The old kit's hull guns (minigun M), rooted on their own axis: from the shoulder joint to the axis. Models rooted on the joint ignore these" },
  { key: "hullUp", label: "Centred hull gun up (m)", min: -1.5, max: 1, step: 0.01, group: "Fit on the Rampart" },
  { key: "hullFwd", label: "Centred hull gun forward (m)", min: -1, max: 1.5, step: 0.01, group: "Fit on the Rampart" },
  { key: "handOut", label: "Hand gun outboard (m)", min: 0, max: 2, step: 0.01, group: "Fit on the Rampart", tip: "Hand, forearm and two-handed guns (the Rampart has no hands: shown on the gun pivot)" },
  { key: "handUp", label: "Hand gun up (m)", min: -2, max: 1, step: 0.01, group: "Fit on the Rampart" },
  { key: "handFwd", label: "Hand gun forward (m)", min: -1, max: 2, step: 0.01, group: "Fit on the Rampart" },
  { key: "shoulderTilt", label: "Shoulder weapon tilt (°)", min: -10, max: 60, step: 1, group: "Fit on the Rampart" },
  { key: "podTilt", label: "Missile pod face up (°)", min: 0, max: 60, step: 1, group: "Fit on the Rampart", tip: "Keith wants pods to fire up over the shoulder (asset list W4)" },
];

export type Slot = "left" | "right" | "shoulderL" | "shoulderR" | "back";

/** The slot a weapon model sits in by its mount, on a side. */
export function slotFor(w: WeaponModel, side: "left" | "right"): Slot {
  const m = w.entry.mount;
  if (m === "shoulder") return side === "left" ? "shoulderL" : "shoulderR";
  if (m === "back" || m === "projectile" || m === "belt") return "back";
  return side;
}

/** Hang a weapon on the Rampart in its slot, the stock pod hidden where it takes the gun pivot. */
export function mountOnRampart(w: WeaponModel, r: RampartBody, side: "left" | "right", v: MountValues = MOUNT_DEFAULTS) {
  const slot = slotFor(w, side);
  w.root.userData.weapon = true;
  r.mount(slot).add(w.root);
  if (slot === "left" || slot === "right") r.showPod(slot === "left" ? 1 : -1, false);
  placeOnRampart(w, side, v);
  return slot;
}

/** Re-apply the offsets (call when the fit sliders change). */
export function placeOnRampart(w: WeaponModel, side: "left" | "right", v: MountValues) {
  const sd = side === "left" ? 1 : -1, m = w.entry.mount, D2R = Math.PI / 180, R = w.root;
  R.rotation.set(0, 0, 0);
  R.scale.setScalar(w.entry.fit * v.weaponScale);
  R.position.set(0, 0, 0);
  const centred = w.rootAt === "trunnion";
  if (m === "hull" && centred) R.position.set(sd * v.hullOut, v.hullUp, v.hullFwd);
  else if (m === "hand" || m === "forearm" || m === "two_handed") R.position.set(m === "two_handed" ? sd * v.handOut * 0.6 : sd * v.handOut, v.handUp, v.handFwd);
  else if (m === "shoulder") R.rotation.x = -(w.entry.cls === "MissilePod" ? v.podTilt : v.shoulderTilt) * D2R;
}
