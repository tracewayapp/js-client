// CONTRACT §16: init({ token, baseUrl }) with Traceway Cloud by default; the 2.0 connection string still parses.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/** A fresh copy, so its `console.warn` is the spy and its warnings are not marked as logged yet. */
async function load() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return { ...(await import("./connection.js")), warn };
}

describe("resolveEndpoints", () => {
  it("defaults to Traceway Cloud", async () => {
    const { resolveEndpoints, DEFAULT_BASE_URL } = await load();
    expect(DEFAULT_BASE_URL).toBe("https://cloud.tracewayapp.com");
    expect(resolveEndpoints().logs).toBe(
      "https://cloud.tracewayapp.com/api/otel/v1/logs",
    );
    expect(resolveEndpoints(undefined).opamp).toBe(
      "https://cloud.tracewayapp.com/api/otel/v1/opamp",
    );
  });

  it("adds https:// to a URL without a scheme (JS2-1)", async () => {
    const { resolveEndpoints } = await load();
    expect(resolveEndpoints("cloud.tracewayapp.com/api/report").logs).toBe(
      "https://cloud.tracewayapp.com/api/otel/v1/logs",
    );
    expect(resolveEndpoints("traceway.test:8082").base).toBe(
      "https://traceway.test:8082",
    );
    expect(resolveEndpoints("http://127.0.0.1:8082/").base).toBe(
      "http://127.0.0.1:8082",
    );
    expect(resolveEndpoints("HTTPS://T.test").base).toBe("HTTPS://T.test");
  });

  it("rejects a scheme other than HTTP(S), and a URL without a host", async () => {
    const { resolveEndpoints } = await load();
    for (const url of ["ftp://x", "https://", "http:/x", "https://:8080"])
      expect(() => resolveEndpoints(url), url).toThrow("must be an HTTP(S) URL with a host");
  });

  it("takes an empty baseUrl (an environment variable left unset) as Traceway Cloud", async () => {
    const { resolveEndpoints } = await load();
    expect(resolveEndpoints("").base).toBe("https://cloud.tracewayapp.com");
    expect(resolveEndpoints(null).base).toBe("https://cloud.tracewayapp.com");
  });
});

// CONTRACT §16.1: the shared table every SDK tests, row by row.
describe("parseConnectionString: every 2.0 variation (§16.1)", () => {
  it.each([
    ["tok@https://cloud.tracewayapp.com", "https://cloud.tracewayapp.com"],
    ["tok@https://cloud.tracewayapp.com/", "https://cloud.tracewayapp.com"],
    ["tok@https://cloud.tracewayapp.com/api", "https://cloud.tracewayapp.com"],
    ["tok@https://cloud.tracewayapp.com/api/", "https://cloud.tracewayapp.com"],
    ["tok@https://cloud.tracewayapp.com/api/report", "https://cloud.tracewayapp.com"],
    ["tok@https://cloud.tracewayapp.com/api/report/", "https://cloud.tracewayapp.com"],
    ["tok@cloud.tracewayapp.com", "https://cloud.tracewayapp.com"],
    ["tok@cloud.tracewayapp.com/api/report", "https://cloud.tracewayapp.com"],
    ["  tok@https://cloud.tracewayapp.com/api/report  ", "https://cloud.tracewayapp.com"],
    ["tok@http://localhost:8082/api/report", "http://localhost:8082"],
    ["tok@localhost:8082", "http://localhost:8082"],
    ["tok@https://corp.example/traceway/api/report", "https://corp.example/traceway"],
    ["tok@https://cloud.tracewayapp.com/api/report?x=1", "https://cloud.tracewayapp.com"],
  ])("%j → token tok, baseUrl %s", async (input, baseUrl) => {
    const { parseConnectionString, startOptions } = await load();
    expect(parseConnectionString(input)).toMatchObject({ token: "tok", baseUrl });
    // init() with it: the same token and baseUrl.
    expect(startOptions(input)).toEqual({ token: "tok", baseUrl });
  });

  it.each([
    "@https://cloud.tracewayapp.com",
    "tok",
    "tok@",
    "tok@ftp://host",
  ])("%j cannot be read: init() warns once and the SDK stays off", async (input) => {
    const { parseConnectionString } = await load();
    expect(() => parseConnectionString(input)).toThrow();
    const message = (() => {
      try {
        parseConnectionString(input);
      } catch (error) {
        return String(error);
      }
    })();
    expect(message).not.toContain("tok@");
  });

  it("also takes the local hosts over plain HTTP without a scheme", async () => {
    const { normalizeBaseUrl } = await load();
    expect(normalizeBaseUrl("127.0.0.1:8082/api")).toBe("http://127.0.0.1:8082");
    expect(normalizeBaseUrl("10.0.2.2:8082")).toBe("http://10.0.2.2:8082");
    expect(normalizeBaseUrl("[::1]:8082/")).toBe("http://[::1]:8082");
    expect(normalizeBaseUrl("traceway.corp:8443")).toBe("https://traceway.corp:8443");
  });

  it("normalizes a baseUrl passed alone by the same rules", async () => {
    const { normalizeBaseUrl, startOptions } = await load();
    expect(normalizeBaseUrl("https://cloud.tracewayapp.com/api/report")).toBe(
      "https://cloud.tracewayapp.com",
    );
    expect(normalizeBaseUrl(" cloud.tracewayapp.com/api/ ")).toBe("https://cloud.tracewayapp.com");
    expect(normalizeBaseUrl("https://corp.example/traceway/")).toBe("https://corp.example/traceway");
    // init({ token, baseUrl }) keeps what it was given; the endpoints are derived from the normalized URL.
    expect(startOptions({ token: "t", baseUrl: "x.test/api/report" }).baseUrl).toBe("x.test/api/report");
  });
});

