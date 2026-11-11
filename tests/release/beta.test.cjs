const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const script = path.resolve("release-beta-2.0.0");

function fixture(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traceway-release-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo"),
    remote = path.join(dir, "remote.git"),
    bin = path.join(dir, "bin");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_REGISTRY: path.join(dir, "registry.json"),
    MOCK_LOG: path.join(dir, "calls.jsonl"),
    ...extraEnv,
  };
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Release Test");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  const dirs = ["frontend", "opamp", "core"]; // Deliberately reverse dependency order.
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ workspaces: dirs.map((p) => `packages/${p}`) }),
  );
  fs.writeFileSync(path.join(repo, "package-lock.json"), "{}");
  for (const name of dirs) {
    fs.mkdirSync(path.join(repo, "packages", name), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "packages", name, "package.json"),
      JSON.stringify({
        name: `@tracewayapp/${name}`,
        version: "2.0.0",
        dependencies:
          name === "frontend"
            ? { "@tracewayapp/core": "2.0.0", "@tracewayapp/opamp": "2.0.0" }
            : {},
      }),
    );
  }
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts/browser-regressions.mjs"), "");
  fs.copyFileSync(script, path.join(repo, "release-beta-2.0.0"));
  fs.writeFileSync(path.join(bin, "npx"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(bin, "npm"),
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
let registry = fs.existsSync(process.env.MOCK_REGISTRY) ? JSON.parse(fs.readFileSync(process.env.MOCK_REGISTRY)) : {};
const save = () => fs.writeFileSync(process.env.MOCK_REGISTRY, JSON.stringify(registry));
if (args[0] === 'view') {
  const value = registry[args[1]];
  if (value) console.log(JSON.stringify(value));
  else { console.log(JSON.stringify({ error: { code: process.env.MOCK_VIEW_ERROR || 'E404' } })); process.exitCode = 1; }
} else if (args[0] === 'pack') {
  const data = fs.readFileSync(path.join(args[1], 'package.json'));
  const pkg = JSON.parse(data);
  const filename = pkg.name.split('/')[1] + '.tgz';
  const integrity = 'sha512-' + crypto.createHash('sha512').update(data).digest('base64');
  fs.writeFileSync(path.join(args[args.indexOf('--pack-destination') + 1], filename), data);
  console.log(JSON.stringify([{ filename, integrity, name: pkg.name, version: pkg.version }]));
} else if (args[0] === 'publish') {
  const data = fs.readFileSync(args[1]); const pkg = JSON.parse(data);
  if (process.env.MOCK_FAIL_PUBLISH === pkg.name && !registry.failedOnce) { registry.failedOnce = true; save(); process.exit(1); }
  registry[pkg.name + '@' + pkg.version] = 'sha512-' + crypto.createHash('sha512').update(data).digest('base64'); save();
} else if (args[0] === 'test' && process.env.MOCK_FAIL_TEST) { process.exit(1); }
`,
    { mode: 0o755 },
  );
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("push", "-u", "origin", "main");
  return {
    repo,
    git,
    env,
    run: () =>
      spawnSync(process.execPath, ["release-beta-2.0.0"], {
        cwd: repo,
        env,
        encoding: "utf8",
      }),
    calls: () =>
      fs.existsSync(env.MOCK_LOG)
        ? fs
            .readFileSync(env.MOCK_LOG, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse)
        : [],
  };
}

test("releases every workspace in dependency order under beta and pushes the commit/tag", (t) => {
  const f = fixture(t);
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const publishes = f.calls().filter((a) => a[0] === "publish");
  assert.deepEqual(
    publishes.map((a) => path.basename(a[1])),
    ["core.tgz", "opamp.tgz", "frontend.tgz"],
  );
  for (const args of publishes)
    assert.equal(args[args.indexOf("--tag") + 1], "beta");
  const frontend = JSON.parse(
    fs.readFileSync(path.join(f.repo, "packages/frontend/package.json")),
  );
  assert.equal(frontend.version, "2.0.0-beta.1");
  assert.equal(frontend.dependencies["@tracewayapp/opamp"], "2.0.0-beta.1");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("rev-parse", "HEAD"), f.git("rev-parse", "origin/main"));
  assert.match(
    f.git("ls-remote", "--tags", "origin"),
    /refs\/tags\/v2\.0\.0-beta\.1/,
  );
});

test("resumes a partial publish without publishing an existing version again", (t) => {
  const f = fixture(t, { MOCK_FAIL_PUBLISH: "@tracewayapp/opamp" });
  assert.equal(f.run().status, 1);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("ls-remote", "--tags", "origin"), "");
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(
    f.calls().filter((a) => a[0] === "publish" && a[1].endsWith("core.tgz"))
      .length,
    1,
  );
});

test("failed checks restore versions and publish nothing", (t) => {
  const f = fixture(t, { MOCK_FAIL_TEST: "1" });
  assert.equal(f.run().status, 1);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.calls().filter((a) => a[0] === "publish").length, 0);
  assert.equal(f.git("tag", "--list"), "");
});

test("a registry outage is not treated as a missing version", (t) => {
  const f = fixture(t, { MOCK_VIEW_ERROR: "E503" });
  assert.equal(f.run().status, 1);
  assert.equal(f.calls().filter((a) => a[0] === "publish").length, 0);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("refuses dirty or non-main branches before invoking npm", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "v2");
  assert.equal(f.run().status, 1);
  f.git("switch", "main");
  fs.writeFileSync(path.join(f.repo, "uncommitted"), "work");
  assert.equal(f.run().status, 1);
  assert.deepEqual(f.calls(), []);
});

test("a failed release commit restores the index and manifests", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.repo, ".git/hooks/pre-commit"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o755 },
  );
  assert.equal(f.run().status, 1);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.calls().filter((a) => a[0] === "publish").length, 0);
});

test("resumes after Git push failure without republishing packages", (t) => {
  const f = fixture(t);
  const hook = path.join(f.repo, "..", "remote.git/hooks/pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.equal(f.run().status, 1);
  assert.equal(f.git("ls-remote", "--tags", "origin"), "");
  fs.unlinkSync(hook);
  const r = f.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.calls().filter((a) => a[0] === "publish").length, 3);
  assert.equal(f.git("rev-parse", "HEAD"), f.git("rev-parse", "origin/main"));
});
