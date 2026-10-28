// Day and night rules (src/world/daynight.ts): the noon sun is the Sun height slider, the night is nightShare of the
// day, the shadow light never drops under its floor, one key light at a time (and none at the handover), the clock
// wraps, and the grade never jumps between neighbouring minutes.
import { skyAt, sunAt, DayClock, DAYNIGHT_DEFAULTS } from "../src/world/daynight";
import { LOOK_DEFAULTS } from "../src/world/look";

let fails = 0;
const fail = (m: string) => { fails++; console.log("FAIL", m); };
const V = { ...LOOK_DEFAULTS, ...DAYNIGHT_DEFAULTS, dayCycle: 1 };

for (const noonEl of [36, 55, 70]) for (const share of [0.25, 0.35, 0.45]) {
  const noon = sunAt(12, V.sunAzimuth, noonEl, share);
  if (Math.abs(noon.el - noonEl) > 0.05) fail(`noon height ${noon.el.toFixed(2)} for ${noonEl}`);
  let down = 0; const N = 2880;
  for (let i = 0; i < N; i++) if (sunAt((i / N) * 24, V.sunAzimuth, noonEl, share).el < 0) down++;
  if (Math.abs(down / N - share) > 0.005) fail(`night share ${(down / N).toFixed(3)} for ${share}`);
}

let prev = skyAt(0, V), maxJump = 0, minShadowEl = 90, both = 0;
const marks: string[] = [];
for (let m = 1; m <= 24 * 60; m++) {
  const h = (m / 60) % 24, s = skyAt(h, V);
  const keyEl = Math.asin(s.keyDir.y) * 180 / Math.PI;
  if (s.keyK > 0.001) minShadowEl = Math.min(minShadowEl, keyEl);
  if (s.keyFrom === "sun" && s.sunEl < V.handoverEl - 0.01 && s.keyK > 0) both++;
  if (s.keyFrom === "moon" && s.sunEl > V.handoverEl + 0.01) both++;
  const jump = Math.abs(s.keyK - prev.keyK) + Math.abs(s.exposure - prev.exposure) + Math.abs(s.grade.night - prev.grade.night);
  maxJump = Math.max(maxJump, jump);
  prev = s;
  if ([4, 6, 12, 17, 18.5, 19.5, 20.3, 21, 23].includes(Math.round(h * 100) / 100))
    marks.push(`${h.toFixed(1)}h sun ${s.sunEl.toFixed(1)}° key ${s.keyFrom} ${s.keyK.toFixed(2)} at ${keyEl.toFixed(0)}° shadow ${s.shadow.toFixed(2)} exp ${s.exposure.toFixed(2)} night ${s.grade.night.toFixed(2)}`);
}
if (minShadowEl < V.shadowMinEl - 0.01) fail(`shadow light down to ${minShadowEl.toFixed(1)}°`);
if (both) fail(`${both} minutes with the key from the wrong body`);
if (maxJump > 0.05) fail(`grade jumps ${maxJump.toFixed(3)} in a minute`);

const c = new DayClock(23.9); c.step(6, { dayLength: 20 });
if (!(c.hour >= 0 && c.hour < 1)) fail(`clock wrap ${c.hour}`);

console.log(marks.join("\n"));
console.log(fails ? `daynight-check: ${fails} failed` : "daynight-check: ok (noon height, night share, shadow floor, one key light, smooth grade, wrap)");
if (fails) throw new Error("daynight check failed");
