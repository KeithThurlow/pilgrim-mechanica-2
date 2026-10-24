import { defineConfig } from "vite";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { reportPlugin } from "./tools/report-plugin";

// Every folder in labs/ with an index.html is its own page, so adding a lab never touches this file.
const root = import.meta.dirname;
const labs = Object.fromEntries(
  readdirSync(resolve(root, "labs"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(root, "labs", d.name, "index.html")))
    .map((d) => [d.name, resolve(root, "labs", d.name, "index.html")]),
);

export default defineConfig({
  // The Report box in every lab posts here in dev (tools/report-plugin.ts).
  plugins: [reportPlugin(root)],
  server: { host: true, open: "/" },
  build: {
    target: "es2022",
    rollupOptions: { input: { main: resolve(root, "index.html"), ...labs } },
  },
});
