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
// A real router in a real browser, for the check that views are named without any code in the app.
const vendor = {
  "/vue.js": "../node_modules/vue/dist/vue.global.prod.js",
  "/vue-router.js": "../node_modules/vue-router/dist/vue-router.global.prod.js",
  "/rrweb.js": "../node_modules/rrweb/dist/rrweb.umd.min.cjs",
};
let document = { schemaVersion: 1 };
let failLogs = false;
let metricsStatus = 200;
const metricPayloads = [];
const logs = [];
const recordings = [];
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === "/sdk.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(bundle);
  }
  if (vendor[req.url]) {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(await readFile(new URL(vendor[req.url], import.meta.url)));
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
    if (req.url.endsWith("/metrics")) {
      metricPayloads.push(JSON.parse(body));
      res.statusCode = metricsStatus;
      return res.end("{}");
    }
    if (req.url.endsWith("/recordings"))
      recordings.push(...JSON.parse(body).segments);
    res.setHeader("Content-Type", "application/json");
    return res.end("{}");
  }
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/masking")
    return res.end(
      '<!doctype html><title>Traceway mask fixture</title>' +
        '<p class="traceway-mask">masked-paragraph-secret</p>' +
        '<div class="traceway-mask"><img src="/masked-image-secret.png" width="40" height="30"></div>' +
        '<div class="traceway-mask"><iframe srcdoc="private inline note"></iframe></div>' +
        '<img id="preview" src="data:image/png;base64,cHJldmlldw==" data-lazy-src="data:image/png;base64,bGF6eQ==">' +
        '<style>.preview-card { background-image: url(data:image/png;base64,Y29sb3I=); color: blue; }</style>' +
        '<iframe srcdoc="&lt;img src=data:image/png;base64,Y2hpbGQ=&gt;"></iframe>' +
        '<div class="traceway-blank" style="width:120px;height:60px">blank-box-secret</div>' +
        '<p class="rr-mask">rr-mask-secret</p><p>visible-mask-fixture</p><script src="/sdk.js"></script>',
    );
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
    "real rrweb masks traceway-mask text and images and blanks traceway-blank",
    async () => {
      const maskContext = await browser.newContext();
      const maskPage = await maskContext.newPage();
      maskPage.on("pageerror", (error) => errors.push(error.message));
      try {
        await maskPage.goto(`${origin}/masking`);
        await maskPage.evaluate(() =>
          Traceway.init(`browser@${location.origin}`, {
            captureResourceTiming: false,
            captureWebVitals: false,
            exportDelayMs: 60_000,
          }),
        );
        await maskPage.evaluate(() => Traceway.refreshConfig());
        await maskPage.evaluate(async () => {
          document.querySelector("iframe").srcdoc = "edited private inline note";
          document.querySelector("#preview").srcset = "data:image/png;base64,dXBkYXRl 2x";
          document.querySelector("p.rr-mask").after(document.createTextNode("updated public fixture"));
          const code = document.createElement("code");
          code.textContent = "initial public note";
          document.body.append(code);
          await new Promise(requestAnimationFrame);
          code.firstChild.data = "literal data:image/png example in application text";
          await new Promise(resolve => setTimeout(resolve, 50));
        });
        const session = await maskPage.evaluate(() =>
          Traceway.currentSessionId(),
        );
        await maskPage.evaluate(() =>
          Traceway.captureException(new Error("mask class check")),
        );
        await maskPage.evaluate(() => Traceway.flush());
        const clip = recordings.filter((r) => r.sessionId === session);
        assert(clip.length > 0, "expected a real rrweb clip");
        const body = JSON.stringify(clip);
        assert(body.includes("visible-mask-fixture"));
        assert(body.includes("updated public fixture"));
        assert(body.includes("literal data:image/png example in application text"));
        for (const original of ["private inline note", "cHJldmlldw==", "bGF6eQ==", "dXBkYXRl", "Y29sb3I=", "Y2hpbGQ="])
          assert(!body.includes(original));
        for (const secret of [
          "masked-paragraph-secret",
          "masked-image-secret",
          "blank-box-secret",
          "rr-mask-secret",
        ])
          assert(!body.includes(secret), secret);
        assert(body.includes("*".repeat("masked-paragraph-secret".length)));
        const elements = [];
        const walk = (node) => {
          if (node.type === 2) elements.push(node);
          for (const child of node.childNodes ?? []) walk(child);
        };
        for (const event of clip.flatMap((segment) => segment.events))
          if (event.type === 2) walk(event.data.node);
        const box = (tag, width, height) =>
          elements.some(
            (node) =>
              node.tagName === tag &&
              node.attributes.rr_width === width &&
              node.attributes.rr_height === height &&
              node.attributes.src === undefined &&
              node.childNodes.length === 0,
          );
        assert(box("div", "120px", "60px"), "traceway-blank is not a blocked box");
        assert(box("img", "40px", "30px"), "a masked image is not a blocked box");
      } finally {
        await maskContext.close();
      }
    },
  );
  await check("real Chromium thumbnails fall back to a playable DOM segment above the image allowance", async () => {
    const previousConfig = document;
    document = { replay: { images: "always" } };
    try {
      for (const count of [1, 12]) {
        const photoContext = await browser.newContext();
        try {
          const tab = await photoContext.newPage();
          await tab.goto(origin);
          const session = await tab.evaluate(async (count) => {
            Traceway.init({ token: "browser", baseUrl: location.origin, collection: { replay: { images: "always" } } });
            await Traceway.refreshConfig();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 256;
            const ctx = canvas.getContext("2d");
            const pixels = ctx.createImageData(256, 256);
            for (let i = 0; i < pixels.data.length; i += 65536)
              crypto.getRandomValues(pixels.data.subarray(i, i + 65536));
            for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
            ctx.putImageData(pixels, 0, 0);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            const url = URL.createObjectURL(blob);
            const lazyImage = async name => {
              const img = new Image();
              img.alt = name;
              document.body.append(img);
              await new Promise(requestAnimationFrame);
              img.src = url;
              await img.decode();
              await new Promise(requestAnimationFrame);
              if (img.width !== 256 || img.height !== 256) throw Error("fixture image has the wrong size");
            };
            if (count > 1) await lazyImage("lazy-before-cap");
            for (let i = 0; i < count; ++i) {
              const img = new Image();
              img.alt = "preview-" + i;
              img.src = url;
              await img.decode();
              document.body.append(img);
              await new Promise(requestAnimationFrame);
            }
            if (count > 1) await lazyImage("lazy-after-cap");
            Traceway.captureException(new Error("image allowance fixture"));
            await Traceway.flush();
            URL.revokeObjectURL(url);
            return Traceway.currentSessionId();
          }, count);
          const clip = recordings.filter(segment => segment.sessionId === session);
          const body = JSON.stringify(clip);
          assert(body.includes("SDK regression fixture") && body.includes("preview-" + (count - 1)));
          const imageBytes = [...body.matchAll(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g)]
            .reduce((total, match) => total + match[0].length, 0);
          console.log(`  ${count} photo(s): ${imageBytes} inline image bytes, ${Buffer.byteLength(body)} replay JSON bytes`);
          if (count === 1) assert(body.includes("data:image/jpeg;base64,"), "an affordable thumbnail should be recorded");
          else {
            assert(!body.includes("data:image/") && !body.includes("blob:" + origin), "oversized image data survived in the wireframe");
            assert(body.includes('"rr_width":"256px"'), "missing image placeholder");
            const playback = await photoContext.newPage();
            await playback.addScriptTag({ url: origin + "/rrweb.js" });
            const events = clip.flatMap(segment => segment.events);
            const frame = await playback.evaluateHandle(events => {
              const player = new rrweb.Replayer(events, { root: document.body, showWarning: false });
              player.pause(events.at(-1).timestamp - events[0].timestamp + 1);
              return player.iframe;
            }, events);
            const replayFrame = await frame.asElement().contentFrame();
            await expect(replayFrame.getByRole("heading", { name: "SDK regression fixture" })).toBeVisible();
            const placeholder = replayFrame.locator('img[alt="preview-11"]');
            await expect(placeholder).toHaveCSS("width", "256px");
            await expect(placeholder).toHaveCSS("height", "256px");
            for (const label of ["lazy-before-cap", "lazy-after-cap"]) {
              const lazy = replayFrame.locator(`img[alt="${label}"]`);
              await expect(lazy).toHaveCSS("width", "256px");
              await expect(lazy).toHaveCSS("height", "256px");
            }
          }
        } finally {
          await photoContext.close();
        }
      }
    } finally {
      document = previousConfig;
    }
  });
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
      await apply({ signals: { network: { mode: "stream" }, custom: { mode: "stream" } } });
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
        Traceway.track("external-retry");
        Traceway.captureMessage("traceway-issue-retry");
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
      assert(requests.slice(start).some(r => r.path === "/api/otel/v1/logs" && r.body.includes("external-trigger")));
      assert(!requests.slice(start).some(r => r.path === "/external/v1/logs" && r.body.includes("external-trigger")));
      assert(requests.slice(retryStart).some(r => r.path === "/api/otel/v1/logs" && r.body.includes("traceway-issue-retry")));
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
                        "exception",
                        "traceway.message",
                        "traceway.config.applied",
                        "traceway.trigger.fired",
                        "traceway.capture.started",
                        "traceway.collection.health",
                      ].includes(log.eventName),
                    ),
                  ),
                )),
          ),
      );
    },
  );
  await check(
    "collection budget survives reload and interaction context stays isolated",
    async () => {
      const budgetPage = await browser.newPage();
      try {
        const initialize = async () => {
          await budgetPage.goto(origin);
          await budgetPage.evaluate(() =>
            Traceway.init(`budget@${location.origin}`, {
              baselineSampleRate: 1,
              collectionLimits: { maxEvents: 2 },
              captureLogs: false,
              captureNavigation: false,
              captureUserActions: false,
              captureWebVitals: false,
              captureResourceTiming: false,
              sessionRecording: false,
              remoteConfig: false,
              exportDelayMs: 60000,
            }),
          );
        };
        await initialize();
        await budgetPage.evaluate(async () => {
          Traceway.track("budget-one");
          Traceway.track("budget-two");
          Traceway.track("budget-dropped");
          Traceway.captureException(new Error("budget-still-reports-errors"));
          await Traceway.flush();
        });
        assert(names().includes("budget-one"));
        assert(names().includes("budget-two"));
        assert(!names().includes("budget-dropped"));
        await initialize();
        await budgetPage.evaluate(async () => {
          Traceway.track("budget-after-reload");
          await Traceway.flush();
        });
        assert(!names().includes("budget-after-reload"));
      } finally {
        await budgetPage.close();
      }
      const interactionPage = await browser.newPage();
      try {
        await interactionPage.goto(origin);
        const result = await interactionPage.evaluate(async () => {
          Traceway.init(`interaction@${location.origin}`, {
            remoteConfig: false,
            baselineSampleRate: 1,
            sessionRecording: false,
            captureWebVitals: false,
            captureResourceTiming: false,
          });
          const checkout = Traceway.startInteraction("checkout");
          const search = Traceway.startInteraction("search");
          await checkout.run(() => fetch("/checkout"));
          await Promise.resolve();
          checkout.captureException(new Error("bound-checkout-error"));
          search.bind(() =>
            Traceway.captureException(new Error("bound-search-error")),
          )();
          Traceway.captureException(new Error("unrelated-error"));
          checkout.end();
          search.end();
          await Traceway.flush();
          return { checkout: checkout.traceId, search: search.traceId };
        });
        const find = (text) =>
          logs.find((log) =>
            log.attributes?.some(
              (attr) =>
                attr.key === "exception.message" &&
                attr.value.stringValue === text,
            ),
          );
        assert.equal(find("bound-checkout-error").traceId, result.checkout);
        assert.equal(find("bound-search-error").traceId, result.search);
        assert(!find("unrelated-error").traceId);
        const spans = requests
          .filter((request) => request.path.endsWith("/traces"))
          .flatMap((request) =>
            JSON.parse(request.body).resourceSpans.flatMap((resource) =>
              resource.scopeSpans.flatMap((scope) => scope.spans),
            ),
          );
        const parent = spans.find(
          (span) =>
            span.name === "checkout" && span.traceId === result.checkout,
        );
        assert(parent);
        assert(
          spans.some(
            (span) =>
              span.traceId === result.checkout &&
              span.parentSpanId === parent.spanId,
          ),
        );
      } finally {
        await interactionPage.close();
      }
    },
  );
  await check(
    "long tasks and route timing stay off until remote config streams them",
    async () => {
      const perfPage = await browser.newPage();
      const attribute = (log, key) => {
        const value = log.attributes?.find((attr) => attr.key === key)?.value;
        return (
          value?.stringValue ?? Number(value?.intValue ?? value?.doubleValue)
        );
      };
      const exercise = (path) =>
        perfPage.evaluate(async (path) => {
          // The browser does not time a script DevTools evaluates, so the block runs in a task of the page.
          await new Promise((resolve) =>
            setTimeout(() => {
              const until = performance.now() + 200;
              while (performance.now() < until);
              resolve();
            }, 0),
          );
          history.pushState(null, "", path);
          await fetch("/data");
          await new Promise((resolve) => setTimeout(resolve, 300));
          document.body.appendChild(document.createElement("section"));
          await new Promise((resolve) => setTimeout(resolve, 1200));
          await Traceway.flush();
        }, path);
      try {
        document = { schemaVersion: 1 };
        await perfPage.goto(origin);
        await perfPage.evaluate(async () => {
          Traceway.init(`perf@${location.origin}`, {
            captureWebVitals: false,
            captureResourceTiming: false,
            sessionRecording: false,
            exportDelayMs: 60000,
          });
          await Traceway.refreshConfig();
        });
        await exercise("/off");
        assert(!names().includes("browser.long_task"));
        assert(!names().includes("browser.route_timing"));

        document = {
          schemaVersion: 1,
          signals: {
            longTasks: { mode: "stream" },
            routeTiming: { mode: "stream" },
          },
        };
        await perfPage.evaluate(() => Traceway.refreshConfig());
        await exercise("/orders");
        const blocks = logs.filter(
          (log) => log.eventName === "browser.long_task",
        );
        assert(
          blocks.some(
            (log) => attribute(log, "browser.long_task.duration") >= 150,
          ),
          "the 200 ms block is reported",
        );
        const routes = logs.filter(
          (log) => log.eventName === "browser.route_timing",
        );
        assert.equal(routes.length, 1);
        assert.equal(attribute(routes[0], "url.full"), `${origin}/orders`);
        assert.equal(
          attribute(routes[0], "browser.route_timing.outcome"),
          "settled",
        );
        assert.equal(attribute(routes[0], "browser.route_timing.requests"), 1);
        const duration = attribute(routes[0], "browser.route_timing.duration");
        assert(duration >= 300 && duration < 1000, `route took ${duration} ms`);
      } finally {
        await perfPage.close();
      }
    },
  );
  await check(
    "metrics travel as one aggregated payload per flush and a failed one is retried once",
    async () => {
      const metricsPage = await browser.newPage();
      const metricsOf = (payload) =>
        Object.fromEntries(
          payload.resourceMetrics[0].scopeMetrics[0].metrics.map((m) => [
            m.name,
            m,
          ]),
        );
      const resourceOf = (payload) =>
        Object.fromEntries(
          payload.resourceMetrics[0].resource.attributes.map((a) => [
            a.key,
            Object.values(a.value)[0],
          ]),
        );
      const retriesOf = (id) =>
        metricPayloads
          .map(resourceOf)
          .filter((r) => r["traceway.retry"] && r["traceway.batch_id"] === id);
      const load = async () => {
        await metricsPage.goto(`${origin}/orders/8841`);
        await metricsPage.evaluate(() => {
          Traceway.init(`metrics@${location.origin}`, {
            sessionRecording: false,
            version: "4.2.0",
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
      };
      const block = () =>
        metricsPage.evaluate(
          () =>
            new Promise((resolve) =>
              setTimeout(() => {
                const until = performance.now() + 200;
                while (performance.now() < until);
                setTimeout(resolve, 1300);
              }, 0),
            ),
        );
      try {
        document = { schemaVersion: 1 };
        metricPayloads.length = 0;
        const logsBefore = logs.length;
        await metricsPage.goto(`${origin}/orders/8841`);
        await metricsPage.evaluate(async () => {
          Traceway.init(`metrics@${location.origin}`, {
            sessionRecording: false,
            version: "4.2.0",
          });
          await Traceway.refreshConfig();
        });
        await block();

        metricsStatus = 503;
        await metricsPage.evaluate(() => Traceway.flush());
        await new Promise((resolve) => setTimeout(resolve, 1500));
        assert.equal(
          metricPayloads.length,
          1,
          "a rejected upload is not retried while the page lives",
        );
        const failedId = resourceOf(metricPayloads[0])["traceway.batch_id"];
        assert.match(failedId, /^[0-9a-f]{32}$/);
        const first = metricsOf(metricPayloads[0]);
        const blocks =
          first["browser.long_task.duration"].exponentialHistogram.dataPoints;
        assert.equal(blocks[0].scale, 3);
        assert(
          blocks[0].attributes.some(
            (a) => a.key === "url.path" && a.value.stringValue === "/orders/:id",
          ),
          "the path is normalized on the device",
        );

        metricsStatus = 200;
        await block();
        await metricsPage.goto("about:blank");
        await new Promise((resolve) => setTimeout(resolve, 500));
        // The browser fires `pagehide` and then `visibilitychange`; the web vitals library reports from both.
        assert(
          metricPayloads.length >= 2 && metricPayloads.length <= 3,
          `${metricPayloads.length} payloads when the page goes away`,
        );
        const last = Object.assign(
          {},
          ...metricPayloads.slice(1).map(metricsOf),
        );
        assert.equal(last["browser.page_view"].sum.dataPoints[0].asDouble, 1);
        assert(last["browser.long_task.blocking_time"], "blocking time per page view");
        assert(
          last["browser.web_vital.lcp"] || last["browser.web_vital.cls"],
          "the final web vitals are uploaded while the page goes away",
        );
        const resource = resourceOf(metricPayloads.at(-1));
        assert.equal(resource["traceway.metrics"], "aggregated");
        assert.equal(resource["service.version"], "4.2.0");
        assert.equal(retriesOf(failedId).length, 0);

        await load();
        assert.equal(
          retriesOf(failedId).length,
          1,
          "the failed payload is sent again on the next page load, as the same batch",
        );
        await load();
        assert.equal(retriesOf(failedId).length, 1, "and only once");
        assert(
          !logs
            .slice(logsBefore)
            .some((log) => log.eventName === "browser.web_vital"),
          "the web vital events stay on the device",
        );
      } finally {
        metricsStatus = 200;
        await metricsPage.close();
      }
    },
  );
  await check(
    "views are named by the route templates of a Vue Router the app never handed over",
    async () => {
      const routerPage = await browser.newPage();
      try {
        document = { schemaVersion: 1 };
        metricPayloads.length = 0;
        // Slugs the path normalization leaves alone, so `:slug` can only have come from the router.
        await routerPage.goto(`${origin}/products/blue-shoes`);
        await routerPage.evaluate(async () => {
          Traceway.init(`routes@${location.origin}`, {
            sessionRecording: false,
          });
          await Traceway.refreshConfig();
        });
        for (const src of ["/vue.js", "/vue-router.js"])
          await routerPage.addScriptTag({ url: src });
        await routerPage.evaluate(async () => {
          const view = { render: () => Vue.h("p", "page") };
          const router = VueRouter.createRouter({
            history: VueRouter.createWebHistory(),
            routes: [
              { path: "/products/:slug", component: view },
              { path: "/cart", component: view },
            ],
          });
          const mount = window.document.createElement("div");
          window.document.body.appendChild(mount);
          Vue.createApp({ render: () => Vue.h(VueRouter.RouterView) })
            .use(router)
            .mount(mount);
          await router.isReady();
          await router.push("/products/red-boots");
          await router.push("/cart");
          await Traceway.flush();
        });
        await expect.poll(() => metricPayloads.length).toBeGreaterThan(0);
        const views = {};
        for (const payload of metricPayloads)
          for (const metric of payload.resourceMetrics[0].scopeMetrics[0].metrics)
            if (metric.name === "browser.page_view")
              for (const point of metric.sum.dataPoints) {
                const path = point.attributes.find((a) => a.key === "url.path");
                views[path.value.stringValue] =
                  (views[path.value.stringValue] ?? 0) + Number(point.asDouble ?? point.asInt);
              }
        assert.deepEqual(views, { "/products/:slug": 2 });
      } finally {
        await routerPage.close();
      }
    },
  );
  await check(
    "streamed resource timing leaves out the SDK's own requests, so exports do not feed themselves",
    async () => {
      const previous = document;
      document = {
        schemaVersion: 1,
        signals: { resourceTiming: { mode: "stream" } },
      };
      const timingContext = await browser.newContext();
      const timingPage = await timingContext.newPage();
      timingPage.on("pageerror", (error) => errors.push(error.message));
      const resourceUrls = (from) =>
        requests
          .slice(from)
          .filter((r) => r.path === "/api/otel/v1/logs")
          .flatMap((r) =>
            JSON.parse(r.body).resourceLogs.flatMap((resource) =>
              resource.scopeLogs.flatMap((scope) => scope.logRecords),
            ),
          )
          .filter((record) => record.eventName === "browser.resource_timing")
          .map(
            (record) =>
              record.attributes.find((a) => a.key === "url.full")?.value
                .stringValue,
          );
      try {
        await timingPage.goto(origin);
        const start = requests.length;
        await timingPage.evaluate(async () => {
          Traceway.init(`browser@${location.origin}`, {
            captureWebVitals: false,
            exportDelayMs: 100,
          });
          await Traceway.refreshConfig();
          await fetch("/resource-timing-application-request");
        });
        await expect
          .poll(() =>
            resourceUrls(start).some((url) =>
              url.endsWith("/resource-timing-application-request"),
            ),
          )
          .toBe(true);
        // Before the fix every export was measured and sent again a moment later, for as long as the page lived.
        await timingPage.waitForTimeout(1500);
        const idle = requests.length;
        await timingPage.waitForTimeout(1500);
        assert.deepEqual(resourceUrls(idle), []);
        assert.deepEqual(
          resourceUrls(start).filter((url) =>
            new URL(url).pathname.startsWith("/api/"),
          ),
          [],
        );
      } finally {
        document = previous;
        await timingContext.close();
      }
    },
  );
  await check("standalone local policy exports to independent OTLP endpoints without OpAMP or replay", async () => {
    const standaloneContext = await browser.newContext();
    const standalonePage = await standaloneContext.newPage();
    try {
      await standalonePage.goto(origin);
      const start = requests.length;
      await standalonePage.evaluate(() => {
        Traceway.init({
          serviceName: "standalone-test",
          telemetry: {
            url: location.origin + "/standalone",
            metrics: { url: location.origin + "/separate/v1/metrics", headers: { Authorization: "Bearer metrics-only" } },
          },
          remoteConfig: true,
          sessionRecording: true,
          captureWebVitals: false,
          captureResourceTiming: false,
          exportDelayMs: 60_000,
          collection: {
            signals: { console: { mode: "stream" }, network: { mode: "stream" } },
            metrics: { flushSeconds: 30 },
          },
        });
        Traceway.track("local-buffered-context");
        console.warn("standalone-console");
        Traceway.captureException(new Error("standalone-error"));
        Traceway.count("checkout.complete");
      });
      await standalonePage.evaluate(async () => {
        await fetch("/standalone-application-request");
        await Traceway.flush();
        await Traceway.shutdown();
      });
      const sent = requests.slice(start);
      assert(sent.some(r => r.path === "/standalone/v1/logs" && r.body.includes("standalone-error")));
      assert(sent.some(r => r.path === "/standalone/v1/logs" && r.body.includes("local-buffered-context")));
      assert(sent.some(r => r.path === "/standalone/v1/traces"));
      assert(sent.some(r => r.path === "/separate/v1/metrics"));
      assert(sent.every(r => !r.path.startsWith("/api/")), "standalone must never contact Traceway APIs");
      for (const request of sent) {
        assert.equal(request.auth, request.path === "/separate/v1/metrics" ? "Bearer metrics-only" : undefined);
      }
    } finally {
      await standaloneContext.close();
    }
  });
  assert.deepEqual(errors, []);
  console.log("Browser regression checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
