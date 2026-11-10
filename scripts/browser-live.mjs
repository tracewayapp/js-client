import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Build both backends in isolated modules; never alter a server checkout or use its data.
const sources = [
  process.env.TRACEWAY_OLD_SOURCE,
  process.env.TRACEWAY_NEW_SOURCE,
];
if (sources.some((source) => !source))
  throw new Error(
    "Set TRACEWAY_OLD_SOURCE and TRACEWAY_NEW_SOURCE to old and OpAMP Traceway repository roots",
  );
await mkdir(".cache", { recursive: true });
const directory = await mkdtemp(resolve(".cache/browser-live-"));
const servers = [];
// Fail before building if a fixed test port belongs to another process.
for (const port of [4330, 4331]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
try {
  for (let index = 0; index < sources.length; index++) {
    const source = resolve(sources[index]);
    const cwd = join(directory, index ? "new" : "old");
    await mkdir(cwd);
    await writeFile(
      join(cwd, "go.mod"),
      `module browsercompat\n\ngo 1.26.2\n\nrequire github.com/tracewayapp/traceway/backend v0.0.0\nreplace github.com/tracewayapp/traceway/backend => ${JSON.stringify(join(source, "backend"))}\nreplace github.com/tracewayapp/traceway/cli => ${JSON.stringify(join(source, "cli"))}\n`,
    );
    await writeFile(
      join(cwd, "main.go"),
      `package main\nimport backend "github.com/tracewayapp/traceway/backend"\nfunc main() { backend.Run(backend.WithPort(${4330 + index}), backend.WithSQLitePath("data.db"), backend.WithDefaultProject("Browser compatibility", "react", "browser-test-token"), backend.WithDefaultUser("browser@example.test", "browser-test-password")) }\n`,
    );
    const env = { ...process.env, GOWORK: "off", GOTMPDIR: cwd };
    await run("go", ["mod", "tidy"], { cwd, env });
    await run(
      "go",
      ["build", "-p", "2", "-ldflags=-s -w", "-o", "server", "."],
      { cwd, env },
    );
    const server = spawn(join(cwd, "server"), [], { cwd, stdio: "ignore" });
    servers.push(server);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null)
        throw new Error("Traceway server exited during startup");
      try {
        await fetch(`http://127.0.0.1:${4330 + index}/`);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!ready) throw new Error("Traceway server did not start");
  }
  await run("npx", ["playwright", "test", "live.spec.ts"], {
    env: {
      ...process.env,
      TRACEWAY_BROWSER_OLD_URL: "http://127.0.0.1:4330",
      TRACEWAY_BROWSER_NEW_URL: "http://127.0.0.1:4331",
    },
  });
} finally {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          if (server.exitCode !== null) return resolve();
          server.once("exit", resolve);
          server.kill("SIGTERM");
        }),
    ),
  );
  console.log(`Stopped live test servers. Test data: ${directory}`);
}
