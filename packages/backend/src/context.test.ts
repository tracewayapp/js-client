import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withTraceContext,
  getTraceContext,
  getTraceId,
  hasTraceContext,
  addSpanToContext,
  setTraceAttribute,
  setTraceAttributes,
  setTraceResponseInfo,
  getTraceSpans,
  getTraceDuration,
  forkTraceContext,
} from "./context.js";
import type { Span } from "@tracewayapp/core";

describe("context", () => {
  describe("withTraceContext", () => {
    it("should create a trace context with auto-generated traceId", () => {
      withTraceContext({}, () => {
        const ctx = getTraceContext();
        expect(ctx).toBeDefined();
        expect(ctx!.traceId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(ctx!.isTask).toBe(false);
        expect(ctx!.spans).toEqual([]);
        expect(ctx!.attributes).toEqual({});
      });
    });

    it("should use provided traceId", () => {
      withTraceContext({ traceId: "custom-trace-id" }, () => {
        expect(getTraceId()).toBe("custom-trace-id");
      });
    });

    it("should set isTask flag", () => {
      withTraceContext({ isTask: true }, () => {
        expect(getTraceContext()!.isTask).toBe(true);
      });
    });

    it("should set initial attributes", () => {
      withTraceContext({ attributes: { userId: "123" } }, () => {
        expect(getTraceContext()!.attributes).toEqual({ userId: "123" });
      });
    });

    it("should set endpoint and clientIP", () => {
      withTraceContext({ endpoint: "GET /api", clientIP: "192.168.1.1" }, () => {
        const ctx = getTraceContext();
        expect(ctx!.endpoint).toBe("GET /api");
        expect(ctx!.clientIP).toBe("192.168.1.1");
      });
    });

    it("should return the function result", () => {
      const result = withTraceContext({}, () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it("should work with async functions", async () => {
      const result = await withTraceContext({}, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getTraceId();
      });
      expect(result).toBeDefined();
    });

    it("should propagate context through async operations", async () => {
      await withTraceContext({ traceId: "async-trace" }, async () => {
        expect(getTraceId()).toBe("async-trace");

        await new Promise((r) => setTimeout(r, 5));
        expect(getTraceId()).toBe("async-trace");

        await Promise.resolve().then(() => {
          expect(getTraceId()).toBe("async-trace");
        });
      });
    });

    it("should isolate nested contexts", () => {
      withTraceContext({ traceId: "outer" }, () => {
        expect(getTraceId()).toBe("outer");

        withTraceContext({ traceId: "inner" }, () => {
          expect(getTraceId()).toBe("inner");
        });

        expect(getTraceId()).toBe("outer");
      });
    });
  });

  describe("getTraceContext / getTraceId / hasTraceContext", () => {
    it("should return undefined outside of context", () => {
      expect(getTraceContext()).toBeUndefined();
      expect(getTraceId()).toBeUndefined();
      expect(hasTraceContext()).toBe(false);
    });

    it("should return values inside context", () => {
      withTraceContext({ traceId: "test-id" }, () => {
        expect(getTraceContext()).toBeDefined();
        expect(getTraceId()).toBe("test-id");
        expect(hasTraceContext()).toBe(true);
      });
    });
  });

  describe("addSpanToContext", () => {
    it("should add span to current context", () => {
      withTraceContext({}, () => {
        const span: Span = {
          id: "span-1",
          name: "test-span",
          startTime: new Date().toISOString(),
          duration: 1000000,
        };
        addSpanToContext(span);
        expect(getTraceSpans()).toEqual([span]);
      });
    });

    it("should accumulate multiple spans", () => {
      withTraceContext({}, () => {
        addSpanToContext({
          id: "span-1",
          name: "first",
          startTime: new Date().toISOString(),
          duration: 1000000,
        });
        addSpanToContext({
          id: "span-2",
          name: "second",
          startTime: new Date().toISOString(),
          duration: 2000000,
        });
        expect(getTraceSpans()).toHaveLength(2);
        expect(getTraceSpans()[0].name).toBe("first");
        expect(getTraceSpans()[1].name).toBe("second");
      });
    });

    it("should no-op outside context", () => {
      addSpanToContext({
        id: "span-1",
        name: "orphan",
        startTime: new Date().toISOString(),
        duration: 1000000,
      });
      // No error, just ignored
    });
  });

  describe("setTraceAttribute / setTraceAttributes", () => {
    it("should set single attribute", () => {
      withTraceContext({}, () => {
        setTraceAttribute("key", "value");
        expect(getTraceContext()!.attributes).toEqual({ key: "value" });
      });
    });

    it("should set multiple attributes", () => {
      withTraceContext({}, () => {
        setTraceAttributes({ a: "1", b: "2" });
        expect(getTraceContext()!.attributes).toEqual({ a: "1", b: "2" });
      });
    });

    it("should merge with existing attributes", () => {
      withTraceContext({ attributes: { existing: "yes" } }, () => {
        setTraceAttribute("new", "value");
        expect(getTraceContext()!.attributes).toEqual({
          existing: "yes",
          new: "value",
        });
      });
    });

    it("should overwrite existing keys", () => {
      withTraceContext({ attributes: { key: "old" } }, () => {
        setTraceAttribute("key", "new");
        expect(getTraceContext()!.attributes.key).toBe("new");
      });
    });

    it("should no-op outside context", () => {
      setTraceAttribute("key", "value");
      setTraceAttributes({ a: "1" });
      // No error, just ignored
    });
  });

  describe("setTraceResponseInfo", () => {
    it("should set status code and body size", () => {
      withTraceContext({}, () => {
        setTraceResponseInfo(200, 1024);
        const ctx = getTraceContext();
        expect(ctx!.statusCode).toBe(200);
        expect(ctx!.bodySize).toBe(1024);
      });
    });

    it("should set only status code if body size not provided", () => {
      withTraceContext({}, () => {
        setTraceResponseInfo(404);
        const ctx = getTraceContext();
        expect(ctx!.statusCode).toBe(404);
        expect(ctx!.bodySize).toBeUndefined();
      });
    });

    it("should no-op outside context", () => {
      setTraceResponseInfo(200, 100);
      // No error, just ignored
    });
  });

  describe("getTraceDuration", () => {
    it("should return 0 outside context", () => {
      expect(getTraceDuration()).toBe(0);
    });

    it("should return elapsed time", async () => {
      await withTraceContext({}, async () => {
        await new Promise((r) => setTimeout(r, 20));
        const duration = getTraceDuration();
        expect(duration).toBeGreaterThanOrEqual(15);
        expect(duration).toBeLessThan(100);
      });
    });
  });

  describe("forkTraceContext", () => {
    it("should return undefined outside context", () => {
      const result = forkTraceContext(() => 42);
      expect(result).toBeUndefined();
    });

    it("should fork with same traceId", () => {
      withTraceContext({ traceId: "parent-trace" }, () => {
        forkTraceContext(() => {
          expect(getTraceId()).toBe("parent-trace");
        });
      });
    });

    it("should fork with copied attributes", () => {
      withTraceContext({ attributes: { key: "value" } }, () => {
        forkTraceContext(() => {
          expect(getTraceContext()!.attributes).toEqual({ key: "value" });
          // Modify in fork
          setTraceAttribute("forked", "yes");
        });
        // Parent should not have the forked attribute
        expect(getTraceContext()!.attributes).toEqual({ key: "value" });
      });
    });

    it("should have isolated spans that merge back", () => {
      withTraceContext({}, () => {
        addSpanToContext({
          id: "parent-span",
          name: "parent",
          startTime: new Date().toISOString(),
          duration: 1000000,
        });

        forkTraceContext(() => {
          expect(getTraceSpans()).toHaveLength(0); // Forked starts empty
          addSpanToContext({
            id: "forked-span",
            name: "forked",
            startTime: new Date().toISOString(),
            duration: 2000000,
          });
        });

        // After fork completes, spans are merged
        const spans = getTraceSpans();
        expect(spans).toHaveLength(2);
        expect(spans[0].name).toBe("parent");
        expect(spans[1].name).toBe("forked");
      });
    });

    it("should return the forked function result", () => {
      withTraceContext({}, () => {
        const result = forkTraceContext(() => "forked-result");
        expect(result).toBe("forked-result");
      });
    });
  });
});
