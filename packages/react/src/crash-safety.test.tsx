// CONTRACT §13: what the React integration runs inside the app's render and lifecycle never throws because of the
// SDK, and the app's own errors and callbacks behave as they would without Traceway.
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, renderHook } from "@testing-library/react";
import * as traceway from "@tracewayapp/frontend";

vi.mock("@tracewayapp/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  init: vi.fn(),
  trackRouter: vi.fn(),
  setRoute: vi.fn(),
  routeFromParams: vi.fn(),
  flush: vi.fn(),
  setAttributes: vi.fn(),
  removeAttribute: vi.fn(),
}));

import { TracewayProvider } from "./provider.js";
import { TracewayErrorBoundary } from "./error-boundary.js";
import { useTraceway } from "./use-traceway.js";
import { useTracewayRoute } from "./use-traceway-route.js";
import { useTracewayAttributes } from "./use-traceway-attributes.js";

const sdkBug = () => {
  throw new Error("sdk bug");
};

afterEach(() => {
  vi.mocked(traceway.init).mockReset();
  vi.mocked(traceway.trackRouter).mockReset();
  vi.mocked(traceway.captureException).mockReset();
  vi.mocked(traceway.routeFromParams).mockReset();
  vi.restoreAllMocks();
});

function Throwing(): React.ReactElement {
  throw new Error("app render error");
}

describe("TracewayProvider (JS-1, JS-7)", () => {
  it("renders the app when init() or trackRouter() fail", () => {
    vi.mocked(traceway.init).mockImplementation(sdkBug);
    vi.mocked(traceway.trackRouter).mockImplementation(sdkBug);
    const { getByText } = render(
      <TracewayProvider token="" router={{}}>
        <div>ok</div>
      </TracewayProvider>,
    );
    expect(getByText("ok")).toBeDefined();
  });

  it("still rethrows the app's render error when the capture fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(traceway.captureException).mockImplementation(sdkBug);
    expect(() =>
      render(
        <TracewayProvider token="t" baseUrl="https://t.test">
          <Throwing />
        </TracewayProvider>,
      ),
    ).toThrow("app render error");
  });
});

describe("TracewayErrorBoundary (JS-7)", () => {
  it("calls the app's onError and shows the fallback when the capture fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(traceway.captureException).mockImplementation(sdkBug);
    const onError = vi.fn();
    const { getByText } = render(
      <TracewayErrorBoundary fallback={<div>fallback</div>} onError={onError}>
        <Throwing />
      </TracewayErrorBoundary>,
    );
    expect(getByText("fallback")).toBeDefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "app render error" }),
      expect.anything(),
    );
  });
});

describe("hooks", () => {
  it("useTraceway() outside the provider returns the capture functions instead of throwing", () => {
    const { result } = renderHook(() => useTraceway());
    expect(result.current.captureException).toBe(traceway.captureException);
    expect(result.current.captureMessage).toBe(traceway.captureMessage);
  });

  it("useTracewayRoute() renders when the route cannot be built from its params", () => {
    vi.mocked(traceway.routeFromParams).mockImplementation(sdkBug);
    expect(() =>
      renderHook(() => useTracewayRoute("/orders/1", { id: "1" })),
    ).not.toThrow();
    expect(traceway.setRoute).toHaveBeenLastCalledWith("/orders/1");
  });

  it("useTracewayAttributes never breaks the app's render or effects (JS2-17)", () => {
    // A Symbol cannot be written into the fingerprint; a string after an object has no keys to look up.
    const { rerender, unmount } = renderHook(
      ({ attributes }: { attributes: unknown }) => useTracewayAttributes(attributes as never),
      { initialProps: { attributes: { plan: "pro" } as unknown } },
    );
    expect(() => rerender({ attributes: { plan: Symbol("x") } })).not.toThrow();
    expect(() => rerender({ attributes: "not an object" })).not.toThrow();
    expect(traceway.removeAttribute).toHaveBeenCalledWith("plan");
    expect(() => rerender({ attributes: Object.create(null) })).not.toThrow();
    expect(() => unmount()).not.toThrow();
  });
});
