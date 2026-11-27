import { guarded } from "./guarded.js";

const MAX_DEPTH = 6;
const MAX_VALUES = 1000;

/**
 * `JSON.stringify` of a value the app handed over (a logged object, action data), without running any of the app's
 * code: only own enumerable data properties are read, so no getter, `toJSON` or proxy `get` trap runs. Cycles and
 * nesting deeper than six levels are cut, at most a thousand values are written, and a BigInt is written as a
 * string. Never throws: what cannot be read at all (a revoked proxy) is `"[unserializable]"`.
 */
export function safeJson(value: unknown): string {
  let values = 0;
  const parents: object[] = [];
  const copy = (v: unknown): unknown => {
    if (typeof v === "bigint") return String(v);
    if (typeof v !== "object" || v === null || v instanceof Date) return v;
    if (parents.length >= MAX_DEPTH || parents.includes(v)) return "[…]";
    parents.push(v);
    const out: Record<string, unknown> = Array.isArray(v)
      ? ([] as unknown as Record<string, unknown>)
      : {};
    for (const key of Object.keys(v)) {
      if (++values > MAX_VALUES) break;
      const property = Object.getOwnPropertyDescriptor(v, key);
      // Functions are left out, as JSON leaves them out: a copied `toJSON` would run when the copy is written.
      if (property && "value" in property && typeof property.value !== "function")
        out[key] = copy(property.value);
    }
    parents.pop();
    return out;
  };
  return guarded(
    "serialize",
    () => JSON.stringify(copy(value)) ?? String(value),
    "[unserializable]",
  );
}

/** The text of a `console.*` call: strings as they are, other values as `safeJson` writes them. */
export function consoleText(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === "object" && arg !== null
        ? safeJson(arg)
        : guarded("serialize", () => String(arg), ""),
    )
    .join(" ");
}
