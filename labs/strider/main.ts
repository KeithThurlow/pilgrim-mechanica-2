// The strider lab now lives in the swarm lab (robots; it was the robots lab) (Keith 2026-11-01: "labs robots and lab strider should probably be the
// same lab"): this page forwards its old flags there. ?count=N → ?strider=N, ?beam|?slam|?grab → ?strider=beam|slam|grab,
// ?dist=m → ?striderdist=m; every other flag passes through.
const q = new URLSearchParams(location.search), out = new URLSearchParams();
for (const [k, v] of q) {
  if (k === "count") out.set("strider", v || "1");
  else if (k === "beam" || k === "slam" || k === "grab") out.set("strider", k);
  else if (k === "dist") out.set("striderdist", v);
  else out.set(k, v);
}
if (!out.has("strider")) out.set("strider", "1");
if (!out.has("enemy")) out.set("enemy", "robots");
location.replace(`../swarm/?${out.toString().replace(/=(&|$)/g, "$1")}`);
export {};
