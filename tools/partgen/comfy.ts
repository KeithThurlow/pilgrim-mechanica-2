// A small ComfyUI HTTP client for the part pipeline: upload an image, queue a workflow (API format, exported from
// ComfyUI with "Export (API)"), wait for it, download what it wrote. Workflows are patched by node title, so any
// workflow works if its nodes are titled:
//   PG_PROMPT  a text node (CLIPTextEncode or any node with a `text` input): gets the prompt
//   PG_IMAGE   a LoadImage node: gets the uploaded image
//   PG_SEED    any node with a `seed` or `noise_seed` input: gets the seed
// Untitled fallbacks: the first CLIPTextEncode not titled negative, every LoadImage, every seed input.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

type Node = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type Workflow = Record<string, Node>;
export interface OutFile { filename: string; subfolder: string; type: string }

export class Comfy {
  constructor(readonly url = "http://127.0.0.1:8188") {}

  async upload(path: string): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([readFileSync(path)]), basename(path));
    form.append("overwrite", "true");
    const r = await fetch(`${this.url}/upload/image`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`comfy upload: ${r.status} ${await r.text()}`);
    const j = await r.json() as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  /** Queue a workflow and wait for it; returns every file its output nodes wrote. */
  async run(wf: Workflow, timeoutS = 1800): Promise<OutFile[]> {
    const r = await fetch(`${this.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: wf, client_id: "partgen" }) });
    if (!r.ok) throw new Error(`comfy prompt: ${r.status} ${await r.text()}`);
    const { prompt_id } = await r.json() as { prompt_id: string };
    const t0 = Date.now();
    for (;;) {
      await new Promise((res) => setTimeout(res, 2000));
      const h = await (await fetch(`${this.url}/history/${prompt_id}`)).json() as Record<string, { outputs: Record<string, Record<string, unknown>>; status?: { status_str?: string; messages?: unknown[] } }>;
      const e = h[prompt_id];
      if (e?.status?.status_str === "error") throw new Error(`comfy: workflow failed: ${JSON.stringify(e.status.messages).slice(0, 2000)}`);
      if (e && (e.status?.status_str === "success" || Object.keys(e.outputs).length)) {
        const files: OutFile[] = [];
        for (const out of Object.values(e.outputs)) for (const v of Object.values(out)) {
          if (Array.isArray(v)) for (const f of v) if (f && typeof f === "object" && "filename" in f) files.push(f as OutFile);
        }
        return files;
      }
      if (Date.now() - t0 > timeoutS * 1000) throw new Error(`comfy: timed out after ${timeoutS} s`);
    }
  }

  async download(f: OutFile): Promise<Uint8Array> {
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
    const r = await fetch(`${this.url}/view?${q}`);
    if (!r.ok) throw new Error(`comfy view ${f.filename}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

/** Fill a workflow's prompt, image and seed (see the header). */
export function patch(wf: Workflow, p: { prompt?: string; image?: string; seed?: number }): Workflow {
  const w = JSON.parse(JSON.stringify(wf)) as Workflow;
  const nodes = Object.values(w), title = (n: Node) => n._meta?.title ?? "";
  if (p.prompt !== undefined) {
    const t = nodes.filter((n) => title(n) === "PG_PROMPT");
    const target = t.length ? t : nodes.filter((n) => n.class_type === "CLIPTextEncode" && !/neg/i.test(title(n))).slice(0, 1);
    if (!target.length) throw new Error("partgen: workflow has no PG_PROMPT node");
    for (const n of target) n.inputs.text = p.prompt;
  }
  if (p.image !== undefined) {
    const t = nodes.filter((n) => title(n) === "PG_IMAGE");
    const target = t.length ? t : nodes.filter((n) => n.class_type === "LoadImage");
    if (!target.length) throw new Error("partgen: workflow has no PG_IMAGE (LoadImage) node");
    for (const n of target) n.inputs.image = p.image;
  }
  if (p.seed !== undefined) {
    const t = nodes.filter((n) => title(n) === "PG_SEED");
    for (const n of t.length ? t : nodes) for (const k of ["seed", "noise_seed"]) if (typeof n.inputs[k] === "number") n.inputs[k] = p.seed;
  }
  return w;
}
