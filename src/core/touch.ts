// Touch controls for phones (Keith 2026-11-07: playing the Pages build on his phone while away from the PC; "it really
// needs to be a dual stick setup", aim and fire while moving). Only on a touch screen (or `?touch`; `?touch=0` off).
// Layout (Keith 2026-11-08, landscape like a MOBA: minimap top left, sticks in the bottom corners, buttons round them;
// reviewed in both orientations 2026-11-12):
// - Left stick: WASD as key events (Keys makes it camera-relative, as on a keyboard). Pushed to the rim it holds Space
//   too: a dash, then the sprint while it stays there. Round it: Repair (Q), Use (E), Reload (R).
// - Right stick: aims (a point on the screen round its centre, further out the further it's pushed) and fires both
//   sides while pushed past the dead zone. MouseButtons (src/game/playerAim.ts) reads `touchState`.
// - Both sticks follow the thumb: each owns its bottom corner of the screen (an unseen zone under the buttons), and a
//   touch anywhere in it off the resting knob puts the stick's centre there until it's let go.
// - Round the right stick: Dash nearest the middle, then the abilities 1-4. Each of 1-4 is its own stick while held (drag to aim on the
//   ground: the knob's push is the point on the screen, the whole screen at the rim), released it fires; a tap with no
//   drag fires at the current aim. Its key is held for as long as the finger is down, so hold-to-paint launchers paint.
// - The buttons are the action bar on phones (`touchSlots`, fed by src/ui/actionBar.ts): each of 1-4 and Repair shows
//   what it is, its cooldown sweep and seconds, its rounds or kits; 1-4 with nothing fitted are hidden.
// - ☰ in the top right corner opens the menu: the rarer keys by name (Lock, Hop out, Inventory, and on the convoy lab
//   Launch, Recover, Bay, Shop, Contract, Heli), then Info (the expedition card), FPS (the frame HUD), Tune (the slider
//   panel, hidden until asked for) and Fullscreen. A touch on the view closes it.
// - Sizes are shares of the screen's short side (Keith 2026-11-08: on his phone in landscape the fixed sizes filled the
//   screen), laid out again on every resize and turn, inside the phone's safe area (notch, rounded corners, home bar).
//   While the inventory, bay or shop is open the pad and the left bars are hidden (lab.css).
// - The whole page is drawn at `?uiscale=` (0.6 by default) of its size, so the labs' panels and HUDs fit a phone.
// Pure input glue: no sim or lab changes. Ownership: the player's own input.

// Guarded: headless checks import playerAim (and so this) under node, with no location or matchMedia.
const query = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
const flag = typeof location === "undefined" ? "0" : query.get("touch");
export const touchMode = flag !== null ? flag !== "0" : typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const UI = Math.min(1, Math.max(0.3, Number(query.get("uiscale")) || 0.6));

/** The right stick (or an ability stick): where it aims (client px) and whether it fires; null aim while let go. */
export const touchState: { aim: { x: number; y: number } | null; fire: boolean } = { aim: null, fire: false };
/** Sent on window when a stick is first touched (the labs stop their demo, as for a mouse). */
export const TOUCH_USE = "touchuse";

const key = (type: "keydown" | "keyup", code: string, k: string) =>
  dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));

// Shares of the screen's short side (S). Landscape is the short screen height, so it gets a smaller share.
const SIZE = {
  land: { stick: 0.30, btn: 0.125, gap: 0.025, edgeX: 0.05, edgeY: 0.05 },
  port: { stick: 0.30, btn: 0.11, gap: 0.03, edgeX: 0.04, edgeY: 0.06 },
};
const KNOB = 0.42, DEAD = 0.25, RIM = 0.92;
const BARS = 56; // CSS px: the energy and hull bars on the left edge (src/ui/energyBar.ts); the landscape left stick clears them
const AIM_DEAD = 0.18; // an ability stick's drag below this (of its radius) is a tap: fire at the current aim
const BTN_PAD = 6; // CSS px kept between neighbours in a fan

