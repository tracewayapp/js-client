import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { encodeServerToAgent } from "../packages/opamp/dist/index.mjs";

const bundle = await readFile(
  new URL("../packages/frontend/dist/traceway.iife.global.js", import.meta.url),
);
let document = { schemaVersion: 1 };
let failLogs = false;
const logs = [];
const recordings = [];
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === "/sdk.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle);
  }
  if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    requests.push({
      path: req.url,
      auth: req.headers.authorization,
      body: body.toString(),
    });
    if (req.url.endsWith("/opamp")) {
      const text = JSON.stringify(document);
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
    if (req.url.endsWith("/logs")) {
      if (failLogs) {
        res.statusCode = 400;
        return res.end();
      }
      const data = JSON.parse(body);
      for (const resource of data.resourceLogs ?? [])
        for (const scope of resource.scopeLogs ?? [])
          logs.push(...(scope.logRecords ?? []));
    }
    if (req.url.endsWith("/recordings"))
      recordings.push(...JSON.parse(body).segments);
    res.setHeader("Content-Type", "application/json");
    return res.end("{}");
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><title>Traceway SDK regression fixture</title><h1>SDK regression fixture</h1><input id="secret"><button id="action">Action</button><script src="/sdk.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const init = async (options = {}) => {
  await page.goto(origin);
  await page.evaluate((options) => {
    Traceway.init(`browser@${location.origin}`, {
      captureResourceTiming: false,
      captureWebVitals: false,
      exportDelayMs: 60_000,
      ...options,
    });
  }, options);
  await page.evaluate(() => Traceway.refreshConfig());
};
const flush = () => page.evaluate(() => Traceway.flush());
const names = () => logs.map((log) => log.eventName);
const apply = async (next) => {
  document = next;
  await page.evaluate(() => Traceway.refreshConfig());
};
const check = async (name, run) => {
  await run();
  console.log(`PASS ${name}`);
};
try {
  await init();
  await check(
    "default destination preserves Traceway auth and session correlation",
    async () => {
      await page.evaluate(() =>
        Traceway.captureMessage("default-session-check"),
      );
      await flush();
      const session = await page.evaluate(() =>
        Traceway.getClient().currentSessionId(),
      );
      const sent = requests.filter((r) => r.path.endsWith("/logs"));
      assert(sent.length > 0);
      assert(
        sent.every(
          (r) => r.path === "/api/otel/v1/logs" && r.auth === "Bearer browser",
        ),
      );
      for (const request of sent) {
        const records = JSON.parse(request.body).resourceLogs.flatMap((r) =>
          r.scopeLogs.flatMap((s) => s.logRecords),
        );
        for (const record of records)
          assert.equal(
            record.attributes.find((a) => a.key === "session.id")?.value
              .stringValue,
            session,
            record.eventName,
          );
      }
    },
  );
  await check(
    "healthy defaults, stable baseline and error burst protection",
    async () => {
      const replayStart = recordings.length;
      await page.evaluate(() => Traceway.track("healthy-default-buffer"));
      await flush();
      assert(!names().includes("healthy-default-buffer"));
      assert.equal(recordings.length, replayStart);
      assert(names().includes("session.start"));
      await apply({ sessions: { baselineSampleRate: 1 } });
      const session = await page.evaluate(() =>
        Traceway.getClient().currentSessionId(),
      );
      await page.evaluate(() => Traceway.track("healthy-baseline"));
      await flush();
      assert(names().includes("healthy-baseline"));
      await init();
      assert.equal(
        await page.evaluate(() => Traceway.getClient().currentSessionId()),
        session,
      );
      await page.evaluate(() => Traceway.track("healthy-baseline-reload"));
      await flush();
      assert(names().includes("healthy-baseline-reload"));
      assert.equal(recordings.length, replayStart);
      await apply({ sessions: { baselineSampleRate: 0 } });
      const errorStart = logs.filter(
        (log) => log.eventName === "exception",
      ).length;
      await page.evaluate(() => {
        const error = new Error("burst");
        for (let i = 0; i < 100; i++) Traceway.captureException(error);
      });
      await flush();
      assert.equal(
        logs.filter((log) => log.eventName === "exception").length - errorStart,
        1,
      );
      assert(recordings.length > replayStart);
      const clips = recordings.length;
      await page.evaluate(() =>
        Traceway.captureException(new Error("within clip cooldown")),
      );
      await flush();
      assert.equal(
        logs.filter((log) => log.eventName === "exception").length - errorStart,
        2,
      );
      assert.equal(recordings.length, clips);
    },
  );
  await check(
    "capture cancellation takes effect in a running browser",
    async () => {
      await apply({
        captures: [
          {
            id: "cancel",
            until: new Date(Date.now() + 60_000).toISOString(),
            replay: true,
          },
        ],
      });
      await page.evaluate(() => Traceway.track("during-capture"));
      await flush();
      assert(names().includes("during-capture"));
      await apply({ captures: [] });
      await page.evaluate(() => Traceway.track("after-cancel"));
      await flush();
      assert(!names().includes("after-cancel"));
    },
  );
  await check(
    "new hard limits suppress buffered and queued exports",
    async () => {
      await page.evaluate(() => {
        Traceway.track("restricted-buffer");
        Traceway.captureMessage("restricted-queue");
      });
      await apply({ limits: { signals: { custom: "off", messages: "off" } } });
      await page.evaluate(() =>
        Traceway.captureException(new Error("flush restricted context")),
      );
      await flush();
      assert(!names().includes("restricted-buffer"));
      assert(!logs.some((log) => log.body?.stringValue === "restricted-queue"));
    },
  );
  await check(
    "real rrweb masks inputs after a remote privacy update",
    async () => {
      await apply({ replay: { maskAllInputs: false } });
      await page.locator("#secret").fill("before-mask-secret");
      await apply({ replay: { maskAllInputs: true } });
      await page.locator("#secret").fill("after-mask-secret");
      await page.waitForTimeout(5100);
      const start = recordings.length;
      await page.evaluate(() =>
        Traceway.captureException(new Error("mask check")),
      );
      await flush();
      assert(recordings.length > start, "expected a real rrweb clip");
      const body = JSON.stringify(recordings.slice(start));
      assert(!body.includes("after-mask-secret"));
      assert(!body.includes("before-mask-secret"));
    },
  );
  await check(
    "zero lookback does not upload a previous replay clip",
    async () => {
      const start = recordings.length;
      await apply({
        captures: [
          {
            id: "zero-replay",
            until: new Date(Date.now() + 60_000).toISOString(),
            lookbackSeconds: 0,
            replay: true,
          },
        ],
      });
      await flush();
      assert.equal(recordings.length, start);
      await apply({ captures: [] });
    },
  );
  await check("lookback survives three full page navigations", async () => {
    await page.evaluate(() => Traceway.track("page-a-context"));
    await init();
    await page.evaluate(() => Traceway.track("page-b-context"));
    await init();
    await page.evaluate(() =>
      Traceway.captureException(new Error("third page trigger")),
    );
    await flush();
    assert(names().includes("page-a-context"), "page A context was lost");
    assert(names().includes("page-b-context"), "page B context was lost");
  });
  await check("final streaming replay is uploaded on pagehide", async () => {
    await apply({ replay: { mode: "stream" } });
    await page.locator("#secret").fill("closing page");
    const start = recordings.length;
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide")),
    );
    await flush();
    assert(recordings.length > start);
  });
  await init();
  await check(
    "outbox recovers without reloading or hiding the page",
    async () => {
      failLogs = true;
      await page.evaluate(() => Traceway.captureMessage("recover-online"));
      await flush();
      failLogs = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForFunction(async () => {
        const db = await new Promise((resolve) => {
          const req = indexedDB.open("traceway");
          req.onsuccess = () => resolve(req.result);
        });
        return await new Promise((resolve) => {
          const req = db.transaction("outbox").objectStore("outbox").count();
          req.onsuccess = () => {
            db.close();
            resolve(req.result === 0);
          };
        });
      });
      assert(logs.some((log) => log.body?.stringValue === "recover-online"));
    },
  );
  await check(
    "external OTLP destination covers live, restored and retried data while control stays on Traceway",
    async () => {
      document = { schemaVersion: 1 };
      const telemetry = {
        url: origin + "/external",
        headers: { Authorization: "Bearer external-only" },
      };
      await init({ telemetry });
      const start = requests.length;
      await page.evaluate(() =>
        Traceway.track("external-buffer-before-navigation"),
      );
      await init({ telemetry });
      await page.evaluate(async () => {
        await fetch("/application-request");
        Traceway.captureException(new Error("external-trigger"));
      });
      await flush();
      assert(
        requests
          .slice(start)
          .some(
            (r) =>
              r.path === "/external/v1/logs" &&
              r.body.includes("external-buffer-before-navigation"),
          ),
      );
      await apply({ signals: { network: { mode: "stream" } } });
      await page.evaluate(async () => {
        await fetch("/another-application-request");
      });
      await expect
        .poll(async () => {
          await flush();
          return requests
            .slice(start)
            .some((r) => r.path === "/external/v1/traces");
        })
        .toBe(true);
      failLogs = true;
      await page.evaluate(() => {
        Traceway.setAttribute("retry.context", "metadata-retry");
        Traceway.captureMessage("external-retry");
      });
      await flush();
      const retryStart = requests.length;
      failLogs = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect
        .poll(() =>
          requests
            .slice(retryStart)
            .some(
              (r) =>
                r.path === "/external/v1/logs" &&
                r.body.includes("external-retry"),
            ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          requests
            .slice(retryStart)
            .some(
              (r) =>
                r.path === "/api/otel/v1/logs" &&
                r.body.includes("metadata-retry"),
            ),
        )
        .toBe(true);
      const sent = requests.slice(start);
      assert(
        sent.some(
          (r) =>
            r.path === "/api/otel/v1/logs" &&
            r.body.includes("traceway.session.update"),
        ),
        "Traceway must receive session metadata to open replay",
      );
      const session = await page.evaluate(() =>
        Traceway.getClient().currentSessionId(),
      );
      for (const request of sent.filter(
        (r) => r.path.endsWith("/logs") || r.path.endsWith("/traces"),
      )) {
        const payload = JSON.parse(request.body);
        const records = payload.resourceLogs
          ? payload.resourceLogs.flatMap((r) =>
              r.scopeLogs.flatMap((s) => s.logRecords),
            )
          : payload.resourceSpans.flatMap((r) =>
              r.scopeSpans.flatMap((s) => s.spans),
            );
        for (const record of records)
          assert.equal(
            record.attributes.find((a) => a.key === "session.id")?.value
              .stringValue,
            session,
            record.eventName ?? record.name,
          );
      }
      assert(
        sent.some(
          (r) => r.path === "/api/otel/v1/opamp" && r.auth === "Bearer browser",
        ),
      );
      assert(
        sent
          .filter((r) => r.path.endsWith("/logs") || r.path.endsWith("/traces"))
          .every(
            (r) =>
              (r.path.startsWith("/external/") &&
                r.auth === "Bearer external-only") ||
              (r.path === "/api/otel/v1/logs" &&
                r.auth === "Bearer browser" &&
                JSON.parse(r.body).resourceLogs.every((resource) =>
                  resource.scopeLogs.every((scope) =>
                    scope.logRecords.every((log) =>
                      [
                        "session.start",
                        "session.end",
                        "traceway.session.update",
                      ].includes(log.eventName),
                    ),
                  ),
                )),
          ),
      );
    },
  );
  assert.deepEqual(errors, []);
  console.log("Browser regression checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
