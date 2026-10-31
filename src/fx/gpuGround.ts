// The ground for GPU effects (scale step 5): height and normal off the detail patch's copy of the chunks' own grid
// (src/world/detailPatch.ts gpuGround; 1 m apart round the camera focus), bilinear. Outside the window, or before it
// has filled, a fallback height (the particle's own ground from when it was made) with a flat normal. Looks only, like
// src/world/chunkGround.ts on the CPU.
import type * as THREE from "three/webgpu";
import { float, int, ivec2, floor, mod, textureLoad, vec4, mix, select } from "three/tsl";
import type { DetailPatch } from "../world/detailPatch";

export type GpuGroundSource = DetailPatch["gpuGround"];
type F = THREE.Node<"float">;

/** vec4(height, normal x, y, z) at world (x, z). */
export function groundAt(g: GpuGroundSource, x: F, z: F, fallback: F): THREE.Node<"vec4"> {
  const fx = x.div(g.step), fz = z.div(g.step);
  const ix = floor(fx), iz = floor(fz);
  const tx = fx.sub(ix), tz = fz.sub(iz);
  const M = g.wrap;
  // Wrapped storage index (offset half a cell so float rounding can't land on the next one), as the patch does.
  const w = (i: F) => int(floor(mod(i.add(0.5), M)));
  const a = textureLoad(g.tex, ivec2(w(ix), w(iz))), b = textureLoad(g.tex, ivec2(w(ix.add(1)), w(iz)));
  const c = textureLoad(g.tex, ivec2(w(ix), w(iz.add(1)))), d = textureLoad(g.tex, ivec2(w(ix.add(1)), w(iz.add(1))));
  const v = mix(mix(a, b, tx), mix(c, d, tx), tz);
  const ox = g.origin.x, oz = g.origin.y;
  const inside = g.ready.greaterThan(0.5)
    .and(ix.greaterThanEqual(ox)).and(ix.add(1).lessThanEqual(ox.add(g.cells)))
    .and(iz.greaterThanEqual(oz)).and(iz.add(1).lessThanEqual(oz.add(g.cells)));
  return select(inside, v, vec4(fallback, float(0), float(1), float(0)));
}
