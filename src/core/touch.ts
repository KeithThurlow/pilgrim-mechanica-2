// Touch controls for phones (Keith 2026-11-07: playing the Pages build on his phone while away from the PC).
// Only on a touch screen (or `?touch`; `?touch=0` turns it off). Pure input glue: the stick and buttons send the same
// keyboard events the labs already listen for (WASD, Space, F, E, Q, R, 1, 2, Tab), so no sim or lab changes;
// MouseButtons (src/game/playerAim.ts) reads a finger on the canvas as the cursor plus the left trigger, and
// `touchState.right` as the right trigger.
// Ownership: the player's own input.

// Guarded: headless checks import playerAim (and so this) under node, with no location or matchMedia.
const flag = typeof location === "undefined" ? "0" : new URLSearchParams(location.search).get("touch");
export const touchMode = flag !== null ? flag !== "0" : typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** The right gun's on-screen trigger (MouseButtons ORs it into `right`). */
export const touchState = { right: false };

const key = (type: "keydown" | "keyup", code: string, k: string) =>
  dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));

const STICK = 120, DEAD = 0.3;
const BUTTONS: [label: string, code: string, key: string][] = [
  ["Dash", "Space", " "], ["F", "KeyF", "f"], ["E", "KeyE", "e"], ["R", "KeyR", "r"],
  ["Q", "KeyQ", "q"], ["1", "Digit1", "1"], ["2", "Digit2", "2"], ["Tab", "Tab", "Tab"],
];

/** Puts the stick (bottom left) and buttons (bottom right) over the lab. */
export function mountTouchPad(container: HTMLElement, canvas: HTMLCanvasElement) {
  if (!touchMode) return;
  canvas.style.touchAction = "none";
  document.documentElement.classList.add("touch");
  document.body.style.touchAction = "manipulation";
  const css = document.createElement("style");
  css.textContent = `
.tp-stick{position:fixed;left:24px;bottom:24px;width:${STICK}px;height:${STICK}px;border-radius:50%;
  background:rgba(0,0,0,.25);border:2px solid rgba(255,220,160,.5);touch-action:none;z-index:20}
.tp-knob{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px;border-radius:50%;
  background:rgba(255,220,160,.6);pointer-events:none}
.tp-btns{position:fixed;right:16px;bottom:16px;display:grid;grid-template-columns:repeat(3,56px);gap:8px;z-index:20}
.tp-btns button{height:56px;border-radius:50%;border:2px solid rgba(255,220,160,.5);background:rgba(0,0,0,.3);
  color:#fdc;font:600 13px system-ui;touch-action:none;user-select:none;-webkit-user-select:none}
.tp-btns button.on{background:rgba(255,180,90,.55)}
.tp-full{position:fixed;left:24px;bottom:${STICK + 40}px;width:44px;height:44px;border-radius:8px;z-index:20;
  border:2px solid rgba(255,220,160,.5);background:rgba(0,0,0,.3);color:#fdc;font:20px system-ui}
@media (orientation:landscape) and (max-height:560px){.tp-btns{grid-template-columns:repeat(3,48px);gap:6px}
  .tp-btns button{height:48px;font-size:11px}.tp-stick{left:16px;bottom:16px}.tp-full{left:16px;bottom:${STICK + 28}px}}`;
  document.head.append(css);

  // Stick: WASD past the dead zone (Keys turns them into a camera-relative direction, as on a keyboard).
  const stick = document.createElement("div"), knob = document.createElement("div");
  stick.className = "tp-stick"; knob.className = "tp-knob"; stick.append(knob);
  const held = new Set<string>();
  const set = (code: string, k: string, on: boolean) => {
    if (on === held.has(code)) return;
    if (on) held.add(code); else held.delete(code);
    key(on ? "keydown" : "keyup", code, k);
  };
  let id = -1;
  const move = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * STICK / 2}px,${y * STICK / 2}px)`;
    set("KeyW", "w", y < -DEAD); set("KeyS", "s", y > DEAD); set("KeyA", "a", x < -DEAD); set("KeyD", "d", x > DEAD);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1; knob.style.transform = "";
    for (const [c, k] of [["KeyW", "w"], ["KeyS", "s"], ["KeyA", "a"], ["KeyD", "d"]]) set(c, k, false);
  };
  stick.addEventListener("pointerdown", (e) => { id = e.pointerId; try { stick.setPointerCapture(id); } catch { /* synthetic pointer */ } move(e); e.preventDefault(); });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);

  // Buttons: held while the finger is on them. "Gun R" is the right trigger; a finger on the canvas aims and fires left.
  const btns = document.createElement("div");
  btns.className = "tp-btns";
  const hold = (label: string, down: () => void, up: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    const off = () => { if (b.classList.contains("on")) { b.classList.remove("on"); up(); } };
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } b.classList.add("on"); down(); });
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    btns.append(b);
  };
  // Full: fullscreen, then landscape where the browser allows it (Android Chrome does; iOS Safari has no lock, the
  // phone's own rotation works there once its rotation lock is off).
  const full = document.createElement("button");
  full.className = "tp-full"; full.textContent = "⛶";
  full.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch { /* not allowed here */ }
  });
  container.append(full);
  hold("Gun R", () => { touchState.right = true; }, () => { touchState.right = false; });
  for (const [label, code, k] of BUTTONS) hold(label, () => key("keydown", code, k), () => key("keyup", code, k));
  container.append(stick, btns);
}
