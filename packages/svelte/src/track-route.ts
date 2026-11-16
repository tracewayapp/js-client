import { setRoute } from "@tracewayapp/frontend";

/**
 * Names the page being shown by its route id, so performance metrics group by route (`/orders/[id]`) and not by
 * URL. In SvelteKit, from the root layout:
 *
 *   $effect(() => trackRoute(page.route.id));
 */
export function trackRoute(routeId: string | null): void {
  setRoute(routeId);
}
