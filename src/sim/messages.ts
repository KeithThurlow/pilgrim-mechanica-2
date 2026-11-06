// Messages between the main thread (src/sim/host.ts) and the sim worker (src/sim/worker.ts). Plain data; typed
// arrays go across as transferables (no SharedArrayBuffer: it needs cross-origin isolation headers).
import type { GroundEvent, GroundInit } from "./groundEvents";

export type ToWorker =
  | { type: "init"; ground: GroundInit }
  /** One frame: the ground's events since the last, and points to sample for the parity check (x, z pairs; may be empty). */
  | { type: "frame"; id: number; ground: GroundEvent[]; sample: Float64Array };

export type FromWorker =
  | { type: "ready" }
  /** A frame done: the heights at its sample points, how long it took the worker (ms). */
  | { type: "frame"; id: number; heights: Float64Array; ms: number }
  | { type: "error"; message: string };
