// A pool's slots as ECS entities (docs/architecture-review.md stage 4, strangler step 4.1). Swarms keep their own
// slot-indexed arrays for now; this gives each live slot an entity, kept while the same thing (its uid) holds the
// slot, destroyed when it dies or the slot is reused. So the world can hold their shared components (Transform,
// Health...) while readers move over one by one. Pure.
import { World, type Entity } from "./world";

const NONE = 0xffffffff;

export class SlotEntities {
  /** The entity in each slot (NONE when empty), and the uid it was made for. */
  private ent = new Uint32Array(64).fill(NONE);
  private owner = new Uint32Array(64);
  /** Live entities this pool holds. */
  count = 0;

  constructor(readonly world: World) {}

  /** The entity for slot i holding thing `uid`: the same one while the uid stays, a new one when it changes. */
  at(i: number, uid: number): Entity {
    if (i >= this.ent.length) this.grow(i + 1);
    const e = this.ent[i];
    if (e !== NONE && this.owner[i] === uid && this.world.exists(e)) return e;
    if (e !== NONE) { this.world.destroy(e); this.count--; }
    const n = this.world.create();
    this.ent[i] = n; this.owner[i] = uid; this.count++;
    return n;
  }

  /** Slot i is empty or dead: its entity goes. */
  clear(i: number) {
    if (i >= this.ent.length) return;
    const e = this.ent[i];
    if (e === NONE) return;
    this.world.destroy(e);
    this.ent[i] = NONE; this.count--;
  }

  /** The entity in slot i, or -1. */
  get(i: number): Entity | -1 { return i < this.ent.length && this.ent[i] !== NONE ? this.ent[i] : -1; }

  private grow(n: number) {
    const cap = Math.max(n, this.ent.length * 2);
    const e = new Uint32Array(cap).fill(NONE); e.set(this.ent); this.ent = e;
    const o = new Uint32Array(cap); o.set(this.owner); this.owner = o;
  }
}
