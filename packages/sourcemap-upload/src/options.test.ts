import { describe, expect, it } from "vitest";

import { DEFAULT_URL, getArg, resolveOptions, uploadEndpoint } from "./options";

describe("resolveOptions", () => {
  it("defaults the server to Traceway Cloud when neither --url nor TRACEWAY_URL is given", () => {
    const opts = resolveOptions(["--token", "tok"], {});
    expect(opts.url).toBe("https://cloud.tracewayapp.com");
    expect(opts.url).toBe(DEFAULT_URL);
    expect(opts.token).toBe("tok");
    expect(opts.directory).toBe(".");
  });

  it("treats a blank TRACEWAY_URL (an unset CI secret) as unset", () => {
    expect(resolveOptions([], { TRACEWAY_URL: "" }).url).toBe(DEFAULT_URL);
    expect(resolveOptions([], { TRACEWAY_URL: "   " }).url).toBe(DEFAULT_URL);
  });

  it("uses TRACEWAY_URL for a self-hosted server", () => {
    const opts = resolveOptions([], {
      TRACEWAY_URL: "https://traceway.example.com",
      TRACEWAY_SOURCEMAP_TOKEN: "envtok",
    });
    expect(opts.url).toBe("https://traceway.example.com");
    expect(opts.token).toBe("envtok");
  });

  it("prefers the flags to the environment", () => {
    const opts = resolveOptions(
      ["--url", "https://flag.example.com", "--token", "flagtok", "--directory", "dist/assets"],
      { TRACEWAY_URL: "https://env.example.com", TRACEWAY_SOURCEMAP_TOKEN: "envtok" },
    );
    expect(opts).toEqual({
      url: "https://flag.example.com",
      token: "flagtok",
      directory: "dist/assets",
    });
  });

  it("reads `--url --token x` (an empty CI secret before --token) as no --url", () => {
    const opts = resolveOptions(["--url", "--token", "tok"], {});
    expect(opts.url).toBe(DEFAULT_URL);
    expect(opts.token).toBe("tok");
  });

  it("has no token when neither --token nor TRACEWAY_SOURCEMAP_TOKEN is set", () => {
    expect(resolveOptions([], { TRACEWAY_SOURCEMAP_TOKEN: " " }).token).toBeUndefined();
  });
});

describe("getArg", () => {
  it("returns the value after the flag", () => {
    expect(getArg(["--url", "https://x.example.com"], "--url")).toBe("https://x.example.com");
  });

  it("returns undefined for a missing flag, a flag with no value, or a flag followed by a flag", () => {
    expect(getArg([], "--url")).toBeUndefined();
    expect(getArg(["--url"], "--url")).toBeUndefined();
    expect(getArg(["--url", "--token", "t"], "--url")).toBeUndefined();
  });
});

describe("uploadEndpoint", () => {
  it.each([
    ["https://cloud.tracewayapp.com", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["https://cloud.tracewayapp.com/", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["https://cloud.tracewayapp.com/api", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["https://cloud.tracewayapp.com/api/report/", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["  https://cloud.tracewayapp.com?x=1  ", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["cloud.tracewayapp.com", "https://cloud.tracewayapp.com/api/sourcemaps/upload"],
    ["localhost:8082", "http://localhost:8082/api/sourcemaps/upload"],
    ["http://127.0.0.1:8082", "http://127.0.0.1:8082/api/sourcemaps/upload"],
    ["https://corp.example/traceway", "https://corp.example/traceway/api/sourcemaps/upload"],
    [
      "https://corp.example/traceway/api/sourcemaps/upload",
      "https://corp.example/traceway/api/sourcemaps/upload",
    ],
  ])("%s -> %s", (url, endpoint) => {
    expect(uploadEndpoint(url)).toBe(endpoint);
  });
});
