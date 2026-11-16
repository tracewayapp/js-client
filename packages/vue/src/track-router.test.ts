import { describe, expect, it, vi } from "vitest";

const setRoute = vi.hoisted(() => vi.fn());
vi.mock("@tracewayapp/frontend", () => ({ setRoute }));

import { trackRouter } from "./track-router.js";

describe("trackRouter", () => {
  it("reports the deepest matched route pattern", () => {
    let guard: (to: { matched?: Array<{ path: string }> }) => void = () => {};
    trackRouter({ afterEach: (g) => (guard = g) });
    guard({ matched: [{ path: "/orders" }, { path: "/orders/:id" }] });
    expect(setRoute).toHaveBeenLastCalledWith("/orders/:id");
    guard({ matched: [] });
    expect(setRoute).toHaveBeenLastCalledWith(null);
  });
});
