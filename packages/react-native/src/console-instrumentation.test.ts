import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayReactNativeClient } from "./client.js";
import { installConsoleInstrumentation } from "./console-instrumentation.js";

const ORIGINAL = {
  debug: console.debug,
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

describe("installConsoleInstrumentation", () => {
  let client: TracewayReactNativeClient;

  beforeEach(() => {
    client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );
    console.debug = vi.fn();
    console.log = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.debug = ORIGINAL.debug;
    console.log = ORIGINAL.log;
    console.info = ORIGINAL.info;
    console.warn = ORIGINAL.warn;
    console.error = ORIGINAL.error;
    vi.restoreAllMocks();
  });

  it("mirrors console.{debug,log,info,warn,error} into the log buffer", () => {
    installConsoleInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordLog");

    console.debug("d");
    console.log("l");
    console.info("i");
    console.warn("w");
    console.error("e");

    const calls = recordSpy.mock.calls.map(([level, msg]) => [level, msg]);
    expect(calls).toEqual([
      ["debug", "d"],
      ["info", "l"],
      ["info", "i"],
      ["warn", "w"],
      ["error", "e"],
    ]);
  });

  it("preserves the original console output", () => {
    const origLog = console.log as unknown as ReturnType<typeof vi.fn>;
    installConsoleInstrumentation(client);

    console.log("hello", "world");
    expect(origLog).toHaveBeenCalledWith("hello", "world");
  });

  it("stringifies object args and concatenates with spaces", () => {
    installConsoleInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordLog");

    console.info("user", { id: 7 });
    expect(recordSpy).toHaveBeenCalledWith("info", 'user {"id":7}');
  });

  it("includes Error.stack when an Error is logged", () => {
    installConsoleInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordLog");

    const err = new Error("zap");
    err.stack = "Error: zap\n    at foo";
    console.error("oh no", err);

    const [, msg] = recordSpy.mock.calls[0];
    expect(msg).toContain("oh no");
    expect(msg).toContain("Error: zap");
  });

  it("never breaks the host call when capture throws", () => {
    const origLog = console.log as unknown as ReturnType<typeof vi.fn>;
    installConsoleInstrumentation(client);
    vi.spyOn(client, "recordLog").mockImplementation(() => {
      throw new Error("buffer broke");
    });

    expect(() => console.log("still fires")).not.toThrow();
    expect(origLog).toHaveBeenCalledWith("still fires");
  });
});
