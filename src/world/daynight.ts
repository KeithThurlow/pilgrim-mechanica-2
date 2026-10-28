// Day and night (Keith 2026-10-28): the time of day from a clock, pure maths, no three.js.
// Ownership: the clock is HOST state (one shared clock; peers get the hour from the host). Everything else here is a
// pure function of the hour and the sliders, so every peer derives the same sun, moon and grade from it.
//
// The sun runs a real hemisphere path: a latitude and a declination picked so the noon height is the "Sun height"
// slider and the night is `nightShare` of the day (day longer than night, as in a summer hemisphere). It rises on one
// side of the noon direction and sets on the other, low and long at both ends. The moon takes over at night, high and
// steady (40-60°), drifting a little, so its shadows are short and clean.
//
// The grade (key light colour, sky, haze, exposure) is keyframed by the sun's height, with a pink set for the morning
// and an amber/violet set for the evening, blended across noon and midnight so nothing jumps.

import type { Param } from "../core/tweaks";

export const DAYNIGHT_DEFAULTS = {
  /** 0: the old fixed sun (Sun direction/height sliders as is); 1: the sun follows the time of day. */
  dayCycle: 0,
  /** 1: the clock runs; 0: held at timeOfDay. */
  dayRun: 0,
  timeOfDay: 12,
  dayLength: 20,
  nightShare: 0.35,
  shadowMinEl: 13,
  lowShadow: 0.55,
  lowSoft: 1.8,
  lowSunFill: 0.4,
  handoverEl: -2,
  blueHour: 4,
  moonEl: 50,
  moonAz: 140,
  moonDrift: 30,
  moonStrength: 0.18,
  moonShadow: 0.7,
  nightExposure: 1.4,
  nightFill: 0.3,
  stars: 1,
};
export type DayNightValues = typeof DAYNIGHT_DEFAULTS;

const G = "Time of day";
export const DAYNIGHT_PARAMS: Param[] = [
  { key: "dayCycle", label: "Day cycle on", min: 0, max: 1, step: 1, group: G, tip: "Off: the fixed sun above. On: Sun direction and Sun height become the noon sun, and the time of day moves it" },
  { key: "dayRun", label: "Clock running", min: 0, max: 1, step: 1, group: G, tip: "0 pauses the clock at the time below" },
  { key: "timeOfDay", label: "Time of day (h)", min: 0, max: 24, step: 0.05, group: G, tip: "Scrub the day; ?time=18.5 starts there" },
  { key: "dayLength", label: "Day length (min)", min: 1, max: 90, step: 0.5, group: G, tip: "Real minutes for 24 hours" },
  { key: "nightShare", label: "Night share", min: 0.15, max: 0.5, step: 0.01, group: G, tip: "How much of the 24 hours the sun is down (Keith: night a third to two-thirds of the day)" },
  { key: "shadowMinEl", label: "Lowest shadow sun (°)", min: 2, max: 30, step: 0.5, group: G, tip: "The shadow-casting light never drops below this, so evening shadows are long, never endless streaks; the sky still follows the real sun" },
  { key: "lowShadow", label: "Low-sun shadow strength", min: 0, max: 1, step: 0.01, group: G, tip: "Shadow darkness with the sun at the horizon (1 at 35° and up)" },
  { key: "lowSoft", label: "Low-sun shadow softness ×", min: 1, max: 4, step: 0.05, group: G, tip: "Shadow blur × this at the horizon" },
  { key: "lowSunFill", label: "Low-sun sky fill", min: 0, max: 2, step: 0.05, group: G, tip: "Extra sky light as the sun gets low, so the shade side doesn't go black" },
  { key: "handoverEl", label: "Sun-to-moon handover (°)", min: -10, max: 4, step: 0.5, group: G, tip: "Sun height where the key light swaps from sun to moon (both off there: one shadow direction at a time)" },
  { key: "blueHour", label: "Blue hour width (°)", min: 1, max: 10, step: 0.5, group: G, tip: "Sun heights over which the sun fades out above the handover and the moon fades in below it" },
  { key: "moonEl", label: "Moon height (°)", min: 25, max: 75, step: 1, group: G },
  { key: "moonAz", label: "Moon direction (°)", min: 0, max: 360, step: 1, group: G },
  { key: "moonDrift", label: "Moon drift over the night (°)", min: 0, max: 120, step: 1, group: G },
  { key: "moonStrength", label: "Moonlight", min: 0, max: 1.5, step: 0.01, group: G, tip: "× Sun strength" },
  { key: "moonShadow", label: "Moon shadow strength", min: 0, max: 1, step: 0.01, group: G },
  { key: "nightExposure", label: "Night exposure ×", min: 1, max: 3, step: 0.01, group: G, tip: "Exposure lift at night: readable, not black" },
  { key: "nightFill", label: "Night sky fill", min: 0, max: 3, step: 0.05, group: G, tip: "Cool fill light at night" },
  { key: "stars", label: "Stars", min: 0, max: 2, step: 0.05, group: G },
];

