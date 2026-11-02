// Grid inventory (Keith 2026-11-02), headless: every base has a size, Keith's sizes hold by default, nothing in a grid
// overlaps or hangs off the edge (by placing, moving, turning and repacking hundreds of rolled items), a full grid
// refuses, turning lets a long item into a wide gap, and the same items repack the same way.
import { BASES } from "../src/items/bases";
import { LOOT_DEFAULTS, rollLoot } from "../src/items/generate";
import { GRID_CLASS_IDS, GRID_SIZE_DEFAULTS, classCells, gridClassOfBase, itemCells, type GridClass } from "../src/items/gridSize";
import { autoPlace, findSpot, fitsAt, footprint, itemAt, newGrid, placeAt, removeFrom, repack, syncGrid, usedCells, type Grid } from "../src/items/grid";

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };

// ---- Sizes ----
for (const b of BASES) {
  const c = gridClassOfBase(b), s = classCells(c);
  must(GRID_CLASS_IDS.includes(c) && s.w >= 1 && s.h >= 1, `${b.id} has no size`);
}
const cls = (id: string): GridClass => gridClassOfBase(BASES.find((b) => b.id === id)!);
const sz = (id: string) => { const s = classCells(cls(id)); return `${s.w}x${s.h}`; };
// Keith's sizes (2026-11-02).
must(sz("mg-medium") === "2x3", `hull minigun ${sz("mg-medium")}, want 2x3`);
must(sz("rail-medium") === "2x4", `rail cannon ${sz("rail-medium")}, want 2x4`);
must(sz("hull-cuirass") === "3x2" && sz("hull-siege") === "4x2", "hulls not 3x2 / 4x2");
must(sz("pack-standin") === "2x2", "pack not 2x2");
must(sz("legs-rampart") === "2x3", "legs not 2x3");
must(sz("arm-rampart") === "2x2", "arm not 2x2");
must(sz("smg-light") === "2x2" && sz("rifle-light") === "2x3", "held weapons not 2x2 / 2x3");
must(sz("waist-drums") === "2x1", "waist not 2x1");
must(sz("sh-missiles") === "2x2", "shoulder not 2x2");
must(sz("sword-heavy") === "2x4" && sz("sword-light") === "1x4" && sz("sword-short") === "1x3", "swords not 2x4 / 1x4 / 1x3");
// 2x4 is the longest size (Keith 2026-11-02).
for (const c of GRID_CLASS_IDS) { const s = classCells(c); must(Math.max(s.w, s.h) <= 4, `${c} is ${s.w}x${s.h}, longer than 4`); }
must(`${classCells("repairKit").w}x${classCells("repairKit").h}` === "1x2" && classCells("protocol").w * classCells("protocol").h === 1, "repair kit not 1x2 or protocol not 1x1");
// Every class's sliders exist.
for (const c of GRID_CLASS_IDS) must(`grid_${c}_w` in GRID_SIZE_DEFAULTS && `grid_${c}_h` in GRID_SIZE_DEFAULTS, `${c} has no sliders`);

// ---- The rules: no overlap, nothing off the edge ----
function sound(g: Grid, what: string) {
  const seen = new Map<string, string>();
  for (const p of g.placed) {
    const f = footprint(p, p.rot);
    if (p.x < 0 || p.y < 0 || p.x + f.w > g.cols || p.y + f.h > g.rows) { fails.push(`${what}: ${p.id} off the edge`); return; }
    for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) {
      const k = `${x},${y}`;
      if (seen.has(k)) { fails.push(`${what}: ${p.id} overlaps ${seen.get(k)} at ${k}`); return; }
      seen.set(k, p.id);
    }
  }
  if (new Set(g.placed.map((p) => p.id)).size !== g.placed.length) fails.push(`${what}: an item is in twice`);
}

