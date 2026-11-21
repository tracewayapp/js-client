const MAX_SEGMENTS = 6;
const MAX_LENGTH = 64;
const ID = ":id";

const NUMBER = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{8,}$/i;
const TOKEN = /^[A-Za-z0-9_\-=.~]{20,}$/;
const DIGIT = /\d/;
// A percent-encoded ASCII character (a space, a slash, a brace): a value somebody typed or a name passed through
// `encodeURIComponent`, never a route literal. Encoded UTF-8 bytes (`%C3%A9`) stay, since localized paths have them.
const ENCODED_ASCII = /%[0-7][0-9a-f]/i;

function isId(segment: string): boolean {
  if (NUMBER.test(segment) || UUID.test(segment)) return true;
  if (ENCODED_ASCII.test(segment)) return true;
  if (!DIGIT.test(segment)) return false;
  return HEX.test(segment) || TOKEN.test(segment);
}

/**
 * Where the query string or fragment of a path begins, or its length. The server gets a route template in the
 * place of a path when the app or its router named the view, and there a `?` ends an optional parameter
 * (`/:lang?/about`): cutting it off made every such route `/:lang`. A template's `?` is told from a query's by the
 * parameter it ends and the segment after it.
 */
function queryStart(path: string): number {
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "#") return i;
    if (path[i] !== "?") continue;
    const segment = path.lastIndexOf("/", i) + 1;
    if (path[segment] !== ":" || path[i + 1] !== "/") return i;
  }
  return path.length;
}

/**
 * Turns a raw path into something close to its route template, so `/orders/8841` and `/orders/8842` are one
 * series: segments that are numbers, UUIDs, long hex or token strings, or that carry a percent-encoded ASCII
 * character become `:id`. The server applies the same
 * rules to paths from SDKs that do not, so the two must stay in step
 * (`backend/app/clientmetrics/route.go`). A route template passed to `setRoute` is used as it is instead.
 */
export function normalizePath(path: string): string {
  const clean = path.slice(0, queryStart(path)).replace(/\/+$/, "");
  if (!clean) return "/";
  const segments = clean.split("/").filter(Boolean);
  let truncated = segments.length > MAX_SEGMENTS;
  const kept = segments
    .slice(0, MAX_SEGMENTS)
    .map((segment) => (isId(segment) ? ID : segment));
  let out = `/${kept.join("/")}`;
  while (kept.length > 1 && out.length + (truncated ? 2 : 0) > MAX_LENGTH) {
    kept.pop();
    truncated = true;
    out = `/${kept.join("/")}`;
  }
  if (truncated) out += "/*";
  return out.length > MAX_LENGTH ? out.slice(0, MAX_LENGTH) : out;
}

export type RouteParams = Record<string, string | string[] | undefined>;

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Rebuilds a route template from a path and the params a router matched in it: `/orders/8841` with `{ id: "8841" }`
 * is `/orders/:id`. For routers that hand out params but not the pattern (`useParams()` of React Router and of the
 * Next.js App Router). A value of several segments, a catch-all or a splat, becomes `:name*` (`*` for React
 * Router's unnamed splat). A param whose value is not found in the path is left out.
 */
export function routeFromParams(
  pathname: string,
  params: RouteParams | null | undefined,
): string {
  const segments = (pathname.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const plain = segments.map(decoded);
  const taken = segments.map(() => false);
  const entries = Object.entries(params ?? {})
    .map(([key, value]) => ({
      key,
      many: Array.isArray(value),
      parts: (Array.isArray(value) ? value : String(value ?? "").split("/"))
        .filter(Boolean)
        .map(decoded),
    }))
    .filter((entry) => entry.parts.length > 0)
    // Routers list params in path order and the search below runs from the end of the path, so the last param
    // goes first: of two equal values each takes its own segment, and a value equal to a static segment names
    // the deeper one. Longest first, so a catch-all is not broken up by a one-segment param inside it.
    .reverse()
    .sort((a, b) => b.parts.length - a.parts.length);
  for (const { key, many, parts } of entries) {
    for (let start = segments.length - parts.length; start >= 0; start--) {
      const fits = parts.every(
        (part, i) => !taken[start + i] && plain[start + i] === part,
      );
      if (!fits) continue;
      const name =
        key === "*" ? "*" : many || parts.length > 1 ? `:${key}*` : `:${key}`;
      segments.splice(start, parts.length, name);
      plain.splice(start, parts.length, name);
      taken.splice(start, parts.length, true);
      break;
    }
  }
  return `/${segments.join("/")}`;
}
