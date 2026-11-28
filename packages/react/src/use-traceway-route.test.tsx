import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, render, renderHook } from "@testing-library/react";
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  createMemoryRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";

const { setRoute, trackRouter, init } = vi.hoisted(() => ({
  setRoute: vi.fn(),
  trackRouter: vi.fn(),
  init: vi.fn(),
}));
vi.mock("@tracewayapp/frontend", async () => {
  const { routeFromParams } = await import("@tracewayapp/core");
  return {
    setRoute,
    trackRouter,
    init,
    routeFromParams,
    captureException: vi.fn(),
    captureExceptionWithAttributes: vi.fn(),
    captureMessage: vi.fn(),
    recordAction: vi.fn(),
  };
});

import { useTracewayRoute } from "./use-traceway-route.js";
import { TracewayProvider } from "./provider.js";

beforeEach(() => vi.clearAllMocks());

describe("useTracewayRoute", () => {
  it("names the route by a template", () => {
    const { rerender } = renderHook(
      ({ template }: { template: string | null }) => useTracewayRoute(template),
      { initialProps: { template: "/orders/:id" as string | null } },
    );
    expect(setRoute).toHaveBeenLastCalledWith("/orders/:id");
    rerender({ template: null });
    expect(setRoute).toHaveBeenLastCalledWith(null);
  });

  it("rebuilds the template from a path and its params", () => {
    renderHook(() => useTracewayRoute("/orders/8841", { id: "8841" }));
    expect(setRoute).toHaveBeenLastCalledWith("/orders/:id");
    // The shape of the Next.js App Router's useParams() for a catch-all
    renderHook(() =>
      useTracewayRoute("/docs/guides/setup", { slug: ["guides", "setup"] }),
    );
    expect(setRoute).toHaveBeenLastCalledWith("/docs/:slug*");
    renderHook(() => useTracewayRoute("/pricing", null));
    expect(setRoute).toHaveBeenLastCalledWith("/pricing");
    renderHook(() => useTracewayRoute(null, { id: "1" }));
    expect(setRoute).toHaveBeenLastCalledWith(null);
  });

  it("names every page of a React Router <Routes> app from one layout route", () => {
    function Layout() {
      useTracewayRoute(useLocation().pathname, useParams());
      return <Outlet />;
    }
    const app = (path: string) => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div />} />
            <Route path="/teams/:team/orders/:id" element={<div />} />
            <Route path="/files/*" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    render(app("/teams/acme/orders/8841"));
    expect(setRoute).toHaveBeenLastCalledWith("/teams/:team/orders/:id");
    render(app("/files/a/b/c"));
    expect(setRoute).toHaveBeenLastCalledWith("/files/*");
    render(app("/"));
    expect(setRoute).toHaveBeenLastCalledWith("/");
  });

  it("names the second of two pages of one route", () => {
    let go: (to: string) => void = () => {};
    function Layout() {
      useTracewayRoute(useLocation().pathname, useParams());
      go = useNavigate();
      return <Outlet />;
    }
    render(
      <MemoryRouter initialEntries={["/products/blue-shoes"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/products/:slug" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(setRoute.mock.calls).toEqual([["/products/:slug"]]);
    // The SDK starts an unnamed view at the history change, so the same template has to be set again.
    act(() => go("/products/red-boots"));
    expect(setRoute.mock.calls).toEqual([
      ["/products/:slug"],
      ["/products/:slug"],
    ]);
  });
});

describe("TracewayProvider", () => {
  it("hands the app's router to the SDK before it starts", () => {
    const order: string[] = [];
    trackRouter.mockImplementation(() => order.push("trackRouter"));
    init.mockImplementation(() => order.push("init"));
    const router = createMemoryRouter([{ path: "/", element: null }]);
    render(
      <TracewayProvider token="token" baseUrl="https://example.com" router={router}>
        <div />
      </TracewayProvider>,
    );
    expect(trackRouter).toHaveBeenCalledWith(router);
    expect(order).toEqual(["trackRouter", "init"]);
  });

  it("tracks no router when none is given", () => {
    render(
      <TracewayProvider token="token" baseUrl="https://example.com">
        <div />
      </TracewayProvider>,
    );
    expect(trackRouter).not.toHaveBeenCalled();
  });
});
