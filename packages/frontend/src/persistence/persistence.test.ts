import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

vi.mock("@rrweb/record", () => ({
  record: Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  ),
}));

import { BufferStore, serializeBuffer } from "./buffer-store.js";
import {
  BUFFER_STORE,
  listByToken,
  OUTBOX_STORE,
  resetDatabase,
} from "./idb.js";
import { mergeRequests } from "./otlp-json.js";
import { Outbox } from "./outbox.js";
import {
  ControlState,
  RingBuffer,
  ceilingsFrom,
  defaultSettings,
} from "@tracewayapp/core";
import { TelemetryRouter } from "../otel/router.js";
import type { BufferedItem } from "../otel/router.js";
import { TracewayFrontendClient } from "../client.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("Outbox", () => {
  it("sends stored batches oldest first and keeps them on a retryable failure", async () => {
    const sent: string[] = [];
    let answer: "sent" | "retry" = "retry";
    const outbox = new Outbox("tok", async (_kind, body) => {
      sent.push(body);
      return answer;
    });
    await outbox.add("logs", '{"resourceLogs":[1]}');
    await outbox.add("traces", '{"resourceSpans":[2]}');

    await outbox.drain();
    expect(sent).toEqual(['{"resourceLogs":[1]}']);
    const kept = await listByToken(OUTBOX_STORE, "tok");
    expect(kept.map((b) => b.attempts)).toEqual([1, 0]);

    answer = "sent";
    const nextPage = new Outbox("tok", async (_kind, body) => {
      sent.push(body);
      return "sent";
    });
    await nextPage.drain();
    expect(sent.slice(1)).toEqual([
      '{"resourceLogs":[1]}',
      '{"resourceSpans":[2]}',
    ]);
    expect(await listByToken(OUTBOX_STORE, "tok")).toHaveLength(0);
  });
});

describe("BufferStore", () => {
  const record = (name: string, timeMs: number) => ({
    timeMs,
    signal: "custom",
    bytes: 10,
    item: {
      kind: "log",
      record: {
        eventName: name,
        hrTime: [Math.floor(timeMs / 1000), 0],
        hrTimeObserved: [Math.floor(timeMs / 1000), 0],
        attributes: {},
        resource: { attributes: { "service.name": "web" }, merge: () => null },
        instrumentationScope: { name: "test" },
        droppedAttributesCount: 0,
      } as unknown as ReadableLogRecord,
    } as BufferedItem,
  });

  it("hands a session's entries to the next page of that session only", async () => {
    const store = new BufferStore("tok");
    const now = Date.now();
    await store.save(
      serializeBuffer([record("a", now - 1_000), record("b", now)], "tok", "session-1"),
      "session-1",
    );
    await store.save(
      serializeBuffer([record("c", now)], "tok", "session-2"),
      "session-2",
    );

    expect(await store.take("session-3", 600_000)).toHaveLength(0);
    const taken = await store.take("session-1", 600_000);
    expect(
      taken.map(
        (b) =>
          JSON.parse(b.body).resourceLogs[0].scopeLogs[0].logRecords[0]
            .eventName,
      ),
    ).toEqual(["a", "b"]);
    expect(await store.take("session-1", 600_000)).toHaveLength(0);
    expect(await listByToken(BUFFER_STORE, "tok")).toHaveLength(1);
  });

  it("drops entries older than the buffer's age limit", async () => {
    const store = new BufferStore("tok");
    await store.save(
      serializeBuffer([record("old", Date.now() - 3_600_000)], "tok", "s"),
      "s",
    );
    expect(await store.take("s", 600_000)).toHaveLength(0);
    expect(await listByToken(BUFFER_STORE, "tok")).toHaveLength(0);
  });

  it("merges OTLP requests of one signal", () => {
    expect(
      JSON.parse(
        mergeRequests("logs", [
          '{"resourceLogs":[1]}',
          '{"resourceLogs":[2,3]}',
          "nope",
        ]),
      ),
    ).toEqual({
      resourceLogs: [1, 2, 3],
    });
  });

  it("sends the records restored from an earlier page as one request, marked with the running capture", () => {
    const control = new ControlState(defaultSettings(), ceilingsFrom());
    control.applyRemote({
      captures: [
        { id: "cap-1", until: new Date(Date.now() + 60_000).toISOString() },
      ],
    });
    const buffer = new RingBuffer<BufferedItem>({
      maxBytes: 1 << 20,
      maxAgeMs: 600_000,
    });
    const body = (name: string) =>
      JSON.stringify({
        resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: name }] }] }],
      });
    buffer.restore(
      ["a", "b", "c"].map((name) => ({
        timeMs: Date.now(),
        signal: "custom",
        bytes: 10,
        item: {
          kind: "stored" as const,
          batch: {
            token: "tok",
            kind: "logs" as const,
            body: body(name),
            createdAtMs: 0,
            attempts: 0,
          },
        },
      })),
    );
    const sent: string[] = [];
    const router = new TelemetryRouter(
      control,
      buffer,
      { logs: {} as never, spans: {} as never },
      {
        sessionId: () => "s",
        globalAttribute: () => undefined,
        enrichLog: () => true,
        observe: () => {},
        sendStored: (batch) => sent.push(batch.body),
      },
    );
    expect(router.flushBuffered(0, "*")).toBe(3);
    expect(sent).toHaveLength(1);
    const records = JSON.parse(sent[0]!).resourceLogs.map(
      (r: any) => r.scopeLogs[0].logRecords[0],
    );
    expect(records.map((r: any) => r.eventName)).toEqual(["a", "b", "c"]);
    expect(records[0].attributes).toEqual([
      { key: "traceway.capture.ids", value: { stringValue: '["cap-1"]' } },
    ]);
  });
});

