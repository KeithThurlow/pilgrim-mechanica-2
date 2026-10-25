// The convoy's defences (Keith 2026-10-25: "there should be defenses on the convoy"). Pure, no rendering.
//
// Twin-gun turrets on sponsons at the cut corners of every platform (defenceCount per car: front right, rear left,
// front left, rear right in that order, so two cover opposite quarters) and a heavy turret on each mech bay's cab roof.
// Each turret slews (yaw relative to its platform, then pitch) toward the nearest threat in range at its own turn
// rate; with nothing to shoot it sweeps slowly about its rest bearing (straight out from its corner).
// Hooks for the combat code, not wired yet (the convoy lab has no enemies): `target(points)` hands it the threats each
// frame, `onFire` is called when a turret is on target and its gun is ready (muzzle and direction in world space).
import type { Param } from "../core/tweaks";
import type { Platform } from "./platform";

export const DEFENCE_DEFAULTS = {
  defenceCount: 2,
  defenceHeavy: 1,
  defenceTurn: 90,
  defenceHeavyTurn: 40,
  defenceRange: 120,
  defenceScan: 35,
  defenceRate: 6,
  defenceHeavyRate: 0.8,
};
export type DefenceValues = typeof DEFENCE_DEFAULTS;

const G = "Defences";
export const DEFENCE_PARAMS: Param[] = [
  { key: "defenceCount", label: "Turrets per car", min: 0, max: 4, step: 1, group: G, tip: "Twin-gun turrets on sponsons at the cut corners of every platform" },
  { key: "defenceHeavy", label: "Heavy turret on the mech bays", min: 0, max: 1, step: 1, group: G, tip: "A heavy gun on each mech bay's cab roof" },
  { key: "defenceTurn", label: "Turn rate (°/s)", min: 10, max: 360, step: 5, group: G, tip: "How fast a twin turret slews and elevates" },
  { key: "defenceHeavyTurn", label: "Heavy turn rate (°/s)", min: 5, max: 180, step: 5, group: G },
  { key: "defenceRange", label: "Range (m)", min: 20, max: 300, step: 5, group: G, tip: "Threats beyond this are ignored" },
  { key: "defenceScan", label: "Idle sweep (°)", min: 0, max: 90, step: 1, group: G, tip: "With nothing to shoot, a turret sweeps this far either side of straight out" },
  { key: "defenceRate", label: "Twin shots per second", min: 0.5, max: 20, step: 0.5, group: G, tip: "For the fire hook (nothing shoots in the convoy lab yet)" },
  { key: "defenceHeavyRate", label: "Heavy shots per second", min: 0.1, max: 4, step: 0.05, group: G },
];

const D2R = Math.PI / 180;
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Corner-cut edges of the outline (outline.ts order: 1 front right, 3 rear right, 5 rear left, 7 front left), in fitting order. */
const CORNERS = [1, 5, 7, 3];
/** Pivot above the deck (m): twin on its sponson, heavy on the cab roof. */
export const TWIN_UP = 1.1, HEAVY_UP = 3.3;
/** How far a sponson stands out past the corner cut (m). */
export const SPONSON_OUT = 0.55;

export interface P3 { x: number; y: number; z: number }

export interface Turret {
  kind: "twin" | "heavy";
  platform: Platform;
  /** Pivot on the platform (local x left, y up from the ground plane, z forward) and its rest bearing (radians, local). */
  x: number; y: number; z: number; rest: number;
  /** Aim relative to the platform (radians; yaw 0 = forward, + left) and elevation (+ up). */
  yaw: number; pitch: number;
  /** What it's tracking, if anything, and seconds until the gun is ready. */
  target: P3 | null;
  cooldown: number;
  phase: number;
}

export class Defence {
  readonly turrets: Turret[] = [];
  /** Called when a turret is on target and ready: the turret, its muzzle and unit direction (world). Not wired yet. */
  onFire: ((t: Turret, from: P3, dir: P3) => void) | null = null;
  private threats: P3[] = [];
  private built = "";
  private time = 0;
  private w = { x: 0, y: 0, z: 0 };

  constructor(public v: DefenceValues, readonly platforms: Platform[]) { this.build(); }

  /** The threats to track this frame (world points; empty for none). */
  target(points: P3[]) { this.threats = points; }

