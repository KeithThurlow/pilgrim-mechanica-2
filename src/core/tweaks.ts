// Live tuning panel built from a parameter list. Every feel value in the project goes through one of these,
// so tuning never needs a code change. Values are edited in place, saved per lab in localStorage,
// and Copy gives JSON to paste back into code as new defaults.

export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  group: string;
  tip?: string;
  /** Rebuild-heavy params (e.g. terrain shape) can ask to apply on release instead of every drag tick. */
  onRelease?: boolean;
}

export type Values = Record<string, number>;

export interface Action {
  label: string;
  onClick: () => void;
  /** Returns whether the button shows as on. */
  active?: () => boolean;
}

export interface PanelOptions<V extends Values> {
  id: string;
  title: string;
  params: Param[];
  values: V;
  defaults: Readonly<V>;
  actions?: Action[];
  onChange?: (key: keyof V & string) => void;
}

export function tweakPanel<V extends Values>(o: PanelOptions<V>) {
  const storeKey = `pm2:${o.id}`;
  // Saved values come back, except where the default has changed since they were saved: a new default in code
  // wins over a stale save (otherwise tuning changes pushed by an agent never show up in Keith's browser).
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) || "{}") as { v?: Values; d?: Values };
    if (saved.v && saved.d) {
      for (const p of o.params) {
        const val = saved.v[p.key], def = saved.d[p.key];
        if (typeof val === "number" && def === o.defaults[p.key]) (o.values as Values)[p.key] = val;
      }
    }
  } catch { /* storage blocked or corrupt: run on defaults */ }
  // URL overrides for reviews and scripted tests, not saved: ?set=sunAzimuth:120,skyFill:1.2
  const known = new Set(o.params.map((p) => p.key));
  for (const pair of (new URLSearchParams(location.search).get("set") ?? "").split(",")) {
    const [k, val] = pair.split(":");
    if (k && known.has(k) && Number.isFinite(Number(val))) (o.values as Values)[k] = Number(val);
  }
  const save = () => {
    try { localStorage.setItem(storeKey, JSON.stringify({ v: o.values, d: o.defaults })); } catch { /* ignore */ }
  };

  const root = document.createElement("aside");
  root.className = "panel";
  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("strong");
  title.textContent = o.title;
  const fold = button("Tune", () => root.classList.toggle("open"));
  head.append(title, fold);
  root.appendChild(head);

  const body = document.createElement("div");
  body.className = "panel-body";
  root.appendChild(body);

  const actionButtons: { el: HTMLButtonElement; a: Action }[] = [];
  const refreshActions = () => actionButtons.forEach(({ el, a }) => el.classList.toggle("on", !!a.active?.()));
  if (o.actions?.length) {
    const row = document.createElement("div");
    row.className = "row";
    for (const a of o.actions) {
      const el = button(a.label, () => { a.onClick(); refreshActions(); });
      actionButtons.push({ el, a });
      row.appendChild(el);
    }
    body.appendChild(row);
  }

  const inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; p: Param }>();
  const show = (p: Param) => {
    const it = inputs.get(p.key)!;
    const v = o.values[p.key];
    it.input.value = String(v);
    const dec = decimals(p.step ?? 0.01);
    it.out.textContent = isToggle(p) ? (v ? "on" : "off") : v.toFixed(dec);
  };

  const groups = new Map<string, HTMLElement>();
  for (const p of o.params) {
    let g = groups.get(p.group);
    if (!g) {
      const d = document.createElement("details");
      d.open = groups.size === 0;
      const s = document.createElement("summary");
      s.textContent = p.group;
      d.appendChild(s);
      body.appendChild(d);
      groups.set(p.group, d);
      g = d;
    }
    const row = document.createElement("label");
    row.className = "slider";
    if (p.tip) row.title = p.tip;
    const name = document.createElement("span");
    name.textContent = p.label;
    const out = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step ?? 0.01);
    const apply = () => {
      (o.values as Values)[p.key] = parseFloat(input.value);
      show(p);
      save();
      o.onChange?.(p.key as keyof V & string);
    };
    input.addEventListener(p.onRelease ? "change" : "input", apply);
    if (p.onRelease) input.addEventListener("input", () => { out.textContent = parseFloat(input.value).toFixed(decimals(p.step ?? 0.01)); });
    row.append(name, out, input);
    g.appendChild(row);
    inputs.set(p.key, { input, out, p });
    show(p);
  }

  const tools = document.createElement("div");
  tools.className = "row";
  tools.append(
    button("Reset", () => {
      for (const p of o.params) { (o.values as Values)[p.key] = o.defaults[p.key]; show(p); }
      save();
      for (const p of o.params) o.onChange?.(p.key as keyof V & string);
    }),
    button("Copy values", async () => {
      const text = JSON.stringify(Object.fromEntries(o.params.map((p) => [p.key, o.values[p.key]])), null, 1);
      try { await navigator.clipboard.writeText(text); } catch { prompt("Values", text); }
    }),
  );
  body.appendChild(tools);

  document.body.appendChild(root);
  refreshActions();
  return {
    refresh: () => { for (const p of o.params) show(p); refreshActions(); },
  };
}

const isToggle = (p: Param) => p.min === 0 && p.max === 1 && p.step === 1;
const decimals = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

function button(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Start from these defaults; the panel overwrites them with any saved values. */
export function defaultsOf<V extends Values>(params: Param[], given: V): V {
  for (const p of params) if (!(p.key in given)) throw new Error(`No default for ${p.key}`);
  return { ...given };
}
