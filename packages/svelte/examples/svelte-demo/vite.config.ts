import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@tracewayapp/svelte": path.resolve(__dirname, "../../src/index.ts"),
      "@tracewayapp/frontend": path.resolve(__dirname, "../../../frontend/src/index.ts"),
      "@tracewayapp/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
