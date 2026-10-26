// The weapons' look on top of the unit look (src/look/toon.ts): paint by section from a scheme (src/weapons/palette.ts)
// times the model's wear colours, sand dust on top faces, bare metal that glints (mechanical and detail sections),
// lamps and lenses that glow, barrels that glow with heat after firing, a faint rim light so a gun's silhouette
// separates from the hull at the 40 m game camera, and an ink outline of its own weight.
// One material per weapon instance (its paint, heat and lamp state are its own); look values are shared uniforms.
import * as THREE from "three/webgpu";
import {
  attribute, uniform, uniformArray, vec3, float, int, mix, smoothstep, clamp, normalWorld, normalView, positionView,
  materialEmissive, positionLocal, normalLocal, cameraPosition, modelWorldMatrix, vec4, color, max,
} from "three/tsl";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Param } from "../core/tweaks";
import type { ToonValues } from "../look/toon";
import { SCHEMES, SECTIONS, SECTION } from "./palette";

export const WEAPON_LOOK_DEFAULTS = {
  weaponScheme: 0,
  weaponWear: 1,
  weaponDust: 0.35,
  weaponPaintGain: 1,
  weaponMetalRough: 0.32,
  weaponMetalness: 0.55,
  weaponRim: 0.18,
  weaponLampGain: 2.2,
  weaponHeatGain: 3,
  weaponInk: 1.1,
};
export type WeaponLookValues = typeof WEAPON_LOOK_DEFAULTS;

export const WEAPON_LOOK_PARAMS: Param[] = [
  { key: "weaponScheme", label: "Paint scheme", min: 0, max: SCHEMES.length - 1, step: 1, group: "Weapon paint", tip: SCHEMES.map((s, i) => `${i} ${s.name}`).join(", ") },
  { key: "weaponWear", label: "Wear", min: 0, max: 2, step: 0.01, group: "Weapon paint", tip: "Grime and underside shade baked in the models (1 = as modelled)" },
  { key: "weaponDust", label: "Sand dust on top", min: 0, max: 1, step: 0.01, group: "Weapon paint" },
  { key: "weaponPaintGain", label: "Paint brightness", min: 0.5, max: 1.6, step: 0.01, group: "Weapon paint" },
  { key: "weaponMetalRough", label: "Bare metal roughness", min: 0.05, max: 1, step: 0.01, group: "Weapon finish", tip: "Barrels, mechanisms and bolts: lower glints more" },
  { key: "weaponMetalness", label: "Bare metal metalness", min: 0, max: 1, step: 0.01, group: "Weapon finish" },
  { key: "weaponRim", label: "Rim light", min: 0, max: 1, step: 0.01, group: "Weapon finish", tip: "A faint edge light so the gun reads against the hull from the game camera" },
  { key: "weaponLampGain", label: "Lamp glow", min: 0, max: 8, step: 0.05, group: "Weapon finish" },
  { key: "weaponHeatGain", label: "Barrel heat glow", min: 0, max: 8, step: 0.05, group: "Weapon finish", tip: "How bright hot barrels glow after firing" },
  { key: "weaponInk", label: "Ink width (px)", min: 0, max: 4, step: 0.05, group: "Weapon finish", tip: "Outline on weapons only (the mech's own is in Cel look)" },
];

const INK = 0x3b2621;

/** Per-instance state a weapon's material reads. */
export class WeaponPaint {
  readonly palette = uniformArray(SECTIONS.map(() => new THREE.Color()), "color");
  readonly heat = uniform(0);
  readonly lamp = uniform(1);
  scheme = -1;
  /** own: the model's own paint (a desktop GLB's sidecar palette), shown for scheme 0 in place of the Rampart row. */
  constructor(scheme: number, private own?: Partial<Record<(typeof SECTIONS)[number], number>>) { this.setScheme(scheme); }
  setScheme(i: number) {
    const k = Math.max(0, Math.min(SCHEMES.length - 1, Math.round(i)));
    const s = SCHEMES[k];
    this.scheme = k;
    SECTIONS.forEach((sec, j) => (this.palette.array[j] as THREE.Color).setHex((k === 0 ? this.own?.[sec] : undefined) ?? s.colors[sec]).convertSRGBToLinear());
  }
  /** One section's colour (sRGB hex), e.g. a team colour on the plating. */
  setSection(sec: (typeof SECTIONS)[number], hex: number) { (this.palette.array[SECTION[sec]] as THREE.Color).setHex(hex).convertSRGBToLinear(); }
}

export class WeaponLook {
  private wear = uniform(1);
  private dust = uniform(0.35);
  private gain = uniform(1);
  private metalRough = uniform(0.32);
  private metalness = uniform(0.55);
  private paintRough = uniform(0.55);
  private paintMetal = uniform(0.05);
  private rim = uniform(0.18);
  private lampGain = uniform(2);
  private heatGain = uniform(3);
  private inkScale = uniform(0.001);
  readonly ink: THREE.MeshBasicNodeMaterial;
  private materials: { mat: THREE.Material; paint: WeaponPaint; meshes: THREE.Mesh[] }[] = [];
  private cel = -1;

