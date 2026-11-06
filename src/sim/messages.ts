// Messages between the main thread (src/sim/host.ts) and the sim worker (src/sim/worker.ts). Plain data; typed
// arrays go across as transferables (no SharedArrayBuffer: it needs cross-origin isolation headers). The worker answers
// in the order it is asked, and the ground's changes always go before a request that reads the ground.
import type { GroundEvent, GroundInit } from "./groundEvents";
import type { BuildResult, PatchResult, TerrainRemote } from "../world/chunks";
import type { FineRemote } from "../world/groundWindow";

export type FineRequest = Parameters<FineRemote["fine"]>[0];

export type BuildRequest = Parameters<TerrainRemote["build"]>[0];
export type PatchRequest = Parameters<TerrainRemote["patch"]>[0];

export type ToWorker =
  | { type: "init"; ground: GroundInit }
  /** The ground's changes since the last message. */
  | { type: "ground"; ground: GroundEvent[] }
  /** End of a frame: points to sample for the parity check (x, z pairs; may be empty). */
  | { type: "frame"; id: number; sample: Float64Array }
  /** Terrain (step 2): a chunk's vertices, a changed box's vertices. */
  | { type: "chunk"; req: BuildRequest }
  | { type: "patch"; req: PatchRequest }
  /** Step 2b: fine rows of the ground window under the detail patch. */
  | { type: "fine"; req: FineRequest };

export type FromWorker =
  | { type: "ready" }
  /**
   * A frame done: the heights at its sample points, how long the worker was busy since the last frame (ms); step 3:
   * the escorts' snapshot (src/sim/escortsRemote.ts) and the worker's convoy poses (x, y, z, heading per platform,
   * then the plough's x, z), for the parity check; null before they exist.
   */
  | { type: "frame"; id: number; heights: Float64Array; ms: number; escorts: Float64Array | null; convoy: Float64Array | null }
  | { type: "chunk"; res: BuildResult }
  | { type: "patch"; res: PatchResult }
  | { type: "fine"; req: FineRequest; heights: Float32Array }
  | { type: "error"; message: string };
