import { guarded } from "@tracewayapp/core";
import { setRoute } from "@tracewayapp/frontend";

interface RouteLike {
  matched?: Array<{ path: string }>;
}

interface RouterLike {
  afterEach(guard: (to: RouteLike) => void): unknown;
}

/**
 * Sets the matched route pattern (`/orders/:id`) with `setRoute` after every navigation, so performance metrics
 * group by route and not by URL. Pass the vue-router instance once, after creating it. The plugin already reads the
 * router installed next to it, so this is only needed for a router the plugin does not see. Anything that is not a
 * router is ignored.
 */
export function trackRouter(router: RouterLike): void {
  guarded("vue.trackRouter", () =>
    router.afterEach((to) =>
      // A router guard of the app: whatever the route looks like, it must not break the navigation.
      guarded("vue.trackRouter", () => {
        const matched = to.matched ?? [];
        setRoute(matched.length ? matched[matched.length - 1]!.path : null);
      }),
    ),
  );
}
