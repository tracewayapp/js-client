import { afterEach, expect, it, vi } from "vitest";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import {
  currentSessionId,
  getClient,
  getInstanceId,
  init,
  log,
  shutdown,
} from "./index.js";

afterEach(async () => {
  await shutdown();
  sessionStorage.clear();
  localStorage.clear();
});

it("reports the running client's session and instance ids, and none before init", async () => {
  expect(currentSessionId()).toBeNull();
  expect(getInstanceId()).toBeNull();

  init("tok_123@https://traceway.test", {
    logExporter: new InMemoryLogRecordExporter(),
    spanExporter: new InMemorySpanExporter(),
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    remoteConfig: false,
  });

  const client = getClient()!;
  expect(currentSessionId()).toBe(client.currentSessionId());
  expect(currentSessionId()).toMatch(/^[0-9a-f-]{36}$/);
  expect(getInstanceId()).toBe(client.instanceId);

  await shutdown();
  expect(currentSessionId()).toBeNull();
});

it("forwards log() to the running client and ignores it before init", async () => {
  expect(() => log("before init", "error")).not.toThrow();

  init("tok_123@https://traceway.test", {
    logExporter: new InMemoryLogRecordExporter(),
    spanExporter: new InMemorySpanExporter(),
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    remoteConfig: false,
  });
  const forwarded = vi.spyOn(getClient()!, "log");
  log("cart synced", "warn", { items: 3 });
  log("default level");
  expect(forwarded.mock.calls).toEqual([
    ["cart synced", "warn", { items: 3 }],
    ["default level", undefined, undefined],
  ]);
});
