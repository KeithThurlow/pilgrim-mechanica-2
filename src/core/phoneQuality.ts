// The phone preset (Keith 2026-11-07: still dropping frames on his phone at ?res=0.15, so the cost isn't pixels):
// tuning values a touch screen starts from instead of the PC's, applied by tweakPanel as that lab's defaults (sliders
// and ?set= still win). `?lite=0` turns the preset off; the sun's shadows come back with `?shadows=1` (src/core/app.ts).
import { touchMode } from "./touch";

const flag = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("lite");
export const phoneLite = flag !== null ? flag !== "0" : touchMode;

export const PHONE_PRESET: Record<string, number> = {
  waveOn: 0,               // blast waves: the screen-bend pass and heat shimmer
  heatOn: 0,               // hot sand glow
  fxDustPerFrame: 150,     // 400 on the PC
  fxGpuDustPerFrame: 400,  // 1600
  fxGpuDustPool: 8192,     // 32768
  fxThinFrom: 20,          // effects thin out from 20 m (30) ...
  fxThinTo: 50,            // ... to their thinnest at 50 m (90)
  dentRes: 1024,           // the GPU dent layer: a quarter of the texels (2048)
  // The detail patch (src/world/detailPatch.ts) was 524k of the 864k triangles a frame in the convoy lab, the same at
  // any ?res= (Keith 2026-11-08: 12-17 fps, 40-80 ms of GPU wait): 50 cm between vertices and no denser middle make it
  // 74k. Footprints and berms still show through the dent texture's per-pixel normals.
  patchSpacing: 0.5,       // 0.25
  patchFineSub: 1,         // 2
};

/** The phone preset over a system's defaults, where they're declared, so values read before any panel is built (the
 *  GPU dust pool, sized once at start) take it too. Not in the sim worker or headless checks (no touch screen there). */
export function phoneDefaults<T extends object>(d: T): T {
  if (phoneLite) for (const k of Object.keys(d)) { const v = PHONE_PRESET[k]; if (v !== undefined) (d as Record<string, unknown>)[k] = v; }
  return d;
}
