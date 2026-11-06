// Messages between the main thread (src/sim/host.ts) and the sim worker (src/sim/worker.ts). Plain data; typed
// arrays go across as transferables (no SharedArrayBuffer: it needs cross-origin isolation headers). The worker answers
// in the order it is asked, and the ground's changes always go before a request that reads the ground.
import type { GroundEvent, GroundInit } from "./groundEvents";
import type { BuildResult, PatchResult, TerrainRemote } from "../world/chunks";

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
  | { type: "patch"; req: PatchRequest };

export type FromWorker =
  | { type: "ready" }
  /** A frame done: the heights at its sample points, how long the worker was busy since the last frame (ms). */
  | { type: "frame"; id: number; heights: Float64Array; ms: number }
  | { type: "chunk"; res: BuildResult }
  | { type: "patch"; res: PatchResult }
  | { type: "error"; message: string };
