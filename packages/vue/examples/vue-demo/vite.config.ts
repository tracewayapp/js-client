import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@traceway/vue": path.resolve(__dirname, "../../src/index.ts"),
      "@traceway/frontend": path.resolve(__dirname, "../../../frontend/src/index.ts"),
      "@traceway/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
