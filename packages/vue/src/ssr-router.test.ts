// @vitest-environment node
// A server-rendered Vue app has one router per request: the plugin must not hand them to the SDK, which lives as
// long as the server does.
import { expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";

const trackRouter = vi.hoisted(() => vi.fn());
vi.mock("@tracewayapp/frontend", async (original) => ({
  ...(await original<typeof import("@tracewayapp/frontend")>()),
  trackRouter,
}));

import { createTracewayPlugin } from "./index.js";

it("hands no router to the SDK while rendering on the server", async () => {
  for (let request = 0; request < 3; request++) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/orders/:id", component: { render: () => h("p", "order") } }],
    });
    const app = createSSRApp({ render: () => h(RouterView) });
    app.use(router);
    app.use(createTracewayPlugin({ token: "tok", baseUrl: "https://traceway.test" }));
    await router.push("/orders/42");
    await router.isReady();
    expect(await renderToString(app)).toBe("<p>order</p>");
  }
  // The plugin looks for the router once more in a microtask.
  await Promise.resolve();
  expect(trackRouter).not.toHaveBeenCalled();
});
