/** A route template as records carry it: trimmed, starting with `/`, at most 64 characters; null when empty. */
export function routeTemplate(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  return (trimmed[0] === "/" ? trimmed : `/${trimmed}`).slice(0, 64);
}

/**
 * Where the page is, with the keys of the mobile SDKs' ScreenState: the screen shown, the screen before it and since
 * when it shows. A screen is named by its route template (`setRoute`, the app's router, `recordNavigation`), else by
 * its path.
 */
export class ScreenState {
  path: string | null = null;
  route: string | null = null;
  previous: string | null = null;
  sinceMs = 0;

  /**
   * The page shows `path`. A different path is a new screen: the one it replaces becomes the previous one, and its
   * route template goes with it. `route` names the screen in the same step. An empty path changes nothing.
   */
  navigated(path: string, atMs: number, route?: unknown): void {
    if (!path) return;
    if (path !== this.path) {
      this.previous = this.name();
      this.path = path;
      this.sinceMs = atMs;
      this.route = null;
    }
    this.route = routeTemplate(route) ?? this.route;
  }

  name(): string | null {
    return this.route ?? this.path;
  }

  /** `app.screen.name`, `app.screen.route`, `app.screen.previous` and `app.screen.duration_ms`. */
  context(nowMs: number): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    const name = this.name();
    if (name) {
      out["app.screen.name"] = name;
      out["app.screen.duration_ms"] = Math.max(0, nowMs - this.sinceMs);
    }
    if (this.route) out["app.screen.route"] = this.route;
    if (this.previous) out["app.screen.previous"] = this.previous;
    return out;
  }
}
