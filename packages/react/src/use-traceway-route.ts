import { useEffect } from "react";
import { setRoute } from "@tracewayapp/frontend";

/**
 * Names the page being shown by its route template, so performance metrics group by route (`/orders/:id`) and
 * not by URL. Call it from the component a route renders, with that route's pattern:
 *
 *   function OrderPage() {
 *     useTracewayRoute("/orders/:id");
 *     ...
 *   }
 *
 * Pass `null` where no pattern is known; the SDK then replaces id-like path segments itself.
 */
export function useTracewayRoute(template: string | null): void {
  useEffect(() => {
    setRoute(template);
  }, [template]);
}
