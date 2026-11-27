// CONTRACT §13: what the Svelte integration runs inside the app's components never throws because of the SDK.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte", () => ({
  getContext: vi.fn(),
  setContext: vi.fn(),
  onMount: vi.fn((fn) => fn()),
  onDestroy: vi.fn(),
}));

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  recordAction: vi.fn(),
  setAttributes: vi.fn(),
  removeAttribute: vi.fn(),
}));

import { setContext } from "svelte";
import * as traceway from "@tracewayapp/frontend";
import { captureSvelteError, setupTraceway } from "./context.js";
import { useTracewayAttributes } from "./use-traceway-attributes.js";

const sdkBug = () => {
  throw new Error("sdk bug");
};

afterEach(() => {
  vi.mocked(traceway.init).mockReset();
  vi.mocked(traceway.captureException).mockReset();
  vi.mocked(traceway.captureMessage).mockReset();
});

describe("Svelte integration (JS-1, JS-7)", () => {
  it("setupTraceway() still provides the context when init() fails", () => {
    vi.mocked(traceway.init).mockImplementation(sdkBug);
    let context: unknown;
    expect(() => {
      context = setupTraceway({ token: "" });
    }).not.toThrow();
    expect(setContext).toHaveBeenCalledWith(expect.anything(), context);
    expect(() => setupTraceway(undefined as any)).not.toThrow();
  });

  it("captureSvelteError() never throws, whatever was thrown and whatever the capture does", () => {
    vi.mocked(traceway.captureException).mockImplementation(sdkBug);
    vi.mocked(traceway.captureMessage).mockImplementation(sdkBug);
    expect(() => captureSvelteError(new Error("app"))).not.toThrow();
    expect(() => captureSvelteError(Object.create(null))).not.toThrow();
  });

  it("useTracewayAttributes' sync never throws into the app's $effect (JS2-17)", () => {
    const sync = useTracewayAttributes();
    expect(() => sync({ plan: "pro" })).not.toThrow();
    expect(() => sync("not an object" as never)).not.toThrow();
    expect(traceway.removeAttribute).toHaveBeenCalledWith("plan");
    vi.mocked(traceway.setAttributes).mockImplementation(sdkBug);
    expect(() => sync({ plan: Symbol("x") as never })).not.toThrow();
  });
});
