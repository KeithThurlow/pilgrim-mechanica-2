// The Report box (Keith 2026-10-24): type a note while looking at something; it goes to the dev server with a
// screenshot, the lab, the URL, the camera, the HUD and every tuning value, and lands in reports/inbox.md for the
// Claude Code session on the PC to pick up (tools/report-plugin.ts). Replies written to reports/replies.md show here.
// Without the dev server (a built copy), the report downloads as a file instead.
import type { App } from "./app";
import type { Values } from "./tweaks";

export function installReport(app: App, lab: string, values: Values) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "report-btn";
  btn.textContent = "Report";
  const box = document.createElement("div");
  box.className = "report";
  box.hidden = true;
  box.innerHTML = `
    <strong>Report to Claude</strong>
    <textarea rows="4" placeholder="What's wrong or what you want changed. A screenshot and every slider value go with it."></textarea>
    <div class="row"><button type="button" data-send>Send</button><button type="button" data-close>Close</button><span class="report-status"></span></div>
    <details><summary>Replies</summary><pre class="report-replies">No replies yet.</pre></details>`;
  document.body.append(btn, box);
  const text = box.querySelector("textarea")!;
  const status = box.querySelector(".report-status") as HTMLElement;
  const replies = box.querySelector(".report-replies") as HTMLElement;

  const loadReplies = async () => {
    try {
      const r = await fetch("/__report");
      const t = r.ok ? (await r.text()).trim() : "";
      if (t) replies.textContent = t.slice(-4000);
    } catch { /* no dev server */ }
  };
  btn.addEventListener("click", () => { box.hidden = !box.hidden; if (!box.hidden) { text.focus(); void loadReplies(); } });
  box.querySelector("[data-close]")!.addEventListener("click", () => { box.hidden = true; });
  // Keep typing out of the game's keys.
  for (const ev of ["keydown", "keyup"] as const) text.addEventListener(ev, (e) => e.stopPropagation());

  box.querySelector("[data-send]")!.addEventListener("click", async () => {
    const note = text.value.trim();
    if (!note) { status.textContent = "Write something first."; return; }
    status.textContent = "Capturing...";
    box.style.visibility = "hidden";
    const image = await app.capture();
    box.style.visibility = "";
    const report = {
      text: note, lab, url: location.href, image,
      hud: (document.querySelector(".hud") as HTMLElement | null)?.innerText ?? "",
      camera: { position: app.camera.position.toArray().map((v) => +v.toFixed(2)), fov: app.camera.fov },
      values,
    };
    try {
      const r = await fetch("/__report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
      if (!r.ok) throw new Error(String(r.status));
      const { id } = await r.json() as { id: string };
      status.textContent = `Sent (${id}).`;
      text.value = "";
    } catch {
      // No dev server: hand the report over as a file.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: "application/json" }));
      a.download = `report-${lab}-${Date.now()}.json`;
      a.click();
      status.textContent = "No dev server: downloaded the report instead.";
    }
  });
  setInterval(() => { if (!box.hidden) void loadReplies(); }, 5000);
}
