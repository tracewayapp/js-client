// @vitest-environment node
import { describe, it, expect } from "vitest";

describe("loading the SDK without a window (server-side rendering)", () => {
  it("imports and accepts every call without doing anything", async () => {
    expect(typeof window).toBe("undefined");
    const traceway = await import("./index.js");

    traceway.init({ token: "token", baseUrl: "https://traceway.example.com" });
    // Nothing is built on the server: no client, no attributes shared by every request (JS2-19).
    expect(traceway.getClient()).toBeNull();
    traceway.captureException(new Error("server"));
    traceway.captureMessage("server");
    traceway.track("server");
    traceway.metric("server.duration", 1);
    traceway.setAttribute("user.id", "u_1");
    await traceway.flush(100);
    await traceway.shutdown();
  });

  it("keeps no router handed to trackRouter: a server-rendered app creates one per request", async () => {
    const { trackRouter, detectRoute } = await import("./otel/route-detect.js");
    // What the Vue plugin and the React provider's `router` prop hand over while rendering.
    for (let request = 0; request < 3; request++)
      trackRouter({ currentRoute: { value: { path: "/orders/42", matched: [{ path: "/orders/:id" }] } } });
    expect(detectRoute("/orders/42")).toBeNull();
  });
});
