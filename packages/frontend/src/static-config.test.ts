import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { TracewayFrontendClient } from "./client.js";
import { logsToJson } from "./persistence/otlp-json.js";

vi.mock("@rrweb/record", () => ({
  record: Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  ),
}));

// The Node exporter uses http.request; model the browser transport so requests are observable here.
vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    constructor(
      private options: { url: string; headers: Record<string, string> },
    ) {}
    export(
      records: Parameters<typeof logsToJson>[0],
      done: (result: { code: number }) => void,
    ) {
      void fetch(this.options.url, {
        method: "POST",
        headers: this.options.headers,
        body: logsToJson(records),
      }).then(
        (response) => done({ code: response.ok ? 0 : 1 }),
        () => done({ code: 1 }),
      );
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

let client: TracewayFrontendClient;
afterEach(async () => {
  await client?.shutdown();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const quiet = {
  captureWebVitals: false,
  captureResourceTiming: false,
  captureNavigation: false,
  captureUserActions: false,
  captureNetwork: false,
  captureLogs: false,
};

it("exports standalone logs and metrics without any Traceway requests, even if remote/replay are requested", async () => {
  const requests = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  client = new TracewayFrontendClient({
    ...quiet,
    telemetry: {
      url: "https://collector.test/otlp",
      headers: { "X-Ingest": "public" },
    },
    remoteConfig: true,
    sessions: true,
    sessionRecording: true,
    collection: {
      signals: { custom: { mode: "stream" } },
      metrics: { flushSeconds: 30 },
      buffer: { persist: false },
    },
  });
  client.start();
  client.track("checkout");
  client.captureException(new Error("standalone exception"));
  client.count("checkout.completed");
  await client.flush();
  await client.shutdown();
  expect(client.control.settings().metrics.flushSeconds).toBe(30);
  expect(client.control.replayMode()).toBe("off");
  expect(client.control.settings().sessions.enabled).toBe(false);
  expect(requests.mock.calls.length).toBeGreaterThan(0);
  for (const [url, init] of requests.mock.calls) {
    expect(String(url)).toMatch(
      /^https:\/\/collector.test\/otlp\/v1\/(logs|metrics)$/,
    );
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  }
  const bodies = requests.mock.calls
    .map(([, init]) => String(init?.body))
    .join("\n");
  expect(bodies).toContain("checkout");
  expect(bodies).toContain("standalone exception");
  expect(bodies).not.toContain('"eventName":"session.start"');
});

it("applies local sampling, modes, triggers and ceilings before start; remote overlays retain local defaults", async () => {
  const logs = new InMemoryLogRecordExporter();
  client = new TracewayFrontendClient({
    token: "token",
    baseUrl: "https://traceway.test",
    ...quiet,
    remoteConfig: false,
    sessionRecording: false,
    logExporter: logs,
    spanExporter: new InMemorySpanExporter(),
    captureMetrics: false,
    collection: {
      signals: {
        custom: { mode: "stream", sampleRate: 0 },
        console: { mode: "stream" },
      },
      triggers: [{ id: "default-exception", enabled: false }],
      buffer: { persist: false, maxAgeSeconds: 45 },
    },
  });
  expect(client.control.settings().signals.console.mode).toBe("off");
  client.start();
  client.track("sampled-out");
  client.control.applyRemote({ signals: { custom: { sampleRate: 1 } } });
  client.track("included");
  await client.flush();
  expect(logs.getFinishedLogRecords().map((r) => r.eventName)).toContain(
    "included",
  );
  expect(logs.getFinishedLogRecords().map((r) => r.eventName)).not.toContain(
    "sampled-out",
  );
  expect(client.control.settings().buffer.maxAgeSeconds).toBe(45);
  client.control.applyRemote(null);
  expect(client.control.settings().signals.custom.sampleRate).toBe(0);
});

it("routes exceptions and session metadata to Traceway, ordinary logs elsewhere, including restored batches", async () => {
  const requests = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  const logs = new InMemoryLogRecordExporter();
  client = new TracewayFrontendClient({
    token: "tw-token",
    baseUrl: "https://traceway.test",
    ...quiet,
    remoteConfig: false,
    sessionRecording: false,
    captureMetrics: false,
    telemetry: {
      logs: {
        url: "https://logs.test/custom",
        headers: { Authorization: "Bearer logs-token" },
      },
    },
    logExporter: logs,
    collection: {
      signals: { custom: { mode: "stream" } },
      buffer: { persist: false },
    },
  });
  client.start();
  client.track("ordinary-log");
  client.captureException(new Error("split exception"));
  await client.flush();
  expect(logs.getFinishedLogRecords().map((r) => r.eventName)).toEqual([
    "ordinary-log",
  ]);
  expect(
    requests.mock.calls.some(
      ([url, init]) =>
        String(url).includes("traceway.test") &&
        String(init?.body).includes("split exception"),
    ),
  ).toBe(true);
  for (const [, init] of requests.mock.calls) {
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer tw-token",
    );
  }
  requests.mockClear();
  await client["sendOtlpJson"](
    "logs",
    logsToJson(logs.getFinishedLogRecords()),
  );
  expect(requests.mock.calls[0]![0]).toBe("https://logs.test/custom");
  expect(
    new Headers(requests.mock.calls[0]![1]?.headers).get("Authorization"),
  ).toBe("Bearer logs-token");
  expect(client.endpoints.traces).toBe(
    "https://traceway.test/api/otel/v1/traces",
  );
});

it("uses per-signal headers and URLs for metrics and trace retries without forwarding Traceway auth", async () => {
  const requests = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  client = new TracewayFrontendClient({
    token: "tw-token",
    baseUrl: "https://traceway.test",
    ...quiet,
    captureNetwork: true,
    remoteConfig: false,
    sessionRecording: false,
    telemetry: {
      metrics: {
        url: "https://metrics.test/ingest",
        headers: { "X-Metrics": "yes" },
      },
      traces: {
        url: "https://traces.test/ingest",
        headers: { "X-Traces": "yes" },
      },
    },
  });
  await client["sendMetrics"]("{}", false);
  await client["sendOtlpJson"]("traces", "{}");
  expect(requests.mock.calls[0]![0]).toBe("https://metrics.test/ingest");
  expect(requests).toHaveBeenCalledTimes(2);
  expect(requests.mock.calls[1]![0]).toBe("https://traces.test/ingest");
  expect(new Headers(requests.mock.calls[1]![1]?.headers).get("X-Traces")).toBe(
    "yes",
  );
  expect(
    new Headers(requests.mock.calls[1]![1]?.headers).get("Authorization"),
  ).toBeNull();
  expect(
    new Headers(requests.mock.calls[0]![1]?.headers).get("Authorization"),
  ).toBeNull();
  expect(
    new Headers(requests.mock.calls[0]![1]?.headers).get("X-Metrics"),
  ).toBe("yes");
});

it("rejects an incomplete standalone configuration, and ignores the transport option (CONTRACT §16)", () => {
  expect(
    () =>
      new TracewayFrontendClient({
        telemetry: { logs: { url: "https://logs.test/v1/logs" } },
      }),
  ).toThrow("all three");
  client = new TracewayFrontendClient({
    ...quiet,
    token: "token",
    baseUrl: "https://traceway.test",
    transport: "legacy",
    telemetry: { url: "https://collector.test" },
  });
  expect(client.endpoints.logs).toBe("https://collector.test/v1/logs");
  expect(client.endpoints.opamp).toBe("https://traceway.test/api/otel/v1/opamp");
});

it("ignores cached OpAMP policy when using static configuration", () => {
  localStorage.setItem(
    "traceway:config:tw-token",
    JSON.stringify({
      body: JSON.stringify({ signals: { custom: { mode: "off" } } }),
    }),
  );
  client = new TracewayFrontendClient({
    token: "tw-token",
    baseUrl: "https://traceway.test",
    ...quiet,
    remoteConfig: false,
    sessionRecording: false,
    collection: { signals: { custom: { mode: "stream" } } },
  });
  expect(client.control.settings().signals.custom.mode).toBe("stream");
  expect(client.control.remoteOverlay()).toBeNull();
});

it("does not resend pending metrics to a newly configured destination", async () => {
  const requests = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  const oldKey =
    'traceway:metrics:pending:["tw-token","https://old.test/v1/metrics"]';
  const pending = JSON.stringify([
    {
      id: "old-batch",
      t: Date.now(),
      p: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "old-destination-only", value: { boolValue: true } },
              ],
            },
            scopeMetrics: [],
          },
        ],
      },
    },
  ]);
  localStorage.setItem(oldKey, pending);
  client = new TracewayFrontendClient({
    token: "tw-token",
    baseUrl: "https://traceway.test",
    ...quiet,
    remoteConfig: false,
    sessionRecording: false,
    logExporter: new InMemoryLogRecordExporter(),
    telemetry: { metrics: { url: "https://new.test/v1/metrics" } },
  });
  client.start();
  client.count("fresh.metric");
  await client.flush();
  expect(
    requests.mock.calls.some(
      ([url]) => String(url) === "https://new.test/v1/metrics",
    ),
  ).toBe(true);
  expect(
    requests.mock.calls.some(([, init]) =>
      String(init?.body).includes("old-destination-only"),
    ),
  ).toBe(false);
  expect(localStorage.getItem(oldKey)).toBe(pending);
});
