import { defineConfig } from "tsup";
import { stripCommentsPlugin } from "../../scripts/strip-comments.mjs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  plugins: [stripCommentsPlugin()],
  external: ["svelte"],
});
