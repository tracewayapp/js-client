import { describe, it, expect } from "vitest";
import { formatErrorStackTrace } from "./stack-trace.js";

describe("formatErrorStackTrace", () => {
  it("should format a standard Error", () => {
    const err = new Error("something went wrong");
    const result = formatErrorStackTrace(err);
    expect(result).toMatch(/^Error: something went wrong\n/);
    expect(result).toContain("()");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("should format a TypeError", () => {
    const err = new TypeError("cannot read property x of null");
    const result = formatErrorStackTrace(err);
    expect(result).toMatch(/^TypeError: cannot read property x of null\n/);
  });

  it("should format a RangeError", () => {
    const err = new RangeError("invalid index");
    const result = formatErrorStackTrace(err);
    expect(result).toMatch(/^RangeError: invalid index\n/);
  });

  it("should produce Go-like format with function name and file:line", () => {
    const err = new Error("test");
    const result = formatErrorStackTrace(err);
    const lines = result.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toBe("Error: test");
    // second line should be a function name ending with ()
    expect(lines[1]).toMatch(/\(\)$/);
    // third line should be indented with file:line
    expect(lines[2]).toMatch(/^\s+.+:\d+$/);
  });

  it("should shorten file paths to just filename", () => {
    const err = new Error("test");
    const result = formatErrorStackTrace(err);
    const lines = result.trim().split("\n");
    const fileLine = lines.find((l) => l.startsWith("    "));
    expect(fileLine).toBeDefined();
    expect(fileLine).not.toContain("/");
  });

  it("should shorten function names by removing module prefix", () => {
    const err = new Error("test");
    const result = formatErrorStackTrace(err);
    const lines = result.trim().split("\n");
    const funcLine = lines.find((l) => l.endsWith("()") && !l.startsWith(" "));
    expect(funcLine).toBeDefined();
  });

  it("should handle error with empty message", () => {
    const err = new Error("");
    const result = formatErrorStackTrace(err);
    expect(result).toMatch(/^Error: \n/);
  });

  it("should handle custom error classes", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const err = new CustomError("custom message");
    const result = formatErrorStackTrace(err);
    expect(result).toMatch(/^CustomError: custom message\n/);
  });

  it("should handle error without stack", () => {
    const err = new Error("no stack");
    err.stack = undefined;
    const result = formatErrorStackTrace(err);
    expect(result).toBe("Error: no stack\n");
  });
});
