// Touch controls for phones (Keith 2026-11-07: playing the Pages build on his phone while away from the PC; "it really
// needs to be a dual stick setup", aim and fire while moving). Only on a touch screen (or `?touch`; `?touch=0` off).
// Layout (Keith 2026-11-08, landscape like a MOBA: minimap top left, sticks in the bottom corners, buttons round them):
// - Left stick: WASD as key events (Keys makes it camera-relative, as on a keyboard). Pushed to the rim it holds Space
//   too: a dash, then the sprint while it stays there. Round it, the utilities: Q (repair kit), R, E, F, Tab.
// - Right stick: aims (a point on the screen round its centre, further out the further it's pushed) and fires both
//   sides while pushed past the dead zone. MouseButtons (src/game/playerAim.ts) reads `touchState`.
// - Round the right stick, the abilities: Dash, then 1-4. Each of 1-4 is its own stick while held (drag to aim on the
//   ground: the knob's push is the point on the screen, the whole screen at the rim), released it fires; a tap with no
//   drag fires at the current aim. Its key is held for as long as the finger is down, so hold-to-paint launchers paint.
// - Inv and ⛶ (fullscreen, landscape lock) sit small at the top.
// - The whole page is drawn at `?uiscale=` (0.6 by default) of its size, so the labs' panels and HUDs fit a phone;
//   the pad is sized up to match so it stays thumb-sized.
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

const css = (n: number) => n / UI; // physical size → CSS px at the page's scale
const px = (n: number) => `${Math.round(css(n))}px`;
// Physical px (at uiscale 0.6 on a phone, about real px). STICK the stick's size, EDGE its gap to the screen's edges.
const STICK = 130, KNOB = 54, DEAD = 0.25, RIM = 0.92, BTN = 44, SMALL = 30, EDGE_X = 34, EDGE_L = 58, EDGE_Y = 20;
// EDGE_L: in landscape the left stick sits further in, clear of the energy and hull bars on the left edge (src/ui/energyBar.ts).
const RING = STICK / 2 + 10 + BTN / 2; // button centres from the stick's centre
const AIM_DEAD = 0.18; // an ability stick's drag below this (of its radius) is a tap: fire at the current aim

type Btn = [label: string, code: string, key: string];
// Inward first (toward the middle of the screen), then round over the top to the outer edge.
const LEFT_BTNS: Btn[] = [["Q", "KeyQ", "q"], ["R", "KeyR", "r"], ["E", "KeyE", "e"], ["F", "KeyF", "f"], ["Tab", "Tab", "Tab"]];
const RIGHT_BTNS: Btn[] = [["1", "Digit1", "1"], ["2", "Digit2", "2"], ["3", "Digit3", "3"], ["4", "Digit4", "4"], ["Dash", "Space", " "]];
const AIMED = new Set(["Digit1", "Digit2", "Digit3", "Digit4"]); // the ones that turn into a stick
const TOP_BTNS: Btn[] = [["Inv", "KeyI", "i"]];

/** Drag tracking on an element: calls back with x, y in -1..1 of `radius` px from where `centre` says (y down). */
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

/** Button centres round a stick: `n` from angle a0 to a1 (degrees; 0 inward, 90 straight up). */
function arc(n: number, a0: number, a1: number) {
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (a0 + (a1 - a0) * (n > 1 ? i / (n - 1) : 0)) * Math.PI / 180;
    out.push({ dx: Math.cos(a) * RING, dy: Math.sin(a) * RING });
  }
  return out;
}

