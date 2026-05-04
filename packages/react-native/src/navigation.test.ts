import { describe, it, expect, vi } from "vitest";
import { TracewayReactNativeClient } from "./client.js";
import { recordNavigationOn } from "./navigation.js";

describe("recordNavigationOn", () => {
  it("records a 'push' navigation event with from/to", () => {
    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );
    const spy = vi.spyOn(client, "recordNavigationEvent");

    recordNavigationOn(client, "Home", "Cart");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      action: "push",
      from: "Home",
      to: "Cart",
    });
  });

  it("appears as a navigation event in the action buffer", () => {
    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000 },
    );

    recordNavigationOn(client, "Home", "Settings");
    const actions = client.bufferedActions();

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("navigation");
    expect((actions[0] as { from: string }).from).toBe("Home");
    expect((actions[0] as { to: string }).to).toBe("Settings");
  });

  it("respects captureNavigation: false", () => {
    const client = new TracewayReactNativeClient(
      "tok@https://example.com/api/report",
      { debounceMs: 10_000, captureNavigation: false },
    );

    recordNavigationOn(client, "A", "B");
    expect(client.bufferedActions()).toHaveLength(0);
  });
});
