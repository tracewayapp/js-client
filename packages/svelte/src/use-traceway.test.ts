import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContext = {
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
};

// Mock svelte first
vi.mock("svelte", () => ({
  getContext: vi.fn(),
  setContext: vi.fn(),
  onMount: vi.fn((fn) => fn()),
}));

// Mock @tracewayapp/frontend to avoid deep imports
vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
}));

import { getContext } from "svelte";
import { getTraceway } from "./use-traceway.js";
import { TRACEWAY_KEY } from "./context.js";

describe("getTraceway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return context when it exists", () => {
    vi.mocked(getContext).mockReturnValue(mockContext);

    const result = getTraceway();

    expect(getContext).toHaveBeenCalledWith(TRACEWAY_KEY);
    expect(result).toBe(mockContext);
  });

  // It used to throw; a server render that skipped setupTraceway would crash on it (CONTRACT §13).
  it("returns the SDK's capture functions when the context does not exist", () => {
    vi.mocked(getContext).mockReturnValue(undefined);

    const result = getTraceway();
    expect(result.captureException).toBeDefined();
    expect(result.captureMessage).toBeDefined();
  });

  it("should return all capture methods", () => {
    vi.mocked(getContext).mockReturnValue(mockContext);

    const result = getTraceway();

    expect(result).toHaveProperty("captureException");
    expect(result).toHaveProperty("captureExceptionWithAttributes");
    expect(result).toHaveProperty("captureMessage");
  });
});
