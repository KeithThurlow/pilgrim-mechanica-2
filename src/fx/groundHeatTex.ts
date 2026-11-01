// Drawing the red-hot sand (src/fx/groundHeat.ts): its bytes as a toroidal texture, and the TSL that turns a
// temperature into a black-body glow (dull red, cherry, orange, yellow-white) with an ember flicker, plus the darkening
// of fused sand. The detail patch (src/world/detailPatch.ts) adds glow() to its emissive and multiplies its colour by
// dark(). The texture uploads only on frames the heat changed.
import * as THREE from "three/webgpu";
import { texture, uniform, vec2, vec3, float, abs, max, smoothstep, clamp, pow, mix, mx_noise_float, time } from "three/tsl";
import { GroundHeat, HEAT_MAX, type HeatValues } from "./groundHeat";

/** Light colours from just glowing to white heat (deep red, red-orange, orange, warm yellow). */
const RAMP = [[1, 0.16, 0.03], [1, 0.32, 0.08], [1, 0.55, 0.2], [1, 0.78, 0.45]];
const glowHex = (u: number) => {
  const t = Math.min(0.999, Math.max(0, u)) * (RAMP.length - 1), i = Math.floor(t), f = t - i, a = RAMP[i], b = RAMP[i + 1];
  return (Math.round(255 * (a[0] + (b[0] - a[0]) * f)) << 16) | (Math.round(255 * (a[1] + (b[1] - a[1]) * f)) << 8) | Math.round(255 * (a[2] + (b[2] - a[2]) * f));
};

/** What the night lights take a held light through (src/world/nightLights.ts hold). */
export interface HeatLightSink { hold(x: number, y: number, z: number, power: number, range: number, color: number, prio?: number, glow?: number): void }

export class GroundHeatTex {
  private patches = new Float32Array(5 * 16);
  heat: GroundHeat;
  private tex: THREE.DataTexture;
  private node: THREE.TextureNode;
  private uploaded = -1;
  private uArea = uniform(104);
  private uCentre = uniform(new THREE.Vector2());
  private uFrom = uniform(480);
  private uGlow = uniform(2);
  private uFlicker = uniform(0.3);
  private uChar = uniform(0.5);

  constructor(public v: HeatValues) {
    this.heat = new GroundHeat(v);
    this.tex = this.makeTex();
    this.node = texture(this.tex);
  }

  private makeTex() {
    const h = this.heat, t = new THREE.DataTexture(h.bytes, h.res, h.res, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /** Step the heat (cooling, following the focus) and upload if it changed; rebuild if the area or cells changed. */
  update(dt: number, fx: number, fz: number) {
    const v = this.v;
    if (!this.heat.fits(v)) {
      this.heat = new GroundHeat(v);
      this.tex.dispose();
      this.tex = this.makeTex();
      this.node.value = this.tex;
      this.uploaded = -1;
    }
    this.heat.update(dt, fx, fz);
    if (this.heat.version !== this.uploaded) { this.tex.needsUpdate = true; this.uploaded = this.heat.version; }
    this.uArea.value = this.heat.area;
    this.uCentre.value.set(fx, fz);
    this.uFrom.value = v.heatGlowFrom;
    this.uGlow.value = v.heatOn ? v.heatGlow : 0;
    this.uFlicker.value = v.heatFlicker;
    this.uChar.value = v.heatOn ? v.heatChar : 0;
  }

  /**
   * Glowing sand lights the ground round it at night (Keith 2026-11-01): the brightest patches ask the night lights
   * for a real light a little above the sand (they fade with the night themselves). ground: for the light's height.
   */
  light(lights: HeatLightSink, ground: { height(x: number, z: number): number }) {
    const v = this.v;
    if (v.heatLight <= 0) return;
    const P = this.patches, n = this.heat.lights(P);
    for (let k = 0; k < n; k++) {
      const o = k * 5, x = P[o], z = P[o + 1], p = P[o + 2], u = P[o + 3], size = P[o + 4];
      lights.hold(x, ground.height(x, z) + 1.2, z, v.heatLight * p, 5 + size * 1.5 + 4 * u, glowHex(u), v.heatLightPrio);
    }
  }

  /** The heat sample (x: temperature in °, y: char 0..1) at world xz, faded out toward the window's edge. */
  private sample(p: THREE.Node<"vec2">) {
    const s = texture(this.node, p.div(this.uArea));
    const d = abs(p.sub(this.uCentre)).div(this.uArea.mul(0.5));
    const fade = float(1).sub(smoothstep(0.85, 0.96, max(d.x, d.y)));
    return vec2(s.x.mul(HEAT_MAX), s.y).mul(fade);
  }

  /** Emissive glow at world xz. */
  glow(p: THREE.Node<"vec2">) {
    const T = this.sample(p).x;
    // 0 at "glows from", 1 at white heat (about 1400° above it).
    const u = clamp(T.sub(this.uFrom).div(1400), 0, 1);
    // Black-body-ish ramp: red comes first, then green (orange, yellow), blue last (white).
    const col = vec3(smoothstep(0, 0.18, u), smoothstep(0.12, 0.8, u).mul(0.85), smoothstep(0.55, 1, u).mul(0.7));
    // Embers crawl: slow noise in the glow, more where it's only just glowing.
    const n = mx_noise_float(vec3(p.x.mul(1.3), p.y.mul(1.3), time.mul(0.9))).mul(0.5).add(0.5);
    const fl = mix(float(1), n.mul(1.6), this.uFlicker.mul(float(1).sub(u.mul(0.6))));
    return col.mul(pow(u, 1.25).mul(this.uGlow).mul(fl));
  }

  /** Colour multiplier at world xz: fused (and still-hot) sand goes dark. */
  dark(p: THREE.Node<"vec2">) {
    const s = this.sample(p);
    const hot = smoothstep(this.uFrom.mul(0.5), this.uFrom, s.x).mul(0.35);
    return float(1).sub(max(s.y, hot).mul(this.uChar));
  }
}
