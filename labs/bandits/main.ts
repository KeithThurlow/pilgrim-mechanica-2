// This lab now lives in the swarm lab (Keith 2026-11-02: one lab for every swarm, the enemy picked by ?enemy=): the page
// forwards there with ?enemy=bandits and every other flag as it was.
const q = new URLSearchParams(location.search);
if (!q.has("enemy")) q.set("enemy", "bandits");
location.replace(`../swarm/?${q.toString().replace(/=(&|$)/g, "$1")}`);
export {};
