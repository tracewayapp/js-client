import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTraceway } from "./use-traceway.js";

vi.mock("@tracewayapp/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  init: vi.fn(),
  flush: vi.fn(),
}));

describe("useTraceway", () => {
  it("should throw when used outside TracewayProvider", () => {
    // Suppress React error logging
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useTraceway());
    }).toThrow("useTraceway must be used within a TracewayProvider");

    vi.restoreAllMocks();
  });
});
