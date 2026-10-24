// Desert light, aimed at a tank in the open desert at midday (Keith 2026-10-24): a hard high sun, a sky
// environment for reflections and soft sky light (blue from above, warm sand bounce from below, which is what lights
// the undersides of a vehicle on sand), filmic tone mapping, and haze toward the horizon. The sun's shadow box
// follows the focus, so shadows stay sharp wherever the convoy has rolled to.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

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
};
export type LookValues = typeof LOOK_DEFAULTS;

export const LOOK_PARAMS: Param[] = [
  { key: "sunAzimuth", label: "Sun direction", min: 0, max: 360, step: 1, group: "Look" },
  { key: "sunElevation", label: "Sun height", min: 5, max: 85, step: 1, group: "Look" },
  { key: "sunIntensity", label: "Sun strength", min: 0, max: 10, step: 0.05, group: "Look" },
  { key: "envIntensity", label: "Sky and sand light", min: 0, max: 3, step: 0.01, group: "Look", tip: "The sky environment: soft light, reflections, warm bounce from the sand" },
  { key: "skyFill", label: "Extra flat fill", min: 0, max: 3, step: 0.05, group: "Look", tip: "An old-style two-colour fill on top of the environment; 0 = off" },
  { key: "exposure", label: "Exposure", min: 0.3, max: 2.5, step: 0.01, group: "Look" },
  { key: "toneMap", label: "Tone mapping (0 ACES, 1 AgX, 2 Neutral)", min: 0, max: 2, step: 1, group: "Look" },
  { key: "haze", label: "Haze", min: 0, max: 1, step: 0.01, group: "Look", tip: "How close the horizon haze starts" },
  { key: "shadowBox", label: "Shadow area (m)", min: 20, max: 200, step: 5, group: "Look" },
];

const SKY_TOP = 0x3f78c9, SKY_HORIZON = 0xd9e2e6, SAND = 0xc99a66, HAZE = 0xe6d6bc;
const TONE = [THREE.ACESFilmicToneMapping, THREE.AgXToneMapping, THREE.NeutralToneMapping];

/** A sky dome to light the scene with: deep blue overhead, pale at the horizon, warm sand below. No sun disc (the sun is the light). */
function skyDome() {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 48, 24);
  const top = new THREE.Color(SKY_TOP), hor = new THREE.Color(SKY_HORIZON), sand = new THREE.Color(SAND);
  const cols = new Float32Array(geo.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 100;
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.55));
    else c.copy(hor).lerp(sand, Math.min(1, -y * 6)).multiplyScalar(0.85);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  return scene;
}

export class DesertLook {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  private fog: THREE.Fog;
  /** Off for overhead review shots, where haze would hide everything. */
  fogOn = true;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGPURenderer, public v: LookValues) {
    scene.background = new THREE.Color(HAZE).lerp(new THREE.Color(SKY_HORIZON), 0.4);
    this.fog = new THREE.Fog(HAZE, 120, 400);
    scene.fog = this.fog;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(skyDome(), 0.04).texture;

    this.fill = new THREE.HemisphereLight(0x6f98ea, 0x8a6a5a, 0);
    scene.add(this.fill);

    this.sun = new THREE.DirectionalLight(0xfff3e2, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    scene.add(this.sun, this.sun.target);
  }

  /**
   * viewDistance: how far the camera can see (the streaming radius), so haze hides the edge of the world.
   * shadowScale grows the shadow box with the camera's zoom, so far views still have shadows across the screen.
   */
  update(focus: THREE.Vector3, viewDistance: number, shadowScale = 1) {
    const v = this.v;
    this.renderer.toneMapping = TONE[Math.round(v.toneMap)] ?? THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = v.exposure;
    this.scene.environmentIntensity = v.envIntensity;
    this.fill.intensity = v.skyFill;
    this.sun.intensity = v.sunIntensity;
    const az = (v.sunAzimuth * Math.PI) / 180, el = (v.sunElevation * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
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
    this.fog.near = far * (1 - v.haze) * 0.9 + 10;
  }
}
