/**
 * Snapshot of browser-visible context that's useful to attach to every
 * exception and session — the standard set of fields most observability
 * SDKs collect by default. Each call re-reads `window` / `navigator` so
 * attributes reflect the current state (e.g. URL changes after SPA
 * navigation).
 *
 * Returns an empty object on the server (no `window`).
 */
export function collectDefaultAttributes(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const attrs: Record<string, string> = {};

  try {
    attrs.url = window.location.href;
    attrs.path = window.location.pathname;
  } catch {
    // ignore — sandboxed iframes can throw on location access
  }

  try {
    if (document.referrer) attrs.referrer = document.referrer;
  } catch {
    // ignore
  }

  try {
    if (navigator.userAgent) attrs.userAgent = navigator.userAgent;
    if (navigator.language) attrs.language = navigator.language;
    if (navigator.platform) attrs.platform = navigator.platform;
  } catch {
    // ignore
  }

  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Number.isFinite(w) && Number.isFinite(h)) {
      attrs.viewport = `${w}x${h}`;
    }
  } catch {
    // ignore
  }

  try {
    if (window.screen) {
      const sw = window.screen.width;
      const sh = window.screen.height;
      if (Number.isFinite(sw) && Number.isFinite(sh)) {
        attrs.screen = `${sw}x${sh}`;
      }
    }
  } catch {
    // ignore
  }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) attrs.timezone = tz;
  } catch {
    // ignore
  }

  return attrs;
}