const items = Array.from({ length: 300 }, (_, i) => rollLoot(1000 + i, LOOT_DEFAULTS));
const g = newGrid(10, 8);
let r = 12345;
const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let placed = 0, refused = 0;
for (let step = 0; step < 3000; step++) {
  const it = items[Math.floor(rnd() * items.length)];
  const s = itemCells(it);
  const roll = rnd();
  if (roll < 0.5) { if (autoPlace(g, it.id, s)) placed++; else refused++; }
  else if (roll < 0.85) { placeAt(g, it.id, s, Math.floor(rnd() * 12) - 1, Math.floor(rnd() * 10) - 1, rnd() < 0.5); }
  else removeFrom(g, it.id);
  sound(g, `step ${step}`);
  if (fails.length) break;
}
must(placed > 50 && refused > 0, `random play too tame: ${placed} placed, ${refused} refused`);

// A full grid refuses; the space taken adds up.
const full = newGrid(4, 4);
for (let i = 0; i < 16; i++) must(autoPlace(full, `p${i}`, { w: 1, h: 1 }), `1x1 #${i} didn't fit an empty 4x4`);
must(!autoPlace(full, "extra", { w: 1, h: 1 }), "a full grid took another item");
must(usedCells(full) === 16, "used cells wrong");
must(itemAt(full, 3, 3)?.id === "p15", "itemAt wrong");

// Turning: a 2x8 rail into an 8-wide, 3-tall grid only fits turned; without turning, no.
const wide = newGrid(8, 3);
must(!!findSpot(wide, { w: 2, h: 8 }) && findSpot(wide, { w: 2, h: 8 })!.rot, "a 2x8 didn't turn to fit an 8x3 grid");
must(!findSpot(wide, { w: 2, h: 8 }, false), "a 2x8 fitted an 8x3 grid unturned");
must(!fitsAt(wide, { w: 2, h: 8 }, 0, 0, false), "fitsAt let a 2x8 hang off");

// Moving within its own grid: an item can shift onto cells it already covers.
const m = newGrid(4, 4);
placeAt(m, "a", { w: 2, h: 2 }, 0, 0, false);
must(placeAt(m, "a", { w: 2, h: 2 }, 1, 0, false) && m.placed.length === 1 && m.placed[0].x === 1, "an item couldn't shift over itself");

// Repack: same input, same layout; and a repack fits at least as much as the random play left in.
const list = items.slice(0, 40).map((it) => ({ id: it.id, cells: itemCells(it) }));
const a = newGrid(10, 8), b = newGrid(10, 8);
const leftA = repack(a, list), leftB = repack(b, [...list].reverse());
sound(a, "repack");
must(JSON.stringify(a.placed) === JSON.stringify(b.placed) && leftA.join() === leftB.join(), "repack depends on the input order");
must(a.placed.length + leftA.length === list.length, "repack lost items");

// Sync: a stale layout (gone items, a changed size, an overlap) comes back sound; new items go in; grow takes all.
const sy = newGrid(10, 8);
repack(sy, list);
const firstId = sy.placed.find((p) => list.slice(0, 30).some((l) => l.id === p.id) && p.w * p.h > 1)!.id;
sy.placed.push({ id: "ghost", x: 0, y: 0, w: 1, h: 1, rot: false }, { ...sy.placed[1], id: "dupe" });
const changed = list.map((l) => (l.id === firstId ? { id: l.id, cells: { w: 1, h: 1 } } : l)).slice(0, 30);
const over = syncGrid(sy, changed);
sound(sy, "sync");
must(!sy.placed.some((p) => p.id === "ghost" || p.id === "dupe"), "sync kept items that aren't in the bag");
must(sy.placed.find((p) => p.id === firstId)?.w === 1 || over.includes(firstId), "sync didn't re-place a resized item");
must(sy.placed.length + over.length === changed.length, "sync lost items");
const st2 = newGrid(12, 4);
must(syncGrid(st2, list, true, true).length === 0 && st2.rows > 4, "a growing grid didn't take everything");
sound(st2, "grow");

if (fails.length) { console.error("grid-check FAILED:\n  " + fails.slice(0, 20).join("\n  ")); process.exit(1); }
console.log(`grid-check ok: ${BASES.length} bases sized, ${placed} random placements sound, repack ${a.placed.length}/${list.length} in 10x8`);
