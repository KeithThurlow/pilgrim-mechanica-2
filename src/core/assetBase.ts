// Where public/ files are served from: "/" in dev, the sub-path on GitHub Pages ("/pilgrim-mechanica-2/", set by
// the deploy workflow through VITE_BASE). Guarded so headless checks under node (no import.meta.env) still get "/".
export const ASSET_BASE: string = (() => {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"; } catch { return "/"; }
})();

/** A public/ path ("models/x.glb") as a URL that works under any base. */
export const asset = (path: string) => ASSET_BASE + path.replace(/^\//, "");
