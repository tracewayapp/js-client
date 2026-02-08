import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpException } from "@nestjs/common";
import {
  captureExceptionWithAttributes,
  getTraceId,
  getTraceContext,
} from "@tracewayapp/backend";
import { TracewayExceptionFilter } from "./traceway.filter.js";
import type { TracewayModuleOptions } from "./traceway.interfaces.js";

vi.mock("@tracewayapp/backend", () => ({
  captureExceptionWithAttributes: vi.fn(),
  getTraceId: vi.fn(() => "trace-123"),
  getTraceContext: vi.fn(() => null),
}));

function createRequest(overrides: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    "user-agent": "test-agent",
    ...(overrides.headers as Record<string, string> || {}),
  };
  return {
    path: "/test",
    query: {},
    body: undefined,
    headers,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
    ...overrides,
  } as any;
}

function createResponse(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn(() => ({ json: jsonFn }));
  return {
    headersSent: false,
    status: statusFn,
    json: jsonFn,
    ...overrides,
  } as any;
}

function createHost(request: any, response: any) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;
}

function setup(options: Partial<TracewayModuleOptions> = {}) {
  const opts: TracewayModuleOptions = {
    connectionString: "test",
    ...options,
  };
  return new TracewayExceptionFilter(opts);
}

describe("TracewayExceptionFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTraceContext).mockReturnValue(null);
    vi.mocked(getTraceId).mockReturnValue("trace-123");
  });

  it("captures a 500 error with attributes", () => {
    const error = new Error("Something broke");
    const req = createRequest();
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup();
    filter.catch(error, host);

    expect(captureExceptionWithAttributes).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ "user agent": "test-agent" }),
      "trace-123",
    );
  });

  it("captures non-HTTP exception and returns 500", () => {
    const req = createRequest();
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup();
    filter.catch("boom", host);

    expect(captureExceptionWithAttributes).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      "trace-123",
    );
    const capturedError = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][0] as Error;
    expect(capturedError.message).toBe("boom");

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("does NOT capture HttpException 400", () => {
    const exception = new HttpException("Bad Request", 400);
    const req = createRequest();
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup();
    filter.catch(exception, host);

    expect(captureExceptionWithAttributes).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("captures HttpException 502", () => {
    const exception = new HttpException("Bad Gateway", 502);
    const req = createRequest();
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup();
    filter.catch(exception, host);

    expect(captureExceptionWithAttributes).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('records URL when onErrorRecording includes "url"', () => {
    const error = new Error("fail");
    const req = createRequest({ path: "/api/users" });
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup({ onErrorRecording: ["url"] });
    filter.catch(error, host);

    const attrs = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][1] as Record<string, string>;
    expect(attrs["url"]).toBe("/api/users");
  });

  it('records query when onErrorRecording includes "query"', () => {
    const error = new Error("fail");
    const req = createRequest({ query: { page: "2" } });
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup({ onErrorRecording: ["query"] });
    filter.catch(error, host);

    const attrs = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][1] as Record<string, string>;
    expect(attrs["query"]).toBe('{"page":"2"}');
  });

  it('records body when onErrorRecording includes "body"', () => {
    const error = new Error("fail");
    const req = createRequest({
      body: { name: "test" },
      headers: { "content-type": "application/json", "user-agent": "test-agent" },
    });
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup({ onErrorRecording: ["body"] });
    filter.catch(error, host);

    const attrs = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][1] as Record<string, string>;
    expect(attrs["body"]).toBe('{"name":"test"}');
  });

  it('records headers (without auth/cookie) when onErrorRecording includes "headers"', () => {
    const error = new Error("fail");
    const req = createRequest({
      headers: {
        "user-agent": "test-agent",
        "authorization": "Bearer secret",
        "cookie": "session=abc",
        "x-custom": "value",
      },
    });
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup({ onErrorRecording: ["headers"] });
    filter.catch(error, host);

    const attrs = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][1] as Record<string, string>;
    const parsedHeaders = JSON.parse(attrs["headers"]);
    expect(parsedHeaders).not.toHaveProperty("authorization");
    expect(parsedHeaders).not.toHaveProperty("cookie");
    expect(parsedHeaders["x-custom"]).toBe("value");
  });

  it("merges trace context attributes", () => {
    vi.mocked(getTraceContext).mockReturnValue({
      attributes: { userId: "42" },
    } as any);

    const error = new Error("fail");
    const req = createRequest();
    const res = createResponse();
    const host = createHost(req, res);

    const filter = setup();
    filter.catch(error, host);

    const attrs = vi.mocked(captureExceptionWithAttributes).mock
      .calls[0][1] as Record<string, string>;
    expect(attrs["userId"]).toBe("42");
  });

  it("does not send response if headers already sent", () => {
    const error = new Error("fail");
    const req = createRequest();
    const res = createResponse({ headersSent: true });
    const host = createHost(req, res);

    const filter = setup();
    filter.catch(error, host);

    expect(res.status).not.toHaveBeenCalled();
  });
});
