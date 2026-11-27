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
});