type Btn = [label: string, code: string, key: string];
// Inward first (toward the middle of the screen), then round over the top to the outer edge.
const LEFT_BTNS: Btn[] = [["Repair", "KeyQ", "q"], ["Use", "KeyE", "e"], ["Reload", "KeyR", "r"]];
const RIGHT_BTNS: Btn[] = [["Dash", "Space", " "], ["1", "Digit1", "1"], ["2", "Digit2", "2"], ["3", "Digit3", "3"], ["4", "Digit4", "4"]];
const AIMED = new Set(["Digit1", "Digit2", "Digit3", "Digit4"]); // the ones that turn into a stick
const MENU_KEYS: Btn[] = [["Lock", "Tab", "Tab"], ["Hop out", "KeyF", "f"], ["Inventory", "KeyI", "i"]];
// The convoy lab's own keys (labs/convoy/main.ts); hold ones (Recover, Contract, Heli) are held while the finger is down.
const CONVOY_KEYS: Btn[] = [["Launch", "KeyG", "g"], ["Recover", "KeyX", "x"], ["Bay", "KeyB", "b"], ["Shop", "KeyU", "u"], ["Contract", "KeyJ", "j"], ["Heli", "KeyH", "h"]];
const CLOSES_MENU = new Set(["KeyI", "KeyB", "KeyU"]); // these open a screen of their own
const SLOT_KEY: Record<string, string> = { Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", KeyQ: "Q" };

/** What a button shows (the action bar's slot, src/ui/actionBar.ts). */
export interface TouchSlot {
  key: string; name: string; cool: number; coolMax?: number; active?: number | null; ready: boolean; sub?: string; dim?: boolean;
  tone?: "weapon" | "ability" | "kit";
}
const TONE = { weapon: "#ffb347", ability: "#7fd6c8", kit: "#8fd18a" } as const;
interface SlotBtn { el: HTMLButtonElement; lbl: HTMLElement; sub: HTMLElement; cd: HTMLElement; def: string; max: number; sig: string }
const slotBtns = new Map<string, SlotBtn>();
let relabel = () => {};

/**
 * The action bar's slots onto the pad's buttons (1-4 and Repair): name, cooldown sweep and seconds, rounds or kits,
 * lit while its effect lasts; a key of 1-4 with no slot is hidden. null: back to the plain labels, all shown.
 */
export function touchSlots(slots: TouchSlot[] | null) {
  for (const [k, b] of slotBtns) {
    const s = slots?.find((x) => x.key === k);
    if (s && s.cool > b.max) b.max = s.cool;
    if (!s || s.cool <= 0) b.max = 0;
    const max = s?.coolMax && s.coolMax > 0 ? s.coolMax : b.max;
    const share = s && s.cool > 0 && max > 0 ? Math.min(1, s.cool / max) : 0;
    const secs = s && s.cool > 0 ? (s.cool < 10 ? s.cool.toFixed(1) : String(Math.ceil(s.cool))) : "";
    const lit = !!s && s.active != null && s.active > 0;
    const sig = !slots ? "" : !s ? "-" : `${s.name}|${s.sub ?? ""}|${Math.round(share * 90)}|${secs}|${s.ready}|${!!s.dim}|${lit}|${s.tone}`;
    if (sig === b.sig) continue;
    b.sig = sig;
    b.el.style.display = slots && !s && k !== "Q" ? "none" : "";
    const name = s?.name ?? b.def, renamed = b.lbl.textContent !== name;
    b.lbl.textContent = name;
    b.sub.textContent = s ? s.sub ?? (k === "Q" ? "" : k) : "";
    const col = TONE[s?.tone ?? "weapon"];
    b.cd.textContent = secs;
    b.cd.style.background = share > 0 ? `conic-gradient(rgba(0,0,0,.68) ${(share * 360).toFixed(0)}deg, transparent 0)` : "";
    b.el.style.borderColor = s ? (s.ready && s.cool <= 0) || lit ? col : "rgba(255,220,160,.25)" : "";
    b.el.style.boxShadow = lit ? `0 0 14px 2px ${col}` : "";
    b.el.style.opacity = s?.dim ? "0.45" : "";
    if (renamed) relabel();
  }
}

/** Drag tracking on an element: calls back with x, y in -1..1 of the radius from the centre `centre` gives (y down). */
function dragger(el: HTMLElement, centre: () => { x: number; y: number; r: number }, cb: {
  down?: (e: PointerEvent) => void; move: (v: { x: number; y: number }) => void; up: () => void;
}) {
  let id = -1;
  const move = (e: PointerEvent) => {
    const c = centre();
    let x = (e.clientX - c.x) / c.r, y = (e.clientY - c.y) / c.r;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    cb.move({ x, y });
  };
  const end = (e: PointerEvent) => { if (e.pointerId === id) { id = -1; cb.up(); } };
  el.addEventListener("pointerdown", (e) => {
    if (id >= 0) return;
    id = e.pointerId; e.preventDefault();
    try { el.setPointerCapture(id); } catch { /* synthetic pointer */ }
    dispatchEvent(new Event(TOUCH_USE));
    cb.down?.(e);
    move(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * One stick: calls back with x, y in -1..1 (y down) while held, and null when let go. It rests at its home; a touch in
 * its zone off the resting knob moves its centre under the thumb until it's let go.
 */
function stick(side: "left" | "right", cb: (v: { x: number; y: number } | null) => void) {
  const zone = document.createElement("div"), ring = document.createElement("div"), knob = document.createElement("div");
  zone.className = "tp-zone"; ring.className = `tp-stick tp-${side}`; knob.className = "tp-knob"; ring.append(knob);
  let hx = 0, hy = 0, r = 1, cx = 0, cy = 0, held = false;
  const place = (x: number, y: number) => { cx = x; cy = y; box(ring, x, y, r * 2); };
  const clamp = (v: number, max: number) => Math.min(Math.max(v, r * 0.7), max - r * 0.7);
  dragger(zone, () => ({ x: cx, y: cy, r }), {
    down: (e) => {
      held = true; ring.classList.add("held");
      if (Math.hypot(e.clientX - hx, e.clientY - hy) > r * KNOB) place(clamp(e.clientX, innerWidth), clamp(e.clientY, innerHeight));
    },
    move: (v) => { knob.style.transform = `translate(${v.x * r}px,${v.y * r}px)`; cb(v); },
    up: () => { held = false; ring.classList.remove("held"); knob.style.transform = ""; place(hx, hy); cb(null); },
  });
  /** Where it rests and how big it is; its zone's box (left, top, width, height). */
  const home = (x: number, y: number, rad: number, z: [number, number, number, number]) => {
    hx = x; hy = y; r = rad;
    Object.assign(zone.style, { left: `${z[0]}px`, top: `${z[1]}px`, width: `${z[2]}px`, height: `${z[3]}px` });
    if (!held) place(x, y);
  };
  return { zone, ring, home };
}

/** Where the right stick or an ability stick points: a spot on the canvas round its centre (the camera follows the mech). */
function screenAim(canvas: HTMLCanvasElement, v: { x: number; y: number }, wide: boolean) {
  const r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (wide) return { x: cx + v.x * 0.47 * r.width, y: cy + v.y * 0.47 * r.height }; // ability: the rim is the screen's edge
  const l = Math.hypot(v.x, v.y), reach = 0.45 * Math.min(r.width, r.height) * (0.35 + 0.65 * Math.min(1, l));
  return { x: cx + v.x / l * reach, y: cy + v.y / l * reach };
}

const box = (el: HTMLElement, x: number, y: number, w: number, h = w) =>
  Object.assign(el.style, { left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` });

/** Puts the two sticks and the buttons over the lab. */
export function mountTouchPad(container: HTMLElement, canvas: HTMLCanvasElement) {
  if (!touchMode) return;
  const viewport = `width=device-width, initial-scale=${UI}, maximum-scale=${UI}, user-scalable=no, viewport-fit=cover`;
  const meta = document.querySelector('meta[name="viewport"]') ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "viewport" }));
  meta.setAttribute("content", viewport);
  canvas.style.touchAction = "none";
  const root = document.documentElement;
  root.classList.add("touch");
  document.body.style.touchAction = "none";
  const style = document.createElement("style");
  style.textContent = `
.tp-zone{position:fixed;z-index:19;touch-action:none}
.tp-stick{position:fixed;border-radius:50%;z-index:20;background:rgba(0,0,0,.18);border:2px solid rgba(255,220,160,.4);
  pointer-events:none;box-sizing:border-box;opacity:.6;transition:opacity .12s}
.tp-stick.held{opacity:1}
.tp-right{border-color:rgba(255,150,90,.55)}
.tp-knob{position:absolute;left:50%;top:50%;width:${KNOB * 100}%;height:${KNOB * 100}%;transform-origin:center;
  translate:-50% -50%;border-radius:50%;background:rgba(255,220,160,.5);pointer-events:none}
.tp-right .tp-knob{background:rgba(255,150,90,.55)}
.tp-btn{position:fixed;border-radius:50%;border:2px solid rgba(255,220,160,.45);background:rgba(14,12,9,.45);color:#fdc;
  font-weight:600;font-family:system-ui;touch-action:none;user-select:none;-webkit-user-select:none;padding:0;z-index:21;
  box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;
  line-height:1.05;text-shadow:0 1px 2px #000;text-transform:none;letter-spacing:0;-webkit-tap-highlight-color:transparent}
.tp-btn>*{pointer-events:none}
.tp-lbl{max-width:92%;overflow:hidden;text-align:center}
.tp-sub{font-size:.72em;opacity:.8;margin-top:.15em}
.tp-sub:empty{display:none}
.tp-cd{position:absolute;inset:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;
  font-weight:700}
.tp-cd:not(:empty)+.tp-lbl,.tp-cd:not(:empty)~.tp-sub{opacity:.35}
.tp-btn.aimed{border-color:rgba(255,150,90,.7)}
.tp-btn.on{background:rgba(255,180,90,.55)}
.tp-menu{position:fixed;display:none;gap:8px;z-index:23;padding:10px;border-radius:12px;background:rgba(14,12,9,.82);
  border:1px solid rgba(255,220,160,.25);box-sizing:border-box}
.tp-menu.open{display:grid}
.tp-menu .tp-btn{position:static;border-radius:10px;border-width:1.5px}
.tp-astick{position:fixed;border-radius:50%;border:2px solid rgba(255,150,90,.7);background:rgba(0,0,0,.22);z-index:22;
  pointer-events:none;box-sizing:border-box;display:none}
.tp-astick .tp-knob{background:rgba(255,150,90,.75)}`;
  document.head.append(style);
  // The phone's safe area (notch, rounded corners, home bar), read off a hidden box's padding.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";

  // Left stick: WASD past the dead zone, Space at the rim.
  const held = new Set<string>();
  const set = (code: string, k: string, on: boolean) => {
    if (on === held.has(code)) return;
    if (on) held.add(code); else held.delete(code);
    key(on ? "keydown" : "keyup", code, k);
  };
  const left = stick("left", (v) => {
    const x = v?.x ?? 0, y = v?.y ?? 0;
    set("KeyW", "w", y < -DEAD); set("KeyS", "s", y > DEAD); set("KeyA", "a", x < -DEAD); set("KeyD", "d", x > DEAD);
    set("Space", " ", Math.hypot(x, y) > RIM);
  });

  // Right stick: a point round the screen's centre, and both triggers past the dead zone. An ability stick held wins.
  let abilityAim = false;
  const right = stick("right", (v) => {
    if (abilityAim) return;
    if (!v) { touchState.fire = false; touchState.aim = null; return; }
    const l = Math.hypot(v.x, v.y);
    if (l < 0.08) return; // keep the last aim until it's pushed somewhere
    touchState.aim = screenAim(canvas, v, false);
    touchState.fire = l > DEAD;
  });

  // The ring an ability button grows into while it's held: the same size as the sticks.
  const astick = document.createElement("div"), aknob = document.createElement("div");
  astick.className = "tp-astick"; aknob.className = "tp-knob"; astick.append(aknob);
  let stickR = 60; // px, set by layout()

  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* not allowed */ } };
  const hold = (b: HTMLElement, press: (on: boolean) => void) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      press(true);
    });
    b.addEventListener("pointerup", () => press(false));
    b.addEventListener("pointercancel", () => press(false));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  };
  const plain = (label: string) => {
    const b = document.createElement("button"), lbl = document.createElement("span");
    b.className = "tp-btn"; lbl.className = "tp-lbl"; lbl.textContent = label; b.append(lbl);
    return b;
  };

  // The ☰ menu, top right: the rarer keys by name, then the toggles. Open until ☰ again or a touch on the view.
  const menu = document.createElement("div");
  menu.className = "tp-menu";
  const menuBtn = plain("☰");
  const openMenu = (on: boolean) => { menu.classList.toggle("open", on); menuBtn.classList.toggle("on", on); };
  menuBtn.addEventListener("click", () => { buzz(); openMenu(!menu.classList.contains("open")); });
  canvas.addEventListener("pointerdown", () => openMenu(false));

  // Buttons: the key is held while the finger is on them.
  const keyButton = ([label, code, k]: Btn) => {
    const b = plain(label);
    const press = (on: boolean) => {
      if (on === b.classList.contains("on")) return;
      b.classList.toggle("on", on); key(on ? "keydown" : "keyup", code, k);
      if (on) buzz(); else if (CLOSES_MENU.has(code)) openMenu(false);
    };
    const slot = SLOT_KEY[code];
    if (slot) {
      const cd = document.createElement("span"), sub = document.createElement("span");
      cd.className = "tp-cd"; sub.className = "tp-sub"; b.prepend(cd); b.append(sub);
      slotBtns.set(slot, { el: b, lbl: b.querySelector(".tp-lbl")!, sub, cd, def: label, max: 0, sig: "" });
    }
    if (!AIMED.has(code)) { hold(b, press); return b; }
    b.classList.add("aimed");
    let moved = false;
    const centre = () => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: stickR }; };
    dragger(b, centre, {
      down: () => {
        moved = false;
        const c = centre();
        box(astick, c.x, c.y, stickR * 2);
        astick.style.display = "block";
        aknob.style.transform = "";
        press(true);
      },
      move: (v) => {
        if (!moved && Math.hypot(v.x, v.y) < AIM_DEAD) return; // still a tap: the current aim stands
        moved = true; abilityAim = true; touchState.fire = false;
        aknob.style.transform = `translate(${v.x * stickR}px,${v.y * stickR}px)`;
        touchState.aim = screenAim(canvas, v, true);
      },
      up: () => {
        press(false); // the game reads the aim as it fires: still the dragged one (MouseButtons keeps it as the cursor)
        astick.style.display = "none";
        if (moved) { abilityAim = false; touchState.aim = null; }
      },
    });
    return b;
  };

  const convoy = typeof location !== "undefined" && location.pathname.includes("/convoy");
  const menuBtns: HTMLButtonElement[] = [...MENU_KEYS, ...(convoy ? CONVOY_KEYS : [])].map(keyButton);
  const toggle = (label: string, cls: string, closes = false) => {
    const b = plain(label);
    b.addEventListener("click", () => {
      const v = !root.classList.contains(cls);
      root.classList.toggle(cls, v); b.classList.toggle("on", v); buzz();
      if (closes && v) openMenu(false);
    });
    return b;
  };
  menuBtns.push(toggle("Info", "tp-info"), toggle("FPS", "tp-fps"), toggle("Tune", "tp-tune", true));
  // Fullscreen, then landscape where the browser allows it (Android Chrome; iOS needs the phone's rotation lock off).
  const full = plain("Fullscreen");
  full.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await root.requestFullscreen({ navigationUI: "hide" });
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch { /* not allowed here */ }
  });
  menuBtns.push(full);
  menu.append(...menuBtns);

  const placed: { el: HTMLButtonElement; side: "left" | "right"; i: number; n: number }[] = [];
  for (const [side, list] of [["left", LEFT_BTNS], ["right", RIGHT_BTNS]] as const)
    list.forEach((def, i) => placed.push({ el: keyButton(def), side, i, n: list.length }));

  // A label's size from its length: one or two characters big, a name fitted to the button's width.
  const fit = (b: HTMLElement, bt: number) => {
    const n = (b.querySelector(".tp-lbl")?.textContent ?? "").length;
    b.style.fontSize = `${Math.round(bt * (n <= 2 ? 0.38 : Math.min(0.24, 1.5 / n)))}px`;
  };

  // Lay everything out from the screen's short side, inside the safe area: the sticks in the bottom corners with their
  // zones, the buttons fanned round them (landscape from inward (0°) round over the top; portrait starting higher up
  // so the two fans don't meet; the ring wide enough that neighbours never touch), ☰ and its menu top right.
  // `--tp-clear` is the height the pad takes (the action bar's note in portrait), `--tp-top` where the top right
  // corner is free again (the Tune panel), both for lab.css.
  let btnSize = 60;
  const layout = () => {
    const cs = getComputedStyle(probe), px = (v: string) => parseFloat(v) || 0;
    const ins = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
    const w = innerWidth, h = innerHeight, land = w > h, S = Math.min(w, h), z = land ? SIZE.land : SIZE.port;
    const st = z.stick * S, bt = btnSize = z.btn * S;
    stickR = st / 2;
    const cy = h - ins.b - z.edgeY * S - st / 2;
    const lx = ins.l + (land ? Math.max(z.edgeX * S, BARS) : z.edgeX * S) + st / 2, rx = w - ins.r - z.edgeX * S - st / 2;
    const zt = land ? h * 0.36 : cy - st * 1.5, zw = land ? w * 0.36 : w / 2;
    left.home(lx, cy, stickR, [0, zt, zw, h - zt]); right.home(rx, cy, stickR, [w - zw, zt, zw, h - zt]);
    // Each fan's angles and ring: the ring wide enough that neighbours never touch, the far end of the fan pulled in
    // until its last button is on the screen (clear of the bars on the left in landscape).
    const fan = { left: land ? [0, 100] : [40, 120], right: land ? [0, 125] : [15, 125] };
    const rings = { left: 0, right: 0 };
    for (const side of ["left", "right"] as const) {
      const n = side === "left" ? LEFT_BTNS.length : RIGHT_BTNS.length, f = fan[side];
      const room = side === "left" ? lx - ins.l - (land ? BARS - 8 : 4) - bt / 2 : w - ins.r - 4 - bt / 2 - rx;
      for (let i = 0; i < 4; i++) {
        const step = (f[1] - f[0]) / Math.max(1, n - 1) * Math.PI / 180;
        rings[side] = Math.max(st / 2 + z.gap * S + bt / 2, (bt + BTN_PAD) / (2 * Math.sin(step / 2)));
        f[1] = Math.min(f[1], Math.acos(Math.max(-1, -Math.max(0, room) / rings[side])) * 180 / Math.PI);
      }
    }
    let top = cy;
    for (const p of placed) {
      const [a0, a1] = fan[p.side];
      const step = (a1 - a0) / Math.max(1, p.n - 1) * Math.PI / 180, ring = rings[p.side];
      const a = a0 * Math.PI / 180 + step * p.i;
      const x = (p.side === "left" ? lx : rx) + (p.side === "left" ? 1 : -1) * Math.cos(a) * ring, y = cy - Math.sin(a) * ring;
      box(p.el, x, y, bt);
      fit(p.el, bt);
      top = Math.min(top, y - bt / 2);
    }
    const mb = bt * 0.9, m = 8;
    box(menuBtn, w - ins.r - m - mb / 2, ins.t + m + mb / 2, mb);
    menuBtn.style.fontSize = `${Math.round(mb * 0.42)}px`;
    const cols = land ? 4 : 3, mw = Math.min(bt * 1.75, (w - ins.l - ins.r - 2 * m - 20 - (cols - 1) * 8) / cols);
    for (const b of menuBtns) Object.assign(b.style, { width: `${mw}px`, height: `${bt * 0.72}px`, fontSize: `${Math.round(bt * 0.25)}px` });
    Object.assign(menu.style, { right: `${ins.r + m}px`, top: `${ins.t + m + mb + m}px`, gridTemplateColumns: `repeat(${cols}, ${mw}px)` });
    root.style.setProperty("--tp-clear", `${Math.round(h - top + 6)}px`);
    root.style.setProperty("--tp-top", `${Math.round(ins.t + m + mb + m)}px`);
  };
  relabel = () => { for (const p of placed) fit(p.el, btnSize); };
  container.append(probe, left.zone, right.zone, left.ring, right.ring, ...placed.map((p) => p.el), menuBtn, menu, astick);
  layout();
  addEventListener("resize", layout);
  visualViewport?.addEventListener("resize", layout);
  screen.orientation?.addEventListener?.("change", () => {
    // Some phones keep the old zoom across a turn: set the viewport again so the page scale holds, then lay out.
    meta.setAttribute("content", viewport + ", ");
    meta.setAttribute("content", viewport);
    requestAnimationFrame(layout);
  });
}
