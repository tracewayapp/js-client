import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withTraceContext,
  getTraceContext,
  setTraceResponseInfo,
  captureCurrentTrace,
  hasTraceContext,
} from "@tracewayapp/backend";
import { TracewayMiddleware } from "./traceway.middleware.js";
import type { TracewayModuleOptions } from "./traceway.interfaces.js";

vi.mock("@tracewayapp/backend", () => ({
  withTraceContext: vi.fn(),
  getTraceContext: vi.fn(),
  setTraceResponseInfo: vi.fn(),
  captureCurrentTrace: vi.fn(),
  hasTraceContext: vi.fn(() => false),
}));

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    path: "/",
    route: undefined as { path: string } | undefined,
    headers: {} as Record<string, string | string[]>,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as any;
}

function createRes(headers: Record<string, string> = {}) {
  const listeners: Record<string, Function[]> = {};
  return {
    statusCode: 200,
    on(event: string, cb: Function) {
      (listeners[event] ||= []).push(cb);
    },
    get(header: string) {
      return headers[header.toLowerCase()];
    },
    emit(event: string) {
      listeners[event]?.forEach((cb) => cb());
    },
  } as any;
}

function setup(options: Partial<TracewayModuleOptions> = {}) {
  const opts: TracewayModuleOptions = {
    connectionString: "test",
    ...options,
  };

  const middleware = new TracewayMiddleware(opts);
  return middleware;
}

describe("TracewayMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasTraceContext).mockReturnValue(false);
    vi.mocked(withTraceContext).mockImplementation((init, cb) => {
      cb();
    });
  });

  it("resolves parameterized route correctly", () => {
    const ctx = { endpoint: "", clientIP: "" };
    vi.mocked(getTraceContext).mockReturnValue(ctx as any);

    const req = createReq({
      method: "GET",
      path: "/users/123",
      route: { path: "/users/:id" },
    });
    const res = createRes({ "content-length": "42" });
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);
    res.emit("finish");

    expect(ctx.endpoint).toBe("GET /users/:id");
  });

  it("falls back to raw path when route is undefined (404)", () => {
    const ctx = { endpoint: "", clientIP: "" };
    vi.mocked(getTraceContext).mockReturnValue(ctx as any);

    const req = createReq({
      method: "GET",
      path: "/nonexistent",
      route: undefined,
    });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);
    res.emit("finish");

    expect(ctx.endpoint).toBe("GET /nonexistent");
  });

  it("resolves static route without params", () => {
    const ctx = { endpoint: "", clientIP: "" };
    vi.mocked(getTraceContext).mockReturnValue(ctx as any);

    const req = createReq({
      method: "GET",
      path: "/test-ok",
      route: { path: "/test-ok" },
    });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);
    res.emit("finish");

    expect(ctx.endpoint).toBe("GET /test-ok");
  });

  it("records response info on finish", () => {
    vi.mocked(getTraceContext).mockReturnValue({ endpoint: "" } as any);

    const req = createReq({ route: { path: "/test" } });
    const res = createRes({ "content-length": "1024" });
    res.statusCode = 201;
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);
    res.emit("finish");

    expect(setTraceResponseInfo).toHaveBeenCalledWith(201, 1024);
  });

  it("calls captureCurrentTrace on finish", () => {
    vi.mocked(getTraceContext).mockReturnValue({ endpoint: "" } as any);

    const req = createReq({ route: { path: "/test" } });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);
    res.emit("finish");

    expect(captureCurrentTrace).toHaveBeenCalledOnce();
  });

  it("skips tracing for ignored routes", () => {
    const req = createReq({ path: "/health" });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup({ ignoredRoutes: ["/health"] });
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(withTraceContext).not.toHaveBeenCalled();
  });

  it("skips tracing when already in a trace context", () => {
    vi.mocked(hasTraceContext).mockReturnValue(true);

    const req = createReq({ path: "/api/data" });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(withTraceContext).not.toHaveBeenCalled();
  });

  it("extracts client IP from x-forwarded-for", () => {
    const req = createReq({
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);

    expect(withTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({ clientIP: "1.2.3.4" }),
      expect.any(Function),
    );
  });

  it("falls back to req.ip for client IP", () => {
    const req = createReq({ ip: "10.0.0.1", headers: {} });
    const res = createRes();
    const next = vi.fn();

    const middleware = setup();
    middleware.use(req, res, next);

    expect(withTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({ clientIP: "10.0.0.1" }),
      expect.any(Function),
    );
  });
});
