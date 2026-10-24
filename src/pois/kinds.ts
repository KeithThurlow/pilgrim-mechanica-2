// Every POI kind's builder and sliders in one table: the lab and the checks build any placement through here.
import type { Param } from "../core/tweaks";
import type { PoiKind, PoiPlacement } from "../world/pois";
import type { PoiSite } from "./site";
import { buildOutcrop, OUTCROP_DEFAULTS, OUTCROP_PARAMS } from "./outcrop";
import { buildWreckPart, WRECK_PART_DEFAULTS, WRECK_PART_PARAMS } from "./wreckPart";
import { buildSupplyPod, POD_DEFAULTS, POD_PARAMS } from "./supplyPod";
import { buildDebrisField, DEBRIS_DEFAULTS, DEBRIS_PARAMS } from "./debrisField";
import { buildDeadConvoy, CONVOY_WRECK_DEFAULTS, CONVOY_WRECK_PARAMS } from "./deadConvoy";

export const SITE_DEFAULTS = { ...OUTCROP_DEFAULTS, ...WRECK_PART_DEFAULTS, ...POD_DEFAULTS, ...DEBRIS_DEFAULTS, ...CONVOY_WRECK_DEFAULTS };
/** Site values plus the pad sizes they read (those live in POI_DEFAULTS, since placement needs them too). */
export type SiteValues = typeof SITE_DEFAULTS & { debrisPad: number; convoyPad: number; convoyPadHalf: number };

/** Each kind's sliders, in a group "POI: <kind>". */
export const KIND_PARAMS: Record<PoiKind, Param[]> = {
  outcrop: OUTCROP_PARAMS, wreckPart: WRECK_PART_PARAMS, supplyPod: POD_PARAMS, debrisField: DEBRIS_PARAMS, deadConvoy: CONVOY_WRECK_PARAMS,
};
export const SITE_PARAMS: Param[] = Object.values(KIND_PARAMS).flat();
/** The slider group of a kind. */
export const kindGroup = (k: PoiKind) => KIND_PARAMS[k][0].group;

export function buildSite(p: PoiPlacement, v: SiteValues): PoiSite {
  switch (p.kind) {
    case "outcrop": return buildOutcrop(p, v);
    case "wreckPart": return buildWreckPart(p, v);
    case "supplyPod": return buildSupplyPod(p, v);
    case "debrisField": return buildDebrisField(p, v);
    case "deadConvoy": return buildDeadConvoy(p, v);
  }
}
