// Drawing the red-hot sand (src/fx/groundHeat.ts): its bytes as a toroidal texture, and the TSL that turns a
// temperature into a black-body glow (dull red, cherry, orange, yellow-white) with an ember flicker, plus the darkening
// of fused sand. The detail patch (src/world/detailPatch.ts) adds glow() to its emissive and multiplies its colour by
// dark(). The texture uploads only on frames the heat changed.
import * as THREE from "three/webgpu";
import { texture, uniform, vec2, vec3, float, abs, max, smoothstep, clamp, pow, mix, mx_noise_float, time } from "three/tsl";
import { GroundHeat, HEAT_MAX, type HeatValues } from "./groundHeat";

export class GroundHeatTex {
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
