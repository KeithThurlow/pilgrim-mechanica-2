// 2D sections for the kit's lofts and extrusions (x across, y up), ported from wkit.py.
export type Ring2 = [number, number][];

/** A chamfered rectangle: half width hw, half height hh, top corners chamfered ch, bottom chBot; batter narrows the
 * top edge, belly the bottom (the angular armour of a cast housing). */
export function octRing(hw: number, hh: number, ch: number, batter = 0, belly = 0, chBot?: number): Ring2 {
  let cb = chBot ?? ch;
  ch = Math.min(ch, hw * 0.9, hh * 0.9);
  cb = Math.min(cb, hw * 0.9, hh * 0.9);
  const tw = hw - batter, bw = hw - belly;
  return [[-bw + cb, -hh], [bw - cb, -hh], [hw, -hh + cb], [hw, hh - ch], [tw - ch, hh], [-tw + ch, hh], [-hw, hh - ch], [-hw, -hh + cb]];
}

/** A faceted section: sides break at `shoulder` of the height, top and bottom faces narrowed. */
export function hexRing(hw: number, hh: number, shoulder = 0.35, top = 0.55, bottom = 0.7): Ring2 {
  const zs = hh * (2 * shoulder - 1);
  return [[-hw * bottom, -hh], [hw * bottom, -hh], [hw, zs], [hw * 0.96, hh * 0.45], [hw * top, hh], [-hw * top, hh], [-hw * 0.96, hh * 0.45], [-hw, zs]];
}

/** A superellipse: p 2 = ellipse, higher = squarer with rounded corners. */
export function sellRing(hw: number, hh: number, n = 16, p = 3, phase = 0): Ring2 {
  const out: Ring2 = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n + phase, c = Math.cos(a), s = Math.sin(a);
    out.push([hw * Math.sign(c) * Math.abs(c) ** (2 / p), hh * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return out;
}

export function circle(r: number, n = 12, phase = 0): Ring2 {
  return Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n + phase; return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]; });
}

export function scaled(ring: Ring2, kx: number, ky = kx, dx = 0, dy = 0): Ring2 {
  return ring.map(([x, y]) => [x * kx + dx, y * ky + dy]);
}

/** A lobed outline (clamp plates, star nuts). */
export function lobed(r: number, lobes: number, depth = 0.25, nPer = 4, phase = 0): Ring2 {
  const n = lobes * nPer, out: Ring2 = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n + phase, k = 1 - depth * (0.5 - 0.5 * Math.cos(lobes * (a - phase)));
    out.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
  }
  return out;
}
