import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "svelte",
    environment: "jsdom",
  },
});