describe("client persistence", () => {
  it("keeps a batch the exporter could not send in the outbox", async () => {
    const failing: LogRecordExporter = {
      export: (_records, done) => done({ code: ExportResultCode.FAILED }),
      forceFlush: async () => {},
      shutdown: async () => {},
    };
    const client = new TracewayFrontendClient("tok@https://traceway.test", {
      logExporter: failing,
      spanExporter: new InMemorySpanExporter(),
      remoteConfig: false,
      sessionRecording: false,
      captureWebVitals: false,
      captureResourceTiming: false,
    });
    client.start();
    client.captureMessage("offline message");
    await client.flush();
    await vi.waitFor(async () =>
      expect((await listByToken(OUTBOX_STORE, "tok")).length).toBeGreaterThan(
        0,
      ),
    );
    const [batch] = await listByToken(OUTBOX_STORE, "tok");
    expect(batch!.kind).toBe("logs");
    expect(batch!.body).toContain("offline message");
    await client.shutdown();
  });
});

describe("persistence transitions", () => {
  it("retries on connectivity recovery without a visibility change", async () => {
    let online = false;
    const send = vi.fn(async () =>
      online ? ("sent" as const) : ("retry" as const),
    );
    const outbox = new Outbox("retry", send);
    outbox.start();
    try {
      await outbox.add("logs", "body");
      await outbox.drain();
      online = true;
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(async () =>
        expect(await listByToken(OUTBOX_STORE, "retry")).toHaveLength(0),
      );
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      outbox.stop();
    }
  });

  it("retains lookback through three pages and enforces current export limits", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(null, { status: 200 });
    });
    const make = () => {
      const client = new TracewayFrontendClient("pages@https://traceway.test", {
        remoteConfig: false,
        sessionRecording: false,
        captureNetwork: false,
        captureLogs: false,
        captureWebVitals: false,
        captureResourceTiming: false,
        logExporter: {
          export: (_records, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: async () => {},
        },
        spanExporter: new InMemorySpanExporter(),
      });
      client.start();
      return client;
    };
    let current = make();
    try {
      const sessionId = current.currentSessionId();
      current.track("page_a");
      window.dispatchEvent(new Event("pagehide"));
      await current.flush();
      await current.shutdown();
      current = make();
      expect(current.currentSessionId()).toBe(sessionId);
      current.track("page_b");
      window.dispatchEvent(new Event("pagehide"));
      await current.flush();
      await current.shutdown();
      current = make();
      await current.flush();
      current.runAction({
        type: "flush",
        lookbackSeconds: 600,
        signals: ["custom"],
      });
      await current.flush();
      expect(sent.join("\n")).toContain("page_a");
      expect(sent.join("\n")).toContain("page_b");
    } finally {
      await current.shutdown();
      vi.unstubAllGlobals();
    }
  });
});
