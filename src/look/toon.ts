// Cel look for units and mechs (the old project's art direction: units are foreground, cel-shaded with clean ink
// lines; the environment stays bright with no outlines). Toon bands over the model's painted vertex colours,
// plus an inverted-hull ink outline whose width stays constant on screen at any zoom.
import * as THREE from "three/webgpu";
import { positionLocal, normalLocal, cameraPosition, modelWorldMatrix, uniform, vec4, color } from "three/tsl";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Param } from "../core/tweaks";

export const TOON_DEFAULTS = {
  inkWidth: 1.6,
  shadeFloor: 0.42,
  shadeMid: 0.72,
};
export type ToonValues = typeof TOON_DEFAULTS;

export const TOON_PARAMS: Param[] = [
  { key: "inkWidth", label: "Ink width (px)", min: 0, max: 5, step: 0.05, group: "Cel look" },
  { key: "shadeFloor", label: "Shadow band", min: 0, max: 1, step: 0.01, group: "Cel look", tip: "Brightness of the darkest band" },
  { key: "shadeMid", label: "Mid band", min: 0, max: 1, step: 0.01, group: "Cel look" },
];

const INK = 0x3b2621;

export class ToonLook {
  readonly gradient: THREE.DataTexture;
  private inkScale = uniform(0.001);
  readonly ink: THREE.MeshBasicNodeMaterial;
  private bands = new Uint8Array(3 * 4);

  constructor(public v: ToonValues) {
    this.gradient = new THREE.DataTexture(this.bands, 3, 1, THREE.RGBAFormat);
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.generateMipmaps = false;
    this.writeBands();

    // Push each vertex out along its smoothed normal by a width proportional to its distance from the camera.
    const ink = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const dist = cameraPosition.distance(world);
    ink.positionNode = positionLocal.add(normalLocal.mul(dist.mul(this.inkScale)));
    ink.colorNode = color(INK);
    ink.fog = true;
    this.ink = ink;
  }

  private writeBands() {
    const vals = [this.v.shadeFloor, this.v.shadeMid, 1];
    vals.forEach((b, i) => { const c = Math.round(b * 255); this.bands.set([c, c, c, 255], i * 4); });
    this.gradient.needsUpdate = true;
  }

  /** Call each frame: keeps the ink a constant width in pixels for this camera and viewport. */
  update(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
    this.inkScale.value = this.v.inkWidth * perPx;
    const cur = this.bands[0] / 255, mid = this.bands[4] / 255;
    if (Math.abs(cur - this.v.shadeFloor) > 0.003 || Math.abs(mid - this.v.shadeMid) > 0.003) this.writeBands();
  }

  material(vertexColors: boolean, tint = 0xffffff) {
    return new THREE.MeshToonMaterial({ color: tint, vertexColors, gradientMap: this.gradient });
  }

  /** Give a mesh the toon material and an ink outline child. */
  apply(mesh: THREE.Mesh, outline = true) {
    const g = mesh.geometry;
    mesh.material = this.material(!!g.attributes.color);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (!outline) return;
    // Smooth normals for the hull, so hard edges don't split the outline open.
    const shell = new THREE.BufferGeometry();
    shell.setAttribute("position", g.attributes.position.clone());
    if (g.index) shell.setIndex(g.index.clone());
    const merged = mergeVertices(shell, 1e-3);
    merged.computeVertexNormals();
    const line = new THREE.Mesh(merged, this.ink);
    line.name = mesh.name + "_ink";
    line.castShadow = false;
    line.receiveShadow = false;
    line.userData.ink = true;
    mesh.add(line);
  }
}
