import { defineConfig } from "vitest/config";

// Node 25+ ships its own localStorage global. Without --localstorage-file it is
// undefined, and Vitest keeps it instead of jsdom's storage. Turn Node's Web
// Storage off in test workers so jsdom provides localStorage and sessionStorage.
const disableNodeWebStorage = "--no-experimental-webstorage";
const execArgv = process.allowedNodeEnvironmentFlags.has(disableNodeWebStorage)
  ? [disableNodeWebStorage]
  : [];

export default defineConfig({
  test: {
    poolOptions: {
      forks: { execArgv },
    },
  },
});
