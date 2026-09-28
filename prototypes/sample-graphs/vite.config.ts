import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// MapLibre loads its tile worker from a URL next to its own module, which a
// single file opened from disk doesn't have. Bundle the worker into one
// classic script; the map hands it over as a blob URL (see GeoMap.tsx).
function inlineMaplibreWorker(): Plugin {
  const id = "virtual:maplibre-worker";
  return {
    name: "inline-maplibre-worker",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(source) {
      if (source !== `\0${id}`) return;
      const entry = join(dirname(fileURLToPath(import.meta.resolve("maplibre-gl"))), "maplibre-gl-worker.mjs");
      const out = await build({
        configFile: false,
        logLevel: "silent",
        build: { write: false, minify: true, lib: { entry, formats: ["iife"], name: "maplibreWorker", fileName: "worker" } },
      });
      const chunk = (Array.isArray(out) ? out[0] : out) as { output: { code?: string }[] };
      return `export default ${JSON.stringify(chunk.output[0].code)};`;
    },
  };
}

// Single-file build: dist/index.html carries the app and every baked graph,
// so it opens straight from disk with no server. The View Type docs live in
// docs/view-types/, outside this package.
export default defineConfig({
  plugins: [react(), tailwindcss(), inlineMaplibreWorker(), viteSingleFile()],
  server: { fs: { allow: ["../.."] } },
});
