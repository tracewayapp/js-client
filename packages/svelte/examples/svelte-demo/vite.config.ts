import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@traceway/svelte": path.resolve(__dirname, "../../src/index.ts"),
      "@traceway/frontend": path.resolve(__dirname, "../../../frontend/src/index.ts"),
      "@traceway/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
