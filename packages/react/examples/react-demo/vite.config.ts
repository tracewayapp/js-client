import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tracewayapp/react": path.resolve(__dirname, "../../src/index.ts"),
      "@tracewayapp/frontend": path.resolve(__dirname, "../../../frontend/src/index.ts"),
      "@tracewayapp/core": path.resolve(__dirname, "../../../core/src/index.ts"),
    },
  },
});
