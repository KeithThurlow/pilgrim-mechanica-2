// Click-and-drag aiming for the line weapons (line mortar, napalm launcher; Keith 2026-11-05: "you target on the
// ground where you want to hit and then you pull your mouse in the direction that you want it to launch ... almost
// like a firewall ability"). Pure: a small state machine per shoulder, fed the key, the left button and the cursor
// each frame; it says what to show and when to fire. src/weapons/arsenal.ts runs it, plans the strip and fires.
//
// - Hold the key and let go: as before, the strip toward the cursor (planStrip, with the snap to a group).
// - Tap the key (shorter than lineTap): armed. The default strip follows the cursor; the left button belongs to the
//   aim, not the left gun. Press the left button on the sand: that's where the line starts. Drag: the way it runs.
//   Let go: it fires. A drag shorter than lineDragMin runs the line straight away from the mech.
// - Tap the key again while armed (a double tap): it fires the default strip at once.
// - Armed and left alone lineArmTime s, sprinting with the weapons off, or the key held into a paint: back to normal.
// - The left button pressed while the key is held starts a drag too.
//
// Ownership: the player's own aim (it becomes a strip, which is the fire command). AIs never arm it (MechUnit.clickAim).

import type { Param } from "../core/tweaks";
import type { Strip } from "./painter";

export const LINE_AIM_GROUP = "Line aim (click and drag)";

export const LINE_AIM_DEFAULTS = {
  lineAimOn: 1,
  lineTap: 0.25,
  lineArmTime: 6,
  lineDragMin: 2,
};
export type LineAimValues = typeof LINE_AIM_DEFAULTS;

export const LINE_AIM_PARAMS: Param[] = [
  { key: "lineAimOn", label: "Click and drag on", min: 0, max: 1, step: 1, group: LINE_AIM_GROUP, tip: "Tap the key, then click on the sand and drag the way the line should run; let go fires. 0: hold and release only" },
  { key: "lineTap", label: "Tap is shorter than (s)", min: 0.05, max: 0.6, step: 0.01, group: LINE_AIM_GROUP, tip: "A key press shorter than this arms the click and drag; longer is the old hold and release" },
  { key: "lineArmTime", label: "Armed for (s)", min: 1, max: 20, step: 0.5, group: LINE_AIM_GROUP, tip: "Armed and not clicked this long, it disarms" },
  { key: "lineDragMin", label: "Least drag (m)", min: 0.2, max: 10, step: 0.1, group: LINE_AIM_GROUP, tip: "A drag shorter than this runs the line straight away from the mech from where you clicked" },
];

export type LineAimState = "idle" | "held" | "armed" | "drag" | "spent";

export interface LineAimInput {
  /** The shoulder's key down. */
  key: boolean;
  /** The left mouse button down (raw, before the left gun's trigger is held back). */
  click: boolean;
  /** The cursor on the sand, or null. */
  cursor: { x: number; z: number } | null;
  /** Click and drag allowed (the player's mech, the slider on). */
  enabled: boolean;
}

/** What the frame asks for: "paint" the default strip (toward the cursor), "drag" a strip from the anchor, or fire one of them. */
export type LineAimOut = "none" | "paint" | "drag" | "fireDefault" | "fireDrag";

export class LineAim {
  state: LineAimState = "idle";
  /** Seconds in the state. */
  t = 0;
  /** Where the line starts (the left button's press on the sand). */
  anchor = { x: 0, z: 0 };
  private prevKey = false;
  private prevClick = false;
  /** The left button was already down (firing the left gun) when the key went down: it stays the gun's. */
  private gunClick = false;

  reset() { this.state = "idle"; this.t = 0; this.prevKey = false; this.prevClick = false; this.gunClick = false; }

  /** The left button is the aim's, not the left gun's (armed, dragging, or the key held). */
  claimsClick(): boolean { return this.state === "armed" || this.state === "drag" || (this.state === "held" && !this.gunClick); }

  step(dt: number, inp: LineAimInput, v: LineAimValues): LineAimOut {
    const keyDown = inp.key && !this.prevKey;
    const clickDown = inp.click && !this.prevClick;
    this.prevKey = inp.key; this.prevClick = inp.click;
    this.t += dt;
    const on = inp.enabled && v.lineAimOn > 0;
    const go = (s: LineAimState) => { this.state = s; this.t = 0; };
    const startDrag = () => { if (!inp.cursor) return false; this.anchor.x = inp.cursor.x; this.anchor.z = inp.cursor.z; go("drag"); return true; };
    switch (this.state) {
      case "idle":
        if (keyDown || inp.key) { go("held"); this.gunClick = inp.click; return "paint"; }
        return "none";
      case "held":
        if (!inp.click) this.gunClick = false;
        if (on && clickDown && startDrag()) return "drag";
        if (!inp.key) {
          if (on && this.t < v.lineTap) { go("armed"); return "paint"; }
          go("idle"); return "fireDefault";
        }
        return "paint";
      case "armed":
        if (keyDown) { go("spent"); return "fireDefault"; }
        if (!on || this.t > v.lineArmTime) { go("idle"); return "none"; }
        if (clickDown && startDrag()) return "drag";
        return "paint";
      case "drag":
        if (!on) { go(inp.key ? "spent" : "idle"); return "none"; }
        // Let go: it fires.
        if (!inp.click) { go(inp.key ? "spent" : "idle"); return "fireDrag"; }
        return "drag";
      case "spent":
        // Fired with the key still down: wait for it to come up (holding it doesn't paint another).
        if (!inp.key) go("idle");
        return "none";
    }
  }

  /**
   * The dragged strip: it starts at the anchor (kept between the nearest and farthest ends' ranges from the mech) and
   * runs `length` m toward the cursor, or straight away from the mech if the drag is short.
   */
  strip(from: { x: number; z: number }, cursor: { x: number; z: number } | null, length: number, width: number, minRange: number, maxRange: number, dragMin: number): Strip {
    let ax = this.anchor.x, az = this.anchor.z;
    let ox = ax - from.x, oz = az - from.z, od = Math.hypot(ox, oz);
    if (od < 1e-3) { ox = 0; oz = 1; od = 1; }
    const r = Math.min(Math.max(od, minRange), Math.max(minRange, maxRange));
    ax = from.x + ox / od * r; az = from.z + oz / od * r;
    let dx = 0, dz = 0, d = 0;
    if (cursor) { dx = cursor.x - this.anchor.x; dz = cursor.z - this.anchor.z; d = Math.hypot(dx, dz); }
    if (d < dragMin) { dx = ox; dz = oz; d = od; }
    dx /= d; dz /= d;
    return { ax, az, bx: ax + dx * length, bz: az + dz * length, width };
  }
}
