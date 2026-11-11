import { afterEach, describe, expect, it, vi } from "vitest";
import { unitHash } from "@tracewayapp/core";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import type { TracewayFrontendOptions } from "./client.js";
import { TracewayFrontendClient } from "./client.js";

let client: TracewayFrontendClient;
let logExporter: InMemoryLogRecordExporter;

function start(options: TracewayFrontendOptions = {}): TracewayFrontendClient {
  logExporter = new InMemoryLogRecordExporter();
  client = new TracewayFrontendClient(
    "tok_123@https://traceway.test/api/report",
    {
      logExporter,
      spanExporter: new InMemorySpanExporter(),
      captureWebVitals: false,
      captureResourceTiming: false,
      sessionRecording: false,
      remoteConfig: false,
      ...options,
    },
  );
  client.start();
  return client;
}

async function exported(): Promise<ReadableLogRecord[]> {
  await client.flush();
  return logExporter.getFinishedLogRecords();
}

function events(
  records: ReadableLogRecord[],
  name: string,
): ReadableLogRecord[] {
  return records.filter((r) => r.eventName === name);
}

afterEach(async () => {
  await client?.shutdown();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("TracewayFrontendClient", () => {
  it("retains earlier breadcrumbs but respects a disabled error trigger", async () => {
    start();
    client["logger"]!.emit({
      eventName: "earlier-context",
      timestamp: new Date(Date.now() - 120_000),
    });
    client.captureException(new Error("context test"));
    expect(events(await exported(), "earlier-context")).toHaveLength(1);
    client.control.applyRemote({
      triggers: [{ id: "default-exception", enabled: false }],
    });
    client.track("private-buffer");
    client.captureException(new Error("disabled trigger"));
    expect(events(await exported(), "private-buffer")).toHaveLength(0);
  });

  it("keeps the replay clip limit across a page reload in the same session", async () => {
    start({ sessionRecording: true });
    client.control.applyRemote({
      triggers: [{ id: "default-exception", maxPerSession: 1 }],
    });
    client.captureException(new Error("first clip"));
    await exported();
    const session = client.currentSessionId();
    await client.shutdown();
    start({ sessionRecording: true });
    expect(client.currentSessionId()).toBe(session);
    client.control.applyRemote({
      triggers: [{ id: "default-exception", maxPerSession: 1 }],
    });
    client.captureException(new Error("after reload"));
    const errors = events(await exported(), "exception");
    expect(errors[0]!.attributes["traceway.replay.status"]).toBe(
      "session_clip_limit",
    );
  });

  it("keeps errors and health metadata when the diagnostic budget is exhausted", async () => {
    start({
      baselineSampleRate: 1,
      collectionLimits: { maxEvents: 2 },
      captureLogs: false,
      captureNavigation: false,
      captureUserActions: false,
    });
    client.track("one");
    client.track("two");
    client.track("dropped");
    client.captureException(new Error("budget error"));
    const records = await exported();
    expect(events(records, "one")).toHaveLength(1);
    expect(events(records, "two")).toHaveLength(1);
    expect(events(records, "dropped")).toHaveLength(0);
    expect(events(records, "exception")).toHaveLength(1);
    expect(
      events(records, "exception")[0]!.attributes[
        "traceway.collection.dropped"
      ],
    ).toBe(1);
  });

  it("uploads the failed interaction root when it ends after the exception flush", async () => {
    const spans = new InMemorySpanExporter();
    start({ spanExporter: spans });
    const interaction = client.startInteraction("failed-root");
    interaction.bind(() =>
      client.captureException(new Error("interaction failed")),
    )();
    await exported();
    interaction.end();
    await exported();
    expect(
      spans
        .getFinishedSpans()
        .find((span) => span.name === "failed-root")
        ?.spanContext().traceId,
    ).toBe(interaction.traceId);
  });

  it("binds overlapping async interaction callbacks without linking unrelated errors", async () => {
    start();
    const first = client.startInteraction("checkout");
    const second = client.startInteraction("search");
    await Promise.resolve();
    first.bind(() => client.captureException(new Error("checkout failed")))();
    second.captureException(new Error("search failed"));
    client.captureException(new Error("unrelated"));
    first.end();
    second.end();
    const errors = events(await exported(), "exception");
    expect(errors[0]!.spanContext?.traceId).toBe(first.traceId);
    expect(errors[1]!.spanContext?.traceId).toBe(second.traceId);
    expect(errors[2]!.spanContext).toBeUndefined();
    expect(first.traceId).not.toBe(second.traceId);
  });

  it("keeps healthy metadata and web vitals enabled without streaming healthy breadcrumbs or replay", async () => {
    start({ captureWebVitals: true, sessionRecording: true });
    client.track("healthy");
    const records = await exported();
    expect(events(records, "healthy")).toHaveLength(0);
    expect(events(records, "session.start")).toHaveLength(1);
    expect(client.control.settings().signals.webVitals.mode).toBe("stream");
    expect(client.control.settings().replay.mode).toBe("buffer");
    expect(client.control.settings().sessions.baselineSampleRate).toBe(0);
  });

  it("samples whole healthy sessions consistently across reloads without streaming replay", async () => {
    start({ baselineSampleRate: 0.5, sessionRecording: true });
    const session = client.currentSessionId()!;
    const sampled = unitHash(session) < 0.5;
    for (let i = 0; i < 20; i++) client.track("baseline");
    expect(events(await exported(), "baseline")).toHaveLength(sampled ? 20 : 0);
    expect(client.control.replayMode()).toBe("buffer");
    await client.shutdown();
    start({ baselineSampleRate: 0.5, sessionRecording: true });
    expect(client.currentSessionId()).toBe(session);
    client.track("baseline-next-page");
    expect(events(await exported(), "baseline-next-page")).toHaveLength(
      sampled ? 1 : 0,
    );
    client.control.applyRemote({
      sessions: { baselineSampleRate: 1 },
      signals: { custom: { mode: "off" } },
    });
    client.track("explicitly-off");
    expect(events(await exported(), "explicitly-off")).toHaveLength(0);
  });

  it("can enable and revoke baseline sampling remotely without affecting exception capture", async () => {
    start();
    client.control.applyRemote({ sessions: { baselineSampleRate: 1 } });
    client.track("sampled");
    expect(events(await exported(), "sampled")).toHaveLength(1);
    client.control.applyRemote({ sessions: { baselineSampleRate: 0 } });
    client.track("buffered-again");
    expect(events(await exported(), "buffered-again")).toHaveLength(0);
    client.captureException(new Error("first error"));
    const records = await exported();
    expect(events(records, "exception")).toHaveLength(1);
    expect(events(records, "buffered-again")).toHaveLength(1);
  });

  it("applies error protection before starting replay triggers", async () => {
    start();
    const error = new Error("repeated");
    for (let i = 0; i < 100; i++) client.captureException(error);
    const records = await exported();
    expect(events(records, "exception")).toHaveLength(1);
    expect(events(records, "traceway.trigger.fired")).toHaveLength(1);
  });

  it("keeps control and replay on Traceway when telemetry uses another base URL", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    start({
      telemetry: { url: "https://collector.example/otlp/" },
      sessions: false,
    });
    expect(client.endpoints.logs).toBe(
      "https://collector.example/otlp/v1/logs",
    );
    expect(client.endpoints.traces).toBe(
      "https://collector.example/otlp/v1/traces",
    );
    expect(client.endpoints.opamp).toBe(
      "https://traceway.test/api/otel/v1/opamp",
    );
    expect(client.endpoints.recordings).toBe(
      "https://traceway.test/api/recordings",
    );
  });

  it.each([
    "file:///tmp/collector",
    "https://user:pass@collector.test",
    "https://collector.test?token=a",
    "https://collector.test/#fragment",
  ])("rejects ambiguous telemetry base %s", (url) => {
    expect(
      () =>
        new TracewayFrontendClient("tok@https://traceway.test", {
          telemetry: { url },
        }),
    ).toThrow();
  });

  it("derives the OTLP endpoints and a stable instance id from the connection string", () => {
    start();
    expect(client.endpoints.logs).toBe(
      "https://traceway.test/api/otel/v1/logs",
    );
    expect(client.endpoints.recordings).toBe(
      "https://traceway.test/api/recordings",
    );
    expect(client.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(localStorage.getItem("traceway:instance:tok_123")).toBe(
      client.instanceId,
    );
  });

  it("replaces a malformed cached instance ID instead of disabling OpAMP", () => {
    const malformed = "-".repeat(36);
    localStorage.setItem("traceway:instance:tok_123", malformed);
    start();
    expect(client.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(localStorage.getItem("traceway:instance:tok_123")).toBe(
      client.instanceId,
    );
  });

  it.each([
    ["a", true],
    ["界", false],
    ["😀", false],
  ])(
    "uses UTF-8 bytes for the keepalive budget (%s)",
    async (character, keepalive) => {
      start();
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 200 }));
      const body = JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    eventName: "exception",
                    body: { stringValue: character.repeat(25_000) },
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(await client["sendOtlpJson"]("logs", body, true)).toBe("sent");
      expect(fetchMock).toHaveBeenCalledWith(
        client.endpoints.logs,
        expect.objectContaining({ keepalive, body }),
      );
    },
  );

  it("streams exceptions with their id, session and context", async () => {
    start({ attributes: { tenant: "acme" } });
    client.setAttribute("user.id", "u-1");
    client.captureException(new TypeError("x is undefined"));

    const records = await exported();
    const [exception] = events(records, "exception");
    expect(exception).toBeDefined();
    const attrs = exception!.attributes;
    expect(attrs["exception.type"]).toBe("TypeError");
    expect(attrs["exception.message"]).toBe("x is undefined");
    expect(attrs["traceway.exception.id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(attrs["session.id"]).toBe(client.currentSessionId());
    expect(attrs["user.id"]).toBe("u-1");
    expect(attrs.tenant).toBe("acme");
    expect(attrs.url).toBeDefined();
    expect(exception!.resource.attributes["service.instance.id"]).toBe(
      client.instanceId,
    );

    const [sessionStart] = events(records, "session.start");
    expect(sessionStart!.attributes["session.id"]).toBe(
      client.currentSessionId(),
    );
    expect(typeof sessionStart!.attributes["traceway.session.started_at"]).toBe(
      "number",
    );
    expect(events(records, "traceway.session.update")).toHaveLength(1);
  });

  it("keeps breadcrumbs on the device until the error trigger flushes them", async () => {
    start();
    client.recordAction("cart", "add_item", { sku: "A1" });
    expect(events(await exported(), "traceway.action")).toHaveLength(0);

    client.captureException(new Error("checkout broke"));
    const records = await exported();
    expect(events(records, "traceway.action")).toHaveLength(1);
    expect(
      events(records, "traceway.trigger.fired")[0]!.attributes[
        "traceway.trigger.id"
      ],
    ).toBe("default-exception");
  });

  it("follows remote settings, including the kill switch", async () => {
    start();
    client.control.applyRemote({ signals: { custom: { mode: "stream" } } });
    client.track("viewed_pricing");
    expect(events(await exported(), "viewed_pricing")).toHaveLength(1);

    client.control.applyRemote({ enabled: false });
    const before = (await exported()).length;
    client.captureException(new Error("dropped"));
    client.track("viewed_pricing");
    expect((await exported()).length).toBe(before);
  });

  it("runs multi-step triggers sent by the server", async () => {
    start();
    client.control.applyRemote({
      triggers: [
        {
          id: "repeated-checkout-failure",
          steps: [
            {
              match: { key: "event.name", op: "eq", value: "checkout_failed" },
            },
            {
              match: { key: "event.name", op: "eq", value: "checkout_failed" },
              withinSeconds: 60,
            },
          ],
          actions: [
            { type: "flush", lookbackSeconds: 60, signals: ["custom"] },
          ],
        },
      ],
    });
    client.track("checkout_failed", { step: "payment" });
    expect(events(await exported(), "checkout_failed")).toHaveLength(0);
    client.track("checkout_failed", { step: "payment" });
    expect(events(await exported(), "checkout_failed")).toHaveLength(2);
  });

  it("starts a capture on the device when a log line repeats, and keeps it on the next page", async () => {
    start();
    client.control.applyRemote({
      triggers: [
        {
          id: "payment-log",
          steps: [
            {
              match: {
                all: [
                  { key: "event.name", op: "eq", value: "browser.console" },
                  { key: "body", op: "icontains", value: "payment failed" },
                ],
              },
              count: 2,
              periodSeconds: 60,
            },
          ],
          actions: [
            { type: "capture", durationSeconds: 1800, lookbackSeconds: 120 },
          ],
        },
      ],
    });
    client.track("before_capture");
    console.warn("Payment FAILED for order 1");
    expect(events(await exported(), "traceway.capture.started")).toHaveLength(
      0,
    );
    console.warn("payment failed for order 2");

    const records = await exported();
    const [started] = events(records, "traceway.capture.started");
    expect(started!.attributes["traceway.capture.source"]).toBe("trigger");
    expect(started!.attributes["traceway.trigger.id"]).toBe("payment-log");
    expect(events(records, "before_capture")).toHaveLength(1);
    expect(events(records, "browser.console").map((r) => r.body)).toEqual([
      "Payment FAILED for order 1",
      "payment failed for order 2",
    ]);

    client.track("during_capture");
    expect(events(await exported(), "during_capture")).toHaveLength(1);

    console.warn("payment failed again");
    console.warn("payment failed and again");
    expect(events(await exported(), "traceway.capture.started")).toHaveLength(
      1,
    );

    await client.shutdown();
    start();
    client.track("next_page");
    expect(events(await exported(), "next_page")).toHaveLength(1);
  });

  it("brings back console a rule switched off once a log line starts a capture, starting with that line", async () => {
    start();
    client.control.applyRemote({
      signals: { console: { mode: "off" }, custom: { mode: "off" } },
      triggers: [
        {
          id: "checkout-log",
          steps: [
            {
              match: {
                all: [
                  { key: "event.name", op: "eq", value: "browser.console" },
                  { key: "body", op: "glob", value: "*checkout*timeout*" },
                ],
              },
            },
          ],
          actions: [{ type: "capture", durationSeconds: 600 }],
        },
      ],
    });
    console.warn("rendering cart");
    client.track("dropped_by_rule");
    console.error("checkout request timeout after 30s");
    console.warn("retrying checkout");
    client.track("kept_by_capture");

    const records = await exported();
    expect(events(records, "traceway.capture.started")).toHaveLength(1);
    expect(events(records, "browser.console").map((r) => r.body)).toEqual([
      "checkout request timeout after 30s",
      "retrying checkout",
    ]);
    expect(events(records, "dropped_by_rule")).toHaveLength(0);
    expect(events(records, "kept_by_capture")).toHaveLength(1);
  });

  it("drops exceptions matched by ignoreErrors or rejected by beforeCapture", async () => {
    start({ beforeCapture: (e) => e.message !== "private" });
    client.captureException(new Error("Failed to fetch"));
    client.captureException(new Error("private"));
    client.captureException(new Error("kept"));
    const messages = events(await exported(), "exception").map(
      (r) => r.attributes["exception.message"],
    );
    expect(messages).toEqual(["kept"]);
  });

  it("records messages as their own event", async () => {
    start();
    client.captureMessage("payment provider slow", { provider: "stripe" });
    const [message] = events(await exported(), "traceway.message");
    expect(message!.body).toBe("payment provider slow");
    expect(message!.attributes.provider).toBe("stripe");
  });
  it("drops buffered and queued telemetry when collection is restricted", async () => {
    start();
    client.track("buffered_private");
    client.captureMessage("queued_private");
    client.control.applyRemote({
      limits: { signals: { custom: "off", messages: "off" } },
    });
    client.captureException(new Error("flush trigger"));
    const records = await exported();
    expect(events(records, "buffered_private")).toHaveLength(0);
    expect(events(records, "traceway.message")).toHaveLength(0);
    client.control.applyRemote(null);
    client.runAction({ type: "flush", lookbackSeconds: 600 });
    expect(events(await exported(), "buffered_private")).toHaveLength(0);
  });

  it("accounts for console bodies in the buffer budget", async () => {
    start();
    client.control.applyRemote({ buffer: { maxBytes: 2_000 } });
    console.info("x".repeat(5_000));
    client.captureException(new Error("flush"));
    expect(events(await exported(), "browser.console")).toHaveLength(0);
  });

  it("does not let a trigger bypass sample rates", async () => {
    start();
    client.control.applyRemote({ signals: { errors: { sampleRate: 0 } } });
    client.captureException(new Error("sampled out"));
    expect(events(await exported(), "exception")).toHaveLength(0);
  });
});
