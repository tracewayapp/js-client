import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "sourcemap-upload",
    environment: "node",
  },
});
