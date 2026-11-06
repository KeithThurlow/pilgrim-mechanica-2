// The canvas's place on the page, read once and kept (perf, 2026-11-06: several per-frame users (aim, drop labels,
// threat marks) each called getBoundingClientRect, which forces the browser to lay the page out again whenever the
// HUD's DOM changed that frame: 1.5% of the convoy frame on Keith's PC). Read again when the canvas resizes, the
// window resizes or scrolls, and at most a second after anything else could have moved it.
const cache = new WeakMap<Element, { r: DOMRect; t: number }>();
let gen = 0;
const bump = () => { gen++; };
if (typeof window !== "undefined") { window.addEventListener("resize", bump); window.addEventListener("scroll", bump, true); }
const watched = new WeakSet<Element>();
const gens = new WeakMap<Element, number>();

/** The element's bounding client rect, cached (same numbers as getBoundingClientRect while the layout holds). */
export function canvasRect(el: Element): DOMRect {
  if (!watched.has(el) && typeof ResizeObserver !== "undefined") { watched.add(el); new ResizeObserver(bump).observe(el); }
  const now = performance.now(), c = cache.get(el);
  if (c && gens.get(el) === gen && now - c.t < 1000) return c.r;
  const r = el.getBoundingClientRect();
  cache.set(el, { r, t: now });
  gens.set(el, gen);
  return r;
}
