import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/vite.ts",
    "src/rollup.ts",
    "src/webpack.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  platform: "node",
  target: "node18",
});
