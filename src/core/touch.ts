// Touch controls for phones (Keith 2026-11-07: playing the Pages build on his phone while away from the PC; "it really
// needs to be a dual stick setup", aim and fire while moving). Only on a touch screen (or `?touch`; `?touch=0` off).
// - Left stick: WASD as key events (Keys makes it camera-relative, as on a keyboard). Pushed to the rim it holds Space
//   too: a dash, then the sprint while it stays there.
// - Right stick: aims (a point on the screen round its centre, further out the further it's pushed) and fires both
//   sides while pushed past the dead zone. MouseButtons (src/game/playerAim.ts) reads `touchState`.
// - Small buttons beside the right stick send Dash, F, E, R, Q, 1, 2, 3, Tab and I (inventory) as key events; ⛶ goes fullscreen.
// - The whole page is drawn at `?uiscale=` (0.6 by default) of its size, so the labs' panels and HUDs fit a phone;
//   the pad is sized up to match so it stays thumb-sized.
// Pure input glue: no sim or lab changes. Ownership: the player's own input.

// Guarded: headless checks import playerAim (and so this) under node, with no location or matchMedia.
const query = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
const flag = typeof location === "undefined" ? "0" : query.get("touch");
export const touchMode = flag !== null ? flag !== "0" : typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const UI = Math.min(1, Math.max(0.3, Number(query.get("uiscale")) || 0.6));

/** The right stick: where it aims (client px) and whether it fires; null aim while it's let go. */
export const touchState: { aim: { x: number; y: number } | null; fire: boolean } = { aim: null, fire: false };
/** Sent on window when a stick is first touched (the labs stop their demo, as for a mouse). */
export const TOUCH_USE = "touchuse";

const key = (type: "keydown" | "keyup", code: string, k: string) =>
  dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));

const px = (n: number) => `${Math.round(n / UI)}px`; // physical size → CSS px at the page's scale
const STICK = 130, KNOB = 54, DEAD = 0.25, RIM = 0.92, BTN = 40;
const BUTTONS: [label: string, code: string, key: string][] = [
  ["Dash", "Space", " "], ["F", "KeyF", "f"], ["E", "KeyE", "e"], ["R", "KeyR", "r"],
  ["Q", "KeyQ", "q"], ["1", "Digit1", "1"], ["2", "Digit2", "2"], ["Tab", "Tab", "Tab"], ["Inv", "KeyI", "i"],
  ["3", "Digit3", "3"],
];

/** One stick: calls back with x, y in -1..1 (y down) while held, and null when let go. */
function stick(side: "left" | "right", cb: (v: { x: number; y: number } | null) => void) {
  const el = document.createElement("div"), knob = document.createElement("div");
  el.className = `tp-stick tp-${side}`; knob.className = "tp-knob"; el.append(knob);
  let id = -1;
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * r.width / 2}px,${y * r.height / 2}px)`;
    cb({ x, y });
  };
  const end = (e: PointerEvent) => { if (e.pointerId === id) { id = -1; knob.style.transform = ""; cb(null); } };
  el.addEventListener("pointerdown", (e) => {
    if (id >= 0) return;
    id = e.pointerId; e.preventDefault();
    try { el.setPointerCapture(id); } catch { /* synthetic pointer */ }
    dispatchEvent(new Event(TOUCH_USE));
    move(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return el;
}

/** Puts the two sticks and the buttons over the lab. */
export function mountTouchPad(container: HTMLElement, canvas: HTMLCanvasElement) {
  if (!touchMode) return;
  const meta = document.querySelector('meta[name="viewport"]') ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "viewport" }));
  meta.setAttribute("content", `width=device-width, initial-scale=${UI}, maximum-scale=${UI}, user-scalable=no, viewport-fit=cover`);
  canvas.style.touchAction = "none";
  document.documentElement.classList.add("touch");
  document.body.style.touchAction = "none";
  const css = document.createElement("style");
  css.textContent = `
.tp-stick{position:fixed;bottom:${px(22)};width:${px(STICK)};height:${px(STICK)};border-radius:50%;z-index:20;
  background:rgba(0,0,0,.22);border:${px(2)} solid rgba(255,220,160,.45);touch-action:none}
.tp-left{left:${px(40)}} .tp-right{right:${px(22)};border-color:rgba(255,150,90,.6)}
.tp-knob{position:absolute;left:50%;top:50%;width:${px(KNOB)};height:${px(KNOB)};margin:${px(-KNOB / 2)};border-radius:50%;
  background:rgba(255,220,160,.55);pointer-events:none}
.tp-right .tp-knob{background:rgba(255,150,90,.6)}
.tp-btns{position:fixed;right:${px(16)};bottom:${px(STICK + 34)};display:grid;grid-template-columns:repeat(6,${px(BTN)});
  gap:${px(6)};z-index:20}
@media (orientation:landscape){.tp-btns{right:${px(STICK + 36)};bottom:${px(14)};grid-template-columns:repeat(3,${px(BTN)})}}
.tp-btns button,.tp-full{height:${px(BTN)};border-radius:${px(10)};border:${px(1.5)} solid rgba(255,220,160,.45);
  background:rgba(0,0,0,.3);color:#fdc;font:600 ${px(12)} system-ui;touch-action:none;user-select:none;
  -webkit-user-select:none;padding:0}
.tp-btns button.on{background:rgba(255,180,90,.55)}
.tp-full{font-size:${px(18)}}`;
  document.head.append(css);

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

  // Right stick: a point round the screen's centre (the camera follows the mech), and both triggers past the dead zone.
  const right = stick("right", (v) => {
    if (!v) { touchState.fire = false; touchState.aim = null; return; }
    const l = Math.hypot(v.x, v.y);
    if (l < 0.08) return; // keep the last aim until it's pushed somewhere
    const r = canvas.getBoundingClientRect(), reach = 0.45 * Math.min(r.width, r.height) * (0.35 + 0.65 * Math.min(1, l));
    touchState.aim = { x: r.left + r.width / 2 + v.x / l * reach, y: r.top + r.height / 2 + v.y / l * reach };
    touchState.fire = l > DEAD;
  });

  // Buttons: held while the finger is on them.
  const btns = document.createElement("div");
  btns.className = "tp-btns";
  for (const [label, code, k] of BUTTONS) {
    const b = document.createElement("button");
    b.textContent = label;
    const off = () => { if (b.classList.contains("on")) { b.classList.remove("on"); key("keyup", code, k); } };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      b.classList.add("on"); key("keydown", code, k);
    });
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    btns.append(b);
  }

  // Fullscreen, then landscape where the browser allows it (Android Chrome; iOS needs the phone's rotation lock off).
  const full = document.createElement("button");
  full.className = "tp-full"; full.textContent = "⛶";
  full.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch { /* not allowed here */ }
  });
  btns.append(full);
  container.append(left, right, btns);
}
