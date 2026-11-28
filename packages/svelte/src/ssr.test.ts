// @vitest-environment node
// JS2-7: setupTraceway in a server-rendered Svelte 5 component. The SDK itself only runs in the browser.
import { expect, it } from "vitest";
import { render } from "svelte/server";
import { getClient } from "@tracewayapp/frontend";
import { setupTraceway } from "./index.js";

/** What the Svelte 5 compiler makes of `<script>setupTraceway({ … })</script><div>hi</div>` for the server. */
function App($$renderer: any) {
  $$renderer.component(($$renderer: any) => {
    setupTraceway({ token: "tok", baseUrl: "https://traceway.test" });
    $$renderer.push("<div>hi</div>");
  });
}

it("renders a component that calls setupTraceway on the server, patching nothing and starting nothing", () => {
  const fetchBefore = globalThis.fetch;
  const errorBefore = console.error;
  expect(render(App as never).body).toContain("<div>hi</div>");
  expect(globalThis.fetch).toBe(fetchBefore);
  expect(console.error).toBe(errorBefore);
  expect(getClient()).toBeNull();
});
