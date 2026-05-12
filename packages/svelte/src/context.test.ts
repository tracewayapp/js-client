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
  recordAction: vi.fn(),
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
      recordAction: traceway.recordAction,
    });
  });

  it("calls traceway.init synchronously, not deferred to onMount", () => {
    // Simulate "component not yet mounted" — onMount callback never fires.
    (onMount as ReturnType<typeof vi.fn>).mockImplementation(() => {});

    setupTraceway({
      connectionString: "test-token@https://example.com/api/report",
      options: { debug: true },
    });

    expect(traceway.init).toHaveBeenCalledWith(
      "test-token@https://example.com/api/report",
      { debug: true },
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

describe("captureSvelteError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards Error values to captureException", async () => {
    const { captureSvelteError } = await import("./context.js");
    const err = new Error("boom");
    captureSvelteError(err);
    expect(traceway.captureException).toHaveBeenCalledWith(err);
    expect(traceway.captureMessage).not.toHaveBeenCalled();
  });

  it("forwards non-Error values to captureMessage", async () => {
    const { captureSvelteError } = await import("./context.js");
    captureSvelteError("just a string");
    expect(traceway.captureMessage).toHaveBeenCalledWith("just a string");
    expect(traceway.captureException).not.toHaveBeenCalled();
  });
});

describe("<svelte:boundary> integration (Svelte 5 recipe)", () => {
  // The README documents the pattern:
  //   <svelte:boundary onerror={(error) => captureSvelteError(error)}>
  //     <YourApp />
  //   </svelte:boundary>
  // We can't compile a real .svelte component in this package's test setup,
  // but we can simulate what Svelte does when a child throws: it invokes the
  // `onerror` callback with the thrown value. These tests pin the contract.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures a component render error when wired through onerror", async () => {
    const { captureSvelteError } = await import("./context.js");

    // Simulate `<svelte:boundary onerror={...}>` calling its handler.
    function simulateBoundary(child: () => void) {
      const onerror = (error: unknown) => captureSvelteError(error);
      try {
        child();
      } catch (error) {
        onerror(error);
      }
    }

    function ChildComponent() {
      throw new Error("svelte-render-error");
    }

    simulateBoundary(ChildComponent);

    expect(traceway.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "svelte-render-error" }),
    );
  });

  it("captures a non-Error throw from a component as a message", async () => {
    const { captureSvelteError } = await import("./context.js");

    function simulateBoundary(child: () => void) {
      const onerror = (error: unknown) => captureSvelteError(error);
      try {
        child();
      } catch (error) {
        onerror(error);
      }
    }

    function ChildComponent() {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string-from-svelte";
    }

    simulateBoundary(ChildComponent);

    expect(traceway.captureMessage).toHaveBeenCalledWith("string-from-svelte");
  });
});
