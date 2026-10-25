// Shared parts for the code-built weapons: a targeting-laser emitter, a rocket (an RPG-style warhead), the
// armoured cowl a hull gun sits in, the trunnion boss that ties a hull gun to the shoulder, a ready lamp.
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, scaled, plate, bolt, boltCircle, lamp, type V3 } from "../kit";
import type { Section } from "../palette";

/** A small laser emitter box with a red lens facing +Z, its "Laser" socket at the lens. */
export function laserEmitter(B: Build, P: Piece, p: V3, size = 0.07, partPrefix = "") {
  const s = size;
  loftZ(P, [[p.z - s * 1.6, octRing(s, s * 0.8, s * 0.3)], [p.z + s * 0.9, octRing(s, s * 0.8, s * 0.3)], [p.z + s * 1.2, octRing(s * 0.85, s * 0.7, s * 0.25)]], "dark", { x0: p.x, y0: p.y });
  lathe(P, v(p.x, p.y, p.z + s * 1.2), Z(), [[0, 0], [0, s * 0.55], [s * 0.25, s * 0.45], [s * 0.3, 0]], "lighting", { n: 8 });
  B.socket(partPrefix + "Laser", v(p.x, p.y, p.z + s * 1.55), Z());
}

/** A rocket lying along +Z with its tail at `tail`: fins, motor body, a bulbous RPG warhead, a fuze probe. */
export function rocket(P: Piece, tail: V3, r: number, len: number, o: { warhead?: Section; body?: Section; band?: Section; bulb?: number; n?: number; fuze?: boolean } = {}) {
  const bulb = o.bulb ?? 1.7, wl = len * 0.42, n = o.n ?? 12;
  const zb = len - wl; // warhead base along the rocket
  // The warhead is the tell from the game camera (asset list W1): bright (trim) with a dark band.
  const wh = o.warhead ?? "trim", body = o.body ?? "dark", band = o.band ?? "secondary";
  // Motor body and tail cone.
  lathe(P, tail, Z(), [[0, 0], [0, r * 0.7], [len * 0.05, r * 0.95], [zb * 0.92, r], [zb, r * 1.05], [zb, 0]], body, { n: Math.max(6, n - 2), secs: [body, body, band, body] });
  // The warhead: widening cone, the bulb, an ogive to the fuze.
  const rw = r * bulb;
  lathe(P, tail.clone().addScaledVector(Z(), zb), Z(), [
    [0, 0], [0, r * 1.05], [wl * 0.22, rw * 0.92], [wl * 0.4, rw], [wl * 0.58, rw * 0.96], [wl * 0.82, rw * 0.62], [wl * 0.95, rw * 0.28], [wl, r * 0.22], [wl, 0],
  ], wh, { n, secs: [wh, wh, band, wh, wh, wh, "mechanical", "mechanical"] });
  if (o.fuze ?? true) lathe(P, tail.clone().addScaledVector(Z(), len - 0.002), Z(), [[0, 0], [0, r * 0.2], [r * 0.9, r * 0.14], [r * 1.0, 0]], "mechanical", { n: 6 });
  // Four folded fins at the tail.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, d = v(Math.cos(a), Math.sin(a), 0);
    const c = tail.clone().addScaledVector(Z(), len * 0.08).addScaledVector(d, r * 0.85);
    plate(P, c, Z(), d, len * 0.14, r * 0.55, r * 0.12, o.body ?? "dark", { bevel: 0, ch: r * 0.12 });
  }
}

/** An armoured cowl round a hull gun's breech: a chamfered housing lofted along z, battered top, belly. */
export function cowl(P: Piece, z0: number, z1: number, hw: number, hh: number, dy = 0, sec: Section = "plating") {
  const L = z1 - z0;
  loftZ(P, [
    [z0, octRing(hw * 0.82, hh * 0.8, hh * 0.35, hw * 0.08, hw * 0.1), dy],
    [z0 + L * 0.12, octRing(hw, hh, hh * 0.38, hw * 0.1, hw * 0.12), dy],
    [z0 + L * 0.78, octRing(hw, hh, hh * 0.38, hw * 0.1, hw * 0.12), dy],
    [z1, octRing(hw * 0.86, hh * 0.84, hh * 0.32, hw * 0.12, hw * 0.12), dy - hh * 0.04],
  ], sec);
}

/** The trunnion boss on the inboard side (the hull gun's pivot onto the shoulder), with a bolt circle. */
export function trunnion(B: Build, P: Piece, r: number, reach: number, at: V3 = v()) {
  const inb = v(-B.sd, 0, 0);
  lathe(P, at, inb, [[0, 0], [0, r * 1.15], [reach * 0.25, r * 1.15], [reach * 0.3, r * 0.85], [reach, r * 0.85], [reach, 0]], "mechanical", { n: 12, secs: ["secondary", "secondary", "mechanical", "mechanical", "mechanical"] });
  boltCircle(B.piece(P.name), at.clone().addScaledVector(inb, reach * 0.25), inb, r * 0.85, 6, r * 0.09);
}

/** An amber ready lamp on a face. */
export function readyLamp(P: Piece, pos: V3, nrm: V3, r = 0.035) { lamp(P, pos, nrm, r); }

export { bolt, scaled, X, Y };
