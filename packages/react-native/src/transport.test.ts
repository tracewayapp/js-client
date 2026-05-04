import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gunzipSync, strFromU8 } from "fflate";
import { sendReport } from "./transport.js";

describe("sendReport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs gzipped JSON with Content-Encoding: gzip and returns true on 200", async () => {
    const ok = await sendReport(
      "https://example.com/api/report",
      "tok",
      '{"hello":"world"}',
    );
    expect(ok).toBe(true);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://example.com/api/report");
    const i = init as RequestInit;
    expect(i.method).toBe("POST");
    const headers = i.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Content-Encoding"]).toBe("gzip");

    const body = i.body;
    expect(body).toBeInstanceOf(Uint8Array);
    const decompressed = strFromU8(gunzipSync(body as Uint8Array));
    expect(decompressed).toBe('{"hello":"world"}');
  });

  it("returns false on non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    const ok = await sendReport("https://example.com/api/report", "tok", "{}");
    expect(ok).toBe(false);
  });
});
