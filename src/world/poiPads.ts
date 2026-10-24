// POI pads as a ground modifier: where a POI needs flat ground (a debris field, a line of dead vehicles) the dunes
// are cut and filled to a level floor at the mean height of the ground it covers, with a blend back to the dunes.
// Pure: a height lookup asks the POI field for the POI of each grid level whose cell holds the point (pads never
// cross their cell's edge), plus hand-placed ones in grid buckets. Stack it with the convoy road via addModifier.
import { DuneField, type GroundModifier, type ModifierSample } from "./terrain";
import type { Pad, PoiField, PoiPlacement, RawGround } from "./pois";

const smooth = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const BUCKET = 64;

export class PoiPads implements GroundModifier {
  private cells: (PoiPlacement | null)[] = [];
  private buckets = new Map<number, Pad[]>();
  private one: ModifierSample = { w: 0, berm: 0, lift: 0, rough: 0 };

  constructor(readonly pois: PoiField) { this.reindex(); }

  /** Re-bucket the hand-placed pads (after `pois.extra` changes). */
  reindex() {
    this.buckets.clear();
    for (const p of this.pois.extra) {
      const d = p.pad;
      if (!d) continue;
      const R = d.r + d.half + d.blend;
      for (let j = Math.floor((d.z - R) / BUCKET); j <= Math.floor((d.z + R) / BUCKET); j++)
        for (let i = Math.floor((d.x - R) / BUCKET); i <= Math.floor((d.x + R) / BUCKET); i++) {
          const k = key(i, j);
          let l = this.buckets.get(k);
          if (!l) this.buckets.set(k, (l = []));
          l.push(d);
        }
    }
  }

  at(x: number, z: number, out: ModifierSample): boolean {
    let any = false;
    let W = 0, L = 0, R = 0;
    const s = this.one;
    const apply = (d: Pad) => {
      if (!padAt(d, x, z, s)) return;
      any = true;
      const k = 1 - s.w;
      L = L * k + s.w * s.lift; R = R * k + s.w * s.rough; W = 1 - (1 - W) * k;
    };
    this.pois.cellsAt(x, z, this.cells);
    for (const p of this.cells) if (p?.pad) apply(p.pad);
    const list = this.buckets.get(key(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    if (list) for (const d of list) apply(d);
    if (!any) return false;
    out.w = W; out.berm = 0; out.lift = W > 1e-9 ? L / W : 0; out.rough = W > 1e-9 ? R / W : 0;
    return true;
  }
}

/** One pad at (x, z): full weight inside the capsule, blending out over `blend`; the floor cancels the swell. */
export function padAt(d: Pad, x: number, z: number, out: ModifierSample): boolean {
  const dx = x - d.x, dz = z - d.z;
  const reach = d.r + d.half + d.blend;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
  const ax = Math.sin(d.yaw), az = Math.cos(d.yaw);
  const t = Math.max(-d.half, Math.min(d.half, dx * ax + dz * az));
  const dist = Math.hypot(dx - ax * t, dz - az * t);
  if (dist >= d.r + d.blend) return false;
  out.w = 1 - smooth(d.r, d.r + d.blend, dist);
  // floor = swell + lift: lift cancels the swell's plane under the pad so the floor stays at d.h.
  out.lift = d.h - (d.s0 + d.sx * dx + d.sz * dz + d.sxx * dx * dx + d.szz * dz * dz + d.sxz * dx * dz);
  out.rough = d.rough;
  out.berm = 0;
  return true;
}

function key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }

/**
 * What POI placement reads of a dune field: its height without any modifier (so the pads, the road and anything
 * else don't feed back into where POIs go) and its swell alone. Two private fields on the same values.
 */
export function rawGround(field: DuneField): RawGround & { refresh(): void } {
  let v = field.v, plain = new DuneField(v), swell = new DuneField(v);
  const full: GroundModifier = { at: (_x, _z, o) => { o.w = 1; o.lift = 0; o.rough = 0; o.berm = 0; return true; } };
  swell.modifier = full;
  const sync = () => {
    if (field.v !== v) { v = field.v; plain = new DuneField(v); swell = new DuneField(v); swell.modifier = full; }
    else { plain.update(); swell.update(); }
  };
  return {
    /** After the dune values change (call before PoiField.reset). */
    refresh: sync,
    height: (x, z) => { if (field.v !== v) sync(); return plain.height(x, z); },
    swell: (x, z) => { if (field.v !== v) sync(); return swell.height(x, z); },
  };
}
