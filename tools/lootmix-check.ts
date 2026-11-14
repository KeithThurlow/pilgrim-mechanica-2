// Loot slot mix (Claude 2026-11-14): random loot must reach every slot, not just weapons. Rolls the field's kill drops
// (src/expedition/drops.ts, the game's own path) many times and checks each slot's share, that shoulder launchers come
// up, and that every droppable base turns up. Prints the mix.
import { DropField, DROP_DEFAULTS } from "../src/expedition/drops";
import { LOOT_DEFAULTS } from "../src/items/generate";
import { BASES, BASE_BY_ID } from "../src/items/bases";

const N = 40000;
const f = new DropField({ ...DROP_DEFAULTS, ...LOOT_DEFAULTS }, 1234);
const kinds: Record<string, number> = {}, bases: Record<string, number> = {};
let launchers = 0;
for (let i = 0; i < N; i++) {
  const d = f.roll(`k${i}`, 1, 0, 0, { danger: 0.3, heat: 0.3, depth: 300 });
  if (!d) continue;
  kinds[d.item.kind] = (kinds[d.item.kind] ?? 0) + 1;
  bases[d.item.base] = (bases[d.item.base] ?? 0) + 1;
  const b = BASE_BY_ID[d.item.base];
  if (b?.kind === "shoulder" && ["rockets", "mortar"].some((t) => b.tags.includes(t))) launchers++;
}
const pct = (n: number) => ((100 * n) / N).toFixed(1) + "%";
const fails: string[] = [];
console.log("drop mix of", N, "rolls:", Object.entries(kinds).map(([k, n]) => `${k} ${pct(n)}`).join(", "), `| shoulder launchers ${pct(launchers)}`);
for (const k of ["legs", "hull", "sensor", "pack", "waist", "shoulder"]) if ((kinds[k] ?? 0) / N < 0.06) fails.push(`${k} only ${pct(kinds[k] ?? 0)} of drops (want >= 6%)`);
if ((kinds.weapon ?? 0) / N > 0.4) fails.push(`weapons ${pct(kinds.weapon)} of drops (want <= 40%)`);
if (launchers / N < 0.08) fails.push(`shoulder launchers only ${pct(launchers)} (want >= 8%)`);
for (const b of BASES) if (b.drop > 0 && !bases[b.id]) fails.push(`${b.id} never dropped`);
if (fails.length) { for (const m of fails) console.error("FAIL", m); process.exit(1); }
console.log("lootmix: ok");