const RAD = Math.PI / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The shared clock: hours 0..24. Host-owned; step it with real seconds. */
export class DayClock {
  constructor(public hour = 12) {}
  step(dt: number, v: Pick<DayNightValues, "dayLength">) {
    this.hour = (this.hour + (dt * 24) / Math.max(1, v.dayLength * 60)) % 24;
    if (this.hour < 0) this.hour += 24;
  }
}

export type Vec3 = { x: number; y: number; z: number };

/** Colours are linear-ish 0..1 triples (sRGB hex numbers converted by the caller). */
export interface Grade {
  /** Sun light colour (hex) and its strength × Sun strength. */
  key: number; keyK: number;
  skyTop: number; skyHor: number; ground: number;
  haze: number; hazeK: number;
  /** × Sky and sand light. */
  env: number;
  /** 0 day .. 1 full night: exposure lift, night fill, stars, night lights. */
  night: number;
}

// Keyframes by the sun's real height (degrees), highest first. Evening (setting) and morning (rising) differ only near
// the horizon; below -8° both are the same night.
type Key = { el: number } & Grade;
const NOON: Omit<Key, "el"> = { key: 0xfff3e2, keyK: 1, skyTop: 0x3f78c9, skyHor: 0xd9e2e6, ground: 0xc99a66, haze: 0xe6d6bc, hazeK: 1, env: 1, night: 0 };
const NIGHT: Omit<Key, "el"> = { key: 0x7090ff, keyK: 0, skyTop: 0x0c1838, skyHor: 0x24305c, ground: 0x2a2c3a, haze: 0x1e2850, hazeK: 1.2, env: 1, night: 1 };
const DUSK_DEEP: Omit<Key, "el"> = { key: 0x8a7fc0, keyK: 0, skyTop: 0x182352, skyHor: 0x3e4478, ground: 0x34303e, haze: 0x343a68, hazeK: 1.3, env: 0.9, night: 0.8 };
const EVENING: Key[] = [
  { el: 35, ...NOON },
  { el: 18, key: 0xffe7c8, keyK: 0.97, skyTop: 0x467bc6, skyHor: 0xe0ddd2, ground: 0xc79763, haze: 0xe8d3b2, hazeK: 1.05, env: 0.97, night: 0 },
  { el: 8, key: 0xffb468, keyK: 0.88, skyTop: 0x5276b0, skyHor: 0xf0c48c, ground: 0xb8875a, haze: 0xe8b688, hazeK: 1.2, env: 0.9, night: 0 },
  { el: 2, key: 0xff7a3a, keyK: 0.62, skyTop: 0x465c98, skyHor: 0xf0966a, ground: 0x8e6852, haze: 0xd88c6c, hazeK: 1.35, env: 0.85, night: 0.1 },
  { el: -3, key: 0xc07ab0, keyK: 0.3, skyTop: 0x2a3a7a, skyHor: 0x6a70aa, ground: 0x464460, haze: 0x5a6296, hazeK: 1.4, env: 0.9, night: 0.45 },
  { el: -8, ...DUSK_DEEP },
  { el: -14, ...NIGHT },
];
const MORNING: Key[] = [
  { el: 35, ...NOON },
  { el: 18, key: 0xfff0dc, keyK: 0.97, skyTop: 0x4a7ec8, skyHor: 0xe2e0dc, ground: 0xc79a6a, haze: 0xe8d8c4, hazeK: 1.05, env: 0.97, night: 0 },
  { el: 8, key: 0xffc4a4, keyK: 0.85, skyTop: 0x6680b8, skyHor: 0xf2c6b8, ground: 0xb68e78, haze: 0xeec4b6, hazeK: 1.25, env: 0.9, night: 0 },
  { el: 2, key: 0xff9a90, keyK: 0.6, skyTop: 0x5462a4, skyHor: 0xeea2aa, ground: 0x957676, haze: 0xdc9eaa, hazeK: 1.4, env: 0.85, night: 0.1 },
  { el: -3, key: 0xb08ac8, keyK: 0.3, skyTop: 0x323a7c, skyHor: 0x9a78aa, ground: 0x4e4666, haze: 0x786a9e, hazeK: 1.45, env: 0.9, night: 0.45 },
  { el: -8, ...DUSK_DEEP },
  { el: -14, ...NIGHT },
];

