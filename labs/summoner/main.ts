// This lab now lives in the swarm lab (Keith 2026-11-02): the page forwards there with ?summon (your units) and the robots,
// on the summoner lab's waves (60 robots in packs of 20 every 6 s from 90 m, your guns at their own damage). Its flags
// carry over: ?drones ?companions ?replicas ?comps ?scrappers ?send ?still ?summoner ?dismissat as they were; ?enemies=N and ?pack=N become
// the robots' wave sliders. Any ?set= given wins.
const q = new URLSearchParams(location.search);
if (!q.has("enemy")) q.set("enemy", "robots");
q.set("summon", "");
const set: Record<string, string> = { robotSwarmSize: "60", robotGroupSize: "20", robotGroupEvery: "6", robotSpawnFrom: "90", labGunDamage: "1", striderCount: "0" };
if (q.has("enemies")) { set.robotSwarmSize = String(Number(q.get("enemies")) || 0); q.delete("enemies"); }
if (q.has("pack")) { set.robotGroupSize = String(Number(q.get("pack")) || 20); q.delete("pack"); }
for (const kv of (q.get("set") ?? "").split(",")) { const [k, v] = kv.split(":"); if (k && v !== undefined) set[k] = v; }
q.set("set", Object.entries(set).map(([k, v]) => `${k}:${v}`).join(","));
location.replace(`../swarm/?${q.toString().replace(/=(&|$)/g, "$1").replace(/%3A/g, ":").replace(/%2C/g, ",")}`);
export {};
