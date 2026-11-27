// @vitest-environment node
// JS2-7: the Vue plugin in a server-rendered app. The SDK itself only runs in the browser.
import { expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { getClient } from "@tracewayapp/frontend";
import { createTracewayPlugin } from "./index.js";

it("renders an app with the plugin on the server, patching nothing and starting nothing", async () => {
  const fetchBefore = globalThis.fetch;
  const errorBefore = console.error;
  const app = createSSRApp({ render: () => h("div", "hi") });
  app.use(createTracewayPlugin({ token: "tok", baseUrl: "https://traceway.test" }));
  expect(await renderToString(app)).toBe("<div>hi</div>");
  expect(globalThis.fetch).toBe(fetchBefore);
  expect(console.error).toBe(errorBefore);
  expect(getClient()).toBeNull();
});
