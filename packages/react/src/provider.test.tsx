import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TracewayProvider, TracewayContext } from "./provider.js";
import * as traceway from "@traceway/frontend";

vi.mock("@traceway/frontend", () => ({
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
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

  it("should call init with connection string", () => {
    render(
      <TracewayProvider connectionString="token@https://example.com/api/report">
        <div>child</div>
      </TracewayProvider>,
    );
    expect(traceway.init).toHaveBeenCalledWith(
      "token@https://example.com/api/report",
      undefined,
    );
  });

  it("should provide context to children", () => {
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
  });
});
