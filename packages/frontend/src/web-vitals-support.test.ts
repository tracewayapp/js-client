import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock(
  "@opentelemetry/browser-instrumentation/experimental/web-vitals",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@opentelemetry/browser-instrumentation/experimental/web-vitals")
      >();
    class CountedWebVitalsInstrumentation
      extends actual.WebVitalsInstrumentation
    {
      constructor(
        ...args: ConstructorParameters<typeof actual.WebVitalsInstrumentation>
      ) {
        super(...args);
        constructed.count++;
      }
    }
    return {
      ...actual,
      WebVitalsInstrumentation: CountedWebVitalsInstrumentation,
    };
  },
);

vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import { TracewayFrontendClient } from "./client.js";

let client: TracewayFrontendClient | undefined;
const nativeAt = Object.getOwnPropertyDescriptor(Array.prototype, "at")!;

function start(): void {
  client = new TracewayFrontendClient(
    "tok_123@https://traceway.test/api/report",
    {
      logExporter: new InMemoryLogRecordExporter(),
      spanExporter: new InMemorySpanExporter(),
      captureWebVitals: true,
      captureResourceTiming: false,
      sessionRecording: false,
      remoteConfig: false,
    },
  );
  client.start();
}

afterEach(async () => {
  Object.defineProperty(Array.prototype, "at", nativeAt);
  await client?.shutdown();
  client = undefined;
  constructed.count = 0;
  sessionStorage.clear();
  localStorage.clear();
});

describe("web vitals", () => {
  it("are collected where Array.prototype.at exists", () => {
    start();
    expect(constructed.count).toBe(1);
  });

  it("are skipped on browsers without Array.prototype.at", () => {
    Object.defineProperty(Array.prototype, "at", {
      ...nativeAt,
      value: undefined,
    });
    start();
    expect(constructed.count).toBe(0);
  });
});
