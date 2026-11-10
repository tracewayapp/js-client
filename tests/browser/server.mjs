import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { encodeServerToAgent } from "../../packages/opamp/dist/index.mjs";
const bundles = {};
for (const framework of ["vanilla", "react", "vue", "svelte"]) {
  const result = await build({
    entryPoints: [
      `tests/browser/fixtures/${framework}.${framework === "react" ? "jsx" : "js"}`,
    ],
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["browser"],
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "svelte",
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
            contents: compile(await readFile(path, "utf8"), {
              filename: path,
              generate: "dom",
            }).js.code,
            loader: "js",
          }));
        },
      },
    ],
  });
  bundles[framework] = result.outputFiles[0].contents;
}
const cases = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
  const match = url.pathname.match(/^\/case\/([^/]+)(.*)$/);
  if (match) {
    const [, id, path] = match;
    if (path === "/control" && req.method === "POST") {
      const next = JSON.parse(body);
      const state = cases.get(id) || { requests: [], config: {} };
      Object.assign(state, next);
      cases.set(id, state);
      return res.end("{}");
    }
    const state = cases.get(id);
    if (!state) {
      res.statusCode = 404;
      return res.end();
    }
    if (path === "/state") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(state));
    }
    state.requests.push({
      path,
      auth: req.headers.authorization,
      body: path.endsWith("/opamp")
        ? body.toString("base64")
        : JSON.parse(body || "{}"),
    });
    if (path.endsWith("/opamp")) {
      if (state.status) {
        res.statusCode = state.status;
        return res.end("not supported");
      }
      const text = JSON.stringify(state.config);
      res.setHeader("Content-Type", "application/x-protobuf");
      return res.end(
        encodeServerToAgent({
          flags: 0,
          capabilities: 3,
          heartbeatIntervalSeconds: 300,
          remoteConfig: {
            configHash: createHash("sha256").update(text).digest(),
            configMap: {
              traceway: {
                body: new TextEncoder().encode(text),
                contentType: "application/json",
              },
            },
          },
        }),
      );
    }
    if (state.status && path !== "/api/report") {
      res.statusCode = 404;
      return res.end();
    }
    return res.end("{}");
  }
  if (url.pathname.endsWith(".js")) {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundles[url.pathname.slice(1, -3)]);
  }
  if (url.pathname === "/application-request") return res.end("{}");
  const framework = url.pathname.slice(1) || "vanilla";
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><title>Traceway ${framework} compatibility</title><main id="app"></main><script src="/${framework}.js"></script>`,
  );
});
server.listen(4318, "127.0.0.1", () =>
  console.log("Framework fixtures: http://localhost:4318/vanilla"),
);
