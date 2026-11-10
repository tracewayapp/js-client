import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteConfig } from "./client.js";
import { OpampHttpClient } from "./client.js";
import type { ServerToAgent } from "./messages.js";
import { AgentCapabilities } from "./messages.js";
import { Writer } from "./wire.js";

const uid = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function serverToAgent(
  msg: Partial<ServerToAgent> & { config?: string; hash?: number[] },
): Uint8Array {
  const w = new Writer();
  if (msg.config !== undefined) {
    w.message(3, (rc) => {
      rc.message(1, (map) =>
        map.message(1, (entry) => {
          entry.string(1, "traceway");
          entry.message(2, (obj) =>
            obj.string(1, msg.config!).string(2, "application/json"),
          );
        }),
      );
      rc.bytes(2, Uint8Array.from(msg.hash ?? [1]));
    });
  }
  if (msg.heartbeatIntervalSeconds)
    w.message(4, (cs) =>
      cs.message(2, (o) => o.uint(4, msg.heartbeatIntervalSeconds!)),
    );
  w.uint(6, msg.flags ?? 0);
  return w.finish();
}

function reply(
  status: number,
  body?: Uint8Array,
  headers: Record<string, string> = {},
): Response {
  return new Response(body as BodyInit | undefined, { status, headers });
}

let requests: Array<{ body: string; headers: Record<string, string> }>;
let responses: Response[];

function client(
  overrides: Partial<ConstructorParameters<typeof OpampHttpClient>[0]> = {},
) {
  const applied: RemoteConfig[] = [];
  const opamp = new OpampHttpClient({
    endpoint: "https://t.test/api/otel/v1/opamp",
    headers: { Authorization: "Bearer tok" },
    instanceUid: uid,
    capabilities:
      AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
    describe: () => ({
      identifying: { "service.name": "web" },
      nonIdentifying: { "user.id": "u-1" },
    }),
    onRemoteConfig: (config) => {
      applied.push(config);
      return { applied: true };
    },
    fetchImpl: async (_url, init) => {
      requests.push({
        body: hex(init!.body as Uint8Array),
        headers: init!.headers as Record<string, string>,
      });
      return responses.shift() ?? reply(200, serverToAgent({}));
    },
    ...overrides,
  });
  return { opamp, applied };
}

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  responses = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpampHttpClient", () => {
  it("applies offered config, reports it at once, then follows the heartbeat", async () => {
    responses.push(
      reply(
        200,
        serverToAgent({
          config: '{"schemaVersion":1}',
          hash: [0xaa, 0xbb],
          heartbeatIntervalSeconds: 120,
        }),
      ),
    );
    const { opamp, applied } = client();
    opamp.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveLength(1);
    expect(new TextDecoder().decode(applied[0]!.configMap.traceway!.body)).toBe(
      '{"schemaVersion":1}',
    );
    expect(requests[0]!.headers["OpAMP-Instance-UID"]).toBe(
      "01020304-0506-0708-090a-0b0c0d0e0f10",
    );
    expect(requests[0]!.headers.Authorization).toBe("Bearer tok");
    expect(requests[0]!.body).toContain(
      hex(new TextEncoder().encode("user.id")),
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body).toContain("aabb");
    expect(opamp.pollIntervalMs()).toBe(120_000);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(3);
    opamp.stop();
  });

  it("does not reapply a config whose hash it already has", async () => {
    responses.push(reply(200, serverToAgent({ config: "{}", hash: [7] })));
    const { opamp, applied } = client({
      appliedConfigHash: Uint8Array.from([7]),
    });
    opamp.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveLength(0);
    opamp.stop();
  });

  it("polls again straight away when the server asks for full state", async () => {
    responses.push(reply(200, serverToAgent({ flags: 1 })));
    const { opamp } = client();
    opamp.start();
    await vi.advanceTimersByTimeAsync(5);
    expect(requests).toHaveLength(2);
    opamp.stop();
  });

  it("honours Retry-After and stops on 401", async () => {
    responses.push(reply(503, undefined, { "Retry-After": "90" }));
    const { opamp } = client();
    opamp.start();
    await vi.advanceTimersByTimeAsync(0);
    await opamp.poll();
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(2);
    opamp.stop();

    requests = [];
    responses.push(reply(401));
    const onUnauthorized = vi.fn();
    const denied = client({ onUnauthorized }).opamp;
    denied.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(requests).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("reports a config it could not apply as failed", async () => {
    responses.push(reply(200, serverToAgent({ config: "nope", hash: [9] })));
    const { opamp } = client({
      onRemoteConfig: () => ({ applied: false, errorMessage: "bad doc" }),
    });
    opamp.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(requests[1]!.body).toContain("09" + "1003");
    expect(requests[1]!.body).toContain(
      hex(new TextEncoder().encode("bad doc")),
    );
    opamp.stop();
  });
  it("does not apply a response after shutdown", async () => {
    let resolve!: (response: Response) => void;
    const { opamp, applied } = client({
      fetchImpl: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    opamp.start();
    opamp.stop();
    resolve(reply(200, serverToAgent({ config: "{}", hash: [8] })));
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(0);
  });
});

describe("legacy capability detection", () => {
  it.each([404, 405, 501])(
    "stops polling after an unsupported endpoint (%s)",
    async (status) => {
      const onUnsupported = vi.fn();
      responses.push(reply(status));
      const { opamp } = client({ onUnsupported });
      opamp.start();
      await opamp.refresh();
      expect(onUnsupported).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(requests).toHaveLength(1);
      opamp.stop();
    },
  );

  it.each([401, 403, 429, 500, 503])(
    "does not mistake status %s for an older server",
    async (status) => {
      const onUnsupported = vi.fn();
      responses.push(reply(status));
      const { opamp } = client({ onUnsupported });
      opamp.start();
      await opamp.poll();
      expect(onUnsupported).not.toHaveBeenCalled();
      opamp.stop();
    },
  );

  it("aborts a stalled capability probe so telemetry can continue", async () => {
    const onUnsupported = vi.fn();
    const { opamp } = client({
      onUnsupported,
      requestTimeoutMs: 100,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    opamp.start();
    const pending = opamp.poll();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(onUnsupported).not.toHaveBeenCalled();
    opamp.stop();
  });
});
