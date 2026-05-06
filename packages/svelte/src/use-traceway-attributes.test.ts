import { describe, it, expect, vi, beforeEach } from "vitest";

const setAttributes = vi.fn();
const removeAttribute = vi.fn();

let onDestroyCb: (() => void) | null = null;

vi.mock("svelte", () => ({
  onDestroy: vi.fn((fn) => {
    onDestroyCb = fn;
  }),
}));

vi.mock("@tracewayapp/frontend", () => ({
  setAttributes: (...args: unknown[]) => setAttributes(...args),
  removeAttribute: (...args: unknown[]) => removeAttribute(...args),
}));

import { useTracewayAttributes } from "./use-traceway-attributes.js";

describe("useTracewayAttributes (Svelte)", () => {
  beforeEach(() => {
    setAttributes.mockReset();
    removeAttribute.mockReset();
    onDestroyCb = null;
  });

  it("pushes the initial attributes on first sync", () => {
    const sync = useTracewayAttributes();
    sync({ userId: "1", tenant: "acme" });
    expect(setAttributes).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith({ userId: "1", tenant: "acme" });
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("only pushes deltas when keys/values change", () => {
    const sync = useTracewayAttributes();
    sync({ userId: "1", tenant: "acme" });
    setAttributes.mockClear();

    sync({ userId: "1", tenant: "acme" }); // no change
    expect(setAttributes).not.toHaveBeenCalled();

    sync({ userId: "2", tenant: "acme" }); // userId changed
    expect(setAttributes).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith({ userId: "2" });
  });

  it("removes keys that disappear from the map", () => {
    const sync = useTracewayAttributes();
    sync({ userId: "1", tenant: "acme" });
    setAttributes.mockClear();
    removeAttribute.mockClear();

    sync({ userId: "1" });
    expect(removeAttribute).toHaveBeenCalledWith("tenant");
    expect(setAttributes).not.toHaveBeenCalled();
  });

  it("clears all owned keys on destroy", () => {
    const sync = useTracewayAttributes();
    sync({ userId: "1", tenant: "acme" });
    removeAttribute.mockClear();

    expect(onDestroyCb).not.toBeNull();
    onDestroyCb!();

    expect(removeAttribute).toHaveBeenCalledTimes(2);
    const keys = removeAttribute.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual(["tenant", "userId"]);
  });

  it("treats null / undefined as an empty map", () => {
    const sync = useTracewayAttributes();
    sync({ userId: "1" });
    setAttributes.mockClear();
    removeAttribute.mockClear();

    sync(null);
    expect(removeAttribute).toHaveBeenCalledWith("userId");
  });
});