  constructor(public v: WeaponLookValues, public toon: { v: ToonValues; gradient: THREE.DataTexture }) {
    const ink = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    ink.positionNode = positionLocal.add(normalLocal.mul(cameraPosition.distance(world).mul(this.inkScale)));
    ink.colorNode = color(INK);
    this.ink = ink;
  }

  /** A material for one weapon instance's meshes (geometry with section, heat and color attributes). */
  material(paint: WeaponPaint): THREE.Material {
    const cel = this.toon.v.celShading > 0.5;
    const m = cel ? new THREE.MeshToonNodeMaterial({ gradientMap: this.toon.gradient }) : new THREE.MeshStandardNodeMaterial();
    const sec = attribute("section", "float");
    const is = (k: number) => float(1).sub(clamp(sec.sub(k).abs(), 0, 1));
    const lampMask = is(SECTION.lighting).add(is(SECTION.visor).mul(0.35));
    const metalMask = is(SECTION.mechanical).add(is(SECTION.detail).mul(0.7));
    const base = paint.palette.element(int(sec.add(0.5))) as unknown as ReturnType<typeof vec3>;
    const wear = mix(vec3(1, 1, 1), attribute("color", "vec3"), this.wear);
    const up = smoothstep(0.35, 0.95, normalWorld.y).mul(float(1).sub(lampMask)).mul(float(1).sub(metalMask.mul(0.5)));
    const sand = vec3(0.62, 0.5, 0.34);
    m.colorNode = mix(base.mul(wear).mul(this.gain), sand, up.mul(this.dust));
    if (!cel) {
      const sm = m as THREE.MeshStandardNodeMaterial;
      sm.roughnessNode = mix(this.paintRough, this.metalRough, metalMask);
      sm.metalnessNode = mix(this.paintMetal, this.metalness, metalMask);
    }
    // Heat: dull red through orange to yellow-white as it climbs, on the parts marked hot (barrels, toward the muzzle).
    const h = paint.heat.mul(attribute("heat", "float"));
    const hot = mix(vec3(0.6, 0.04, 0.0), vec3(1.0, 0.42, 0.08), smoothstep(0.2, 0.7, h)).add(vec3(0.4, 0.35, 0.2).mul(smoothstep(0.75, 1.0, h)));
    const facing = normalView.dot(positionView.normalize().negate()).abs();
    const rimK = float(1).sub(facing).pow(3).mul(this.rim);
    (m as THREE.MeshStandardNodeMaterial).emissiveNode = materialEmissive
      .add(base.mul(lampMask).mul(this.lampGain).mul(paint.lamp))
      .add(hot.mul(smoothstep(0.02, 0.4, h)).mul(this.heatGain).mul(max(h, 0.2)))
      .add(vec3(1.0, 0.92, 0.78).mul(rimK));
    return m;
  }

  /** Give a weapon's meshes their material (shared by the instance) and ink hulls. */
  apply(meshes: THREE.Mesh[], paint: WeaponPaint) {
    const mat = this.material(paint);
    for (const mesh of meshes) {
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const shell = new THREE.BufferGeometry();
      shell.setAttribute("position", mesh.geometry.attributes.position.clone());
      if (mesh.geometry.index) shell.setIndex(mesh.geometry.index.clone());
      const merged = mergeVertices(shell, 1e-3);
      merged.computeVertexNormals();
      const line = new THREE.Mesh(merged, this.ink);
      line.name = mesh.name + "_ink";
      line.userData.ink = true;
      line.raycast = () => {};
      mesh.add(line);
    }
    this.materials.push({ mat, paint, meshes });
    return mat;
  }

  /** Forget a weapon's material (when the weapon is dropped). */
  release(paint: WeaponPaint) {
    const i = this.materials.findIndex((e) => e.paint === paint);
    if (i >= 0) { this.materials[i].mat.dispose(); this.materials.splice(i, 1); }
  }

  /** Call each frame: look values into uniforms, ink width for this camera; cel toggles rebuild the materials. */
  update(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    const v = this.v, t = this.toon.v;
    this.wear.value = v.weaponWear; this.dust.value = v.weaponDust; this.gain.value = v.weaponPaintGain;
    this.metalRough.value = v.weaponMetalRough; this.metalness.value = v.weaponMetalness;
    this.paintRough.value = t.paintRoughness; this.paintMetal.value = t.paintMetal;
    this.rim.value = v.weaponRim; this.lampGain.value = v.weaponLampGain; this.heatGain.value = v.weaponHeatGain;
    const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
    this.inkScale.value = v.weaponInk * perPx;
    this.ink.visible = v.weaponInk > 0;
    const cel = t.celShading > 0.5 ? 1 : 0;
    if (cel !== this.cel) {
      const first = this.cel < 0;
      this.cel = cel;
      if (!first) for (const e of this.materials) {
        e.mat.dispose();
        e.mat = this.material(e.paint);
        for (const m of e.meshes) m.material = e.mat;
      }
    }
  }
}
