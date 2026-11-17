import { setRoute } from "@tracewayapp/frontend";

interface RouteLike {
  matched?: Array<{ path: string }>;
}

interface RouterLike {
  afterEach(guard: (to: RouteLike) => void): unknown;
}

/**
 * Reports the matched route pattern of every navigation (`/orders/:id`), so performance metrics group by route
 * and not by URL. Pass the vue-router instance once, after creating it.
 */
export function trackRouter(router: RouterLike): void {
  router.afterEach((to) => {
    const matched = to.matched ?? [];
    setRoute(matched.length ? matched[matched.length - 1]!.path : null);
  });
}
