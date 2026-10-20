import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const root = path.dirname(fileURLToPath(import.meta.url));

/** The node_modules package directory a module id belongs to, if any. */
function packageDirectory(id: string): string | undefined {
  const file = id.replace(/^\0/, "").replace(/\?.*$/, "").replace(/\\/g, "/");
  const marker = "/node_modules/";
  const start = file.lastIndexOf(marker);
  if (start < 0) return undefined;
  const parts = file.slice(start + marker.length).split("/");
  const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return path.posix.join(path.relative(root, file.slice(0, start)).replace(/\\/g, "/"), "node_modules", name);
}

/**
 * Writes dist/.vite/bundled-modules.json: the npm packages whose code ends
 * up in dist/assets, for scripts/generate-third-party-notices.mjs. Vite's
 * own helpers (module preload, CommonJS interop) count as the vite package.
 */
function bundledModules(): Plugin {
  return {
    name: "bellpr-bundled-modules",
    apply: "build",
    generateBundle() {
      const directories = new Set<string>();
      for (const id of this.getModuleIds()) {
        const directory = packageDirectory(id);
        if (directory) directories.add(directory);
        else if (/^\0(vite\/|commonjsHelpers)/.test(id))
          directories.add("node_modules/vite");
      }
      const packages = [...directories].sort().map((directory) => ({
        name: directory.slice(directory.lastIndexOf("node_modules/") + 13),
        path: directory,
      }));
      this.emitFile({
        type: "asset",
        fileName: ".vite/bundled-modules.json",
        source: `${JSON.stringify({ packages }, null, 2)}\n`,
      });
    },
  };
}

/**
 * Stable vendor code and the sample project get chunks of their own, which
 * browsers keep cached across releases that only change the app. The
 * Markdown stack is loaded on demand only. The icons share one chunk, so
 * the icons that only lazily loaded views use do not each become a chunk
 * of a few hundred bytes.
 */
function manualChunks(id: string): string | undefined {
  const file = id.replace(/\\/g, "/");
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(file)) return "react";
  if (file.includes("/node_modules/lucide-react/")) return "icons";
  if (
    /\/node_modules\/(micromark[^/]*|mdast-util-[^/]+|unist-util-[^/]+)\//.test(
      file,
    )
  )
    return "markdown";
  // The sample's zh-TW text loads with the zh-TW dictionary (src/locales).
  if (file.includes("/src/demo/") && !file.endsWith("/src/demo/zh-TW.ts"))
    return "demo";
  return undefined;
}

export default defineConfig({
  plugins: [react(), bundledModules()],
  // Worktrees that share node_modules must not share Vite's optimizer cache.
  cacheDir: ".vite-cache",
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    // The stylesheets use color-mix(), which needs Chrome and Edge 111,
    // Firefox 113 or Safari 16.2, so the app cannot run on older browsers.
    // Scripts and styles keep the syntax these versions support instead of
    // being rewritten for older ones (Vite's default target).
    target: ["chrome111", "edge111", "firefox113", "safari16.2"],
    // The largest chunk's budget in kB (minified, before gzip); the gzip
    // budgets live in scripts/check-pack.mjs.
    chunkSizeWarningLimit: 450,
    // One stylesheet. Split per lazy view, each of the six small ones was
    // compressed on its own and the CSS took 3.6 kB more gzip (45.1 instead
    // of 41.5 kB); in one file it still comes after the shell's rules, as
    // the lazy files did.
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks } },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:4311", changeOrigin: true } },
  },
});
