import { describe, it, expect } from "vitest";
import {
  parseConnectionString,
  generateUUID,
  msToNanoseconds,
  nowISO,
} from "./utils.js";

describe("parseConnectionString", () => {
  it("should parse a valid connection string", () => {
    const result = parseConnectionString(
      "mytoken@https://traceway.example.com/api/report",
    );
    expect(result.token).toBe("mytoken");
    expect(result.apiUrl).toBe("https://traceway.example.com/api/report");
  });

  it("should handle @ in the URL portion", () => {
    const result = parseConnectionString(
      "mytoken@https://user@traceway.example.com/api/report",
    );
    expect(result.token).toBe("mytoken");
    expect(result.apiUrl).toBe(
      "https://user@traceway.example.com/api/report",
    );
  });

  it("should throw on missing @", () => {
    expect(() => parseConnectionString("notokenhere")).toThrow(
      "Invalid connection string",
    );
  });

  it("should throw on empty token", () => {
    expect(() => parseConnectionString("@https://example.com")).toThrow(
      "Invalid connection string",
    );
  });

  it("should throw on empty apiUrl", () => {
    expect(() => parseConnectionString("token@")).toThrow(
      "Invalid connection string",
    );
  });
});

describe("generateUUID", () => {
  it("should return a valid UUID v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("should generate unique values", () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });
});

describe("msToNanoseconds", () => {
  it("should convert milliseconds to nanoseconds", () => {
    expect(msToNanoseconds(1)).toBe(1_000_000);
    expect(msToNanoseconds(15.234)).toBe(15_234_000);
    expect(msToNanoseconds(0)).toBe(0);
  });

  it("should round to nearest integer", () => {
    expect(msToNanoseconds(0.0001)).toBe(100);
  });
});

describe("nowISO", () => {
  it("should return a valid ISO 8601 string", () => {
    const iso = nowISO();
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});