describe("startOptions", () => {
  it("takes the options object as it is, without a warning", async () => {
    const { startOptions, warn } = await load();
    const options = { token: "tok", baseUrl: "https://traceway.test", debug: true };
    expect(startOptions(options)).toEqual(options);
    expect(startOptions(options)).not.toBe(options);
    expect(startOptions({ telemetry: { url: "https://collector.test" } })).toEqual({
      telemetry: { url: "https://collector.test" },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["tok@https://traceway.test/api/report", "https://traceway.test"],
    ["tok@https://traceway.test/api", "https://traceway.test"],
    ["tok@https://traceway.test/", "https://traceway.test"],
    ["tok@traceway.test/api/report", "https://traceway.test"],
    ["tok@https://example.com/traceway/api/report", "https://example.com/traceway"],
  ])("reads the 2.0 connection string %s as token + baseUrl %s", async (cs, baseUrl) => {
    const { startOptions } = await load();
    expect(startOptions(cs, { debug: true } as never)).toEqual({
      debug: true,
      token: "tok",
      baseUrl,
    });
  });

  it("warns once that connection strings are deprecated, naming the new form and never the token", async () => {
    const { startOptions, warn } = await load();
    startOptions("secret-token@https://traceway.test/api/report");
    startOptions("secret-token@https://traceway.test/api/report");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      'Traceway: connection strings are deprecated: use init({ token: "…", baseUrl: "https://traceway.test" })',
    );
    startOptions("other@https://cloud.tracewayapp.com/api/report");
    expect(warn.mock.calls[1]![0]).toBe(
      'Traceway: connection strings are deprecated: use init({ token: "…" })',
    );
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret-token");
  });

  it("accepts the transport option and ignores it with one deprecation warning", async () => {
    const { startOptions, warn } = await load();
    expect(startOptions({ token: "t", transport: "legacy" }).token).toBe("t");
    startOptions({ token: "t", transport: "otlp" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      "Traceway: the transport option is deprecated and ignored: telemetry is always sent as OTLP",
    );
  });

  it("says what to pass when there is no token, e.g. a build without its environment variable (JS2-8)", async () => {
    const { startOptions } = await load();
    for (const given of [undefined, null, {}, { token: "" }, { token: undefined }])
      expect(() => startOptions(given as never)).toThrow(
        /^init\(\) needs a token, as in init\(\{ token: "YOUR_TOKEN" \}\), and got (undefined|""): is the environment variable set in this build\?/,
      );
    expect(() =>
      startOptions({ telemetry: { logs: { url: "https://l.test" } } }),
    ).toThrow("all three of telemetry.logs, telemetry.traces and telemetry.metrics");
  });

  it("still rejects a connection string it cannot read", async () => {
    const { startOptions } = await load();
    expect(() => startOptions("no-at-sign")).toThrow("Invalid connection string");
    expect(() => startOptions("tok@ftp://x")).toThrow("HTTP(S)");
    expect(() => startOptions("tok@ftp://x")).not.toThrow("tok@");
  });
});
