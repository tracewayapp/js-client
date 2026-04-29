import type { TracewayFrontendClient } from "./client.js";

function locationPath(): string {
  if (typeof window === "undefined" || !window.location) return "";
  return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * Records SPA navigation transitions reported via the History API.
 *
 * Patches `history.pushState` / `history.replaceState` and listens for
 * `popstate`. Hash-only changes are also captured via `hashchange`.
 *
 * Static `<a>`-driven full-page loads do not flow through here (the document
 * unloads before we can record). Use server-side analytics for those.
 */
export function installNavigationInstrumentation(
  client: TracewayFrontendClient,
): void {
  if (typeof window === "undefined" || !window.history) return;

  let lastPath = locationPath();
  const record = (action: string) => {
    const next = locationPath();
    if (next === lastPath) return;
    try {
      client.recordNavigationEvent({
        action,
        from: lastPath,
        to: next,
      });
    } catch {
      // never break navigation
    }
    lastPath = next;
  };

  const originalPush = window.history.pushState;
  window.history.pushState = function (
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    const result = originalPush.apply(this, args);
    record("push");
    return result;
  };

  const originalReplace = window.history.replaceState;
  window.history.replaceState = function (
    this: History,
    ...args: Parameters<History["replaceState"]>
  ) {
    const result = originalReplace.apply(this, args);
    record("replace");
    return result;
  };

  window.addEventListener("popstate", () => record("pop"));
  window.addEventListener("hashchange", () => record("push"));
}
