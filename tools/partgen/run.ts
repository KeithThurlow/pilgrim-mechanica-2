// Make a game part (docs/proposal-partgen.md). From a prompt: ComfyUI draws a concept image, then lane A
// (TripoSplat: image → splat, meshed here) and/or lane B (Pixal3D / TRELLIS.2: image → textured mesh) make the
// shape, and prep turns each into a part in public/models/gen/ with a sidecar and an entry in index.json, which the
// part lab (labs/parts/) shows beside the Rampart.
//
//   npx tsx tools/partgen/run.ts --kind hull --prompt "..." [--seed 1] [--lane a|b|both] [--comfy http://127.0.0.1:8188]
//   npx tsx tools/partgen/run.ts --kind hull --image concept.png --lane b     (skip the concept step)
//   npx tsx tools/partgen/run.ts --kind wreck --from some.ply|some.glb        (no ComfyUI: prep only)
// More: --label text (the part lab's name for it), --front +z --up +y (the source's axes; generators differ), --tris N (the full level), --id name, --res 160 (lane A grid).
// Workflows: tools/partgen/workflows/{concept,lane-a,lane-b}.json, ComfyUI "Export (API)" files (see comfy.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { Comfy, patch, type OutFile, type Workflow } from "./comfy";
import { readGlb, writeGlb } from "./glb";
import { loadKinds } from "./kinds";
import { glbToMesh, prepare, type Axis } from "./prep";
import { readPly, splatToMesh, SPLAT_MESH_DEFAULTS, type Mesh } from "./splat";

/** House style for concept images: one part, whole, flat light (the texture becomes paint, so no baked shadows). */
export const STYLE = "single game asset, hard-surface mech part, olive drab industrial paint, worn edges, " +
  "flat even lighting, no cast shadows, plain light grey background, three-quarter front view, whole object in frame";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const kinds = loadKinds();
const kind = kinds[opt("kind", "hull")!];
if (!kind) throw new Error(`partgen: --kind one of ${Object.keys(kinds).join(", ")}`);
const seed = Number(opt("seed", "1")), lane = opt("lane", "both")!, comfyUrl = opt("comfy", "http://127.0.0.1:8188")!;
const front = opt("front", "+z") as Axis, up = opt("up", "+y") as Axis;
const RAW = "shots/partgen/raw", OUT = "public/models/gen";
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
const wf = (name: string) => {
  const p = `tools/partgen/workflows/${name}.json`;
  if (!existsSync(p)) throw new Error(`partgen: no ${p} (export it from ComfyUI as API format; see tools/partgen/workflows/README.md)`);
  return JSON.parse(readFileSync(p, "utf8")) as Workflow;
};
const pick = (files: OutFile[], exts: string[]) => files.find((f) => exts.includes(extname(f.filename).toLowerCase()));

async function save(id: string, laneName: string, src: Mesh, meta: Record<string, unknown>) {
  const t0 = performance.now();
  // Full, simpler and simplest (docs/asset-list.md): <id>.glb, <id>-lod1.glb, <id>-lod2.glb, same sockets.
  const lods = [];
  for (const lod of [0, 1, 2] as const) {
    const q = await prepare(src, kind, { front, up, lod, tris: opt("tris") && lod === 0 ? Number(opt("tris")) : undefined });
    writeFileSync(`${OUT}/${id}${lod ? `-lod${lod}` : ""}.glb`, writeGlb([q.part], q.sockets, { kind: kind.id, lane: laneName, lod }));
    lods.push(q);
  }
  const p = lods[0];
  const side = { id, kind: kind.id, lane: laneName, seed, front, up, trisIn: p.trisIn, tris: lods.map((q) => q.part.index.length / 3), size: p.size, made: new Date().toISOString(), ...meta };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(side, null, 2) + "\n");
  const indexPath = `${OUT}/index.json`;
  const list = (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : []) as { id: string }[];
  const next = [...list.filter((e) => e.id !== id), { id, kind: kind.id, lane: laneName, label: opt("label") ?? meta.prompt ?? meta.from ?? id }].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(indexPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`${id}: ${p.trisIn} → ${side.tris.join(" / ")} tris, ${p.size.map((v) => v.toFixed(2)).join("×")} m, prep ${(performance.now() - t0).toFixed(0)} ms → ${OUT}/${id}.glb`);
}

function meshOf(bytes: Uint8Array, name: string): { mesh: Mesh; lane: string } {
  if (name.toLowerCase().endsWith(".ply")) {
    const t0 = performance.now();
    const s = readPly(bytes);
    const mesh = splatToMesh(s, { ...SPLAT_MESH_DEFAULTS, resolution: Number(opt("res", String(SPLAT_MESH_DEFAULTS.resolution))) });
    console.log(`splat ${s.n} Gaussians → ${mesh.index.length / 3} tris in ${(performance.now() - t0).toFixed(0)} ms`);
    return { mesh, lane: "a" };
  }
  return { mesh: glbToMesh(readGlb(bytes)), lane: "b" };
}

const from = opt("from");
if (from) {
  const { mesh, lane: l } = meshOf(new Uint8Array(readFileSync(from)), from);
  await save(opt("id", `${kind.id}-${l}-${seed}`)!, l, mesh, { from });
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
  for (const l of lane === "both" ? ["a", "b"] : [lane]) {
    const files = await comfy.run(patch(wf(`lane-${l}`), { image: uploaded, seed }));
    const f = pick(files, l === "a" ? [".ply"] : [".glb"]);
    if (!f) throw new Error(`partgen: lane ${l} wrote no ${l === "a" ? "PLY" : "GLB"} (got ${files.map((x) => x.filename).join(", ") || "nothing"})`);
    const bytes = await comfy.download(f), raw = `${RAW}/${kind.id}-${seed}-lane${l}${extname(f.filename)}`;
    writeFileSync(raw, bytes);
    const { mesh } = meshOf(bytes, f.filename);
    await save(opt("id", `${kind.id}-${l}-${seed}`)! + (opt("id") && lane === "both" ? `-${l}` : ""), l, mesh, { prompt: opt("prompt", kind.prompt), image, raw });
  }
}
