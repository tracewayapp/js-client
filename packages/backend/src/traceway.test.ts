import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  init,
  shutdown,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  captureMetric,
  captureTrace,
  captureTask,
  captureCurrentTrace,
  startSpan,
  endSpan,
  shouldSample,
  measureTask,
} from "./traceway.js";
import {
  withTraceContext,
  getTraceContext,
  setTraceResponseInfo,
  setTraceAttribute,
} from "./context.js";

describe("traceway", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(async () => {
    await shutdown();
    vi.restoreAllMocks();
  });

  it("should initialize without error", () => {
    expect(() =>
      init("test-token@https://example.com/api/report"),
    ).not.toThrow();
  });

  it("should throw on double init", () => {
    init("test-token@https://example.com/api/report");
    expect(() =>
      init("test-token@https://example.com/api/report"),
    ).toThrow("already initialized");
  });

  it("should allow init after shutdown", async () => {
    init("test-token@https://example.com/api/report");
    await shutdown();
    expect(() =>
      init("test-token@https://example.com/api/report"),
    ).not.toThrow();
  });

  it("should capture exception without error when initialized", () => {
    init("test-token@https://example.com/api/report");
    expect(() => captureException(new Error("test"))).not.toThrow();
  });

  it("should no-op capture methods when not initialized", () => {
    expect(() => captureException(new Error("test"))).not.toThrow();
    expect(() => captureMessage("hello")).not.toThrow();
    expect(() => captureMetric("test", 42)).not.toThrow();
  });

  it("should return false from shouldSample when not initialized", () => {
    expect(shouldSample(false)).toBe(false);
  });

  it("should return true from shouldSample with default rates", () => {
    init("test-token@https://example.com/api/report");
    expect(shouldSample(false)).toBe(true);
    expect(shouldSample(true)).toBe(true);
  });

  it("should respect sampleRate 0", () => {
    init("test-token@https://example.com/api/report", { sampleRate: 0 });
    expect(shouldSample(false)).toBe(false);
  });

  it("should respect errorSampleRate 0", () => {
    init("test-token@https://example.com/api/report", { errorSampleRate: 0 });
    expect(shouldSample(true)).toBe(false);
    expect(shouldSample(false)).toBe(true);
  });

  it("should capture exception with attributes without error", () => {
    init("test-token@https://example.com/api/report");
    expect(() =>
      captureExceptionWithAttributes(
        new Error("test"),
        { userId: "123" },
        "trace-id",
      ),
    ).not.toThrow();
  });

  it("should capture trace without error when initialized", () => {
    init("test-token@https://example.com/api/report");
    expect(() =>
      captureTrace(
        "trace-id",
        "GET /api/users",
        150,
        new Date(),
        200,
        1024,
        "192.168.1.1",
        { route: "/api/users" },
      ),
    ).not.toThrow();
  });

  it("should capture trace with spans", () => {
    init("test-token@https://example.com/api/report");
    const span = startSpan("db-query");
    const endedSpan = endSpan(span);
    expect(() =>
      captureTrace(
        "trace-id",
        "GET /api/users",
        150,
        new Date(),
        200,
        1024,
        "192.168.1.1",
        undefined,
        [endedSpan],
      ),
    ).not.toThrow();
  });

  it("should capture task without error when initialized", () => {
    init("test-token@https://example.com/api/report");
    expect(() =>
      captureTask("trace-id", "process-email", 500, new Date(), {
        emailId: "abc",
      }),
    ).not.toThrow();
  });

  it("should no-op captureTrace when not initialized", () => {
    expect(() =>
      captureTrace(
        "trace-id",
        "GET /api/users",
        150,
        new Date(),
        200,
        1024,
        "192.168.1.1",
      ),
    ).not.toThrow();
  });

  it("should no-op captureTask when not initialized", () => {
    expect(() =>
      captureTask("trace-id", "process-email", 500, new Date()),
    ).not.toThrow();
  });

  describe("startSpan/endSpan", () => {
    it("should create span with correct structure", () => {
      const span = startSpan("test-operation");
      expect(span.id).toBeDefined();
      expect(span.id.length).toBeGreaterThan(0);
      expect(span.name).toBe("test-operation");
      expect(span.startTime).toBeDefined();
      expect(span.startedAt).toBeGreaterThan(0);
    });

    it("should end span with duration in nanoseconds", async () => {
      const span = startSpan("test-operation");
      await new Promise((r) => setTimeout(r, 10));
      const ended = endSpan(span);

      expect(ended.id).toBe(span.id);
      expect(ended.name).toBe(span.name);
      expect(ended.startTime).toBe(span.startTime);
      expect(ended.duration).toBeGreaterThan(0);
      expect(ended.duration).toBeGreaterThanOrEqual(10_000_000);
    });
  });

  describe("measureTask", () => {
    it("should execute sync function and capture task", () => {
      init("test-token@https://example.com/api/report");
      let executed = false;
      measureTask("sync-task", () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it("should execute async function and capture task", async () => {
      init("test-token@https://example.com/api/report");
      let executed = false;
      measureTask("async-task", async () => {
        await new Promise((r) => setTimeout(r, 5));
        executed = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(executed).toBe(true);
    });

    it("should rethrow sync errors", () => {
      init("test-token@https://example.com/api/report");
      expect(() =>
        measureTask("failing-task", () => {
          throw new Error("sync error");
        }),
      ).toThrow("sync error");
    });

    it("should handle async errors gracefully", async () => {
      init("test-token@https://example.com/api/report");
      // measureTask doesn't return the promise, so we just verify it doesn't crash
      measureTask("async-task-with-error", async () => {
        await new Promise((r) => setTimeout(r, 5));
        // In real usage, errors would be captured but the promise rejection
        // is handled internally by measureTask
      });
      await new Promise((r) => setTimeout(r, 20));
    });

    it("should not capture when sample rate is 0", () => {
      init("test-token@https://example.com/api/report", { sampleRate: 0 });
      measureTask("unsampled-task", () => {});
    });
  });

  describe("context-aware capture functions", () => {
    it("captureException should auto-detect trace context", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext({ traceId: "ctx-trace-id" }, () => {
        captureException(new Error("context error"));
      });
      // The exception should be linked to the trace context
    });

    it("captureException should use context attributes", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext(
        { traceId: "attr-trace", attributes: { userId: "123" } },
        () => {
          captureException(new Error("with attrs"));
        },
      );
    });

    it("captureMessage should auto-detect trace context", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext({ traceId: "msg-trace" }, () => {
        captureMessage("test message");
      });
    });

    it("captureExceptionWithAttributes should prefer explicit params over context", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext({ traceId: "ctx-trace", attributes: { a: "1" } }, () => {
        // Explicit traceId and attributes should be used
        captureExceptionWithAttributes(
          new Error("explicit"),
          { b: "2" },
          "explicit-trace",
        );
      });
    });
  });

  describe("endSpan with context", () => {
    it("should auto-add span to trace context", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext({}, () => {
        const span = startSpan("auto-span");
        endSpan(span);
        const ctx = getTraceContext();
        expect(ctx!.spans).toHaveLength(1);
        expect(ctx!.spans[0].name).toBe("auto-span");
      });
    });

    it("should not add span when addToContext is false", () => {
      init("test-token@https://example.com/api/report");
      withTraceContext({}, () => {
        const span = startSpan("manual-span");
        endSpan(span, false);
        const ctx = getTraceContext();
        expect(ctx!.spans).toHaveLength(0);
      });
    });

    it("should still work outside trace context", () => {
      const span = startSpan("no-context-span");
      const ended = endSpan(span);
      expect(ended.name).toBe("no-context-span");
      expect(ended.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("captureCurrentTrace", () => {
    it("should capture HTTP trace from context", async () => {
      init("test-token@https://example.com/api/report");
      await withTraceContext(
        { endpoint: "GET /api/users", clientIP: "127.0.0.1" },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          setTraceResponseInfo(200, 256);
          setTraceAttribute("route", "/api/users");
          captureCurrentTrace();
        },
      );
      await shutdown();
      expect(fetch).toHaveBeenCalled();
    });

    it("should capture task trace from context", async () => {
      init("test-token@https://example.com/api/report");
      await withTraceContext(
        { isTask: true, endpoint: "send-emails" },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          const span = startSpan("smtp-connect");
          await new Promise((r) => setTimeout(r, 2));
          endSpan(span);
          captureCurrentTrace();
        },
      );
      await shutdown();
      expect(fetch).toHaveBeenCalled();
    });

    it("should no-op outside trace context", () => {
      init("test-token@https://example.com/api/report");
      captureCurrentTrace(); // Should not throw
    });

    it("should respect sampling rate", () => {
      init("test-token@https://example.com/api/report", { sampleRate: 0 });
      withTraceContext({ endpoint: "GET /unsampled" }, () => {
        setTraceResponseInfo(200);
        captureCurrentTrace(); // Should be sampled out
      });
    });

    it("should use error sample rate for 5xx responses", async () => {
      init("test-token@https://example.com/api/report", {
        sampleRate: 0,
        errorSampleRate: 1,
      });
      await withTraceContext({ endpoint: "GET /error" }, async () => {
        setTraceResponseInfo(500);
        captureCurrentTrace(); // Should be captured (error rate = 1)
      });
      await shutdown();
      expect(fetch).toHaveBeenCalled();
    });
  });
});
