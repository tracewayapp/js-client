import { defineConfig } from "tsup";
import { stripCommentsPlugin } from "../../scripts/strip-comments.mjs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  plugins: [stripCommentsPlugin()],
  external: ["react", "react-dom"],
  // The provider and the hooks are client components: with the directive, the Next.js App Router accepts
  // <TracewayProvider> in a server layout without a wrapper file of the app's.
  banner: { js: '"use client";' },
});