/** Puts the two sticks and the buttons over the lab. */
export function mountTouchPad(container: HTMLElement, canvas: HTMLCanvasElement) {
  if (!touchMode) return;
  const meta = document.querySelector('meta[name="viewport"]') ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "viewport" }));
  meta.setAttribute("content", `width=device-width, initial-scale=${UI}, maximum-scale=${UI}, user-scalable=no, viewport-fit=cover`);
  canvas.style.touchAction = "none";
  document.documentElement.classList.add("touch");
  document.body.style.touchAction = "none";
  const style = document.createElement("style");
  style.textContent = `
.tp-stick{position:fixed;bottom:${px(EDGE_Y)};width:${px(STICK)};height:${px(STICK)};border-radius:50%;z-index:20;
  background:rgba(0,0,0,.22);border:${px(2)} solid rgba(255,220,160,.45);touch-action:none;box-sizing:border-box}
.tp-left{left:${px(EDGE_X)}} @media (orientation:landscape){.tp-left{left:${px(EDGE_L)}}} .tp-right{right:${px(EDGE_X)};border-color:rgba(255,150,90,.6)}
.tp-knob{position:absolute;left:50%;top:50%;width:${px(KNOB)};height:${px(KNOB)};margin:${px(-KNOB / 2)};border-radius:50%;
  background:rgba(255,220,160,.55);pointer-events:none}
.tp-right .tp-knob{background:rgba(255,150,90,.6)}
.tp-btn{position:fixed;width:${px(BTN)};height:${px(BTN)};margin:${px(-BTN / 2)} 0 0 ${px(-BTN / 2)};border-radius:50%;
  border:${px(1.5)} solid rgba(255,220,160,.45);background:rgba(0,0,0,.3);color:#fdc;font:600 ${px(13)} system-ui;
  touch-action:none;user-select:none;-webkit-user-select:none;padding:0;z-index:21}
.tp-btn.aimed{border-color:rgba(255,150,90,.7)}
.tp-btn.on{background:rgba(255,180,90,.55)}
.tp-top{position:fixed;top:${px(8)};left:50%;transform:translateX(-50%);display:flex;gap:${px(6)};z-index:21}
.tp-top button{position:static;margin:0;width:${px(SMALL + 12)};height:${px(SMALL)};border-radius:${px(8)};font-size:${px(12)}}
@media (orientation:portrait){.tp-top{left:auto;right:${px(8)};top:${px(36)};transform:none}}
.tp-astick{position:fixed;width:${px(STICK)};height:${px(STICK)};margin:${px(-STICK / 2)} 0 0 ${px(-STICK / 2)};
  border-radius:50%;border:${px(2)} solid rgba(255,150,90,.7);background:rgba(0,0,0,.25);z-index:22;pointer-events:none;
  box-sizing:border-box;display:none}
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

  // The ring an ability button grows into while it's held.
  const astick = document.createElement("div"), aknob = document.createElement("div");
  astick.className = "tp-astick"; aknob.className = "tp-knob"; astick.append(aknob);

  // Buttons: the key is held while the finger is on them.
  const placed: { el: HTMLButtonElement; side: "left" | "right"; i: number; n: number }[] = [];
  const button = ([label, code, k]: Btn) => {
    const b = document.createElement("button");
    b.className = "tp-btn"; b.textContent = label;
    const press = (on: boolean) => {
      if (on === b.classList.contains("on")) return;
      b.classList.toggle("on", on); key(on ? "keydown" : "keyup", code, k);
    };
    if (AIMED.has(code)) {
      b.classList.add("aimed");
      let moved = false;
      const centre = () => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: css(STICK) / 2 }; };
      dragger(b, centre, {
        down: () => {
          moved = false;
          const c = centre();
          Object.assign(astick.style, { display: "block", left: `${c.x}px`, top: `${c.y}px` });
          aknob.style.transform = "";
          press(true);
        },
        move: (v) => {
          if (!moved && Math.hypot(v.x, v.y) < AIM_DEAD) return; // still a tap: the current aim stands
          moved = true; abilityAim = true; touchState.fire = false;
          aknob.style.transform = `translate(${v.x * css(STICK) / 2}px,${v.y * css(STICK) / 2}px)`;
          touchState.aim = screenAim(canvas, v, true);
        },
        up: () => {
          press(false); // the game reads the aim as it fires: still the dragged one (MouseButtons keeps it as the cursor)
          astick.style.display = "none";
          if (moved) { abilityAim = false; touchState.aim = null; }
        },
      });
    } else {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        press(true);
      });
      b.addEventListener("pointerup", () => press(false));
      b.addEventListener("pointercancel", () => press(false));
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    return b;
  };
  for (const [side, list] of [["left", LEFT_BTNS], ["right", RIGHT_BTNS]] as const)
    list.forEach((def, i) => placed.push({ el: button(def), side, i, n: list.length }));

  // Top: inventory, fullscreen (then landscape where the browser allows it: Android Chrome; iOS needs the phone's
  // rotation lock off).
  const top = document.createElement("div");
  top.className = "tp-top";
  for (const def of TOP_BTNS) top.append(button(def));
  const full = document.createElement("button");
  full.className = "tp-btn"; full.textContent = "⛶";
  full.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch { /* not allowed here */ }
  });
  top.append(full);

  // Place the buttons round the sticks: landscape from inward (0°) round over the top to past straight up; portrait
  // starting 35-40° up so the two fans don't meet in the middle. In landscape the left fan stops short of the bars on the edge.
  const layout = () => {
    const land = innerWidth > innerHeight;
    const ys = innerHeight - css(EDGE_Y + STICK / 2);
    for (const p of placed) {
      const [a0, a1] = p.side === "left" ? (land ? [0, 105] : [40, 140]) : (land ? [0, 120] : [40, 140]);
      const { dx, dy } = arc(p.n, a0, a1)[p.i];
      const sx = p.side === "left" ? css((land ? EDGE_L : EDGE_X) + STICK / 2) : innerWidth - css(EDGE_X + STICK / 2);
      p.el.style.left = `${sx + (p.side === "left" ? 1 : -1) * css(dx)}px`;
      p.el.style.top = `${ys - css(dy)}px`;
    }
  };
  layout();
  addEventListener("resize", layout);
  screen.orientation?.addEventListener?.("change", layout);

  container.append(left, right, ...placed.map((p) => p.el), top, astick);
}
