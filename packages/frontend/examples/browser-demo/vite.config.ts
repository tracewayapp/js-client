import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Point to source files directly - Vite handles TypeScript
      "@tracewayapp/frontend": path.resolve(__dirname, "../../src/index.ts"),
      "@tracewayapp/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
