// A small seeded random stream for anything that changes game state (CLAUDE.md rule 12: Math.random only in FX, sound
// and drawing). mulberry32: fast, 32 bits of state, so a host can snapshot it (`state`) and a peer or the sim worker
// can carry on the same stream. Pure.
export class Rng {
  state: number;
  constructor(seed = 1) { this.state = seed >>> 0 || 1; }
  /** 0 (inclusive) to 1 (exclusive). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** The stream as a function, for code that takes one. */
  readonly fn = () => this.next();
}

/** A seed from text (an id, a name): FNV-1a. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
