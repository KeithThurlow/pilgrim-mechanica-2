// Desert light, aimed at a tank in the open desert at midday (Keith 2026-10-24): a hard high sun, a sky
// environment for reflections and soft sky light (blue from above, warm sand bounce from below, which is what lights
// the undersides of a vehicle on sand), filmic tone mapping, and haze toward the horizon. The sun's shadow box
// follows the focus, so shadows stay sharp wherever the convoy has rolled to.
//
// Day and night (Keith 2026-10-28): with "Day cycle on" the time of day (src/world/daynight.ts, a shared host clock)
// moves the sun along a hemisphere path whose noon is the Sun direction/height sliders, hands the key light over to a
// high moon through a short blue hour, and grades the light, sky, haze and exposure by the sun's height. Two suns: the
// sky and colours follow the real sun, the shadow light never drops under "Lowest shadow sun". Stars and a moon disc
// at night, night lights (src/world/nightLights.ts). Off, everything is the old fixed midday look.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { SHADOW_ONLY_LAYER } from "./chunks";
import { DayClock, skyAt, DAYNIGHT_DEFAULTS, DAYNIGHT_PARAMS, type Sky } from "./daynight";
import { NightLights, NIGHT_LIGHT_DEFAULTS, NIGHT_LIGHT_PARAMS } from "./nightLights";

export const LOOK_DEFAULTS = {
  sunAzimuth: 215,
  sunElevation: 36,
  // Picked from an A/B of ACES, AgX and Neutral on the Rampart (2026-10-24): Neutral keeps the sand and paint colour,
  // AgX greyed everything out.
  sunIntensity: 3.2,
  envIntensity: 0.5,
  skyFill: 0,
  exposure: 1,
  toneMap: 0,
  haze: 0.5,
  shadowBox: 70,
  shadowSoft: 6,
  ...DAYNIGHT_DEFAULTS,
  ...NIGHT_LIGHT_DEFAULTS,
};
export type LookValues = typeof LOOK_DEFAULTS;

/** The slider groups a lab's Light topic should list. */
export const LIGHT_GROUPS = ["Look", "Time of day", "Night lights"];

export const LOOK_PARAMS: Param[] = [
  { key: "sunAzimuth", label: "Sun direction", min: 0, max: 360, step: 1, group: "Look", tip: "With the day cycle on: the noon sun's direction" },
  { key: "sunElevation", label: "Sun height", min: 5, max: 85, step: 1, group: "Look", tip: "With the day cycle on: the noon sun's height (the top of its path)" },
  { key: "sunIntensity", label: "Sun strength", min: 0, max: 10, step: 0.05, group: "Look" },
  { key: "envIntensity", label: "Sky and sand light", min: 0, max: 3, step: 0.01, group: "Look", tip: "The sky environment: soft light, reflections, warm bounce from the sand" },
  { key: "skyFill", label: "Extra flat fill", min: 0, max: 3, step: 0.05, group: "Look", tip: "An old-style two-colour fill on top of the environment; 0 = off" },
  { key: "exposure", label: "Exposure", min: 0.3, max: 2.5, step: 0.01, group: "Look" },
  { key: "toneMap", label: "Tone mapping (0 ACES, 1 AgX, 2 Neutral)", min: 0, max: 2, step: 1, group: "Look" },
  { key: "haze", label: "Haze", min: 0, max: 1, step: 0.01, group: "Look", tip: "How close the horizon haze starts" },
  { key: "shadowBox", label: "Shadow area (m)", min: 20, max: 200, step: 5, group: "Look" },
  { key: "shadowSoft", label: "Shadow softness", min: 0, max: 12, step: 0.1, group: "Look", tip: "Blur of the shadow edges (Keith 2026-10-24: the reference video's dune shadows are soft)" },
  ...DAYNIGHT_PARAMS,
  ...NIGHT_LIGHT_PARAMS,
];

const SKY_TOP = 0x3f78c9, SKY_HORIZON = 0xd9e2e6, SAND = 0xc99a66, HAZE = 0xe6d6bc, SUN = 0xfff3e2;
const TONE = [THREE.ACESFilmicToneMapping, THREE.AgXToneMapping, THREE.NeutralToneMapping];

/** A sky dome to light the scene with: deep blue overhead, pale at the horizon, warm sand below. No sun disc (the sun is the light). */
class SkyDome {
  readonly scene = new THREE.Scene();
  private geo = new THREE.SphereGeometry(100, 48, 24);
  private cols = new THREE.BufferAttribute(new Float32Array(this.geo.attributes.position.count * 3), 3);
  constructor() {
    this.geo.setAttribute("color", this.cols);
    this.scene.add(new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    this.paint(SKY_TOP, SKY_HORIZON, SAND);
  }
  paint(topHex: number, horHex: number, sandHex: number) {
    const top = new THREE.Color(topHex), hor = new THREE.Color(horHex), sand = new THREE.Color(sandHex), c = new THREE.Color();
    const pos = this.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 100;
      if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.55));
      else c.copy(hor).lerp(sand, Math.min(1, -y * 6)).multiplyScalar(0.85);
      this.cols.setXYZ(i, c.r, c.g, c.b);
    }
    this.cols.needsUpdate = true;
  }
}

