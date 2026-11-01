// Make a game part (docs/proposal-partgen.md). From a prompt: ComfyUI draws a concept image, then lane A
// (TripoSplat: image → splat, meshed here) and/or lane B (Pixal3D / TRELLIS.2: image → textured mesh) make the
// shape, and prep turns each into a part in public/models/gen/ with a sidecar and an entry in index.json, which the
// part lab (labs/parts/) shows beside the Rampart.
//
//   npx tsx tools/partgen/run.ts --kind hull --prompt "..." [--seed 1] [--lane a|b|both] [--comfy http://127.0.0.1:8188]
//   npx tsx tools/partgen/run.ts --kind hull --image concept.png --lane b     (skip the concept step)
//   npx tsx tools/partgen/run.ts --kind wreck --from some.ply|some.glb        (no ComfyUI: prep only)
// Axes per lane (found 2026-11-01 on Keith's PC): lane A --front +x --up -y; lane B --front +z --up +y --yaw 45,snap.
// More: --label text (the part lab's name for it), --front +z --up +y (the source's axes; generators differ),
// --yaw deg[,snap] (turn about +Y after that; snap: then box it tightest within ±45°), --tris N (the full level), --id name, --res N (lane A grid; default: each level meshed at its own budget), --delight 0..1
// (take baked light out of the colours; default 1 for lane A, 0 for lane B whose base colour is albedo).
// Workflows: tools/partgen/workflows/{concept,lane-a,lane-b}.json, ComfyUI "Export (API)" files (see comfy.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { Comfy, hasTitle, patch, type OutFile, type Workflow } from "./comfy";
import { readGlb, writeGlb } from "./glb";
import { loadKinds } from "./kinds";
import { glbToMesh, prepare, type Axis } from "./prep";
import { readPly, splatToMesh, splatToMeshAt, SPLAT_MESH_DEFAULTS, type Mesh } from "./splat";

/** House style for concept images: one part, whole, unlit (the colours become paint: Keith 2026-11-01, no baked lighting). */
export const STYLE = "single game asset, hard-surface mech part, olive drab industrial paint, worn edges, " +
  "unlit albedo colours only, flat even lighting, no cast shadows, no highlights, no reflections, plain light grey background, " +
  "three-quarter front view, whole object in frame";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const kinds = loadKinds();
const kind = kinds[opt("kind", "hull")!];
if (!kind) throw new Error(`partgen: --kind one of ${Object.keys(kinds).join(", ")}`);
const seed = Number(opt("seed", "1")), lane = opt("lane", "both")!, comfyUrl = opt("comfy", "http://127.0.0.1:8188")!;
const front = opt("front", "+z") as Axis, up = opt("up", "+y") as Axis;
// --yaw degrees (about +Y after --front/--up), or "<degrees>,snap" / "snap" to then box the part tightest (within ±45°).
const yawArg = opt("yaw", "0")!, yaw = parseFloat(yawArg) || 0, snap = yawArg.includes("snap");
const RAW = "shots/partgen/raw", OUT = "public/models/gen";
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
const wf = (name: string) => {
  const p = `tools/partgen/workflows/${name}.json`;
  if (!existsSync(p)) throw new Error(`partgen: no ${p} (export it from ComfyUI as API format; see tools/partgen/workflows/README.md)`);
  return JSON.parse(readFileSync(p, "utf8")) as Workflow;
};
const pick = (files: OutFile[], exts: string[]) => files.find((f) => exts.includes(extname(f.filename).toLowerCase()));

/** A level of detail's raw mesh: each level is made at its own budget where the lane can (low-res from the start). */
type Source = (lod: 0 | 1 | 2, budget: number) => Promise<Mesh>;

