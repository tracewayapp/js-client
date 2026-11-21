import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import {
  createMemoryHistory as tanstackHistory,
  createRootRoute,
  createRoute,
  createRouter as createTanstackRouter,
} from "@tanstack/react-router";
import { createApp, h } from "vue";
import {
  RouterView,
  createMemoryHistory,
  createRouter as createVueRouter,
} from "vue-router";
import {
  detectRoute,
  findRoute,
  forgetRouters,
  trackRouter,
} from "./route-detect.js";

const page = window as unknown as Record<string, unknown>;

afterEach(() => {
  forgetRouters();
  delete page.__reactRouterDataRouter;
  delete page.__remixRouter;
  delete page.__TSR_ROUTER__;
  delete page.next;
  document.body.innerHTML = "";
});

function reactRouter(path: string, basename?: string) {
  return createMemoryRouter(
    [
      {
        path: "/",
        children: [
          { index: true },
          { path: "orders", children: [{ index: true }, { path: ":id" }] },
          { path: "files/*" },
          { children: [{ path: "/teams/:team/settings" }] },
        ],
      },
    ],
    { initialEntries: [path], basename },
  );
}

describe("React Router data router", () => {
  it.each([
    ["/", "/"],
    ["/orders", "/orders"],
    ["/orders/8841", "/orders/:id"],
    ["/files/a/b/c", "/files/*"],
    // A pathless layout with a child that states its whole path
    ["/teams/acme/settings", "/teams/:team/settings"],
  ])("%s is %s", (path, template) => {
    trackRouter(reactRouter(path));
    expect(detectRoute(path)).toBe(template);
  });

  it("follows a navigation", async () => {
    const router = reactRouter("/orders");
    trackRouter(router);
    await router.navigate("/orders/8841");
    expect(detectRoute("/orders/8841")).toBe("/orders/:id");
    // The view that ended is not named after the route that replaced it.
    expect(detectRoute("/orders")).toBeNull();
  });

  it("matches the address with the router's basename in it", () => {
    trackRouter(reactRouter("/app/orders/8841", "/app"));
    expect(detectRoute("/app/orders/8841")).toBe("/orders/:id");
  });

  it("does not name a path no route matched after the root", () => {
    trackRouter(reactRouter("/nowhere"));
    expect(detectRoute("/nowhere")).toBeNull();
  });

  it("is found where framework mode and Remix leave it", () => {
    page.__reactRouterDataRouter = reactRouter("/orders/8841");
    expect(detectRoute("/orders/8841")).toBe("/orders/:id");
    delete page.__reactRouterDataRouter;
    expect(detectRoute("/orders/8841")).toBeNull();
    page.__remixRouter = reactRouter("/orders/8841");
    expect(detectRoute("/orders/8841")).toBe("/orders/:id");
  });
});

describe("TanStack Router", () => {
  async function router(path: string) {
    const root = createRootRoute();
    const routeTree = root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/" }),
      createRoute({ getParentRoute: () => root, path: "/posts/$postId" }),
    ]);
    const created = createTanstackRouter({
      routeTree,
      history: tanstackHistory({ initialEntries: [path] }),
    });
    await created.load();
    return created;
  }

  it("names a view by the full path of its deepest match", async () => {
    // Creating a router in a browser leaves it on the page, which is where the SDK finds it.
    const created = await router("/posts/42");
    expect(page.__TSR_ROUTER__).toBe(created);
    expect(detectRoute("/posts/42")).toBe("/posts/$postId");
    expect(detectRoute("/posts/43")).toBeNull();
  });

  it("follows a navigation", async () => {
    const created = await router("/");
    expect(detectRoute("/")).toBe("/");
    await created.navigate({ to: "/posts/$postId", params: { postId: "7" } });
    expect(detectRoute("/posts/7")).toBe("/posts/$postId");
  });

  it("says so when the route it shows may still be the one of the page before", async () => {
    let finish: () => void = () => {};
    const loading = new Promise<void>((resolve) => (finish = resolve));
    const root = createRootRoute();
    const created = createTanstackRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/settings" }),
        createRoute({
          getParentRoute: () => root,
          path: "/$team/settings",
          loader: () => loading,
        }),
      ]),
      history: tanstackHistory({ initialEntries: ["/settings"] }),
    });
    await created.load();
    expect(findRoute("/settings")).toEqual({
      template: "/settings",
      settled: true,
    });

    const navigation = created.navigate({
      to: "/$team/settings",
      params: { team: "acme" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The address has moved and the loader has not finished: the old path is the end of the new one.
    expect(created.history.location.pathname).toBe("/acme/settings");
    expect(findRoute("/acme/settings")).toEqual({
      template: "/settings",
      settled: false,
    });
    finish();
    await navigation;
    expect(findRoute("/acme/settings")).toEqual({
      template: "/$team/settings",
      settled: true,
    });
  });
});

