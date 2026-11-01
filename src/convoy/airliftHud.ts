// The helipad airlift's line on the screen (top centre, under the expedition's notes): the price on the pad, the
// call's hold bar, and in the air the distance out, what the trip has cost so far and the bank ticking down.
import type { Airlift } from "./airlift";

export class AirliftHud {
  private el = document.createElement("div");
  private last = "";

  constructor() {
    Object.assign(this.el.style, {
      position: "fixed", top: "86px", left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none",
      font: "600 15px/1.35 system-ui, 'Segoe UI', sans-serif", color: "#8fd0ff", textShadow: "0 1px 3px #000c", zIndex: "5",
      fontVariantNumeric: "tabular-nums",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.el);
  }

  /** `fromConvoy`: metres from the lead bay; `bank`: the convoy's scrap now. */
  update(lift: Airlift, fromConvoy: number, bank: number) {
    const v = lift.v, s = lift.state;
    let html = "";
    if (s === "idle" && lift.onPad) {
      const short = bank < v.heliBase ? ` · <span style="color:#ffb09a">NOT ENOUGH IN THE BANK</span>` : "";
      html = `Helipad · hold <b>H</b> to fly out · ${v.heliBase} scrap to start, then ${v.heliPerKm} per km · bank ${Math.floor(bank)}${short}`;
    } else if (s === "calling") {
      const n = 20, k = Math.round(lift.callShare * n);
      html = `Calling the quadcopter <span style="letter-spacing:-1px">${"▮".repeat(k)}${"▯".repeat(n - k)}</span>`;
    } else if (s === "clamp" || s === "lift") html = `Quadcopter clamping on · ${lift.paid} scrap paid`;
    else if (s === "fly") html = `Airlift · ${(fromConvoy / 1000).toFixed(2)} km from the convoy · trip ${lift.paid} scrap · bank ${Math.floor(bank)} · <b>H</b> drops you here · WASD steers`;
    else if (s === "lower") html = `Lowering · trip ${lift.paid} scrap`;
    if (html !== this.last) { this.el.innerHTML = html; this.last = html; }
  }
}
