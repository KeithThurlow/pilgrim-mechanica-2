// The baked bandit (tools/mixamo/bake-bandit.ts writes it, banditVat.ts loads it): one thinned Mixamo character
// whose every clip frame is stored per vertex in two textures, so hundreds draw in one instanced mesh.
// public/models/bandit-vat.json holds this header; bandit-vat.bin holds the arrays at the byte offsets it lists.
//   pos:    frames × vertices × RGBA half floats (metres, character space: feet at y 0, facing +Z), row = frame
//   normal: frames × vertices × RG bytes (octahedral unit normal)
//   colour: vertices × RGBA float32 (linear base colour; alpha = cloth mask, where the per-bandit tint lands)
//   index:  triangles × 3 uint16
//   rest:   vertices × XYZ float32 (frame 0 of the first clip, for bounds and picking)

export interface VatClip {
  /** First texture row of the clip. */
  start: number;
  frames: number;
  /** Frames per second the clip was sampled at. */
  fps: number;
  /** Looping clips wrap their last frame to the first; others hold the last. */
  loop: boolean;
  /** Ground speed the clip was made at (m/s, at the baked height; 0 for clips in place). */
  speed: number;
  /** Length in seconds. */
  duration: number;
}

export interface VatHeader {
  version: 1;
  vertices: number;
  triangles: number;
  frames: number;
  /** Standing height of the baked character (m). */
  height: number;
  /** Average colour under the cloth mask, so a tint can replace it (linear RGB). */
  clothRef: [number, number, number];
  clips: Record<string, VatClip>;
  /** Byte offsets into the .bin. */
  offsets: { pos: number; normal: number; colour: number; index: number; rest: number };
  source: string;
}

/** Clips the drawer asks for by name. */
export const VAT_CLIPS = ["run", "sprint", "runFire", "walkFire", "aim", "flinch"] as const;
export type VatClipName = (typeof VAT_CLIPS)[number];
