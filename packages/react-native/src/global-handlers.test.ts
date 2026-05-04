import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayReactNativeClient } from "./client.js";
import { installGlobalHandlers } from "./global-handlers.js";

interface InstalledErrorUtils {
  setGlobalHandler: ReturnType<typeof vi.fn>;
  getGlobalHandler: ReturnType<typeof vi.fn>;
  current: (error: Error, isFatal?: boolean) => void;
}

function fakeErrorUtils(
  previous: ((error: Error, isFatal?: boolean) => void) | undefined,
): InstalledErrorUtils {
  const fake: InstalledErrorUtils = {
    current: previous ?? (() => {}),
    setGlobalHandler: vi.fn((handler) => {
      fake.current = handler;
    }),
    getGlobalHandler: vi.fn(() => fake.current),
  };
  return fake;
}

describe("installGlobalHandlers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing when ErrorUtils is absent", () => {
    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );
    expect(() => installGlobalHandlers(client)).not.toThrow();
  });

  it("captures errors and forwards to the previous handler", async () => {
    const previous = vi.fn();
    const errorUtils = fakeErrorUtils(previous);
    vi.stubGlobal("ErrorUtils", errorUtils);

    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 20 },
    );
    const addExceptionSpy = vi.spyOn(client, "addException");

    installGlobalHandlers(client);

    expect(errorUtils.setGlobalHandler).toHaveBeenCalledTimes(1);
    expect(errorUtils.getGlobalHandler).toHaveBeenCalledTimes(1);

    const boom = new Error("kaboom");
    errorUtils.current(boom, true);

    expect(addExceptionSpy).toHaveBeenCalledTimes(1);
    const recorded = addExceptionSpy.mock.calls[0][0];
    expect(recorded.isMessage).toBe(false);
    expect(recorded.stackTrace).toContain("kaboom");
    expect(previous).toHaveBeenCalledWith(boom, true);
  });

  it("never lets capture failures break the previous handler chain", () => {
    const previous = vi.fn();
    const errorUtils = fakeErrorUtils(previous);
    vi.stubGlobal("ErrorUtils", errorUtils);

    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );
    vi.spyOn(client, "addException").mockImplementation(() => {
      throw new Error("internal capture failure");
    });

    installGlobalHandlers(client);

    expect(() => errorUtils.current(new Error("oops"))).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("works with no previous handler installed", () => {
    const errorUtils = fakeErrorUtils(undefined);
    vi.stubGlobal("ErrorUtils", errorUtils);

    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );
    const addExceptionSpy = vi.spyOn(client, "addException");

    installGlobalHandlers(client);
    errorUtils.current(new Error("solo"));
    expect(addExceptionSpy).toHaveBeenCalledTimes(1);
  });
});
