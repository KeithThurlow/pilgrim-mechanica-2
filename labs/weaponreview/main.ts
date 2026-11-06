// The weapon review lab now lives in the weapons lab (Keith 2026-11-06: "we should try to combine the weapon lab and
// the weapon review lab"): this page forwards there, starting on the reviewed weapon with the review panel open. Every
// flag passes through (?w=, ?protos=, ?armour=, ?pen, ?nofire, ?panel=0 and the combat-lab flags work the same there).
const q = new URLSearchParams(location.search);
if (!q.has("w") && !q.has("protos")) q.set("review", "");
if (!q.has("panel")) q.set("panel", "1");
location.replace(`../weapons/?${q.toString().replace(/=(&|$)/g, "$1")}`);
export {};
