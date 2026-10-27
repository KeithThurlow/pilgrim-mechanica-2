// How far a planted foot sinks into the ground (Keith 2026-10-26 21:54: "the feet should clip into the ground a little
// more, especially for sand... push into softer things, sand and snow; on rock it would stand on top"). Pure and
// deterministic: from the surface (DuneField.surfaceAt, or a lab's override) and the ground's hardness (the crater
// layer: bare rock, rocky sand, shallows, POI pads and the convoy road are hard), so feet, the leg solve, checks and every
// peer agree. The walker puts its planted spots this far under the ground (WalkerSim.sinkAt); the footprint dents are
// about as deep on each surface (src/fx/dents.ts: print depth × the surface's depth), so a foot sits in its print.
import type { Param } from "../core/tweaks";

/** What a foot can stand on: the terrain's surfaces (concrete is bare rock and water) and snow (lab only so far). */
export type SinkSurface = "sand" | "gravel" | "dirt" | "concrete" | "snow";

export const SINK_DEFAULTS = {
  sinkSand: 0.09,
  sinkSnow: 0.22,
  sinkDirt: 0.04,
  sinkGravel: 0.025,
  sinkRock: 0,
};
export type SinkValues = typeof SINK_DEFAULTS;

const G = "Feet sink";
export const SINK_PARAMS: Param[] = [
  { key: "sinkSand", label: "Into sand (m)", min: 0, max: 0.4, step: 0.005, group: G, tip: "A planted foot sits this far into loose sand (less on harder ground: rocky sand, the road, POI pads). Keith 2026-10-26: push into soft things, stand on rock" },
  { key: "sinkSnow", label: "Into snow (m)", min: 0, max: 0.6, step: 0.005, group: G, tip: "No snow in the terrain yet: the walker lab's ?surface=snow" },
  { key: "sinkDirt", label: "Into dirt (m)", min: 0, max: 0.3, step: 0.005, group: G },
  { key: "sinkGravel", label: "Into gravel (m)", min: 0, max: 0.3, step: 0.005, group: G },
  { key: "sinkRock", label: "Into rock and concrete (m)", min: 0, max: 0.1, step: 0.005, group: G, tip: "0: stands on top" },
];

/** Sink depth (m) on a surface of this hardness (0 soft .. 1 takes no dent). Values missing from v take the defaults. */
export function sinkDepth(v: Partial<SinkValues>, surface: SinkSurface, hardness = 0): number {
  const d = surface === "sand" ? v.sinkSand ?? SINK_DEFAULTS.sinkSand
    : surface === "snow" ? v.sinkSnow ?? SINK_DEFAULTS.sinkSnow
    : surface === "dirt" ? v.sinkDirt ?? SINK_DEFAULTS.sinkDirt
    : surface === "gravel" ? v.sinkGravel ?? SINK_DEFAULTS.sinkGravel
    : v.sinkRock ?? SINK_DEFAULTS.sinkRock;
  return Math.max(0, d * (1 - Math.min(1, Math.max(0, hardness))));
}
