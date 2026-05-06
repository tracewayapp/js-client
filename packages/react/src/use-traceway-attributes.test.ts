import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const setAttributes = vi.fn();
const removeAttribute = vi.fn();

vi.mock("@tracewayapp/frontend", () => ({
  setAttributes: (...args: unknown[]) => setAttributes(...args),
  removeAttribute: (...args: unknown[]) => removeAttribute(...args),
}));

import { useTracewayAttributes } from "./use-traceway-attributes.js";

describe("useTracewayAttributes", () => {
  beforeEach(() => {
    setAttributes.mockReset();
    removeAttribute.mockReset();
  });

  it("pushes the initial attributes on mount", () => {
    renderHook(() => useTracewayAttributes({ userId: "1", tenant: "acme" }));
    expect(setAttributes).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith({ userId: "1", tenant: "acme" });
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("only sends deltas when keys/values change", () => {
    const { rerender } = renderHook(
      ({ attrs }: { attrs: Record<string, string> }) =>
        useTracewayAttributes(attrs),
      { initialProps: { attrs: { userId: "1", tenant: "acme" } } },
    );
    setAttributes.mockClear();

    // Same content, new object reference — should NOT trigger a call
    rerender({ attrs: { userId: "1", tenant: "acme" } });
    expect(setAttributes).not.toHaveBeenCalled();

    // userId changes
    rerender({ attrs: { userId: "2", tenant: "acme" } });
    expect(setAttributes).toHaveBeenCalledTimes(1);
    expect(setAttributes).toHaveBeenCalledWith({ userId: "2" });
  });

  it("removes keys that disappear from the map", () => {
    const { rerender } = renderHook(
      ({ attrs }: { attrs: Record<string, string> }) =>
        useTracewayAttributes(attrs),
      { initialProps: { attrs: { userId: "1", tenant: "acme" } } },
    );
    setAttributes.mockClear();
    removeAttribute.mockClear();

    rerender({ attrs: { userId: "1" } });
    expect(removeAttribute).toHaveBeenCalledWith("tenant");
    expect(setAttributes).not.toHaveBeenCalled();
  });

  it("clears all owned keys on unmount", () => {
    const { unmount } = renderHook(() =>
      useTracewayAttributes({ userId: "1", tenant: "acme" }),
    );
    removeAttribute.mockClear();

    act(() => {
      unmount();
    });

    expect(removeAttribute).toHaveBeenCalledTimes(2);
    const keys = removeAttribute.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual(["tenant", "userId"]);
  });

  it("treats null / undefined as an empty map", () => {
    const { rerender } = renderHook(
      ({ attrs }: { attrs: Record<string, string> | null }) =>
        useTracewayAttributes(attrs),
      { initialProps: { attrs: { userId: "1" } as Record<string, string> | null } },
    );
    setAttributes.mockClear();
    removeAttribute.mockClear();

    rerender({ attrs: null });
    expect(removeAttribute).toHaveBeenCalledWith("userId");
  });
});
