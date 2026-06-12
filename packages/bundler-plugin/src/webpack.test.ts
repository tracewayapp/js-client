import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webpack from "webpack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractDebugIdFromSource, isValidDebugId } from "./debug-id";
import { TracewayDebugIdsWebpackPlugin } from "./webpack";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "traceway-debugid-wp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function runWebpack(config: webpack.Configuration): Promise<webpack.Stats> {
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) return reject(err);
      if (stats?.hasErrors()) {
        return reject(new Error(stats.toString({ errors: true })));
      }
      resolve(stats!);
    });
  });
}

async function buildFixture(code: string) {
  const entry = join(dir, "entry.js");
  await writeFile(entry, code);
  const outDir = join(dir, "out");
  await runWebpack({
    mode: "production",
    entry,
    devtool: "source-map",
    output: { path: outDir, filename: "main.js" },
    plugins: [new TracewayDebugIdsWebpackPlugin()],
  });
  return {
    code: await readFile(join(outDir, "main.js"), "utf8"),
    map: JSON.parse(await readFile(join(outDir, "main.js.map"), "utf8")),
  };
}

describe("TracewayDebugIdsWebpackPlugin", () => {
  it("injects the runtime snippet, comment and map field with matching ids", async () => {
    const { code, map } = await buildFixture(
      "export function boom() { throw new Error('x'); }\nconsole.log(boom);\n",
    );

    const runtimeId = extractDebugIdFromSource(code);
    expect(runtimeId).toBeDefined();
    expect(isValidDebugId(runtimeId!)).toBe(true);

    expect(code).toContain("_tracewayDebugIds");
    expect(code).toContain(`//# debugId=${runtimeId}`);
    expect(map.debugId).toBe(runtimeId);
    expect(map.debug_id).toBe(runtimeId);
  });

  it("keeps source maps pointing at original sources", async () => {
    const { map } = await buildFixture(
      "export function boom() { throw new Error('x'); }\nconsole.log(boom);\n",
    );
    expect(map.sources.some((s: string) => s.includes("entry.js"))).toBe(true);
    expect(map.mappings.length).toBeGreaterThan(0);
  });
});
