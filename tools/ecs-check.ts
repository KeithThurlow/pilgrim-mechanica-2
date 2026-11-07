// The ECS core (src/ecs/; docs/architecture-review.md stage 2). Random entities and components against a plain
// reference (sets and maps): membership, every query's list, field values kept through growth, stale ids after a
// destroy and index reuse, more than 32 components (two mask words), systems in phase order and at their rates,
// events cleared each tick, two worlds sharing component definitions without sharing data, snapshot columns, and
// interpolation between ticks. Run: npm test (or npx tsx tools/ecs-check.ts).
import { World, defineComponent, defineObjects, entityIndex, type Component, type Entity, type Query } from "../src/ecs/world";
import { Transform, PrevTransform, keepPrevious, drawnAt } from "../src/ecs/components";
import { packWorld } from "../src/ecs/snapshot";

const problems: string[] = [];
const fail = (s: string) => { if (problems.length < 20) console.log("  FAIL " + s); problems.push(s); };

let seed = 1234;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// 1. Random operations against a reference.
{
  const w = new World();
  const comps: Component[] = [];
  for (let k = 0; k < 40; k++) comps.push(defineComponent(`C${k}`, { a: "f32", b: "i32", c: "u8" }));
  const Obj = defineObjects<{ n: number }>("Obj");
  const ref = new Map<Entity, Set<number>>();
  const val = (e: Entity, k: number) => (entityIndex(e) * 7 + k * 13) % 1000;
  const queries: { q: Query; want: number[] }[] = [];
  const stale: Entity[] = [];
  let ops = 0;
  for (let step = 0; step < 40000; step++) {
    const r = rnd(), live = [...ref.keys()];
    ops++;
    if (r < 0.25 || live.length < 5) {
      const e = w.create();
      if (ref.has(e)) fail(`create gave a live id ${e}`);
      ref.set(e, new Set());
    } else if (r < 0.35) {
      const e = pick(live);
      w.destroy(e); ref.delete(e); stale.push(e);
    } else if (r < 0.7) {
      const e = pick(live), k = Math.floor(rnd() * comps.length);
      w.add(e, comps[k], { a: val(e, k), b: -val(e, k), c: val(e, k) & 255 });
      ref.get(e)!.add(k);
      if (rnd() < 0.05) { w.addObject(e, Obj, { n: e }); }
    } else if (r < 0.9) {
      const e = pick(live), k = Math.floor(rnd() * comps.length);
      w.remove(e, comps[k]); ref.get(e)!.delete(k);
    } else if (r < 0.902 && queries.length < 12) {
      const n = 1 + Math.floor(rnd() * 3), want = [...new Set(Array.from({ length: n }, () => Math.floor(rnd() * comps.length)))];
      queries.push({ q: w.query(...want.map((k) => comps[k])), want });
    }
    if (step % 997 !== 0) continue;
    // Membership and values.
    for (const [e, set] of ref) {
      if (!w.exists(e)) fail(`${e} should exist`);
      for (let k = 0; k < comps.length; k++) {
        if (w.has(e, comps[k]) !== set.has(k)) { fail(`has(${e}, C${k}) ${w.has(e, comps[k])} vs ${set.has(k)}`); continue; }
        if (set.has(k)) {
          const c = w.columns(comps[k]), i = entityIndex(e);
          if (c.a[i] !== val(e, k) || c.b[i] !== -val(e, k) || c.c[i] !== (val(e, k) & 255)) fail(`C${k} of ${e}: ${c.a[i]},${c.b[i]},${c.c[i]}`);
        }
      }
    }
    for (const e of stale) if (w.exists(e)) fail(`stale id ${e} still exists`);
    for (const { q, want } of queries) {
      const got = new Set(q.list()), exp = [...ref].filter(([, s]) => want.every((k) => s.has(k))).map(([e]) => e);
      if (got.size !== exp.length || exp.some((e) => !got.has(e))) fail(`query C${want.join("+C")}: ${got.size} vs ${exp.length}`);
    }
    if (w.alive !== ref.size) fail(`alive ${w.alive} vs ${ref.size}`);
  }
  const objs = w.objects(Obj);
  for (const [e] of ref) { const o = objs[entityIndex(e)]; if (o && o.n !== e && w.has(e, Obj)) fail(`object of ${e}`); }
  console.log(`  ${ops} random operations, ${w.alive} alive, high ${w.high}, ${queries.length} queries, ${stale.length} destroyed: ${problems.length ? "problems" : "match"}`);
}

// 2. Ids: a destroyed index comes back with a new generation; growth keeps data.
{
  const w = new World();
  const a = w.create(); w.destroy(a);
  const b = w.create();
  if (entityIndex(a) !== entityIndex(b) || a === b || w.exists(a) || !w.exists(b)) fail(`reuse: ${a} -> ${b}`);
  const P = defineComponent("P", { v: "f64" });
  const es: Entity[] = [];
  for (let i = 0; i < 5000; i++) { const e = w.create(); w.add(e, P, { v: i * 0.5 }); es.push(e); }
  const c = w.columns(P);
  if (es.some((e, i) => c.v[entityIndex(e)] !== i * 0.5)) fail("growth lost values");
}

// 3. Systems: phase order, rates, events.
{
  const w = new World();
  const order: string[] = [];
  let slow = 0, slowDt = 0;
  w.addSystem({ name: "late", phase: "late", run: () => order.push("late") });
  w.addSystem({ name: "ai", phase: "ai", run: (wd) => { order.push("ai"); wd.emit("thought", { t: wd.tick }); } });
  w.addSystem({ name: "input", phase: "input", run: () => order.push("input") });
  w.addSystem({ name: "far", phase: "ai", every: 4, offset: 1, run: (_, dt) => { slow++; slowDt = dt; } });
  for (let i = 0; i < 40; i++) {
    w.step(1 / 60);
    if (w.events.length !== 1) fail(`tick ${i}: ${w.events.length} events`);
  }
  if (order.slice(0, 3).join() !== "input,ai,late") fail(`order ${order.slice(0, 3)}`);
  if (slow !== 10 || Math.abs(slowDt - 4 / 60) > 1e-9) fail(`rate group ran ${slow} times, dt ${slowDt}`);
}

// 4. Two worlds share definitions, not data; snapshots; interpolation.
{
  const a = new World(), b = new World();
  const ea = a.create(), eb = b.create();
  a.add(ea, Transform, { x: 1 }); b.add(eb, Transform, { x: 2 });
  if (a.columns(Transform).x[entityIndex(ea)] !== 1 || b.columns(Transform).x[entityIndex(eb)] !== 2) fail("worlds share columns");
  a.add(ea, PrevTransform);
  keepPrevious(a);
  a.columns(Transform).x[entityIndex(ea)] = 3;
  a.columns(Transform).heading[entityIndex(ea)] = -3;
  a.columns(PrevTransform).heading[entityIndex(ea)] = 3;
  const o = drawnAt(a, entityIndex(ea), 0.5, { x: 0, y: 0, z: 0, heading: 0 });
  if (o.x !== 2) fail(`drawnAt x ${o.x}`);
  if (Math.abs(Math.abs(o.heading) - (3 + (2 * Math.PI - 6) / 2)) > 1e-5) fail(`drawnAt heading ${o.heading} (should go the short way)`);
  const s = packWorld(a);
  if (!s.columns.Transform || s.columns.PrevTransform) fail("snapshot should hold host components only");
  if ((s.columns.Transform.x as Float32Array)[0] !== 3) fail("snapshot value");
}

if (problems.length) { console.log(`ecs: ${problems.length} problem(s)`); process.exit(1); }
console.log("ecs: ok");
