import { useEffect } from "react";
import { routeFromParams, setRoute } from "@tracewayapp/frontend";
import type { RouteParams } from "@tracewayapp/frontend";

/**
 * Names the page being shown by its route template, so performance metrics group by route (`/orders/:id`) and
 * not by URL.
 *
 * Most routers need none of this: React Router in framework mode, Remix, TanStack Router and the Next.js Pages
 * Router are read from the page, and a `createBrowserRouter` router is handed over once with `trackRouter(router)`
 * or `<TracewayProvider router={router}>`.
 *
 * Where the router only hands out a path and its params, pass both, once, from a component every page renders:
 *
 *   // React Router with <BrowserRouter> and <Routes>
 *   useTracewayRoute(useLocation().pathname, useParams());
 *
 *   // Next.js App Router, in a client component of the root layout
 *   useTracewayRoute(usePathname(), useParams());
 *
 * Or name a route yourself, from the component it renders: `useTracewayRoute("/orders/:id")`. `null` leaves the
 * name to the router or, without one, to the SDK's replacing of id-like path segments.
 */
export function useTracewayRoute(template: string | null): void;
export function useTracewayRoute(
  pathname: string | null,
  params: RouteParams | null | undefined,
): void;
export function useTracewayRoute(
  path: string | null,
  ...rest: [params?: RouteParams | null]
): void {
  const template =
    path !== null && rest.length ? routeFromParams(path, rest[0]) : path;
  // The path too: called from one layout, two pages of one route give the same template, and the SDK starts an
  // unnamed view at every navigation.
  useEffect(() => {
    setRoute(template);
  }, [template, path]);
}
