// Everything that marks the ground goes through here: footprints, ruts, dash furrows, round strikes, blasts. Each
// call becomes a dent brush (src/fx/dents.ts). Without a dent layer (headless, before useDents) marks are dropped.
// (The old flat decals were deleted 2026-10-26 once Keith approved the dents.)
import type { Ground } from "../mech/walker";
import type { DentLayer, DentValues } from "./dents";

export type GroundMarkValues = DentValues;

export class GroundMarks {
  /** Set by Battlefield.useDents; null: marks are dropped. */
  dents: DentLayer | null = null;
  private nn = [0, 1, 0];

  constructor(private ground: Ground, public v: GroundMarkValues) {}

  /** Is there a dent layer to mark? */
  get denting(): boolean { return !!this.dents; }

  /** A foot planted at (x, z) facing yaw; strength around 1. On a steep face it also leaves a slide downhill. */
  print(x: number, z: number, yaw: number, strength: number) {
    if (!this.denting) return;
    const v = this.v, nr = this.ground.normal(x, z, this.nn), steep = 1 - nr[1], s = v.printSize;
    // The Rampart's foot: about 0.95 m across and 1.35 m long, pressed deeper on steep sand (it slides in).
    this.dents!.stamp(x, z, 0.45 * s, yaw, 1.42, v.dentPrint * Math.min(1.6, 0.7 + 0.3 * strength) * (1 + steep * 1.5));
    // Only properly steep sand breaks loose.
    if (v.slideOnSlope > 0 && steep > 0.14) {
      // Sand broken loose downhill: a long shallow trough with its sand piled at the bottom.
      const dx = nr[0], dz = nr[2], l = Math.hypot(dx, dz) || 1;
      const len = (1 + steep * 9) * v.slideOnSlope, r = 0.45 * s;
      this.dents!.stamp(x + (dx / l) * len * 0.45, z + (dz / l) * len * 0.45, r, Math.atan2(dx, dz), Math.max(1, len / (2 * r)), v.dentPrint * 0.2 * (0.5 + steep), { berm: 1.3, comp: 0.2 });
    }
  }

  /** A wheel or track rut: a trough `width` m wide, `length` m long along yaw. */
  rut(x: number, z: number, yaw: number, width: number, length: number) {
    if (!this.denting) return;
    const r = (width / 2) * this.v.dentRutWidth;
    this.dents!.stamp(x, z, r, yaw, Math.max(1, length / (2 * r)), this.v.dentRut, { comp: Math.min(1, this.v.dentComp * 1.3) });
  }

  /**
   * A skidding foot from (x0, z0) to (x1, z1) this frame (the dash): a continuous furrow with the sand shoved up
   * either side.
   */
  furrow(x0: number, z0: number, x1: number, z1: number, width: number, _dt: number) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (!this.denting || len < 1e-3) return;
    const r = width / 2;
    this.dents!.stamp((x0 + x1) / 2, (z0 + z1) / 2, r, Math.atan2(dx, dz), 1 + len / (2 * r), this.v.dentFurrow, { berm: 1.2, comp: 0.7 });
  }

  /** A shell (k about 1) or a blast (k several) into the sand: a round crater. */
  crater(x: number, z: number, k: number) {
    if (!this.denting) return;
    const v = this.v, d = this.dents!;
    const big = k >= 2;
    if (!big && !d.roundDue()) return;
    const r = v.craterSize * (0.7 + Math.random() * 0.6) * Math.sqrt(Math.max(0.2, k));
    d.stamp(x, z, r, Math.random() * Math.PI * 2, 1, (big ? v.dentBlast : v.dentRound) * Math.sqrt(Math.max(0.2, k)), { mode: "add", comp: 0.25 });
  }

  /**
   * A minigun round into the sand (Keith 2026-10-27): a U open toward the shooter, along its flight (dx, dz), longer
   * and more open the lower it skims in (down: 0 level .. 1 straight down). k: the hit's strength (Hit size × scale).
   * The minigun's sand hits come here, and other small-calibre weapons (SMGs) should too; shells and blasts keep crater().
   */
  roundHit(x: number, z: number, k: number, dx: number, dz: number, down: number) {
    if (!this.denting || !this.dents!.roundDue()) return;
    const v = this.v;
    const steep = Math.min(1, Math.max(0, down)) * v.dentHitAngle;
    const s = Math.sqrt(Math.max(0.2, k / 2.1));
    const r = v.dentHitSize * (0.7 + Math.random() * 0.6) * s;
    const yaw = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.2;
    const elong = 1 + (v.dentHitLength - 1) * (1 - steep);
    this.dents!.stamp(x, z, r, yaw, elong, v.dentHitDepth * s, { mode: "add", comp: 0.25, open: v.dentHitOpen * (1 - 0.7 * steep) });
  }

  /**
   * An explosive's blast of this radius (m) at (x, z): the real crater goes into the true ground (Battlefield.blast
   * queues it); this is the fine churned bowl and rim on top, sized to the blast.
   */
  blast(x: number, z: number, radius: number) {
    const k = Math.max(0.5, radius / 3);
    if (!this.denting) return;
    const r = Math.max(0.3, radius * 0.4) * (0.85 + Math.random() * 0.3);
    this.dents!.stamp(x, z, r, Math.random() * Math.PI * 2, 1, this.v.dentBlast * Math.sqrt(k), { mode: "add", comp: 0.3 });
  }
}
