import { describe, expect, it } from "vitest";
import { consoleText, safeJson } from "./safe-json.js";

describe("an Error in a console line or in action data", () => {
  it("is written as its name, message and stack, which are not enumerable", () => {
    const error = new TypeError("cart is undefined");
    const text = consoleText(["save failed", error]);
    expect(text.split("\n")[0]).toBe("save failed TypeError: cart is undefined");
    expect(text).toContain("safe-json.test");
    expect(JSON.parse(safeJson({ error, attempt: 2 }))).toEqual({
      error: expect.stringMatching(/^TypeError: cart is undefined\n/),
      attempt: 2,
    });
  });

  it("has its name and message when there is no stack, and at most 4,096 characters of one", () => {
    const bare = new RangeError("too many items");
    delete (bare as { stack?: string }).stack;
    expect(consoleText([bare])).toBe("RangeError: too many items");

    // JavaScriptCore: the frames only.
    const frames = new Error("boom");
    frames.stack = "save@https://app.test/app.js:10:4\n" + "x".repeat(5000);
    const text = consoleText([frames]);
    expect(text.startsWith("Error: boom\nsave@https://app.test/app.js:10:4\n")).toBe(true);
    expect(text).toHaveLength("Error: boom\n".length + 4096);
  });

  it("runs no getter of the error or of its class, and so leaves out a stack the engine would write with them", () => {
    let reads = 0;
    class AppError extends Error {
      get name(): string {
        reads++;
        return "AppError";
      }
    }
    const error = new AppError("declined");
    expect(consoleText([error])).toBe("Error: declined");
    Object.defineProperty(error, "message", { get: () => (reads++, "from a getter") });
    expect(consoleText([error])).toBe("Error");

    // A stack the app computes itself is not the engine's.
    const computed = new Error("boom");
    Object.defineProperty(computed, "stack", { get: () => (reads++, "from a getter") });
    expect(consoleText([computed])).toBe("Error: boom");
    expect(reads).toBe(0);
  });
});
