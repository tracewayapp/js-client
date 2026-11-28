import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTraceway } from "./use-traceway.js";
import * as traceway from "@tracewayapp/frontend";

vi.mock("@tracewayapp/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  init: vi.fn(),
  flush: vi.fn(),
}));

describe("useTraceway", () => {
  // It used to throw; an app that calls init() itself would crash on it (CONTRACT §13).
  it("returns the SDK's capture functions when used outside TracewayProvider", () => {
    const { result } = renderHook(() => useTraceway());
    expect(result.current.captureException).toBe(traceway.captureException);
    expect(result.current.captureMessage).toBe(traceway.captureMessage);
    expect(result.current.recordAction).toBe(traceway.recordAction);
  });
});
