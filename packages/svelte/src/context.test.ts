import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTraceway, TRACEWAY_KEY } from "./context.js";

vi.mock("svelte", () => ({
  setContext: vi.fn(),
  onMount: vi.fn((fn) => fn()),
}));

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
}));

import { setContext, onMount } from "svelte";
import * as traceway from "@tracewayapp/frontend";

describe("setupTraceway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call setContext with TRACEWAY_KEY and context methods", () => {
    setupTraceway({
      connectionString: "test-token@https://example.com/api/report",
    });

    expect(setContext).toHaveBeenCalledWith(TRACEWAY_KEY, {
      captureException: traceway.captureException,
      captureExceptionWithAttributes: traceway.captureExceptionWithAttributes,
      captureMessage: traceway.captureMessage,
    });
  });

  it("should call traceway.init in onMount with connection string and options", () => {
    setupTraceway({
      connectionString: "test-token@https://example.com/api/report",
      options: { debug: true },
    });

    expect(onMount).toHaveBeenCalled();
    expect(traceway.init).toHaveBeenCalledWith(
      "test-token@https://example.com/api/report",
      { debug: true }
    );
  });

  it("should return context value with capture methods", () => {
    const result = setupTraceway({
      connectionString: "test-token@https://example.com/api/report",
    });

    expect(result).toHaveProperty("captureException");
    expect(result).toHaveProperty("captureExceptionWithAttributes");
    expect(result).toHaveProperty("captureMessage");
    expect(result.captureException).toBe(traceway.captureException);
    expect(result.captureExceptionWithAttributes).toBe(
      traceway.captureExceptionWithAttributes
    );
    expect(result.captureMessage).toBe(traceway.captureMessage);
  });
});
