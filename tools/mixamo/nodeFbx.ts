// Load a Mixamo FBX in Node with three's FBXLoader: no DOM, so embedded textures are caught as raw bytes (the loader
// hands them to URL.createObjectURL) and decoded here (TGA through three's TGALoader; other formats give null and
// the caller falls back to flat material colours).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { decodePng } from "./png";

export interface Rgba { w: number; h: number; data: Uint8Array; flipY: boolean }

const blobs = new Map<string, Blob>();
let nextUrl = 0;
const g = globalThis as unknown as Record<string, unknown>;
g.window ??= globalThis;
g.self ??= globalThis;
URL.createObjectURL = (b: Blob) => { const u = `blob:fbx/${nextUrl++}`; blobs.set(u, b); return u; };

/** A texture stand-in: remembers its URL; the loader never fetches anything. */
class CatchLoader extends THREE.Loader {
  load(url: string): THREE.Texture {
    const t = new THREE.Texture();
    t.userData.url = url;
    return t;
  }
}

export interface LoadedFbx { root: THREE.Group; decode: (tex: THREE.Texture | null | undefined) => Promise<Rgba | null> }

export function loadFbx(path: string): LoadedFbx {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, new CatchLoader());
  const buf = readFileSync(path);
  const loader = new FBXLoader(manager);
  const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const decode = async (tex: THREE.Texture | null | undefined): Promise<Rgba | null> => {
    const url = tex?.userData?.url as string | undefined;
    const blob = url ? blobs.get(url) : undefined;
    if (!blob) return null;
    const bytes = await blob.arrayBuffer();
    if (blob.type === "image/tga") {
      const t = new TGALoader().parse(bytes) as unknown as { width: number; height: number; data: Uint8Array; flipY: boolean };
      return { w: t.width, h: t.height, data: t.data, flipY: t.flipY };
    }
    if (blob.type === "image/png") { const p = decodePng(new Uint8Array(bytes)); return { ...p, flipY: true }; }
    console.warn(`  texture ${url} is ${blob.type}: not decoded`);
    return null;
  };
  return { root, decode };
}

/** Colour at a UV (bilinear off: nearest texel, wrapped). */
export function sample(img: Rgba, u: number, v: number): [number, number, number] {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(img.w - 1, Math.floor(u * img.w));
  // TGALoader's data runs top row first (flipY asks the GPU upload to turn it), so v = 1 is row 0.
  const y = Math.min(img.h - 1, Math.floor((1 - v) * img.h));
  const o = (y * img.w + x) * 4;
  return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
}

/** Strip Mixamo's bone prefixes ("mixamorig:", "mixamorig1:", or the sanitised "mixamorigHips"). */
export function boneKey(name: string): string {
  return name.replace(/^mixamorig\d*:?/i, "");
}
