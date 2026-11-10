import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync, gunzipSync, strToU8 } from "fflate";
import { LegacyTransport } from "./legacy.js";

const body = (id: string) =>
  JSON.stringify({
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                eventName: "exception",
                timeUnixNano: "1000000000",
                attributes: [
                  {
                    key: "exception.stacktrace",
                    value: { stringValue: "Error: failed" },
                  },
                  { key: "traceway.exception.id", value: { stringValue: id } },
                  { key: "session.id", value: { stringValue: "session" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

afterEach(() => vi.unstubAllGlobals());

describe("legacy report compatibility", () => {
  it("keeps replay attached through a failed export and uses per-exception storage keys", async () => {
    const reports: any[] = [];
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        reports.push(
          JSON.parse(
            new TextDecoder().decode(gunzipSync(init!.body as Uint8Array)),
          ),
        );
        return new Response(null, { status: fail ? 503 : 200 });
      }),
    );
    const legacy = new LegacyTransport("https://old.test", "token", "2.0.0");
    legacy.enabled = true;
    await legacy.recordings("https://old.test/api/recordings", {
      body: gzipSync(
        strToU8(
          JSON.stringify({
            segments: [
              {
                exceptionId: "first",
                sessionId: "session",
                segmentIndex: 0,
                events: [{ type: 2, data: "snapshot" }],
              },
            ],
          }),
        ),
      ) as BodyInit,
    });
    expect((await legacy.sendLogs(body("first"))).status).toBe(503);
    fail = false;
    expect((await legacy.sendLogs(body("first"))).status).toBe(200);
    for (const report of reports) {
      const frame = report.collectionFrames[0];
      expect(frame.stackTraces[0].sessionRecordingId).toBe("first");
      expect(frame.stackTraces[0].sessionId).toBe("session");
      expect(frame.sessionRecordings[0]).toEqual({
        exceptionId: "first",
        events: [{ type: 2, data: "snapshot" }],
        logs: [],
        actions: [],
      });
    }
    await legacy.sendLogs(body("second"));
    expect(
      reports.at(-1).collectionFrames[0].sessionRecordings[0].events,
    ).toEqual([]);
  });

  it("does not send any data before the initial capability result", async () => {
    const send = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", send);
    const legacy = new LegacyTransport("https://old.test", "token", "2.0.0");
    let ready!: () => void;
    legacy.ready = new Promise((resolve) => {
      ready = resolve;
    });
    const pending = legacy.recordings("https://old.test/api/recordings", {
      body: gzipSync(
        strToU8(
          JSON.stringify({
            segments: [
              { sessionId: "session", segmentIndex: 1, events: [{ type: 2 }] },
            ],
          }),
        ),
      ) as BodyInit,
    });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    legacy.enabled = true;
    ready();
    await pending;
    expect(send.mock.calls[0][0]).toBe("https://old.test/api/report");
  });
});
