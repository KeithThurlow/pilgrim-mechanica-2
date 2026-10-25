// The ground's broad colour at a point: trough to windward to crest by height on the dune, slip faces darker, flats
// paler; rocky sand greyer, bare rock by steepness with strata; wet sand and the floor under the shallows. The chunks
// (src/world/chunks.ts) bake it into their vertex colours and the detail patch (src/world/detailPatch.ts) into its
// colour window, from this one function, so the two can't drift apart.
import * as THREE from "three/webgpu";
import type { DuneField, GroundSample } from "./terrain";

// Sand palette (sRGB): warm windward faces, darker slip faces, paler hardpan flats.
const C = {
  trough: new THREE.Color().setHex(0xc99467, THREE.SRGBColorSpace),
  windward: new THREE.Color().setHex(0xe6b780, THREE.SRGBColorSpace),
  crest: new THREE.Color().setHex(0xf3d3a2, THREE.SRGBColorSpace),
  slip: new THREE.Color().setHex(0xc4824f, THREE.SRGBColorSpace),
  flat: new THREE.Color().setHex(0xdcb98f, THREE.SRGBColorSpace),
  // Rocky land: sand in the hollows a little greyer; rock tops grey-brown, risers red-brown.
  rockSand: new THREE.Color().setHex(0xccb08a, THREE.SRGBColorSpace),
  rockTop: new THREE.Color().setHex(0xa48c72, THREE.SRGBColorSpace),
  rockFace: new THREE.Color().setHex(0x6a4232, THREE.SRGBColorSpace),
  // Shallows: wet sand at the waterline, the floor under the water.
  wet: new THREE.Color().setHex(0x9c8261, THREE.SRGBColorSpace),
  floor: new THREE.Color().setHex(0x7d7a5f, THREE.SRGBColorSpace),
};
/** Water colours (the chunks' water sheets). */
export const WATER_COLOURS = {
  shallow: new THREE.Color().setHex(0x7fae9f, THREE.SRGBColorSpace),
  deep: new THREE.Color().setHex(0x2f6465, THREE.SRGBColorSpace),
  foam: new THREE.Color().setHex(0xeef2e8, THREE.SRGBColorSpace),
};

const c2 = new THREE.Color(), wide = [0, 1, 0];

/** The colour at (x, z), given its sample s (field.sample(x, z)); written into out. */
export function groundColour(field: DuneField, x: number, z: number, s: GroundSample, out: THREE.Color): THREE.Color {
  const [wx, wz] = field.wind();
  const cr = Math.pow(Math.min(1, s.crest), 0.8);
  out.copy(C.trough).lerp(C.windward, Math.min(1, cr * 1.6)).lerp(C.crest, Math.max(0, cr - 0.6) * 2);
  // Colour reads a wide normal (2 m) so the slip-face tint fades smoothly instead of following the grid.
  field.normal(x, z, wide, 2);
  const steep = 1 - wide[1], downwind = wide[0] * wx + wide[2] * wz;
  const slipK = smooth(0.12, 0.35, steep) * smooth(0.02, 0.2, downwind);
  out.lerp(C.slip, slipK * 0.75);
  out.lerp(C.flat, s.flat * 0.25 * (1 - (s.wr ?? 0)));
  // Biomes: rocky land's sand greyer, bare rock by steepness (tops grey, risers red-brown); shallows wet and dark.
  const wr = s.wr ?? 0, ws = s.ws ?? 0, rock = s.rock ?? 0;
  if (wr > 0) out.lerp(C.rockSand, wr * 0.6);
  if (rock > 0) {
    // Rock: tops grey-brown, risers red-brown, with strata bands by height so the shelves read as layered stone.
    const band = 0.5 + 0.5 * Math.sin(s.h * 3.9 + Math.sin(x * 0.05) * 0.6);
    c2.copy(C.rockTop).lerp(C.rockFace, smooth(0.08, 0.3, steep));
    c2.multiplyScalar(0.9 + 0.14 * band * smooth(0.05, 0.25, steep));
    out.lerp(c2, rock);
  }
  const water = field.waterLevel;
  if (water !== null && ws > 0) {
    const above = s.h - water;
    out.lerp(C.wet, ws * (1 - smooth(0.05, 1.6, above) * 0.6) * (1 - rock * 0.7));
    out.lerp(C.floor, ws * smooth(0, 0.6, -above) * (1 - rock));
  }
  return out;
}

export const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
