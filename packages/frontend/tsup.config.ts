import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    platform: "browser",
  },
  {
    entry: { "traceway.iife": "src/index.ts" },
    format: ["iife"],
    globalName: "Traceway",
    platform: "browser",
    noExternal: [/.*/],
    sourcemap: true,
    minify: true,
  },
]);
