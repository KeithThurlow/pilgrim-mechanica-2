// The pilot's HUD: a ring that fills while F is held (bottom centre, with what letting it fill will do), a short
// prompt line (the terminal, salvage, why you can't get out here), and his health while on foot. Plain DOM.
const CSS = `
.pilot-hud { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  pointer-events: none; font: 13px/1.35 var(--sans, system-ui); color: #f2ede4; text-shadow: 0 1px 2px #000a; }
.pilot-hud .ring { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font: 600 14px var(--mono, monospace);
  background: conic-gradient(#ffb347 var(--k, 0%), #ffffff22 0); box-shadow: 0 0 0 1px #0006; }
.pilot-hud .ring span { width: 30px; height: 30px; border-radius: 50%; background: #17191ccc; display: grid; place-items: center; }
.pilot-hud .text { background: #17191cb3; padding: 5px 9px; border-radius: 4px; max-width: 46ch; }
.pilot-hud .text b { color: #ffb347; font-weight: 600; }
.pilot-hud .text .bad { color: #f06a4b; }
.pilot-life { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: 180px; height: 7px; border-radius: 4px;
  background: #0008; box-shadow: 0 0 0 1px #0006; pointer-events: none; overflow: hidden; }
.pilot-life i { display: block; height: 100%; background: #8fd18a; }
.pilot-hurt { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px 40px #c0281888; opacity: 0; transition: opacity 0.08s; }
`;

export class PilotHud {
  private root: HTMLDivElement;
  private ring: HTMLDivElement;
  private key: HTMLSpanElement;
  private text: HTMLDivElement;
  private life: HTMLDivElement;
  private bar: HTMLElement;
  private hurt: HTMLDivElement;

  constructor() {
    if (!document.getElementById("pilot-hud-css")) {
      const st = document.createElement("style");
      st.id = "pilot-hud-css"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement("div");
    this.root.className = "pilot-hud";
    this.ring = document.createElement("div");
    this.ring.className = "ring";
    this.key = document.createElement("span");
    this.key.textContent = "F";
    this.ring.appendChild(this.key);
    this.text = document.createElement("div");
    this.text.className = "text";
    this.root.append(this.ring, this.text);
    this.life = document.createElement("div");
    this.life.className = "pilot-life";
    this.bar = document.createElement("i");
    this.life.appendChild(this.bar);
    this.hurt = document.createElement("div");
    this.hurt.className = "pilot-hurt";
    document.body.append(this.root, this.life, this.hurt);
  }

  /**
   * hold: 0..1 of the F hold (null: no ring); text: HTML for the line (empty hides it); health: 0..1 while on foot
   * (null hides the bar); hurt: 0..1 red edge.
   */
  set(hold: number | null, text: string, health: number | null, hurt = 0) {
    this.ring.style.display = hold === null ? "none" : "";
    if (hold !== null) this.ring.style.setProperty("--k", `${Math.round(hold * 100)}%`);
    this.text.style.display = text ? "" : "none";
    if (this.text.innerHTML !== text) this.text.innerHTML = text;
    this.root.style.display = hold === null && !text ? "none" : "flex";
    this.life.style.display = health === null ? "none" : "";
    if (health !== null) {
      this.bar.style.width = `${Math.max(0, Math.min(1, health)) * 100}%`;
      this.bar.style.background = health > 0.5 ? "#8fd18a" : health > 0.25 ? "#f0c14b" : "#f06a4b";
    }
    this.hurt.style.opacity = String(Math.max(0, Math.min(0.9, hurt)));
  }
}