async function save(id: string, laneName: string, source: Source, meta: Record<string, unknown>) {
  const t0 = performance.now();
  // Lane A's colours are the concept image's light; lane B's base colour is albedo already (Keith 2026-11-01: no
  // lighting baked into textures).
  const delightAmount = Number(opt("delight", laneName === "a" ? "1" : "0"));
  // Full, simpler and simplest (docs/asset-list.md): <id>.glb, <id>-lod1.glb, <id>-lod2.glb, same sockets.
  const lods = [];
  for (const lod of [0, 1, 2] as const) {
    const budget = opt("tris") && lod === 0 ? Number(opt("tris")) : kind.tris[lod];
    const q = await prepare(await source(lod, budget), kind, { front, up, yaw, snap, lod, tris: budget, delight: delightAmount });
    writeFileSync(`${OUT}/${id}${lod ? `-lod${lod}` : ""}.glb`, writeGlb([q.part], q.sockets, { kind: kind.id, lane: laneName, lod }));
    lods.push(q);
  }
  const p = lods[0];
  const side = { id, kind: kind.id, lane: laneName, seed, front, up, yaw: yawArg, delight: delightAmount, trisIn: lods.map((q) => q.trisIn), tris: lods.map((q) => q.part.index.length / 3), size: p.size, made: new Date().toISOString(), ...meta };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(side, null, 2) + "\n");
  const indexPath = `${OUT}/index.json`;
  const list = (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : []) as { id: string }[];
  const next = [...list.filter((e) => e.id !== id), { id, kind: kind.id, lane: laneName, label: opt("label") ?? meta.prompt ?? meta.from ?? id }].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(indexPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`${id}: made ${side.trisIn.join(" / ")} → ${side.tris.join(" / ")} tris, ${p.size.map((v) => v.toFixed(2)).join("×")} m, ${(performance.now() - t0).toFixed(0)} ms → ${OUT}/${id}.glb`);
}

/** Lane A: mesh the splat afresh at each level's budget (or at a fixed --res). */
function splatSource(bytes: Uint8Array): Source {
  const s = readPly(bytes);
  return async (lod, budget) => {
    const t0 = performance.now();
    const m = opt("res") ? { ...splatToMesh(s, { ...SPLAT_MESH_DEFAULTS, resolution: Number(opt("res")) }), resolution: Number(opt("res")) } : splatToMeshAt(s, budget);
    console.log(`lod${lod}: splat ${s.n} Gaussians → ${m.index.length / 3} tris at resolution ${m.resolution} in ${(performance.now() - t0).toFixed(0)} ms`);
    return m;
  };
}

const from = opt("from");
if (from) {
  const bytes = new Uint8Array(readFileSync(from));
  const isPly = from.toLowerCase().endsWith(".ply");
  const glbMesh = isPly ? null : glbToMesh(readGlb(bytes));
  await save(opt("id", `${kind.id}-${isPly ? "a" : "b"}-${seed}`)!, isPly ? "a" : "b", isPly ? splatSource(bytes) : async () => glbMesh!, { from });
} else {
  const comfy = new Comfy(comfyUrl);
  const prompt = `${opt("prompt", kind.prompt)}, ${STYLE}`;
  let image = opt("image");
  if (!image) {
    const files = await comfy.run(patch(wf("concept"), { prompt, seed }));
    const f = pick(files, [".png", ".jpg", ".jpeg", ".webp"]);
    if (!f) throw new Error("partgen: the concept workflow wrote no image");
    image = `${RAW}/${kind.id}-${seed}-concept${extname(f.filename)}`;
    writeFileSync(image, await comfy.download(f));
    console.log(`concept → ${image}`);
  }
  const uploaded = await comfy.upload(image);
  const fetchOut = async (l: string, extra: { faces?: number; res?: number }, tag: string) => {
    const files = await comfy.run(patch(wf(`lane-${l}`), { image: uploaded, seed, ...extra }));
    const f = pick(files, l === "a" ? [".ply"] : [".glb"]);
    if (!f) throw new Error(`partgen: lane ${l} wrote no ${l === "a" ? "PLY" : "GLB"} (got ${files.map((x) => x.filename).join(", ") || "nothing"})`);
    const bytes = await comfy.download(f), raw = `${RAW}/${kind.id}-${seed}-lane${l}${tag}${extname(f.filename)}`;
    writeFileSync(raw, bytes);
    return { bytes, raw };
  };
  for (const l of lane === "both" ? ["a", "b"] : [lane]) {
    const id = opt("id", `${kind.id}-${l}-${seed}`)! + (opt("id") && lane === "both" ? `-${l}` : "");
    const meta = { prompt: opt("prompt", kind.prompt), image };
    if (l === "a") {
      const { bytes, raw } = await fetchOut("a", {}, "");
      await save(id, "a", splatSource(bytes), { ...meta, raw });
    } else {
      // Lane B: a workflow with a PG_FACES node is run once per level at that level's budget (low-res from the start);
      // without one, its single output is reduced for each level.
      const perLod = hasTitle(wf("lane-b"), "PG_FACES");
      let one: Mesh | null = null;
      const raws: string[] = [];
      await save(id, "b", async (lod, budget) => {
        if (!perLod && one) return one;
        const { bytes, raw } = await fetchOut("b", { faces: budget, res: opt("res") ? Number(opt("res")) : undefined }, perLod ? `-lod${lod}` : "");
        raws.push(raw);
        one = glbToMesh(readGlb(bytes));
        return one;
      }, { ...meta, raw: raws });
    }
  }
}
