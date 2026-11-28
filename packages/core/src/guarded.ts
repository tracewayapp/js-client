/**
 * The page's own `console.warn`, taken before the SDK patches the console: a contained failure is logged with it,
 * so the log line is never recorded by Traceway itself.
 */
const consoleWarn =
  typeof console !== "undefined" && typeof console.warn === "function"
    ? console.warn
    : undefined;
let debug = false;
const logged = new Set<string>();

/**
 * Runs SDK code where its failure must not reach the app that called it (CONTRACT §13): returns what `fn` returned,
 * or `fallback` when it threw. The failure is never rethrown and never reported through Traceway; with debug
 * logging on (`setGuardedDebug`) one line is logged per `where`, otherwise nothing.
 */
export function guarded<T>(where: string, fn: () => T): T | undefined;
export function guarded<T>(where: string, fn: () => T, fallback: T): T;
export function guarded<T>(
  where: string,
  fn: () => T,
  fallback?: T,
): T | undefined {
  try {
    return fn();
  } catch (error) {
    if (debug && !logged.has(where)) {
      logged.add(where);
      try {
        consoleWarn?.call(console, `Traceway: ${where} failed`, error);
      } catch {
        // Nothing to report it with.
      }
    }
    return fallback;
  }
}

/** Turns the one-line debug log of contained failures on or off: the `debug` option of the browser SDK. */
export function setGuardedDebug(on: boolean): void {
  debug = on;
}

/**
 * One line of the `debug` option (`Traceway: <text>`), with `detail` after it when given: what the SDK started with,
 * what it dropped and why. Written with the page's own `console.warn`, so Traceway never records it. With `once`, a
 * text is logged the first time only. Silent without debug; never throws.
 */
export function debugLog(text: string, detail?: unknown, once?: boolean): void {
  if (!debug || (once && logged.has(text))) return;
  if (once) logged.add(text);
  write(text, detail);
}

/**
 * A setup mistake the app has to fix, or a deprecated call (`Traceway: <text>`): logged even without debug, once per
 * text, like `debugLog` otherwise.
 */
export function setupWarning(text: string): void {
  if (logged.has(text)) return;
  logged.add(text);
  write(text);
}

function write(text: string, detail?: unknown): void {
  try {
    const line = `Traceway: ${text}`;
    if (detail === undefined) consoleWarn?.call(console, line);
    else consoleWarn?.call(console, line, detail);
  } catch {
    // Nothing to report it with.
  }
}
