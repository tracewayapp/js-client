import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rollup } from "rollup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractDebugIdFromSource, isValidDebugId } from "./debug-id";
import { tracewayDebugIds } from "./rollup";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "traceway-debugid-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildFixture(code: string) {
  const input = join(dir, "input.js");
  await writeFile(input, code);
  const bundle = await rollup({ input, plugins: [tracewayDebugIds()] });
  const outDir = join(dir, "out");
  await bundle.write({ dir: outDir, sourcemap: true });
  await bundle.close();
  return {
    code: await readFile(join(outDir, "input.js"), "utf8"),
    map: JSON.parse(await readFile(join(outDir, "input.js.map"), "utf8")),
  };
}

describe("tracewayDebugIds rollup plugin", () => {
  it("injects the runtime snippet, comment and map field with matching ids", async () => {
    const { code, map } = await buildFixture("export const x = 1;\n");

    const runtimeId = extractDebugIdFromSource(code);
    expect(runtimeId).toBeDefined();
    expect(isValidDebugId(runtimeId!)).toBe(true);

    expect(code).toContain("_tracewayDebugIds");
    expect(code).toContain(`//# debugId=${runtimeId}`);
    expect(code.indexOf(`//# debugId=`)).toBeLessThan(
      code.indexOf("//# sourceMappingURL="),
    );
    expect(map.debugId).toBe(runtimeId);
    expect(map.debug_id).toBe(runtimeId);
  });

  it("keeps source maps pointing at original positions", async () => {
    const { map } = await buildFixture(
      "function boom() {\n  throw new Error('x');\n}\nexport { boom };\n",
    );
    expect(map.sources.some((s: string) => s.includes("input.js"))).toBe(true);
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it("is deterministic across rebuilds of identical input", async () => {
    const first = await buildFixture("export const y = 2;\n");
    await rm(join(dir, "out"), { recursive: true, force: true });
    const second = await buildFixture("export const y = 2;\n");
    expect(first.map.debugId).toBe(second.map.debugId);
  });
});

describe("tracewayDebugIds idempotency and asset filtering", () => {
  it("is a no-op on already instrumented code", () => {
    const plugin = tracewayDebugIds();
    const first = plugin.renderChunk("export const z = 3;\n", {
      fileName: "app.js",
    });
    expect(first).not.toBeNull();
    expect(first!.code).toContain("_tracewayDebugIdIdentifier");

    const second = plugin.renderChunk(first!.code, { fileName: "app.js" });
    expect(second).toBeNull();
  });

  it("leaves non-JS assets untouched", () => {
    const plugin = tracewayDebugIds();
    expect(plugin.renderChunk("body { color: red }", { fileName: "styles.css" })).toBeNull();
    expect(plugin.renderChunk("<html></html>", { fileName: "index.html" })).toBeNull();
    expect(plugin.renderChunk("body {}", { fileName: "styles.css?inline" })).toBeNull();
    expect(plugin.renderChunk("{}", { fileName: "manifest.json" })).toBeNull();
  });

  it("processes js files with query suffixes", () => {
    const plugin = tracewayDebugIds();
    const out = plugin.renderChunk("export const q = 1;\n", {
      fileName: "app.js?v=123",
    });
    expect(out).not.toBeNull();
    expect(out!.code).toContain("_tracewayDebugIdIdentifier");
  });
});
