import { describe, it, expect } from "vitest";
import { formatStackTrace } from "./stack-trace.js";

describe("formatStackTrace", () => {
  it("formats a Hermes/V8-shaped stack", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at handlePay (app/screens/Cart.js:42:11)",
      "    at app/screens/Cart.js:99:3",
    ].join("\n");

    const formatted = formatStackTrace(error);
    expect(formatted).toContain("Error: boom");
    expect(formatted).toContain("handlePay()");
    expect(formatted).toContain("Cart.js:42:11");
    expect(formatted).toContain("<anonymous>()");
    expect(formatted).toContain("Cart.js:99:3");
  });

  it("formats a JavaScriptCore-shaped stack", () => {
    const error = new Error("ios boom");
    error.stack = [
      "handlePay@app/screens/Cart.js:42:11",
      "@app/screens/Cart.js:99:3",
    ].join("\n");

    const formatted = formatStackTrace(error);
    expect(formatted).toContain("Error: ios boom");
    expect(formatted).toContain("handlePay()");
    expect(formatted).toContain("<anonymous>()");
  });

  it("returns just the type and message when no stack is present", () => {
    const error = new Error("no stack");
    error.stack = undefined;

    const formatted = formatStackTrace(error);
    expect(formatted).toBe("Error: no stack\n");
  });
});
