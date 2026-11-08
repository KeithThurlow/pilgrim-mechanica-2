// Touch controls for phones (Keith 2026-11-07: playing the Pages build on his phone while away from the PC; "it really
// needs to be a dual stick setup", aim and fire while moving). Only on a touch screen (or `?touch`; `?touch=0` off).
// Layout (Keith 2026-11-08, landscape like a MOBA: minimap top left, sticks in the bottom corners, buttons round them):
// - Left stick: WASD as key events (Keys makes it camera-relative, as on a keyboard). Pushed to the rim it holds Space
//   too: a dash, then the sprint while it stays there. Round it: Q (repair kit), E (use), and ⋯, a menu with the rarer
//   keys (Tab lock, F hop out, R reload, Inv), Info (the expedition card), FPS (the frame HUD) and ⛶ (fullscreen).
// - Right stick: aims (a point on the screen round its centre, further out the further it's pushed) and fires both
//   sides while pushed past the dead zone. MouseButtons (src/game/playerAim.ts) reads `touchState`.
// - Round the right stick, the abilities: Dash, then 1-4. Each of 1-4 is its own stick while held (drag to aim on the
//   ground: the knob's push is the point on the screen, the whole screen at the rim), released it fires; a tap with no
//   drag fires at the current aim. Its key is held for as long as the finger is down, so hold-to-paint launchers paint.
// - Sizes are shares of the screen's short side (Keith 2026-11-08: on his phone in landscape the fixed sizes filled the
//   screen), laid out again on every resize and turn. The frame HUD and the expedition card start hidden (the menu).
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
  land: { stick: 0.30, btn: 0.12, gap: 0.025, edgeX: 0.05, edgeY: 0.04 },
  port: { stick: 0.30, btn: 0.105, gap: 0.03, edgeX: 0.04, edgeY: 0.035 },
};
const KNOB = 0.42, DEAD = 0.25, RIM = 0.92;
const BARS = 56; // CSS px: the energy and hull bars on the left edge (src/ui/energyBar.ts); the landscape left stick clears them
const AIM_DEAD = 0.18; // an ability stick's drag below this (of its radius) is a tap: fire at the current aim

type Btn = [label: string, code: string, key: string];
// Inward first (toward the middle of the screen), then round over the top to the outer edge.
const LEFT_BTNS: Btn[] = [["Q", "KeyQ", "q"], ["E", "KeyE", "e"], ["⋯", "", ""]];
const RIGHT_BTNS: Btn[] = [["1", "Digit1", "1"], ["2", "Digit2", "2"], ["3", "Digit3", "3"], ["4", "Digit4", "4"], ["Dash", "Space", " "]];
const AIMED = new Set(["Digit1", "Digit2", "Digit3", "Digit4"]); // the ones that turn into a stick
const MENU_KEYS: Btn[] = [["Tab", "Tab", "Tab"], ["F", "KeyF", "f"], ["R", "KeyR", "r"], ["Inv", "KeyI", "i"]];

