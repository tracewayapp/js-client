import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "vue",
    environment: "jsdom",
  },
});
