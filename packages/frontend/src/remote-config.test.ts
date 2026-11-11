import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { encodeServerToAgent } from "@tracewayapp/opamp";

vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import { TracewayFrontendClient } from "./client.js";

let serverDocument: Record<string, unknown>;
let opampBodies: string[];
let client: TracewayFrontendClient;
let logExporter: InMemoryLogRecordExporter;

function hashOf(doc: Record<string, unknown>): Uint8Array {
  const text = JSON.stringify(doc);
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 251;
  return Uint8Array.from([h, text.length % 256]);
}

beforeEach(() => {
  serverDocument = { schemaVersion: 1 };
  opampBodies = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/otel/v1/opamp")) {
      opampBodies.push(
        new TextDecoder("latin1").decode(init!.body as Uint8Array),
      );
      return new Response(
        encodeServerToAgent({
          flags: 0,
          capabilities: 3,
          heartbeatIntervalSeconds: 300,
          remoteConfig: {
            configMap: {
              traceway: {
                body: new TextEncoder().encode(JSON.stringify(serverDocument)),
                contentType: "application/json",
              },
            },
            configHash: hashOf(serverDocument),
          },
        }) as BodyInit,
      );
    }
    return new Response(null, { status: 200 });
  });
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function start(): TracewayFrontendClient {
  logExporter = new InMemoryLogRecordExporter();
  client = new TracewayFrontendClient("tok@https://traceway.test", {
    logExporter,
    spanExporter: new InMemorySpanExporter(),
    sessionRecording: false,
    captureWebVitals: false,
    captureResourceTiming: false,
  });
  client.start();
  return client;
}

async function exported(name: string): Promise<ReadableLogRecord[]> {
  await client.flush();
  return logExporter
    .getFinishedLogRecords()
    .filter((r) => r.eventName === name);
}

describe("remote config over OpAMP", () => {
  it("applies the server's settings and keeps them for the next page", async () => {
    serverDocument = {
      schemaVersion: 1,
      signals: { custom: { mode: "stream" } },
    };
    start();
    await vi.waitFor(() =>
      expect(client.control.remoteOverlay()).not.toBeNull(),
    );
    client.track("opened_cart");
    expect(await exported("opened_cart")).toHaveLength(1);
    expect(await exported("traceway.config.applied")).toHaveLength(1);
    expect(opampBodies[0]).toContain("service.instance.id");
    expect(opampBodies[0]).toContain(client.instanceId);

    await client.shutdown();
    const nextPage = new TracewayFrontendClient("tok@https://traceway.test", {
      remoteConfig: true,
    });
    expect(nextPage.control.settings().signals.custom.mode).toBe("stream");
  });

  it("describes global attributes so rules can target users", async () => {
    start();
    await vi.waitFor(() => expect(opampBodies.length).toBeGreaterThan(0));
    client.setAttribute("user.id", "u-9481");
    await client.refreshConfig();
    expect(opampBodies.at(-1)).toContain("u-9481");
  });

  it("runs a capture: uploads the lookback once, then streams until it ends", async () => {
    start();
    await vi.waitFor(() =>
      expect(client.control.remoteOverlay()).not.toBeNull(),
    );
    client.track("before_capture");
    expect(await exported("before_capture")).toHaveLength(0);

    serverDocument = {
      schemaVersion: 1,
      captures: [
        {
          id: "cap-1",
          until: new Date(Date.now() + 3_600_000).toISOString(),
          lookbackSeconds: 600,
          signals: ["*"],
        },
      ],
    };
    await client.refreshConfig();
    await vi.waitFor(() =>
      expect(client.control.settings().captures).toHaveLength(1),
    );
    expect(await exported("before_capture")).toHaveLength(1);
    expect(
      (await exported("traceway.capture.started"))[0]!.attributes[
        "traceway.capture.id"
      ],
    ).toBe("cap-1");

    client.track("during_capture");
    expect(await exported("during_capture")).toHaveLength(1);

    await client.refreshConfig();
    expect(await exported("traceway.capture.started")).toHaveLength(1);
  });
  it("revokes cancelled captures without cancelling local overrides", async () => {
    start();
    await client.refreshConfig();
    serverDocument = {
      captures: [
        { id: "remote", until: new Date(Date.now() + 60_000).toISOString() },
      ],
    };
    await client.refreshConfig();
    expect(client.control.modeFor("custom")).toBe("stream");
    client.runAction({
      type: "stream",
      signals: ["network"],
      durationSeconds: 60,
    });
    serverDocument = { captures: [] };
    await client.refreshConfig();
    expect(client.control.modeFor("custom")).toBe("buffer");
    expect(client.control.modeFor("network")).toBe("stream");
    client.track("after_cancel");
    expect(await exported("after_cancel")).toHaveLength(0);
  });

  it("preserves zero lookback and empty signal selections", async () => {
    start();
    await client.refreshConfig();
    client.track("before_zero_lookback");
    serverDocument = {
      captures: [
        {
          id: "zero",
          until: new Date(Date.now() + 60_000).toISOString(),
          lookbackSeconds: 0,
          signals: [],
        },
      ],
    };
    await client.refreshConfig();
    expect(client.control.settings().captures[0]).toMatchObject({
      lookbackSeconds: 0,
      signals: [],
    });
    expect(await exported("before_zero_lookback")).toHaveLength(0);
    expect(client.control.modeFor("custom")).toBe("buffer");
  });
});
