// The weapons lab's review charts (was the weapon review lab's, Keith 2026-11-03): SVG strings for the budget map,
// raw against eDPS, and small line charts. Pure: profiles in, markup out.
import { SCALING, type Profile } from "../../src/items/weaponScaling";

export const C_FOCUS = "#e8892b", C_AREA = "#4bc0d9", C_GRID = "#30343b", C_SEL = "#f0c14b";
export const f0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toString() : "–");
export const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A small line chart: series of [x, y] with a colour and dash. */
export function lineChart(o: { w?: number; h?: number; xs: number[]; series: { pts: [number, number][]; color: string; dash?: string; width?: number }[]; xLabel: string; yLabel: string; yMax?: number; yMin?: number; marks?: { x: number; label: string }[] }): string {
  const W = o.w ?? 420, H = o.h ?? 130, L = 34, R = 8, T = 8, B = 22;
  const all = o.series.flatMap((s) => s.pts.map((p) => p[1])).filter(Number.isFinite);
  const yMin = o.yMin ?? 0, yMax = o.yMax ?? Math.max(1e-6, ...all) * 1.08;
  const x0 = Math.min(...o.xs), x1 = Math.max(...o.xs);
  const X = (x: number) => L + ((x - x0) / Math.max(1e-6, x1 - x0)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - yMin) / Math.max(1e-6, yMax - yMin)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="${C_GRID}" stroke-width="1"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${yMax - yMin < 5 ? y.toFixed(1) : Math.round(y)}</text>`;
  }
  for (const x of o.xs) s += `<text x="${X(x)}" y="${H - 9}" text-anchor="middle">${x}</text>`;
  for (const m of o.marks ?? []) s += `<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${T}" y2="${H - B}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(m.x) + 3}" y="${T + 9}" style="fill:${C_SEL}">${esc(m.label)}</text>`;
  for (const se of o.series) {
    const d = se.pts.filter((p) => Number.isFinite(p[1])).map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width ?? 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""}/>`;
  }
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">${esc(o.xLabel)}</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">${esc(o.yLabel)}</text></svg>`;
  return s;
}

/** The budget map: every weapon at (focus %, area %) of its slot's budget, the 130% caps and the proposed spend line. */
export function budgetMap(all: Profile[], sel: Profile, builds: { f: Profile | null; a: Profile | null; mine: Profile | null }): string {
  const W = 420, H = 250, L = 34, R = 10, T = 10, B = 24, max = Math.max(260, ...all.map((p) => Math.max(p.focusPct, p.areaPct)) , ...[builds.a, builds.f, builds.mine].filter(Boolean).map((p) => Math.max(p!.focusPct, p!.areaPct))) * 1.05;
  const X = (x: number) => L + (x / max) * (W - L - R), Y = (y: number) => T + (1 - y / max) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let v = 0; v <= max; v += 50) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${C_GRID}"/><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C_GRID}"/><text x="${X(v)}" y="${H - 11}" text-anchor="middle">${v}</text><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  s += `<line x1="${X(130)}" x2="${X(130)}" y1="${T}" y2="${H - B}" stroke="#f06a4b" stroke-dasharray="4 3"/><line x1="${L}" x2="${W - R}" y1="${Y(130)}" y2="${Y(130)}" stroke="#f06a4b" stroke-dasharray="4 3"/>`;
  const c = SCALING.spendCap;
  s += `<line x1="${X(0)}" y1="${Y(c)}" x2="${X(c)}" y2="${Y(0)}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(c * 0.55) + 4}" y="${Y(c * 0.45) - 4}" style="fill:${C_SEL}">spend ${c}</text>`;
  for (const p of all) {
    const me = p.id === sel.id;
    s += `<circle cx="${X(p.focusPct)}" cy="${Y(p.areaPct)}" r="${me ? 5 : 3.2}" fill="${me ? C_SEL : p.slot === "shoulder" ? "#9a958c" : "#e8e4dc"}" opacity="${me ? 1 : 0.75}"><title>${esc(p.name)}: focus ${f0(p.focusPct)}%, area ${f0(p.areaPct)}%</title></circle>`;
    if (me || p.spend > c) s += `<text x="${X(p.focusPct) + 6}" y="${Y(p.areaPct) + 3}" style="fill:${me ? C_SEL : "#e8e4dc"}">${esc(p.name)}</text>`;
  }
  const arrow = (to: Profile | null, color: string, label: string) => {
    if (!to) return;
    s += `<line x1="${X(sel.focusPct)}" y1="${Y(sel.areaPct)}" x2="${X(to.focusPct)}" y2="${Y(to.areaPct)}" stroke="${color}" stroke-width="1.5"/><circle cx="${X(to.focusPct)}" cy="${Y(to.areaPct)}" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><text x="${X(to.focusPct) + 5}" y="${Y(to.areaPct) - 4}" style="fill:${color}">${label}</text>`;
  };
  arrow(builds.f, C_FOCUS, "best focus build");
  arrow(builds.a, C_AREA, "best area build");
  arrow(builds.mine, "#8fd18a", "fitted");
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">focus: % of budget vs its best single target</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">area: % vs the swarm</text></svg>`;
  return s;
}

/** Raw (card) DPS against eDPS for every weapon: under the line is what misses, armour and waiting cost it. */
export function rawMap(all: Profile[], sel: Profile): string {
  const W = 420, H = 230, L = 34, R = 10, T = 10, B = 24;
  const max = Math.max(...all.map((p) => Math.max(p.card, p.focus))) * 1.05;
  const X = (x: number) => L + (x / max) * (W - L - R), Y = (y: number) => T + (1 - y / max) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let v = 0; v <= max; v += 100) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${C_GRID}"/><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C_GRID}"/><text x="${X(v)}" y="${H - 11}" text-anchor="middle">${v}</text><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(max)}" y2="${Y(max)}" stroke="${C_SEL}" stroke-dasharray="2 3"/><text x="${X(max * 0.8)}" y="${Y(max * 0.8) - 5}" style="fill:${C_SEL}">eDPS = raw</text>`;
  for (const p of all) {
    const me = p.id === sel.id;
    s += `<circle cx="${X(p.card)}" cy="${Y(p.focus)}" r="${me ? 5 : 3.2}" fill="${me ? C_SEL : p.slot === "shoulder" ? "#9a958c" : "#e8e4dc"}" opacity="${me ? 1 : 0.75}"><title>${esc(p.name)}: raw ${f0(p.card)}, eDPS ${f0(p.focus)} (${p.focusSet})</title></circle>`;
    if (me) s += `<text x="${X(p.card) + 6}" y="${Y(p.focus) + 3}" style="fill:${C_SEL}">${esc(p.name)}</text>`;
  }
  s += `<text x="${W - R}" y="${H - 1}" text-anchor="end">raw DPS (the item card)</text><text x="2" y="${T + 2}" transform="rotate(90 2 ${T + 2})">eDPS vs its best single</text></svg>`;
  return s;
}
