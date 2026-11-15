// Vehicle body models by kind: `public/models/vehicles/<kind>.glb`, built by tools/blender/parts/warband.py
// (docs/asset-pipeline.md), when the file exists; CarBody keeps its boxes until one loads and when there is none
// (headless checks, a kind not modelled yet). A model is plain geometry in the body's frame: `body` in its own colours,
// `paint` near white (CarBody multiplies it by the vehicle's colour), `glow` the lamps' lit faces, `wheel` one wheel
// about its hub. Each is built to its kind's default tuning (CAR_KINDS). Drawing only.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { asset } from "../core/assetBase";
import { plain } from "../mech/partModels";
import type { CarKind } from "./car";

export interface CarModel { body: THREE.BufferGeometry; paint: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null; wheel: THREE.BufferGeometry | null }

const loader = new GLTFLoader();
const base = asset("models/vehicles/");
const models = new Map<CarKind, Promise<CarModel | null>>();

/** The kind's model, or null when there's none (a missing file, or the dev server's html). Cached. */
export function carModel(kind: CarKind): Promise<CarModel | null> {
  let p = models.get(kind);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(base + kind + ".glb");
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "glTF") return null;
        const scene = (await loader.parseAsync(buf, base)).scene;
        scene.updateMatrixWorld(true);
        const out: Record<string, THREE.BufferGeometry> = {};
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const lit = (m.material as THREE.Material)?.name === "Paint_lighting";
          const name = lit ? "glow" : m.parent?.name === "Paint" ? "paint" : m.parent?.name === "Wheel" ? "wheel" : "body";
          const g = plain(m.geometry);
          if (name !== "wheel") g.applyMatrix4(m.matrixWorld);
          out[name] = g;
        });
        return out.body ? { body: out.body, paint: out.paint ?? null, glow: out.glow ?? null, wheel: out.wheel ?? null } : null;
      } catch { return null; }
    })();
    models.set(kind, p);
  }
  return p;
}

/** The kind's sliders a model is built to: moved off the defaults, the boxes (which follow them) stay. */
export const MODEL_FIT_KEYS = ["wheelbase", "track", "rideHeight", "wheelRadius", "frontAxles", "rearAxles", "axleGap"] as const;
