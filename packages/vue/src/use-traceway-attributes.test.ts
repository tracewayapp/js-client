import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick, createApp } from "vue";

const setAttributes = vi.fn();
const removeAttribute = vi.fn();

vi.mock("@tracewayapp/frontend", () => ({
  setAttributes: (...args: unknown[]) => setAttributes(...args),
  removeAttribute: (...args: unknown[]) => removeAttribute(...args),
}));

import { useTracewayAttributes } from "./use-traceway-attributes.js";
import { TracewayAttributes } from "./traceway-attributes.js";

function mountWith(attrs: Record<string, string> | null | undefined) {
  const Comp = defineComponent({
    setup() {
      useTracewayAttributes(attrs);
      return () => h("div");
    },
  });
  const container = document.createElement("div");
  const app = createApp(Comp);
  app.mount(container);
  return app;
}

describe("useTracewayAttributes (Vue)", () => {
  beforeEach(() => {
    setAttributes.mockReset();
    removeAttribute.mockReset();
  });

  it("pushes the initial attributes on mount", () => {
    mountWith({ userId: "u_1", tenant: "acme" });
    expect(setAttributes).toHaveBeenCalledWith({
      userId: "u_1",
      tenant: "acme",
    });
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("pushes nothing for an empty map", () => {
    mountWith({});
    expect(setAttributes).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("pushes only the diff when a reactive source changes", async () => {
    const source = ref<Record<string, string>>({
      userId: "u_1",
      tenant: "acme",
    });

    const Comp = defineComponent({
      setup() {
        useTracewayAttributes(source);
        return () => h("div");
      },
    });
    const app = createApp(Comp);
    app.mount(document.createElement("div"));

    expect(setAttributes).toHaveBeenLastCalledWith({
      userId: "u_1",
      tenant: "acme",
    });
    setAttributes.mockClear();

    source.value = { userId: "u_2", tenant: "acme" };
    await nextTick();

    expect(setAttributes).toHaveBeenCalledWith({ userId: "u_2" });
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("removes a dropped key on the next sync", async () => {
    const source = ref<Record<string, string>>({
      userId: "u_1",
      tenant: "acme",
    });

    const Comp = defineComponent({
      setup() {
        useTracewayAttributes(source);
        return () => h("div");
      },
    });
    createApp(Comp).mount(document.createElement("div"));

    source.value = { userId: "u_1" };
    await nextTick();

    expect(removeAttribute).toHaveBeenCalledWith("tenant");
  });

  it("removes every owned key on unmount", () => {
    const app = mountWith({ userId: "u_1", tenant: "acme" });
    removeAttribute.mockClear();

    app.unmount();

    expect(removeAttribute).toHaveBeenCalledWith("userId");
    expect(removeAttribute).toHaveBeenCalledWith("tenant");
  });
});

describe("<TracewayAttributes /> (Vue)", () => {
  beforeEach(() => {
    setAttributes.mockReset();
    removeAttribute.mockReset();
  });

  it("forwards its `attributes` prop into the composable", () => {
    const Comp = defineComponent({
      setup() {
        return () =>
          h(TracewayAttributes, {
            attributes: { userId: "u_1", tenant: "acme" },
          });
      },
    });
    createApp(Comp).mount(document.createElement("div"));

    expect(setAttributes).toHaveBeenCalledWith({
      userId: "u_1",
      tenant: "acme",
    });
  });
});
