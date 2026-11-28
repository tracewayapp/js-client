import { defineConfig } from "tsup";
import { stripCommentsPlugin } from "../../scripts/strip-comments.mjs";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    plugins: [stripCommentsPlugin()],
    platform: "browser",
  },
  {
    entry: { "traceway.iife": "src/index.ts" },
    format: ["iife"],
    globalName: "Traceway",
    platform: "browser",
    noExternal: [/.*/],
    sourcemap: true,
    plugins: [stripCommentsPlugin()],
    minify: true,
  },
]);
