// Import the old project's mech weapon kit (Minigun, HandCannon, MissilePod L/M/H, back drums, belt segments):
// FBX -> public/models/weapons/<id>.glb plus a <id>.json sidecar in this repo's frame (docs/asset-list.md: +Z front,
// +Y up, +X the mech's left, root at the mount). The FBXs load in Unity's frame with X already negated by the
// loader's handedness, so geometry needs nothing; the old sidecars' Unity x values flip.
//   npx tsx tools/weapons-import.ts <old repo>/Assets/_Project/Art/Generated/Weapons/Mech
// The old repo's files are in Git LFS: `git lfs pull --include="Assets/_Project/Art/Generated/Weapons/Mech/*"` there.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { convertFbx } from "./fbx-to-glb";

const SRC = process.argv[2] ?? resolve(import.meta.dirname, "../../pilgrim-mechanica/Assets/_Project/Art/Generated/Weapons/Mech");
const OUT = resolve(import.meta.dirname, "../public/models/weapons");

const NAMES = [
  "Minigun_L", "Minigun_L_Lside", "Minigun_M", "Minigun_M_Lside", "Minigun_H",
  "HandCannon_L", "HandCannon_L_Lside", "HandCannon_M", "HandCannon_M_Lside", "HandCannon_H", "HandCannon_H_Lside",
  "MissilePod_L", "MissilePod_L_Lside", "MissilePod_M", "MissilePod_M_Lside", "MissilePod_H", "MissilePod_H_Lside",
  "AmmoDrum_Back_Full", "AmmoDrum_Back_Half", "AmmoDrum_Back_Half_Lside", "AmmoBelt_Link", "AmmoBelt_Chute",
];

/** Weapon_MissilePod_M_Lside -> missile-pod-m-left */
const fileName = (n: string) => n.replace("_Lside", "_left").replace(/([a-z])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const flip = (p: number[]) => [r4(-p[0]), r4(p[1]), r4(p[2])];

for (const n of NAMES) {
  const fbx = `${SRC}/Weapon_${n}.fbx`, json = `${SRC}/Weapon_${n}.json`;
  if (!existsSync(fbx)) throw new Error(`missing ${fbx} (git lfs pull in the old repo?)`);
  const id = fileName(n);
  const { tris } = await convertFbx(fbx, `${OUT}/${id}.glb`);
  const d = JSON.parse(readFileSync(json, "utf8"));
  const moving = (d.moving ?? []).map((m: Record<string, unknown>) => {
    // Hinges about X and spins about Z are unchanged by the X flip; slides: Slide back along -Z, Missile_n out +Z.
    const o: Record<string, unknown> = { node: m.node, kind: m.kind, axis: m.kind === "slide" ? (String(m.node).startsWith("Missile") ? [0, 0, 1] : [0, 0, -1]) : m.kind === "spin" ? [0, 0, 1] : [1, 0, 0] };
    for (const k of ["angleDeg", "travel", "suggestedRpm"]) if (typeof m[k] === "number") o[k] = m[k];
    if (Array.isArray(m.pivot)) o.pivot = flip(m.pivot as number[]);
    return o;
  });
  const sockets = Object.fromEntries(Object.entries((d.sockets ?? {}) as Record<string, number[]>).map(([k, p]) => [k, flip(p)]));
  const socketFrames = Object.fromEntries(Object.entries((d.socketFrames ?? {}) as Record<string, { position: number[]; forward: number[]; up: number[]; note?: string }>)
    .map(([k, f]) => [k, { position: flip(f.position), forward: flip(f.forward), up: flip(f.up), note: f.note }]));
  const side = d.side?.side ?? "both";
  const sidecar = {
    id, class: d.class ?? n.split("_")[0], size: d.size ?? n.split("_").slice(1).join("_").replace("_Lside", ""), mount: d.mount, brand: d.brand,
    side: side === "right" ? "right" : side === "left" ? "left" : "both",
    // The old kit roots its guns on their own axis (a hull gun on its trunnion, a hand gun on its grip), not on the
    // mech's joint as the asset-list contract does: the game offsets them (src/weapons/mounts.ts).
    rootAt: ["hull", "forearm", "hand", "two_handed"].includes(d.mount) ? "trunnion" : "joint",
    frame: "+Z front (muzzle), +Y up, +X the mech's left; root at the mount or grip; metres at game size",
    source: `old repo Assets/_Project/Art/Generated/Weapons/Mech/Weapon_${n}.fbx (+ .json), converted by tools/weapons-import.ts`,
    tris, moving, sockets, socketFrames, paintSections: d.paintSections, extra: d.extra ?? {},
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(sidecar, null, 1) + "\n");
}
console.log(`wrote ${NAMES.length} models and sidecars to ${OUT}`);
