import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Point to source files directly - Vite handles TypeScript
      "@traceway/frontend": path.resolve(__dirname, "../../src/index.ts"),
      "@traceway/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
