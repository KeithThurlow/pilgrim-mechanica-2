// The convoy's unlock shop (docs/proposal-economy.md: the convoy grows with scrap): a small panel beside the bay
// screen (shown whenever the bay terminal is open, U toggles it on its own). One row per unlock: its level, what the
// next level costs out of the banked scrap, a Buy button. DOM only; the rules are src/expedition/unlocks.ts.
import { UNLOCKS, type Unlocks, type UnlockValues } from "../expedition/unlocks";

export interface ShopOptions {
  unlocks: Unlocks;
  tuning: UnlockValues;
  /** The convoy's bank (scrap is spent from it). */
  bank: { scrap: number };
  /** Something was bought: apply the effects and save. */
  onChange: () => void;
}

export function convoyShop(o: ShopOptions) {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed", top: "70px", right: "14px", width: "290px", zIndex: "30", background: "rgba(14, 18, 18, 0.92)",
    border: "1px solid #4a5a56", borderRadius: "8px", padding: "10px 12px", color: "#dfeae4", display: "none",
    font: "500 13px/1.4 system-ui, 'Segoe UI', sans-serif",
  } as CSSStyleDeclaration);
  document.body.appendChild(root);
  let forced = false, shown = false;

  function render() {
    root.textContent = "";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px";
    head.innerHTML = `<b style="letter-spacing:0.08em">CONVOY UNLOCKS</b><span style="color:#ffd27a;font-variant-numeric:tabular-nums">${Math.floor(o.bank.scrap)} scrap</span>`;
    root.appendChild(head);
    for (const u of UNLOCKS) {
      const lvl = o.unlocks.level(u.id), max = o.unlocks.maxLevel(u.id), price = o.unlocks.nextPrice(o.tuning, u.id);
      const row = document.createElement("div");
      row.style.cssText = "padding:6px 0;border-top:1px solid #2c3836";
      const effect = u.mul && lvl > 0 ? ` · ×${o.unlocks.mul(o.tuning, u.id).toFixed(2)}` : "";
      row.innerHTML = `<div><b>${u.label}</b> <span style="color:#9a958c">${max > 1 ? `level ${lvl}/${max}` : lvl ? "bought" : "not bought"}${effect}</span></div>`
        + `<div style="font-size:11px;color:#9a958c">${u.tip}</div>`;
      const btn = document.createElement("button");
      btn.style.cssText = "margin-top:4px;padding:3px 10px;border-radius:5px;border:1px solid #5d746d;background:#1f2b28;color:#dfeae4;cursor:pointer";
      if (price === null) { btn.textContent = "Done"; btn.disabled = true; btn.style.opacity = "0.5"; }
      else {
        const can = o.bank.scrap >= price;
        btn.textContent = `Buy for ${price}`;
        btn.disabled = !can;
        btn.style.opacity = can ? "1" : "0.5";
        btn.onclick = () => { if (o.unlocks.buy(o.tuning, u.id, o.bank)) { o.onChange(); render(); } };
      }
      row.appendChild(btn);
      root.appendChild(row);
    }
  }

  return {
    /** Show with the bay screen (or on its own after toggle()). */
    sync(bayOpen: boolean) {
      const want = bayOpen || forced;
      if (want !== shown) { shown = want; root.style.display = want ? "block" : "none"; if (want) render(); }
    },
    toggle() { forced = !forced; },
    /** Redraw if showing (the bank moved). */
    refresh() { if (shown) render(); },
    get isOpen() { return shown; },
  };
}
