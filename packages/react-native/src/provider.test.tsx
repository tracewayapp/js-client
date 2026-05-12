// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TracewayProvider, TracewayContext } from "./provider.js";
import * as sdk from "./sdk.js";

vi.mock("./sdk.js", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  recordNavigation: vi.fn(),
  setDeviceAttributes: vi.fn(),
  flush: vi.fn(),
}));

describe("TracewayProvider (RN)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls init with the connection string", () => {
    render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <div>child</div>
      </TracewayProvider>,
    );
    expect(sdk.init).toHaveBeenCalledWith(
      "token@https://example.com/api/report",
      undefined,
    );
  });

  it("calls init BEFORE rendering children", () => {
    const callOrder: string[] = [];
    (sdk.init as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("init");
    });

    function MarkerChild() {
      callOrder.push("child-render");
      return null;
    }

    render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <MarkerChild />
      </TracewayProvider>,
    );

    expect(callOrder[0]).toBe("init");
    expect(callOrder).toContain("child-render");
  });

  it("provides context to children", () => {
    let contextValue: any = null;

    function Consumer() {
      contextValue = React.useContext(TracewayContext);
      return null;
    }

    render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <Consumer />
      </TracewayProvider>,
    );

    expect(contextValue).not.toBeNull();
    expect(contextValue.captureException).toBeDefined();
    expect(contextValue.captureMessage).toBeDefined();
    expect(contextValue.recordAction).toBeDefined();
  });
});

describe("TracewayProvider (RN) render-error capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Throwing(): React.ReactElement {
    throw new Error("rn-render-error");
  }

  it("captures render errors thrown by children", () => {
    expect(() =>
      render(
        <TracewayProvider connectionString="token@https://example.com/api/report">
          <Throwing />
        </TracewayProvider>,
      ),
    ).toThrow("rn-render-error");

    expect(sdk.captureException).toHaveBeenCalled();
    expect(sdk.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "rn-render-error" }),
    );
  });

  it("re-throws so the error propagates as it would without Traceway", () => {
    expect(() =>
      render(
        <TracewayProvider connectionString="token@https://example.com/api/report">
          <Throwing />
        </TracewayProvider>,
      ),
    ).toThrow("rn-render-error");
  });

  it("does not capture anything when children render normally", () => {
    render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <div>ok</div>
      </TracewayProvider>,
    );
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("lets an inner TracewayErrorBoundary catch first (closest boundary wins)", async () => {
    const { TracewayErrorBoundary } = await import("./error-boundary.js");
    const { getByText } = render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <TracewayErrorBoundary fallback={<div>inner caught</div>}>
          <Throwing />
        </TracewayErrorBoundary>
      </TracewayProvider>,
    );
    expect(getByText("inner caught")).toBeDefined();
    expect(sdk.captureException).toHaveBeenCalled();
  });
});
