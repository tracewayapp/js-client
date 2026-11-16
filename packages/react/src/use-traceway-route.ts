import { useEffect } from "react";
import { setRoute } from "@tracewayapp/frontend";

/**
 * Names the page being shown by its route template, so performance metrics group by route (`/orders/:id`) and
 * not by URL. Call it from the component a route renders, or once near the router with the matched pattern:
 *
 *   const match = useMatches().at(-1);
 *   useTracewayRoute(match?.route.path ?? null);
 */
export function useTracewayRoute(template: string | null): void {
  useEffect(() => {
    setRoute(template);
  }, [template]);
}
