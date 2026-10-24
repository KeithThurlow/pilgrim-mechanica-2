// Dev-server endpoint for the in-lab Report box (Keith 2026-10-24: report from inside the app straight to the
// Claude Code session running on the PC). POST /__report writes the note, a screenshot and the full lab state to
// reports/, and adds a line to reports/inbox.md; GET /__report returns reports/replies.md, so answers written there
// show up in the box. Only runs under `npm run dev`; reports/ is committed so any agent can pick them up.
import type { Plugin } from "vite";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Report { text: string; lab: string; url: string; image?: string; hud?: string; camera?: unknown; context?: Record<string, unknown>; values?: Record<string, number> }

const fence = "```";

export function reportPlugin(root: string): Plugin {
  const dir = join(root, "reports");
  return {
    name: "pm-report",
    configureServer(server) {
      server.middlewares.use("/__report", (req, res) => {
        if (req.method === "GET") {
          const f = join(dir, "replies.md");
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(existsSync(f) ? readFileSync(f, "utf8") : "");
          return;
        }
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const r = JSON.parse(body) as Report;
            mkdirSync(dir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const id = `${stamp}-${r.lab}`;
            let image = "";
            if (r.image?.startsWith("data:image/png;base64,")) {
              writeFileSync(join(dir, id + ".png"), Buffer.from(r.image.slice(22), "base64"));
              image = `![screenshot](${id}.png)\n`;
            }
            const md = [
              `# Report ${id}`, "", r.text, "",
              `- Lab: ${r.lab}`, `- About: ${JSON.stringify(r.context ?? {})}`, `- URL: ${r.url}`, `- Camera: ${JSON.stringify(r.camera)}`, "",
              image,
              "## HUD", "", fence, r.hud ?? "", fence, "",
              "## Tuning values", "", fence + "json", JSON.stringify(r.values ?? {}, null, 1), fence, "",
            ].join("\n");
            writeFileSync(join(dir, id + ".md"), md);
            const inbox = join(dir, "inbox.md");
            if (!existsSync(inbox)) {
              writeFileSync(inbox, "# Report inbox\n\nReports from the labs, newest last. Answer in replies.md; when one is fixed, delete its line and its files in the fixing commit.\n\n");
            }
            const about = r.context?.selected ?? r.context?.topic;
            appendFileSync(inbox, `- [ ] ${id}${about ? ` [${about}]` : ""}: ${r.text.replace(/\s+/g, " ").slice(0, 200)} (${id}.md)\n`);
            server.config.logger.info(`report: ${id}`, { timestamp: true });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, id }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}
