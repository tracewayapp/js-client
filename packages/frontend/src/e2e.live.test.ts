import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("rrweb", () => {
  let emit: ((e: unknown) => void) | null = null;
  const record = Object.assign(
    vi.fn((opts: { emit: (e: unknown) => void }) => {
      emit = opts.emit;
      emit({ type: 4, data: { href: "http://localhost/", width: 800, height: 600 }, timestamp: Date.now() });
      emit({ type: 2, data: { node: {}, initialOffset: { top: 0, left: 0 } }, timestamp: Date.now() });
      return () => {
        emit = null;
      };
    }),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import { TracewayFrontendClient } from "./client.js";

/**
 * Runs the SDK against a live Traceway server. Opt-in, like the CLI smoke tests:
 *   TRACEWAY_E2E_CONNECTION  <project token>@<server url>
 *   TRACEWAY_E2E_JWT         a dashboard session token for the same project's organization
 *   TRACEWAY_E2E_PROJECT     the project id
 * The project needs a rule streaming custom events for `user.id = e2e-user`.
 */
const connection = process.env.TRACEWAY_E2E_CONNECTION;
const jwt = process.env.TRACEWAY_E2E_JWT;
const projectId = process.env.TRACEWAY_E2E_PROJECT;
const server = connection?.slice(connection.indexOf("@") + 1).replace(/\/api\/report$/, "");

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${server}/api${path}${path.includes("?") ? "&" : "?"}projectId=${projectId}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

describe.skipIf(!connection || !jwt || !projectId)("live server", () => {
  let client: TracewayFrontendClient;
  afterAll(async () => {
    await client?.shutdown();
  });

  it("delivers issues, sessions, replay and remote config end to end", async () => {
    const marker = `e2e-${Date.now()}`;
    client = new TracewayFrontendClient(connection!, {
      version: "2.3.1",
      environment: "e2e",
      exportDelayMs: 100,
      captureWebVitals: false,
      captureResourceTiming: false,
    });
    client.start();
    client.track(`${marker}-before-user`);
    client.setAttribute("user.id", "e2e-user");
    await client.refreshConfig();
    expect(client.control.settings().signals.custom.mode).toBe("stream");

    client.track(`${marker}-after-rule`, { step: "payment" });
    client.captureMessage(`${marker} message issue`);
    client.captureException(new TypeError(`${marker} boom`));
    await client.flush();
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const issues = await api<{ data: Array<{ stackTrace: string; exceptionHash: string }> }>("/exception-stack-traces", {
      fromDate: from,
      toDate: to,
      orderBy: "last_seen",
      pagination: { page: 1, pageSize: 50 },
    });
    const boom = issues.data.find((i) => i.stackTrace.includes(`${marker} boom`));
    const message = issues.data.find((i) => i.stackTrace.includes(`${marker} message issue`));
    expect(boom, JSON.stringify(issues.data.map((i) => i.stackTrace.slice(0, 80)))).toBeDefined();
    expect(message).toBeDefined();

    const detail = await api<{ sessionId?: string; sessionRecording?: unknown }>(`/exception-stack-traces/${boom!.exceptionHash}`, {
      fromDate: from,
      toDate: to,
    });
    expect(detail.sessionId).toBe(client.currentSessionId());

    const sessions = await api<{ data: Array<{ id: string; clientIP: string; attributes: Record<string, string> }> }>("/sessions", {
      fromDate: from,
      toDate: to,
      pagination: { page: 1, pageSize: 50 },
    });
    const session = sessions.data.find((s) => s.id === client.currentSessionId());
    expect(session?.attributes["user.id"]).toBe("e2e-user");
    expect(session?.clientIP).toBeTruthy();

    const logs = await api<{ data: Array<{ logAttributes: Record<string, string> }> }>("/logs", {
      fromDate: from,
      toDate: to,
      attributeFilters: [{ scope: "log", key: "event.name", value: marker, contains: true }],
      pagination: { page: 1, pageSize: 100 },
    });
    const events = logs.data.map((l) => l.logAttributes["event.name"]);
    expect(events).toContain(`${marker}-after-rule`);
    expect(events).toContain(`${marker}-before-user`);
  }, 30_000);
});
