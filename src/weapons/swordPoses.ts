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
  { name: "ret1", label: "Return: coming back up", clip: "R", span: false },
  { name: "ret2", label: "Return: across the front", clip: "R", span: false },
  { name: "preRest", label: "Return: last before rest", clip: "R", span: false },
  { name: "block", label: "Block", clip: "P", span: false },
  { name: "recoil", label: "Parry recoil", clip: "K", span: false },
];

/** Keith's posed keys, the defaults everywhere. Paste the pose lab's "Copy pose" JSON here. */
export const SWORD_POSES: Record<string, PoseSet> = {
  // Keith 2026-11-02, from the pose lab: the Breaker. The other swords start from it (INHERIT) and list only where they differ.
  "sword-light": {
    "bMid": {"hand":[0.705,-0.836,2.596],"fwd":[-0.109,-0.046,0.993],"up":[-0.954,-0.277,-0.118],"pole":[0.756,-0.182,0.629]},
    "bEnd": {"hand":[2.578,0.712,0.907],"fwd":[0.741,0.254,0.621],"up":[-0.613,-0.12,0.781],"pole":[0.953,0.237,-0.187]},
    "bStart": {"hand":[-1.751,-1.094,1.405],"fwd":[-0.522,-0.042,-0.852],"up":[0.85,-0.114,-0.515],"pole":[0.313,-0.853,0.419]},
    "under": {"hand":[-1.471,-0.896,1.776],"fwd":[-0.75,-0.185,-0.635],"up":[0.59,0.246,-0.769],"pole":[-0.144,-0.301,0.943]},
    "aEnd": {"hand":[-1.771,-1.34,1.355],"fwd":[-0.938,-0.257,-0.233],"up":[-0.248,0.028,0.968],"pole":[-0.055,-0.847,0.529]},
    "drive:close": {"hand":[1.173,0.604,1.222],"fwd":[-0.348,-0.101,-0.932],"up":[0.142,0.977,-0.159],"pole":[0.507,-0.495,0.706]},
    "aStart:close": {"hand":[1.364,-0.311,1.514],"fwd":[0.273,0.405,-0.873],"up":[-0.626,-0.614,-0.481],"pole":[0.249,-0.664,0.705]},
    "aMid:close": {"hand":[-0.755,-0.492,1.444],"fwd":[0.734,0.563,-0.381],"up":[0.176,-0.699,-0.693],"pole":[0.326,-0.754,0.569]},
    "aEnd:close": {"hand":[-0.655,-0.822,1.559],"fwd":[-0.801,-0.409,-0.437],"up":[-0.339,-0.292,0.894],"pole":[0.395,-0.34,0.854]},
    "under:close": {"hand":[-0.951,-1.312,1.414],"fwd":[-0.948,-0.253,-0.194],"up":[-0.052,0.724,-0.688],"pole":[0.096,-0.593,0.799]},
    "bStart:close": {"hand":[-0.488,-1.176,1.515],"fwd":[-0.996,-0.046,-0.076],"up":[0.071,0.101,-0.992],"pole":[0.786,-0.437,0.437]},
    "bMid:close": {"hand":[0.399,-0.723,1.521],"fwd":[-0.999,-0.028,0.024],"up":[-0.023,-0.043,-0.999],"pole":[0.869,-0.391,0.304]},
    "bEnd:close": {"hand":[2.227,0.793,0.386],"fwd":[0.838,0.243,0.488],"up":[-0.24,-0.64,0.73],"pole":[0.752,0.217,-0.622]},
    "cock:close": {"hand":[0.618,1.2,1.875],"fwd":[-0.216,0.452,-0.865],"up":[-0.151,-0.891,-0.428],"pole":[0.627,-0.697,-0.348]},
    "rest": {"hand":[0.025,-0.976,1.832],"fwd":[-0.26,0.69,-0.675],"up":[0.582,-0.446,-0.68],"pole":[0.664,-0.733,-0.148]},
    "drive": {"hand":[0.891,1.493,0.323],"fwd":[-0.293,-0.713,-0.637],"up":[-0.222,-0.597,0.771],"pole":[-0.057,-0.586,0.808]},
    "aStart": {"hand":[1.941,-1.141,0.688],"fwd":[0.763,0.035,-0.646],"up":[-0.646,0.045,-0.762],"pole":[0.239,-0.921,0.309]},
  },
  // Keith 2026-11-02: the short sword's own keys (the rest from the Breaker).
  "sword-short": {
    "drive:close": {"hand":[0.767,-1.576,0.357],"fwd":[0.04,0.411,0.911],"up":[-0.503,0.796,-0.337],"pole":[0.229,-0.792,-0.566]},
    "aStart:close": {"hand":[1.25,-0.827,1.229],"fwd":[0.268,0.405,-0.874],"up":[-0.629,-0.614,-0.477],"pole":[0.26,-0.947,0.189]},
    "aMid:close": {"hand":[-0.613,-0.492,2.183],"fwd":[0.733,0.563,-0.381],"up":[0.176,-0.699,-0.693],"pole":[0.326,-0.755,0.569]},
    "aEnd:close": {"hand":[-1.206,-1.106,2.052],"fwd":[-0.801,-0.409,-0.437],"up":[-0.339,-0.292,0.894],"pole":[0.395,-0.34,0.854]},
    "bStart:close": {"hand":[-1.153,-1.175,2.156],"fwd":[-0.541,0.139,-0.83],"up":[0.841,0.054,-0.539],"pole":[0.786,-0.437,0.437]},
    "bMid:close": {"hand":[0.477,-0.723,2.255],"fwd":[-0.999,-0.028,0.024],"up":[-0.023,-0.043,-0.999],"pole":[0.869,-0.391,0.304]},
    "bEnd:close": {"hand":[2.54,-1.025,-1.364],"fwd":[0.876,-0.376,0.302],"up":[-0.117,0.442,0.889],"pole":[0.665,-0.19,-0.723]},
    "rest": {"hand":[0.884,-2.073,-0.052],"fwd":[0.368,-0.339,0.866],"up":[-0.386,0.791,0.474],"pole":[0.147,-0.777,-0.612]},
    "cock": {"hand":[2.108,-0.994,1.406],"fwd":[0.525,-0.32,0.789],"up":[-0.829,0.016,0.558],"pole":[0.958,-0.242,-0.151]},
  },
  // Keith 2026-11-02: the buster's own keys (the rest from the Breaker).
  "sword-heavy": {
    "aEnd:close": {"hand":[-0.041,-0.8,1.971],"fwd":[-0.786,-0.596,-0.163],"up":[-0.085,-0.157,0.984],"pole":[0.395,-0.34,0.854]},
    "rest": {"hand":[0.281,1.535,1.08],"fwd":[-0.132,-0.663,-0.737],"up":[0.811,-0.499,0.304],"pole":[0.394,-0.392,0.832]},
  },
};

/** Swords that start from another's poses (Keith 2026-11-02: "make that breaker animation a default for the other
 *  swords, and then I can branch from there"): every key they don't pose themselves is the Breaker's, edits included. */
export const INHERIT: Record<string, string> = { "sword-heavy": "sword-light", "sword-short": "sword-light" };

/** The pose lab's unsaved edits (only ever set in the lab), on top of SWORD_POSES. */
let live: Record<string, PoseSet> = {};
const merged = new Map<string, PoseSet>();
const EMPTY: PoseSet = {};

/** A sword's posed keys (defaults with the lab's edits on top). */
export function posesFor(id: string | undefined): PoseSet {
  if (!id) return EMPTY;
  let m = merged.get(id);
  if (!m) {
    // A sword that branches from another starts from that one's posed keys (its own on top).
    m = INHERIT[id] ? { ...posesFor(INHERIT[id]) } : {};
    for (const [k, p] of Object.entries(SWORD_POSES[id] ?? {})) m[k] = { ...(m[k] ?? {}), ...p };
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