describe("Vue Router", () => {
  async function mount(path: string, base?: string) {
    const router = createVueRouter({
      history: createMemoryHistory(base),
      routes: [
        { path: "/", component: { render: () => h("div") } },
        {
          path: "/orders",
          component: { render: () => h(RouterView) },
          children: [
            { path: "", component: { render: () => h("div") } },
            { path: ":id", component: { render: () => h("div") } },
          ],
        },
      ],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const app = createApp({ render: () => h(RouterView) });
    app.use(router);
    await router.push(path);
    app.mount(el);
    return { app, router };
  }

  it("is found through the app Vue leaves on its mount element", async () => {
    await mount("/orders/8841");
    expect(detectRoute("/orders/8841")).toBe("/orders/:id");
    expect(detectRoute("/orders")).toBeNull();
  });

  it("follows a navigation and takes the base into account", async () => {
    const { router } = await mount("/orders", "/shop");
    expect(detectRoute("/shop/orders")).toBe("/orders");
    await router.push("/orders/8841");
    expect(detectRoute("/shop/orders/8841")).toBe("/orders/:id");
  });

  it("names nothing where no route matched", async () => {
    await mount("/nowhere");
    expect(detectRoute("/nowhere")).toBeNull();
  });

  it("is gone with the app", async () => {
    const { app } = await mount("/orders/8841");
    app.unmount();
    expect(detectRoute("/orders/8841")).toBeNull();
  });
});

describe("Next.js Pages Router", () => {
  // The shape of `window.next.router` (next/dist/shared/lib/router/router.js): `pathname` is the page,
  // `asPath` the address without base path and locale.
  it("names a view by its page", () => {
    page.next = {
      router: {
        pathname: "/posts/[id]",
        asPath: "/posts/42?ref=home#comments",
        basePath: "/docs",
        locale: "fr",
      },
    };
    expect(detectRoute("/docs/posts/42")).toBe("/posts/[id]");
    expect(detectRoute("/docs/fr/posts/42")).toBe("/posts/[id]");
    // A locale the router does not report is a prefix like any other: named, and asked for again.
    expect(findRoute("/docs/posts/42")?.settled).toBe(true);
    expect(findRoute("/docs/fr/posts/42")?.settled).toBe(false);
    expect(detectRoute("/docs/posts/43")).toBeNull();
  });

  it("waits for a router that is not there yet", () => {
    page.next = { router: null };
    expect(detectRoute("/posts/42")).toBeNull();
  });
});

describe("detectRoute", () => {
  it("returns null without a router", () => {
    expect(detectRoute("/orders/8841")).toBeNull();
  });

  it("survives a router that throws or reads differently", () => {
    trackRouter({
      get state(): never {
        throw new Error("no");
      },
    });
    trackRouter({ state: { matches: [{ nothing: true }] } });
    expect(detectRoute("/orders/8841")).toBeNull();
    trackRouter(reactRouter("/orders/8841"));
    expect(detectRoute("/orders/8841")).toBe("/orders/:id");
  });

  it("compares the address and the router's path decoded", () => {
    trackRouter(reactRouter("/orders/hello%20world"));
    expect(detectRoute("/orders/hello%20world")).toBe("/orders/:id");
  });
});
