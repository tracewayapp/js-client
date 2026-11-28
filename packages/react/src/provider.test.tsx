import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TracewayProvider, TracewayContext } from "./provider.js";
import * as traceway from "@tracewayapp/frontend";

vi.mock("@tracewayapp/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  init: vi.fn(),
  flush: vi.fn(),
}));

describe("TracewayProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls init with the token, the baseUrl and the options in one object (CONTRACT §16)", () => {
    render(
      <TracewayProvider token="token" baseUrl="https://example.com" options={{ debug: true }}>
        <div>child</div>
      </TracewayProvider>,
    );
    expect(traceway.init).toHaveBeenCalledWith({
      token: "token",
      baseUrl: "https://example.com",
      debug: true,
    });
  });

  it("passes the replay privacy limits through to init (§14.5)", () => {
    render(
      <TracewayProvider
        token="token"
        options={{ replayImages: "wifi", collection: { replay: { maskAllInputs: true } } }}
      >
        <div>child</div>
      </TracewayProvider>,
    );
    expect(traceway.init).toHaveBeenCalledWith(
      expect.objectContaining({
        replayImages: "wifi",
        collection: { replay: { maskAllInputs: true } },
      }),
    );
  });

  it("still takes the deprecated connectionString prop", () => {
    render(
      <TracewayProvider connectionString="token@https://example.com/api/report" options={{ debug: true }}>
        <div>child</div>
      </TracewayProvider>,
    );
    expect(traceway.init).toHaveBeenCalledWith("token@https://example.com/api/report", { debug: true });
  });

  it("calls init BEFORE rendering children (init runs in constructor, not componentDidMount)", () => {
    const callOrder: string[] = [];
    (traceway.init as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("init");
    });

    function MarkerChild() {
      callOrder.push("child-render");
      return null;
    }

    render(
      <TracewayProvider token="token" baseUrl="https://example.com">
        <MarkerChild />
      </TracewayProvider>,
    );

    expect(callOrder[0]).toBe("init");
    expect(callOrder).toContain("child-render");
  });

  it("should provide context to children", () => {
    let contextValue: any = null;

    function Consumer() {
      contextValue = React.useContext(TracewayContext);
      return null;
    }

    render(
      <TracewayProvider token="token" baseUrl="https://example.com">
        <Consumer />
      </TracewayProvider>,
    );

    expect(contextValue).not.toBeNull();
    expect(contextValue.captureException).toBeDefined();
    expect(contextValue.captureMessage).toBeDefined();
  });
});

describe("TracewayProvider render-error capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Throwing(): React.ReactElement {
    throw new Error("render-error-from-child");
  }

  it("captures render errors thrown by children", () => {
    expect(() =>
      render(
        <TracewayProvider token="token" baseUrl="https://example.com">
          <Throwing />
        </TracewayProvider>,
      ),
    ).toThrow("render-error-from-child");

    expect(traceway.captureException).toHaveBeenCalled();
    expect(traceway.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render-error-from-child" }),
    );
  });

  it("re-throws so the error propagates as it would without Traceway", () => {
    expect(() =>
      render(
        <TracewayProvider token="token" baseUrl="https://example.com">
          <Throwing />
        </TracewayProvider>,
      ),
    ).toThrow("render-error-from-child");
  });

  it("does not capture anything when children render normally", () => {
    render(
      <TracewayProvider token="token" baseUrl="https://example.com">
        <div>ok</div>
      </TracewayProvider>,
    );
    expect(traceway.captureException).not.toHaveBeenCalled();
  });

  it("lets an inner TracewayErrorBoundary catch first (closest boundary wins)", async () => {
    const { TracewayErrorBoundary } = await import("./error-boundary.js");
    const { getByText } = render(
      <TracewayProvider token="token" baseUrl="https://example.com">
        <TracewayErrorBoundary fallback={<div>inner caught</div>}>
          <Throwing />
        </TracewayErrorBoundary>
      </TracewayProvider>,
    );
    expect(getByText("inner caught")).toBeDefined();
    expect(traceway.captureException).toHaveBeenCalledTimes(1);
  });
});
