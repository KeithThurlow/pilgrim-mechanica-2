// Posed keys for each sword (Keith 2026-11-01: "a lab where we can pose things ... on a per weapon basis"): the pose
// lab (labs/pose/) grabs the arm at a key of a move (rest, the drive, the cut's start, middle and end, where it ends
// up) and moves the hand, turns the blade and swings the elbow; what it changes is an override of that key here.
//
// The data, per sword base id (src/items/bases.ts: sword-light the Breaker, sword-heavy the buster, sword-short the
// short sword), per key name (SWORD_KEYS below; a cut key posed for the close cut adds ":close"): the hand off the
// shoulder, the blade's way (fwd), the way its spine faces (up) and where the elbow points (pole), all in the LEFT
// arm's frame off its shoulder (+x out to the mech's left, +y up, +z ahead along the aim; the right arm mirrors).
// Anything left out keeps the code's key (src/weapons/sword.ts). A cut key's blade stays a sweep: its way is read back
// as a yaw across the aim and a pitch, so the cut still turns through it rather than cutting straight across.
//
// Applying Keith's poses as the defaults: the lab's "Copy pose" puts JSON on the clipboard in exactly this shape; paste
// it into SWORD_POSES (merging per sword), and every lab and the game swing with it. The lab's own edits live only in
// the lab (`setLivePoses`, saved in the browser) until then.
// Ownership: cosmetic and the player's (the shape of the swing; where it cuts follows from it).

export type P3 = [number, number, number];
export interface KeyPose { hand?: P3; fwd?: P3; up?: P3; pole?: P3 }
/** Key name ("rest", "aMid", "aMid:close", ...) to its posed values. */
export type PoseSet = Record<string, KeyPose>;

/** The keys a pose can change, in the order a swing passes them. `span`: the key has a close cut form too. */
export const SWORD_KEYS: { name: string; label: string; clip: "guard" | "A" | "B" | "R" | "P" | "K"; span: boolean }[] = [
  { name: "rest", label: "Rest", clip: "guard", span: false },
  { name: "drive", label: "Cut 1: drive in", clip: "A", span: true },
  { name: "aStart", label: "Cut 1: start", clip: "A", span: true },
  { name: "aMid", label: "Cut 1: middle", clip: "A", span: true },
  { name: "aEnd", label: "Cut 1: end", clip: "A", span: true },
  { name: "under", label: "Cut 1: ends up (under)", clip: "A", span: true },
  { name: "bStart", label: "Cut 2: start", clip: "B", span: true },
  { name: "bMid", label: "Cut 2: middle", clip: "B", span: true },
  { name: "bEnd", label: "Cut 2: end", clip: "B", span: true },
  { name: "cock", label: "Cut 2: ends up (cocked)", clip: "B", span: true },
  { name: "preRest", label: "Return: last before rest", clip: "R", span: false },
  { name: "block", label: "Block", clip: "P", span: false },
  { name: "recoil", label: "Parry recoil", clip: "K", span: false },
];

/** Keith's posed keys, the defaults everywhere. Paste the pose lab's "Copy pose" JSON here. */
export const SWORD_POSES: Record<string, PoseSet> = {};

/** The pose lab's unsaved edits (only ever set in the lab), on top of SWORD_POSES. */
let live: Record<string, PoseSet> = {};
const merged = new Map<string, PoseSet>();
const EMPTY: PoseSet = {};

/** A sword's posed keys (defaults with the lab's edits on top). */
export function posesFor(id: string | undefined): PoseSet {
  if (!id) return EMPTY;
  let m = merged.get(id);
  if (!m) {
    m = { ...(SWORD_POSES[id] ?? {}) };
    for (const [k, p] of Object.entries(live[id] ?? {})) m[k] = { ...(m[k] ?? {}), ...p };
    merged.set(id, m);
  }
  return m;
}

/** The lab's edits, replaced whole. */
export function setLivePoses(all: Record<string, PoseSet>) { live = all; merged.clear(); }
export function livePoses(): Record<string, PoseSet> { return live; }
/** One key of one sword (null clears it back to the default). */
export function setLivePose(id: string, key: string, pose: KeyPose | null) {
  const set = { ...(live[id] ?? {}) };
  if (pose) set[key] = pose; else delete set[key];
  live = { ...live, [id]: set };
  if (!Object.keys(set).length) delete live[id];
  merged.clear();
}

/** The name a key is stored under for a reach (span 0 the close cut, 1 the full sweep). */
export const poseKey = (name: string, close: boolean) => (close ? `${name}:close` : name);