  /** Turrets from the sliders (rebuilt when the count or the heavy option changes). */
  private build() {
    const v = this.v, n = Math.round(clamp(v.defenceCount, 0, 4)), heavy = v.defenceHeavy >= 0.5;
    const key = `${n}|${heavy}`;
    if (key === this.built) return;
    this.built = key;
    this.turrets.length = 0;
    let i = 0;
    for (const p of this.platforms) {
      const ol = p.outline, D = p.deck;
      for (const e of CORNERS.slice(0, n)) {
        const [ax, az] = ol.pts[e], [bx, bz] = ol.pts[(e + 1) % ol.pts.length], edge = ol.edges[e];
        const x = (ax + bx) / 2 + edge.nx * SPONSON_OUT, z = (az + bz) / 2 + edge.nz * SPONSON_OUT;
        const rest = Math.atan2(edge.nx, edge.nz);
        this.turrets.push({ kind: "twin", platform: p, x, y: D + TWIN_UP, z, rest, yaw: rest, pitch: 0, target: null, cooldown: 0, phase: i++ * 2.3 });
      }
      if (heavy && p.spec.kind === "bay") {
        // On the cab roof, off to one side when a footbridge lands on the middle of it.
        const x = p.follows >= 0 ? -2 : 0;
        this.turrets.push({ kind: "heavy", platform: p, x, y: D + HEAVY_UP, z: p.spec.length / 2 - 2, rest: 0, yaw: 0, pitch: 0, target: null, cooldown: 0, phase: i++ * 2.3 });
      }
    }
  }

  /** The turret's pivot in world space. */
  pivot(t: Turret, out: P3 = { x: 0, y: 0, z: 0 }) { return t.platform.toWorld(t.x, t.y, t.z, out); }

  /** Its barrels' direction in world space. */
  aimDir(t: Turret, out: P3 = { x: 0, y: 0, z: 0 }) {
    const p = t.platform, cy = Math.cos(t.pitch), lx = Math.sin(t.yaw) * cy, ly = Math.sin(t.pitch), lz = Math.cos(t.yaw) * cy;
    out.x = p.left.x * lx + p.up.x * ly + p.fwd.x * lz;
    out.y = p.left.y * lx + p.up.y * ly + p.fwd.y * lz;
    out.z = p.left.z * lx + p.up.z * ly + p.fwd.z * lz;
    return out;
  }

  update(dt: number) {
    this.build();
    this.time += dt;
    const v = this.v;
    for (const t of this.turrets) {
      const w = this.pivot(t, this.w), p = t.platform;
      // Nearest threat in range.
      let best: P3 | null = null, bd = v.defenceRange;
      for (const q of this.threats) { const d = Math.hypot(q.x - w.x, q.y - w.y, q.z - w.z); if (d < bd) { bd = d; best = q; } }
      t.target = best;
      let wantYaw: number, wantPitch: number;
      if (best) {
        // Into the platform's frame: yaw about its up, pitch above its deck plane.
        const dx = best.x - w.x, dy = best.y - w.y, dz = best.z - w.z;
        const lx = p.left.x * dx + p.left.y * dy + p.left.z * dz, ly = p.up.x * dx + p.up.y * dy + p.up.z * dz, lz = p.fwd.x * dx + p.fwd.y * dy + p.fwd.z * dz;
        wantYaw = Math.atan2(lx, lz);
        wantPitch = Math.atan2(ly, Math.hypot(lx, lz));
      } else {
        wantYaw = t.rest + v.defenceScan * D2R * Math.sin(this.time * 0.35 + t.phase);
        wantPitch = 4 * D2R;
      }
      const rate = (t.kind === "heavy" ? v.defenceHeavyTurn : v.defenceTurn) * D2R * dt;
      t.yaw = wrap(t.yaw + clamp(wrap(wantYaw - t.yaw), -rate, rate));
      t.pitch += clamp(clamp(wantPitch, -10 * D2R, 60 * D2R) - t.pitch, -rate, rate);
      t.cooldown = Math.max(0, t.cooldown - dt);
      if (best && this.onFire && t.cooldown <= 0 && Math.abs(wrap(wantYaw - t.yaw)) < 3 * D2R) {
        t.cooldown = 1 / Math.max(0.05, t.kind === "heavy" ? v.defenceHeavyRate : v.defenceRate);
        this.onFire(t, { ...w }, this.aimDir(t));
      }
    }
  }

  /** Bearing error to its target (radians), or null with none: for the check and HUD. */
  error(t: Turret) {
    if (!t.target) return null;
    const w = this.pivot(t, this.w), p = t.platform, q = t.target;
    const dx = q.x - w.x, dy = q.y - w.y, dz = q.z - w.z;
    const lx = p.left.x * dx + p.left.y * dy + p.left.z * dz, lz = p.fwd.x * dx + p.fwd.y * dy + p.fwd.z * dz;
    return Math.abs(wrap(Math.atan2(lx, lz) - t.yaw));
  }
}
