// CONTRACT §16: init({ token, baseUrl? }) with Traceway Cloud by default, the 2.0 connection string still read, the
// /api/report transport gone. Fetch is stubbed and the exporters are in memory: no test sends anything anywhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import type { TracewayFrontendOptions } from "./client.js";
import { TracewayFrontendClient } from "./client.js";
import { captureException, flush, getClient, init, shutdown, track } from "./index.js";

let network: ReturnType<typeof vi.fn>;
let logs: InMemoryLogRecordExporter;

function quiet(extra: TracewayFrontendOptions = {}): TracewayFrontendOptions {
  logs = new InMemoryLogRecordExporter();
  return {
    logExporter: logs,
    spanExporter: new InMemorySpanExporter(),
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    ...extra,
  };
}

function urls(): string[] {
  return network.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  network = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", network);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await shutdown();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("init({ token, baseUrl })", () => {
  it("sends to Traceway Cloud with only a token", () => {
    // Not started: nothing is sent.
    const client = new TracewayFrontendClient({ token: "YOUR_TOKEN" });
    expect(client.endpoints).toEqual({
      base: "https://cloud.tracewayapp.com",
      logs: "https://cloud.tracewayapp.com/api/otel/v1/logs",
      traces: "https://cloud.tracewayapp.com/api/otel/v1/traces",
      metrics: "https://cloud.tracewayapp.com/api/otel/v1/metrics",
      opamp: "https://cloud.tracewayapp.com/api/otel/v1/opamp",
      recordings: "https://cloud.tracewayapp.com/api/recordings",
    });
  });

  it("sends to the baseUrl of a self-hosted server, with the token as the bearer", async () => {
    init({ ...quiet({ remoteConfig: true }), token: "tok", baseUrl: "https://traceway.test/" });
    expect(getClient()!.endpoints.opamp).toBe("https://traceway.test/api/otel/v1/opamp");
    await getClient()!.refreshConfig();
    const opamp = network.mock.calls.find(([url]) => String(url) === "https://traceway.test/api/otel/v1/opamp");
    expect(new Headers(opamp![1].headers).get("Authorization")).toBe("Bearer tok");
  });

  it("still reads the 2.0 connection string, /api/report suffix and all", () => {
    const client = new TracewayFrontendClient("tok@https://traceway.test/api/report", quiet());
    expect(client.endpoints.base).toBe("https://traceway.test");
    expect(client.endpoints.logs).toBe("https://traceway.test/api/otel/v1/logs");
    expect(client["token"]).toBe("tok");
  });

  it("runs standalone without a token: only the telemetry destination", () => {
    const client = new TracewayFrontendClient({
      ...quiet(),
      telemetry: { url: "https://collector.test" },
    });
    expect(client.endpoints.logs).toBe("https://collector.test/v1/logs");
    expect(client["options"].remoteConfig).toBe(false);
    expect(client["options"].sessionRecording).toBe(false);
  });

  it("stays off, with one warning, without a token or a destination (JS2-8)", () => {
    const warn = vi.mocked(console.warn);
    init({ token: undefined });
    expect(getClient()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![1])).toContain(
      'init() needs a token, as in init({ token: "YOUR_TOKEN" }), and got undefined: is the environment variable set in this build?',
    );
  });
});

describe("no /api/report (CONTRACT §16)", () => {
  async function exported(): Promise<ReadableLogRecord[]> {
    await flush();
    return logs.getFinishedLogRecords();
  }

  it.each([
    ["a server without OpAMP", {}],
    ["the deprecated transport: \"legacy\"", { transport: "legacy" as const }],
  ])("never requests it, with %s; exceptions go out as OTLP", async (_, extra) => {
    network.mockImplementation(async (url: unknown) =>
      String(url).endsWith("/opamp") ? new Response(null, { status: 404 }) : new Response(null, { status: 200 }),
    );
    init({ ...quiet({ remoteConfig: true, ...extra }), token: "tok", baseUrl: "https://traceway.test" });
    await getClient()!.refreshConfig();
    await new Promise((resolve) => setTimeout(resolve, 10));
    captureException(new Error("after the probe"));
    track("checkout");
    const records = await exported();
    expect(records.filter((r) => r.eventName === "exception").map((r) => r.attributes["exception.message"])).toEqual([
      "after the probe",
    ]);
    expect(urls().some((url) => url.includes("/api/report"))).toBe(false);
    expect(urls().filter((url) => url.includes("/opamp")).length).toBeGreaterThan(0);
  });
});