const unhex = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const hexOf = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
function mixHex(a: number, b: number, t: number) {
  const A = unhex(a), B = unhex(b);
  return hexOf(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function mixGrade(a: Grade, b: Grade, t: number): Grade {
  return {
    key: mixHex(a.key, b.key, t), keyK: a.keyK + (b.keyK - a.keyK) * t,
    skyTop: mixHex(a.skyTop, b.skyTop, t), skyHor: mixHex(a.skyHor, b.skyHor, t), ground: mixHex(a.ground, b.ground, t),
    haze: mixHex(a.haze, b.haze, t), hazeK: a.hazeK + (b.hazeK - a.hazeK) * t,
    env: a.env + (b.env - a.env) * t, night: a.night + (b.night - a.night) * t,
  };
}
function sample(keys: Key[], el: number): Grade {
  if (el >= keys[0].el) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (el >= keys[i].el) {
      const a = keys[i - 1], b = keys[i];
      return mixGrade(a, b, (a.el - el) / (a.el - b.el));
    }
  }
  return keys[keys.length - 1];
}

export interface Sky {
  hour: number;
  /** Unit vector toward the real sun, and its height in degrees (negative below the horizon). */
  sunDir: Vec3; sunEl: number;
  /** Toward the moon. */
  moonDir: Vec3; moonEl: number;
  /** The key light: which body, its direction (sun clamped to the lowest shadow height), strength × Sun strength. */
  keyFrom: "sun" | "moon"; keyDir: Vec3; keyK: number; keyColor: number;
  /** Shadow darkness 0..1 and softness ×. */
  shadow: number; soft: number;
  /** Extra hemisphere fill (added to Extra flat fill). */
  fill: number;
  /** Exposure ×. */
  exposure: number;
  grade: Grade;
  /** 0..1: weight of the morning palette. */
  morning: number;
}

function dirOf(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * RAD, el = elDeg * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
}

/**
 * The sun's direction at an hour on a hemisphere path whose noon is at (noonAz, noonEl) and whose night is nightShare
 * of the 24 hours. A latitude φ and declination δ are solved from those two, then the textbook alt-az formulas.
 */
export function sunAt(hour: number, noonAz: number, noonEl: number, nightShare: number): { dir: Vec3; el: number; H: number } {
  const H = ((hour - 12) / 24) * Math.PI * 2;
  const n = Math.min(0.49, Math.max(0.05, nightShare));
  const sMax = Math.sin(Math.min(89, Math.max(1, noonEl)) * RAD);
  const B = sMax / (1 + Math.cos(Math.PI * n)), A = B * Math.cos(Math.PI * n);
  const d1 = Math.acos(Math.min(1, A + B)), d2 = Math.acos(Math.max(-1, Math.min(1, B - A)));
  const lat = (d1 + d2) / 2, dec = (d2 - d1) / 2;
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H);
  // World: the noon sun lies toward noonAz (north is the other way); east is a quarter turn round from it.
  const az = noonAz * RAD;
  const sx = Math.sin(az), sz = Math.cos(az);
  const ex = -sz, ez = sx;
  const x = -north * sx + east * ex, z = -north * sz + east * ez;
  const len = Math.hypot(x, up, z) || 1;
  return { dir: { x: x / len, y: up / len, z: z / len }, el: Math.asin(Math.max(-1, Math.min(1, up / len))) / RAD, H };
}

/** Everything the look needs at an hour. v: the time-of-day sliders plus the noon sun. */
export function skyAt(hour: number, v: DayNightValues & { sunAzimuth: number; sunElevation: number }): Sky {
  const s = sunAt(hour, v.sunAzimuth, v.sunElevation, v.nightShare);
  // Night progress (0 at sunset, 1 at sunrise) for the moon's drift.
  const halfNight = v.nightShare * 12;
  let fromMid = hour - 0; if (fromMid > 12) fromMid -= 24;
  const nightT = clamp01((fromMid + halfNight) / (2 * halfNight));
  const moonAz = v.moonAz + v.moonDrift * (nightT - 0.5);
  const moonDir = dirOf(moonAz, v.moonEl);

  const morning = clamp01(0.5 + 1.5 * -Math.sin(s.H));
  const grade = mixGrade(sample(EVENING, s.el), sample(MORNING, s.el), morning);

  // One key light at a time: the sun fades out above the handover, the moon fades in below it; at the handover both
  // are off (the blue hour, lit by the sky alone).
  const sunW = smoothstep(v.handoverEl, v.handoverEl + v.blueHour, s.el);
  const moonW = smoothstep(v.handoverEl, v.handoverEl - v.blueHour, s.el);
  const high = smoothstep(Math.max(0, v.shadowMinEl - 5), 35, s.el);
  let keyFrom: "sun" | "moon", keyDir: Vec3, keyK: number, keyColor: number, shadow: number, soft: number;
  if (sunW > 0 || moonW <= 0) {
    keyFrom = "sun";
    const e = Math.max(s.el, v.shadowMinEl);
    const h = Math.hypot(s.dir.x, s.dir.z) || 1;
    const c = Math.cos(e * RAD);
    keyDir = { x: (s.dir.x / h) * c, y: Math.sin(e * RAD), z: (s.dir.z / h) * c };
    keyK = grade.keyK * sunW;
    keyColor = grade.key;
    shadow = v.lowShadow + (1 - v.lowShadow) * high;
    soft = v.lowSoft + (1 - v.lowSoft) * high;
  } else {
    keyFrom = "moon";
    keyDir = moonDir;
    keyK = v.moonStrength * moonW;
    keyColor = NIGHT.key;
    shadow = v.moonShadow;
    soft = 1;
  }
  const fill = (1 - high) * v.lowSunFill * (1 - grade.night) + grade.night * v.nightFill;
  const exposure = 1 + (v.nightExposure - 1) * grade.night;
  return { hour, sunDir: s.dir, sunEl: s.el, moonDir, moonEl: v.moonEl, keyFrom, keyDir, keyK, keyColor, shadow, soft, fill, exposure, grade, morning };
}
