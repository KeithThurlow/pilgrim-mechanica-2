// A rocket clip's look from its magazine (Keith 2026-10-31: clip-fed rockets with a reload you can see and hear). Pure:
// the arsenal hands each clip-fed model its magazine, the model (src/weapons/modelSwap.ts) poses itself from this.
// Firing, the loaded tubes go dark in order (tube 0 first). Reloading: the empty clip drops out of the cradle, a beat
// with no clip, a full one rises in and seats with a clunk (the arsenal plays it at CLIP_SEAT).
import type { Mag } from "./magazine";

/** Reload phases (share of the reload): drop out by, rise from, seated at. */
export const CLIP_OUT = 0.3, CLIP_IN = 0.5, CLIP_SEAT = 0.85;

export interface ClipPose {
  /** How far the clip has dropped (0 seated, 1 its full drop). */
  drop: number;
  /** Is there a clip in view at all? */
  shown: boolean;
  /** Tubes still loaded (the last ones: tube i is loaded when i >= tubes - loaded). */
  loaded: number;
}

/** 0..1 of the way through a reload, or -1 when not reloading. */
export const reloadShare = (m: Mag) => (m.reloading > 0 ? 1 - m.reloading / Math.max(1e-3, m.reload) : -1);

export function clipPose(m: Mag, tubes: number): ClipPose {
  const p = reloadShare(m);
  if (p < 0) return { drop: 0, shown: true, loaded: Math.max(0, Math.min(tubes, Math.round((tubes * m.left) / Math.max(1, m.size)))) };
  if (p < CLIP_OUT) { const k = p / CLIP_OUT; return { drop: k * k, shown: true, loaded: 0 }; }
  if (p < CLIP_IN) return { drop: 1, shown: false, loaded: 0 };
  if (p < CLIP_SEAT) { const t = (p - CLIP_IN) / (CLIP_SEAT - CLIP_IN), e = t * t * (3 - 2 * t); return { drop: 1 - e, shown: true, loaded: tubes }; }
  return { drop: 0, shown: true, loaded: tubes };
}

/** The tube the next round leaves from: rounds already fired out of this clip (so they go in order). */
export const nextTube = (m: Mag) => Math.max(0, Math.ceil(m.size - m.left - 1e-6));
