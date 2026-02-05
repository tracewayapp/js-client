import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@tracewayapp/vue": path.resolve(__dirname, "../../src/index.ts"),
      "@tracewayapp/frontend": path.resolve(__dirname, "../../../frontend/src/index.ts"),
      "@tracewayapp/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