/** Drag tracking on an element: calls back with x, y in -1..1 of the radius from the centre `centre` gives (y down). */
function dragger(el: HTMLElement, centre: () => { x: number; y: number; r: number }, cb: {
  down?: () => void; move: (v: { x: number; y: number }) => void; up: () => void;
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
    cb.down?.();
    move(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** One stick: calls back with x, y in -1..1 (y down) while held, and null when let go. */
function stick(side: "left" | "right", cb: (v: { x: number; y: number } | null) => void) {
  const el = document.createElement("div"), knob = document.createElement("div");
  el.className = `tp-stick tp-${side}`; knob.className = "tp-knob"; el.append(knob);
  const centre = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; };
  dragger(el, centre, {
    move: (v) => { const r = centre().r; knob.style.transform = `translate(${v.x * r}px,${v.y * r}px)`; cb(v); },
    up: () => { knob.style.transform = ""; cb(null); },
  });
  return el;
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
.tp-stick{position:fixed;border-radius:50%;z-index:20;background:rgba(0,0,0,.18);border:2px solid rgba(255,220,160,.4);
  touch-action:none;box-sizing:border-box}
.tp-right{border-color:rgba(255,150,90,.55)}
.tp-knob{position:absolute;left:50%;top:50%;width:${KNOB * 100}%;height:${KNOB * 100}%;transform-origin:center;
  translate:-50% -50%;border-radius:50%;background:rgba(255,220,160,.5);pointer-events:none}
.tp-right .tp-knob{background:rgba(255,150,90,.55)}
.tp-btn{position:fixed;border-radius:50%;border:1.5px solid rgba(255,220,160,.45);background:rgba(0,0,0,.3);color:#fdc;
  font-weight:600;font-family:system-ui;touch-action:none;user-select:none;-webkit-user-select:none;padding:0;z-index:21;
  box-sizing:border-box}
.tp-btn.aimed{border-color:rgba(255,150,90,.7)}
.tp-btn.on{background:rgba(255,180,90,.55)}
.tp-menu{position:fixed;display:none;flex-direction:column;gap:6px;z-index:22}
.tp-menu.open{display:flex}
.tp-menu .tp-btn{position:static;border-radius:8px}
.tp-astick{position:fixed;border-radius:50%;border:2px solid rgba(255,150,90,.7);background:rgba(0,0,0,.22);z-index:22;
  pointer-events:none;box-sizing:border-box;display:none}
.tp-astick .tp-knob{background:rgba(255,150,90,.75)}`;
  document.head.append(style);

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

  // Buttons: the key is held while the finger is on them.
  const keyButton = ([label, code, k]: Btn) => {
    const b = document.createElement("button");
    b.className = "tp-btn"; b.textContent = label;
    const press = (on: boolean) => {
      if (on === b.classList.contains("on")) return;
      b.classList.toggle("on", on); key(on ? "keydown" : "keyup", code, k);
    };
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

  // The ⋯ menu: the rarer keys, then the toggles. It stays open until ⋯ is pressed again.
  const menu = document.createElement("div");
  menu.className = "tp-menu";
  const menuBtns: HTMLButtonElement[] = MENU_KEYS.map(keyButton);
  const toggle = (label: string, cls: string, on = false) => {
    const b = document.createElement("button");
    b.className = "tp-btn"; b.textContent = label;
    const show = (v: boolean) => { root.classList.toggle(cls, v); b.classList.toggle("on", v); };
    show(on);
    b.addEventListener("click", () => show(!root.classList.contains(cls)));
    return b;
  };
  menuBtns.push(toggle("Info", "tp-info"), toggle("FPS", "tp-fps"));
  // Fullscreen, then landscape where the browser allows it (Android Chrome; iOS needs the phone's rotation lock off).
  const full = document.createElement("button");
  full.className = "tp-btn"; full.textContent = "⛶";
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
    list.forEach((def, i) => {
      let el: HTMLButtonElement;
      if (def[0] === "⋯") {
        el = document.createElement("button"); el.className = "tp-btn"; el.textContent = "⋯";
        el.addEventListener("click", () => { menu.classList.toggle("open"); el.classList.toggle("on", menu.classList.contains("open")); });
      } else el = keyButton(def);
      placed.push({ el, side, i, n: list.length });
    });

  // Lay everything out from the screen's short side: the sticks in the bottom corners, the buttons fanned round them
  // (landscape from inward (0°) round over the top; portrait starting higher up so the two fans don't meet), the menu
  // above the left fan. `--tp-clear` is the height the pad takes, for the action bar in portrait (lab.css).
  const layout = () => {
    const w = innerWidth, h = innerHeight, land = w > h, S = Math.min(w, h), z = land ? SIZE.land : SIZE.port;
    const st = z.stick * S, bt = z.btn * S, ring = st / 2 + z.gap * S + bt / 2;
    stickR = st / 2;
    const cy = h - z.edgeY * S - st / 2;
    const lx = (land ? Math.max(z.edgeX * S, BARS) : z.edgeX * S) + st / 2, rx = w - z.edgeX * S - st / 2;
    box(left, lx, cy, st); box(right, rx, cy, st);
    let top = cy;
    for (const p of placed) {
      const [a0, a1] = p.side === "left" ? (land ? [0, 100] : [40, 120]) : (land ? [0, 120] : [15, 125]);
      const a = (a0 + (a1 - a0) * (p.n > 1 ? p.i / (p.n - 1) : 0)) * Math.PI / 180;
      const x = (p.side === "left" ? lx : rx) + (p.side === "left" ? 1 : -1) * Math.cos(a) * ring, y = cy - Math.sin(a) * ring;
      box(p.el, x, y, bt);
      p.el.style.fontSize = `${Math.round(bt * (p.el.textContent!.length > 2 ? 0.28 : 0.38))}px`;
      top = Math.min(top, y - bt / 2);
    }
    for (const b of menuBtns) Object.assign(b.style, { width: `${bt * 1.25}px`, height: `${bt * 0.75}px`, fontSize: `${Math.round(bt * 0.3)}px` });
    Object.assign(menu.style, { left: `${lx - st / 2}px`, bottom: `${h - top + 8}px`, maxHeight: `${top - 8}px`, flexWrap: "wrap-reverse" });
    root.style.setProperty("--tp-clear", `${Math.round(h - top + 6)}px`);
  };
  layout();
  addEventListener("resize", layout);
  visualViewport?.addEventListener("resize", layout);
  screen.orientation?.addEventListener?.("change", () => {
    // Some phones keep the old zoom across a turn: set the viewport again so the page scale holds, then lay out.
    meta.setAttribute("content", viewport + ", ");
    meta.setAttribute("content", viewport);
    requestAnimationFrame(layout);
  });

  container.append(left, right, ...placed.map((p) => p.el), menu, astick);
}
