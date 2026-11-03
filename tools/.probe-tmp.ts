import { readFileSync } from "fs";
const b = readFileSync(process.argv[2]); const len = b.readUInt32LE(12); const j = JSON.parse(b.subarray(20, 20 + len).toString());
console.log("materials:", j.materials?.map((m: any) => m.name).join(", "));
for (const n of j.nodes) if (n.mesh !== undefined) { const m = j.meshes[n.mesh]; console.log(n.name, m.primitives.map((p: any) => j.materials?.[p.material]?.name).join("/"), j.accessors[m.primitives[0].attributes.POSITION].max?.map((v:number)=>v.toFixed(2)).join(","), j.accessors[m.primitives[0].attributes.POSITION].min?.map((v:number)=>v.toFixed(2)).join(",")); }
