import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
await p.goto("http://localhost:5199/" + process.argv[2]);
await p.waitForTimeout(Number(process.argv[4] ?? 20000));
await p.screenshot({ path: process.argv[3] });
await b.close();
