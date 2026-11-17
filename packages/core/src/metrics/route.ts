const MAX_SEGMENTS = 6;
const MAX_LENGTH = 64;
const ID = ":id";

const NUMBER = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{8,}$/i;
const TOKEN = /^[A-Za-z0-9_\-=.~]{20,}$/;
const DIGIT = /\d/;

function isId(segment: string): boolean {
  if (NUMBER.test(segment) || UUID.test(segment)) return true;
  if (!DIGIT.test(segment)) return false;
  return HEX.test(segment) || TOKEN.test(segment);
}

/**
 * Turns a raw path into something close to its route template, so `/orders/8841` and `/orders/8842` are one
 * series: segments that are numbers, UUIDs, or long hex or token strings become `:id`. The server applies the same
 * rules to paths from SDKs that do not, so the two must stay in step
 * (`backend/app/clientmetrics/route.go`). A route template passed to `setRoute` is used as it is instead.
 */
export function normalizePath(path: string): string {
  const clean = (path.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
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