/** A star dome and a moon disc, drawn round the focus far out, past the haze (fog off). */
function starDome() {
  const N = 1800, R = 900;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // cosmetic, but seeded so it never shimmers
  for (let i = 0; i < N; i++) {
    const y = Math.pow(rnd(), 0.7) * 0.98 + 0.02, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * R, y * R, Math.sin(a) * r * R], i * 3);
    const b = 0.35 + Math.pow(rnd(), 3) * 0.65, warm = rnd();
    col.set([b * (0.85 + 0.15 * warm), b * 0.92, b * (1 - 0.15 * warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, sizeAttenuation: false, size: 1, toneMapped: false });
  const stars = new THREE.Points(g, mat);
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  const moon = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xe4ebff, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
  moon.renderOrder = -9;
  return { stars, moon };
}

export class DesertLook {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  /** The shared clock (host state): the hour of the day. */
  readonly clock: DayClock;
  /** This frame's sky (null with the day cycle off). */
  sky: Sky | null = null;
  /** 0 day .. 1 full night. */
  night = 0;
  /** The light's colour on unlit effects (dust): white at noon. */
  readonly tint = new THREE.Color(1, 1, 1);
  readonly lights: NightLights;
  private fog: THREE.Fog;
  private dome = new SkyDome();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.RenderTarget;
  private envSig = "";
  private envAt = 0;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private bg = new THREE.Color();
  private lastTime: number;
  private timeFlag: number | null = null;
  /** Off for overhead review shots, where haze would hide everything. */
  fogOn = true;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGPURenderer, public v: LookValues) {
    // ?time=H: the day cycle on for this page load (not saved), starting at that hour (applied on the first update,
    // after the panel has loaded its saved values).
    const t = typeof location !== "undefined" ? new URLSearchParams(location.search).get("time") : null;
    if (t !== null && Number.isFinite(parseFloat(t))) this.timeFlag = ((parseFloat(t) % 24) + 24) % 24;
    this.clock = new DayClock(v.timeOfDay);
    this.lastTime = NaN;

    scene.background = this.bg.set(HAZE).lerp(new THREE.Color(SKY_HORIZON), 0.4);
    this.fog = new THREE.Fog(HAZE, 120, 400);
    scene.fog = this.fog;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = this.pmrem.fromScene(this.dome.scene, 0.04);
    scene.environment = this.envRT.texture;
    this.envSig = this.sig(SKY_TOP, SKY_HORIZON, SAND);

    this.fill = new THREE.HemisphereLight(0x6f98ea, 0x8a6a5a, 0);
    scene.add(this.fill);

    this.sun = new THREE.DirectionalLight(SUN, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    // The shadow map also draws what only casts (the terrain's coarse shadow copy); the camera never sees that layer.
    this.sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
    scene.add(this.sun, this.sun.target);

    const sd = starDome();
    this.stars = sd.stars; this.moon = sd.moon;
    this.stars.visible = this.moon.visible = false;
    scene.add(this.stars, this.moon);

    this.lights = new NightLights(v);
    scene.add(this.lights.group);
  }

  private sig(a: number, b: number, c: number) { return `${a},${b},${c}`; }

  /** Repaint the sky environment when its colours have moved (throttled; the same render target, so no material rebuilds). */
  private sky2env(top: number, hor: number, sand: number) {
    const q = (h: number) => h & 0xf8f8f8; // ignore the last bits: no repaints for invisible changes
    const sig = this.sig(q(top), q(hor), q(sand));
    if (sig === this.envSig) return;
    const now = performance.now();
    if (now - this.envAt < 250) return;
    this.envAt = now; this.envSig = sig;
    this.dome.paint(top, hor, sand);
    this.pmrem.fromScene(this.dome.scene, 0.04, 0.1, 100, { renderTarget: this.envRT as THREE.CubeRenderTarget });
  }

  /**
   * viewDistance: how far the camera can see (the streaming radius), so haze hides the edge of the world.
   * shadowScale grows the shadow box with the camera's zoom, so far views still have shadows across the screen.
   * dt: real seconds since the last frame, for the clock (0 holds it).
   */
  update(focus: THREE.Vector3, viewDistance: number, shadowScale = 1, dt = 0) {
    const v = this.v;
    if (this.timeFlag !== null && Number.isNaN(this.lastTime)) v.timeOfDay = this.timeFlag;
    const cycle = v.dayCycle > 0.5 || this.timeFlag !== null;
    // The time slider scrubs the clock; otherwise the clock runs (or holds) and the slider follows it.
    if (v.timeOfDay !== this.lastTime) this.clock.hour = ((v.timeOfDay % 24) + 24) % 24;
    if (cycle && v.dayRun > 0.5) this.clock.step(dt, v);
    v.timeOfDay = this.lastTime = Math.round(this.clock.hour * 1000) / 1000;

    this.renderer.toneMapping = TONE[Math.round(v.toneMap)] ?? THREE.AgXToneMapping;
    const sky = this.sky = cycle ? skyAt(this.clock.hour, v) : null;
    this.night = sky ? sky.grade.night : 0;
    this.renderer.toneMappingExposure = v.exposure * (sky ? sky.exposure : 1);
    this.scene.environmentIntensity = v.envIntensity * (sky ? sky.grade.env : 1);
    this.sun.intensity = v.sunIntensity * (sky ? sky.keyK : 1);
    this.sun.color.setHex(sky ? sky.keyColor : SUN);
    this.sun.shadow.radius = v.shadowSoft * (sky ? sky.soft : 1);
    this.sun.shadow.intensity = sky ? sky.shadow : 1;
    this.fill.intensity = v.skyFill + (sky ? sky.fill : 0);
    const g = sky?.grade;
    if (g) {
      // The fill takes the sky's and the ground's hue at full brightness: its strength comes from the intensity.
      const norm = (c: THREE.Color) => c.multiplyScalar(1 / Math.max(0.05, c.r, c.g, c.b));
      norm(this.fill.color.setHex(g.night > 0.5 ? 0x4c6ce0 : g.skyHor).lerp(new THREE.Color(g.skyTop), 0.5));
      norm(this.fill.groundColor.setHex(g.ground)).multiplyScalar(0.6);
    } else { this.fill.color.setHex(0x6f98ea); this.fill.groundColor.setHex(0x8a6a5a); }
    this.sky2env(g?.skyTop ?? SKY_TOP, g?.skyHor ?? SKY_HORIZON, g?.ground ?? SAND);
    this.fog.color.setHex(g?.haze ?? HAZE);
    this.bg.setHex(g?.haze ?? HAZE).lerp(new THREE.Color(g?.skyHor ?? SKY_HORIZON), 0.4);

    // The tint on unlit effects: the key light's colour and strength plus the sky's, against noon's.
    if (sky && g) {
      const k = new THREE.Color(sky.keyColor).multiplyScalar(sky.keyK * 0.7);
      const h = new THREE.Color(g.skyHor).multiplyScalar(0.3 * g.env).add(new THREE.Color(this.fill.color).multiplyScalar(0.12 * sky.fill));
      const n = new THREE.Color(SUN).multiplyScalar(0.7).add(new THREE.Color(SKY_HORIZON).multiplyScalar(0.3));
      this.tint.setRGB(Math.max(0.08, (k.r + h.r) / n.r), Math.max(0.08, (k.g + h.g) / n.g), Math.max(0.08, (k.b + h.b) / n.b));
    } else this.tint.setRGB(1, 1, 1);

    // The key light: the sun (its shadow height clamped) or the moon.
    const kd = sky ? sky.keyDir : null;
    const az = (v.sunAzimuth * Math.PI) / 180, el = (v.sunElevation * Math.PI) / 180;
    const dir = kd ? new THREE.Vector3(kd.x, kd.y, kd.z) : new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    // Snap the shadow box to texels so shadows don't shimmer as the focus moves.
    const box = v.shadowBox * shadowScale;
    const texel = (box * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(dir, 150);
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - box) > 0.5) {
      cam.left = -box; cam.right = box; cam.top = box; cam.bottom = -box;
      cam.near = 1; cam.far = 400;
      cam.updateProjectionMatrix();
    }
    this.scene.fog = this.fogOn ? this.fog : null;
    const far = Math.max(60, viewDistance);
    this.fog.far = far;
    const haze = Math.min(0.95, v.haze * (g ? g.hazeK : 1));
    this.fog.near = far * (1 - haze) * 0.9 + 10;

    // Stars and the moon disc at night.
    const starA = sky ? Math.max(0, Math.min(1, (this.night - 0.35) / 0.5)) * v.stars : 0;
    this.stars.visible = starA > 0.01;
    if (this.stars.visible) {
      this.stars.position.copy(focus);
      (this.stars.material as THREE.PointsMaterial).opacity = Math.min(1, starA);
    }
    this.moon.visible = !!sky && this.night > 0.2;
    if (sky && this.moon.visible) {
      this.moon.position.set(focus.x + sky.moonDir.x * 800, focus.y + sky.moonDir.y * 800, focus.z + sky.moonDir.z * 800);
      this.moon.lookAt(focus);
      (this.moon.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (this.night - 0.2) / 0.4);
    }

    this.lights.update(dt, this.night, focus);
  }
}
