// Marks at the edge of the screen for things happening out of view (DOM): a dust plume of a moving pack, a raid
// coming, a blast just now. Each sits on the screen's edge the way the thing lies, with a word and its distance; things
// on screen get no mark (their dust is there to see).
import * as THREE from "three/webgpu";

export interface Mark { id: string; x: number; y: number; z: number; text: string; color: string; strength: number }

export class ThreatMarks {
  readonly root = document.createElement("div");
  private els = new Map<string, HTMLDivElement>();
  private p = new THREE.Vector3();

  constructor() {
    Object.assign(this.root.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "4" } as CSSStyleDeclaration);
    document.body.appendChild(this.root);
  }

  update(camera: THREE.Camera, canvas: HTMLCanvasElement, marks: Mark[], from: { x: number; z: number }) {
    const r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const seen = new Set<string>();
    for (const m of marks) {
      const p = this.p.set(m.x, m.y, m.z).project(camera);
      let sx = p.x, sy = -p.y;
      if (p.z > 1) { sx = -sx; sy = -sy; }
      const pad = 0.9;
      if (p.z <= 1 && Math.abs(sx) < pad && Math.abs(sy) < pad) continue;
      // To the edge along the line from the middle.
      const k = pad / Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
      const ex = cx + sx * k * (r.width / 2), ey = cy + sy * k * (r.height / 2);
      seen.add(m.id);
      let el = this.els.get(m.id);
      if (!el) {
        el = document.createElement("div");
        Object.assign(el.style, {
          position: "absolute", transform: "translate(-50%, -50%)", font: "700 12px/1.1 system-ui, 'Segoe UI', sans-serif",
          letterSpacing: "0.06em", textShadow: "0 1px 3px #000d", whiteSpace: "nowrap", textAlign: "center",
        } as CSSStyleDeclaration);
        this.root.appendChild(el);
        this.els.set(m.id, el);
      }
      const d = Math.hypot(m.x - from.x, m.z - from.z);
      const ang = Math.atan2(sy, sx);
      const html = `<div style="display:inline-block;transform:rotate(${ang.toFixed(2)}rad);font-size:15px">➤</div><div>${m.text}</div><div style="font-weight:500;opacity:0.8">${Math.round(d / 10) * 10} m</div>`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      el.style.left = `${ex}px`; el.style.top = `${ey}px`;
      el.style.color = m.color;
      el.style.opacity = String(Math.max(0.25, Math.min(1, m.strength)));
    }
    for (const [id, el] of this.els) if (!seen.has(id)) { el.remove(); this.els.delete(id); }
  }
}
