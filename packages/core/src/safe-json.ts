import { guarded } from "./guarded.js";

const MAX_DEPTH = 6;
const MAX_VALUES = 1000;

const MAX_STACK_LENGTH = 4096;

function inherited(value: object, key: string): PropertyDescriptor | undefined {
  for (let o: object | null = value, depth = 0; o && depth < 8; o = Object.getPrototypeOf(o), depth++) {
    const property = Object.getOwnPropertyDescriptor(o, key);
    if (property) return property;
  }
  return undefined;
}

/**
 * `Name: message` and the stack, as a console prints an Error: none of the three is enumerable. Read without
 * running anything of the app: data properties of the error or of its prototypes, and the stack behind the engine's
 * own getter (Chrome has one on every error, Firefox on `Error.prototype`), told from a getter of the app by being
 * the one a new Error has. Chrome writes the stack on first read, from the name and the message: it is left out
 * when either of those is a getter.
 */
function errorText(error: Error): string {
  const [name, message, stack] = ["name", "message", "stack"].map((key) => inherited(error, key));
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const title = (text(name?.value) || "Error") + (text(message?.value) && `: ${message!.value}`);
  const engine = stack?.get && !name?.get && !message?.get && stack.get === inherited(new Error(), "stack")?.get;
  const frames = text(engine ? stack!.get!.call(error) : stack?.value).slice(0, MAX_STACK_LENGTH);
  // V8 starts the stack with the title; the others keep the frames only.
  return frames.startsWith(title) ? frames : frames ? `${title}\n${frames}` : title;
}

/**
 * `JSON.stringify` of a value the app handed over (a logged object, action data), without running any of the app's
 * code: only own enumerable data properties are read, so no getter, `toJSON` or proxy `get` trap runs. Cycles and
 * nesting deeper than six levels are cut, at most a thousand values are written, a BigInt is written as a string
 * and an Error as its name, message and stack. Never throws: what cannot be read at all (a revoked proxy) is
 * `"[unserializable]"`.
 */
export function safeJson(value: unknown): string {
  let values = 0;
  const parents: object[] = [];
  const copy = (v: unknown): unknown => {
    if (typeof v === "bigint") return String(v);
    if (typeof v !== "object" || v === null || v instanceof Date) return v;
    if (v instanceof Error) return errorText(v);
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

/** The text of a `console.*` call: strings and Errors as they are, other values as `safeJson` writes them. */
export function consoleText(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === "object" && arg !== null
        ? guarded("serialize", () => (arg instanceof Error ? errorText(arg) : safeJson(arg)), "[unserializable]")
        : guarded("serialize", () => String(arg), ""),
    )
    .join(" ");
}
