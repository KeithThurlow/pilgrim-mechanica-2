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
};
