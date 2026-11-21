/**
 * Reads the route template of the page being shown (`/orders/:id`) from the app's router, so metrics group by
 * route without the app calling `setRoute`. A router is found where its framework leaves it on the page, or is
 * handed over with `trackRouter`:
 *
 * - React Router in framework mode (`__reactRouterDataRouter`) and Remix (`__remixRouter`)
 * - TanStack Router (`__TSR_ROUTER__`)
 * - the Next.js Pages Router (`next.router`)
 * - Vue Router, through the app Vue leaves on its mount element (`__vue_app__`), which covers Nuxt
 *
 * The Next.js App Router, React Router's `<BrowserRouter>` and SvelteKit leave nothing to read: those name the
 * route from a component (`useTracewayRoute`, `trackRoute`).
 *
 * Nothing here is typed against a router package: every read is of a shape that may be missing, and a router
 * that reads differently is skipped.
 */

interface Reading {
  /** The path the router says it is showing, without its base. */
  path: string;
  base?: string;
  template: string | null;
}

type Loose = any;

const tracked: unknown[] = [];

/** Names views from this router. For a router its framework does not leave on the page. */
export function trackRouter(router: unknown): void {
  if (router && typeof router === "object" && !tracked.includes(router))
    tracked.push(router);
}

export function forgetRouters(): void {
  tracked.length = 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Child route paths are relative to their parent unless they start with a slash. */
function joined(matches: Loose[]): string | null {
  let out = "";
  let any = false;
  for (const match of matches) {
    const path = text(match?.route?.path);
    if (!path) continue;
    any = true;
    out = path.startsWith("/") ? path : `${out.replace(/\/+$/, "")}/${path}`;
  }
  // Only index and pathless routes matched: the root.
  return any ? out : matches.length ? "/" : null;
}

function read(router: Loose): Reading | null {
  // Vue Router
  const current = router.currentRoute?.value;
  if (current && Array.isArray(current.matched)) {
    const path = text(current.path);
    if (path === undefined) return null;
    const last = current.matched[current.matched.length - 1];
    return {
      path,
      base: text(router.options?.history?.base),
      template: text(last?.path) ?? null,
    };
  }

  // Next.js Pages Router: `pathname` is the page (`/posts/[id]`), `asPath` what the address bar shows.
  const asPath = text(router.asPath);
  const page = text(router.pathname);
  if (asPath !== undefined && page !== undefined)
    return { path: asPath, base: text(router.basePath), template: page };

  const matches = router.state?.matches;
  if (!Array.isArray(matches) || !matches.length) return null;
  const last = matches[matches.length - 1];
  // The deepest match's own path and not the router's location: TanStack moves its location when a navigation
  // starts and its matches when it ends, and a path no route matched (a 404 rendered by the root) fails the
  // comparison instead of being named after the root.
  const path = text(last?.pathname);
  if (path === undefined) return null;

  // TanStack Router
  const fullPath = text(last.fullPath);
  if (fullPath !== undefined)
    return { path, base: text(router.basepath), template: fullPath };

  // React Router data router
  return { path, base: text(router.basename), template: joined(matches) };
}

function plain(path: string): string {
  const clean = (path.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  try {
    return decodeURI(clean);
  } catch {
    return clean;
  }
}

function shows(reading: Reading, pathname: string): "whole" | "end" | null {
  const want = plain(pathname);
  const path = plain(reading.path);
  if (want === plain(reading.base ?? "") + path) return "whole";
  // A prefix the router does not report: a locale, or a base it was not told about.
  return path !== "" && want.endsWith(path) ? "end" : null;
}

function candidates(): unknown[] {
  const found = tracked.slice();
  if (typeof window === "undefined") return found;
  const page = window as Loose;
  found.push(
    page.__reactRouterDataRouter,
    page.__remixRouter,
    page.__TSR_ROUTER__,
    page.next?.router,
  );
  const mounts = typeof document === "undefined" ? null : document.body;
  if (mounts) {
    for (let i = 0; i < mounts.children.length; i++)
      found.push(
        (mounts.children[i] as Loose).__vue_app__?.config?.globalProperties
          ?.$router,
      );
  }
  return found;
}

export interface FoundRoute {
  template: string;
  /**
   * False when the router's path is only the end of the address. That is a router with a prefix it does not
   * report, or one still showing the page before (`/settings` while the address is already `/acme/settings`),
   * so the answer may change once the router has caught up.
   */
  settled: boolean;
}

/**
 * The template of the route shown at `pathname`, or null when no router is found or the one found is showing
 * another path: a router commits a navigation just before or some time after the address changes, and a view
 * must not get the name of its neighbour.
 */
export function findRoute(pathname: string): FoundRoute | null {
  let routers: unknown[] = [];
  try {
    routers = candidates();
  } catch {
    // Reading somebody else's globals threw. Naming the route is not worth an error.
  }
  let loose: FoundRoute | null = null;
  for (const router of routers) {
    if (!router || typeof router !== "object") continue;
    try {
      const reading = read(router);
      const match = reading?.template ? shows(reading, pathname) : null;
      if (match === "whole")
        return { template: reading!.template!, settled: true };
      if (match === "end")
        loose ??= { template: reading!.template!, settled: false };
    } catch {
      // A getter of this router threw; the next one may still answer.
    }
  }
  return loose;
}

export function detectRoute(pathname: string): string | null {
  return findRoute(pathname)?.template ?? null;
}
