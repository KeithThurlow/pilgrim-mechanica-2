// Desert light: a warm low sun, a cool blue sky fill (so shadows read blue-violet, not grey), and haze toward the
// horizon. The sun's shadow box follows the focus, so shadows stay sharp wherever the convoy has rolled to.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";

export const LOOK_DEFAULTS = {
  sunAzimuth: 215,
  sunElevation: 38,
  sunIntensity: 3.2,
  skyFill: 1.6,
  exposure: 0.8,
  haze: 0.55,
  shadowBox: 70,
};
export type LookValues = typeof LOOK_DEFAULTS;

export const LOOK_PARAMS: Param[] = [
  { key: "sunAzimuth", label: "Sun direction", min: 0, max: 360, step: 1, group: "Look" },
  { key: "sunElevation", label: "Sun height", min: 5, max: 85, step: 1, group: "Look" },
  { key: "sunIntensity", label: "Sun strength", min: 0, max: 8, step: 0.05, group: "Look" },
  { key: "skyFill", label: "Sky fill (shadow colour)", min: 0, max: 4, step: 0.05, group: "Look" },
  { key: "exposure", label: "Exposure", min: 0.3, max: 2, step: 0.01, group: "Look" },
  { key: "haze", label: "Haze", min: 0, max: 1, step: 0.01, group: "Look", tip: "How close the horizon haze starts" },
  { key: "shadowBox", label: "Shadow area (m)", min: 20, max: 200, step: 5, group: "Look" },
];

const SKY = 0xa9c6dd, HAZE = 0xe9d2b0;

export class DesertLook {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  private fog: THREE.Fog;
  /** Off for overhead review shots, where haze would hide everything. */
  fogOn = true;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGPURenderer, public v: LookValues) {
    scene.background = new THREE.Color(HAZE).lerp(new THREE.Color(SKY), 0.55);
    this.fog = new THREE.Fog(HAZE, 120, 400);
    scene.fog = this.fog;

    this.fill = new THREE.HemisphereLight(0x6f98ea, 0x8a6a5a, 1);
    scene.add(this.fill);

    this.sun = new THREE.DirectionalLight(0xffe0b5, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
  }

  /** viewDistance: how far the camera can see (the streaming radius), so haze hides the edge of the world. */
  update(focus: THREE.Vector3, viewDistance: number) {
    const v = this.v;
    this.renderer.toneMappingExposure = v.exposure;
    this.fill.intensity = v.skyFill;
    this.sun.intensity = v.sunIntensity;
    const az = (v.sunAzimuth * Math.PI) / 180, el = (v.sunElevation * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    // Snap the shadow box to texels so shadows don't shimmer as the focus moves.
    const texel = (v.shadowBox * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(dir, 150);
    const cam = this.sun.shadow.camera;
    if (cam.right !== v.shadowBox) {
      cam.left = -v.shadowBox; cam.right = v.shadowBox; cam.top = v.shadowBox; cam.bottom = -v.shadowBox;
      cam.near = 1; cam.far = 400;
      cam.updateProjectionMatrix();
    }
    this.scene.fog = this.fogOn ? this.fog : null;
    const far = Math.max(60, viewDistance);
    this.fog.far = far;
    this.fog.near = far * (1 - v.haze) * 0.9 + 10;
  }
}
