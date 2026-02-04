import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TracewayErrorBoundary } from "./error-boundary.js";
import * as traceway from "@traceway/frontend";

vi.mock("@traceway/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  init: vi.fn(),
  flush: vi.fn(),
}));

function ThrowingComponent(): React.ReactElement {
  throw new Error("render error");
}

describe("TracewayErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress React error boundary console.error
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render children when no error", () => {
    const { getByText } = render(
      <TracewayErrorBoundary fallback={<div>Error</div>}>
        <div>Hello</div>
      </TracewayErrorBoundary>,
    );
    expect(getByText("Hello")).toBeDefined();
  });

  it("should render fallback when child throws", () => {
    const { getByText } = render(
      <TracewayErrorBoundary fallback={<div>Something went wrong</div>}>
        <ThrowingComponent />
      </TracewayErrorBoundary>,
    );
    expect(getByText("Something went wrong")).toBeDefined();
  });

  it("should call captureException when child throws", () => {
    render(
      <TracewayErrorBoundary fallback={<div>Error</div>}>
        <ThrowingComponent />
      </TracewayErrorBoundary>,
    );
    expect(traceway.captureException).toHaveBeenCalledTimes(1);
    expect(traceway.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render error" }),
    );
  });

  it("should call onError callback when child throws", () => {
    const onError = vi.fn();
    render(
      <TracewayErrorBoundary fallback={<div>Error</div>} onError={onError}>
        <ThrowingComponent />
      </TracewayErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render error" }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });
});
