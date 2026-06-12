const FRAME_PATTERNS = [
  /^\s+at\s+.+?\s+\((.+):\d+:\d+\)$/,
  /^\s+at\s+(.+):\d+:\d+$/,
  /^(?:.*@)?(.+):\d+:\d+$/,
];

function filenameFromStack(stack: string): string | undefined {
  for (const line of stack.split("\n")) {
    for (const pattern of FRAME_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const parts = match[1].split("/");
        return parts[parts.length - 1];
      }
    }
  }
  return undefined;
}

function isRegistry(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null;
}

let cachedKeyCount = -1;
let cachedMap: Record<string, string> = {};

/**
 * Builds a filename → debugId map from the registries that
 * `@tracewayapp/bundler-plugin` (or Sentry's bundler plugins) inject into
 * bundles. Each registry key is the stack of a synthetic error thrown at the
 * top of a bundle, so its first frame points at the bundle's own runtime URL.
 */
export function collectDebugIds(): Record<string, string> | undefined {
  const g = globalThis as Record<string, unknown>;
  const registries = [g._tracewayDebugIds, g._sentryDebugIds].filter(isRegistry);
  if (registries.length === 0) {
    return undefined;
  }

  let keyCount = 0;
  for (const registry of registries) {
    keyCount += Object.keys(registry).length;
  }
  if (keyCount !== cachedKeyCount) {
    const map: Record<string, string> = {};
    for (const registry of registries) {
      for (const stackKey of Object.keys(registry)) {
        const filename = filenameFromStack(stackKey);
        if (filename && !(filename in map)) {
          map[filename] = String(registry[stackKey]);
        }
      }
    }
    cachedKeyCount = keyCount;
    cachedMap = map;
  }

  return Object.keys(cachedMap).length > 0 ? cachedMap : undefined;
}

export function debugIdsForStackTrace(
  stackTrace: string,
): Record<string, string> | undefined {
  const all = collectDebugIds();
  if (!all) {
    return undefined;
  }
  let relevant: Record<string, string> | undefined;
  for (const [filename, debugId] of Object.entries(all)) {
    if (stackTrace.includes(filename)) {
      (relevant ??= {})[filename] = debugId;
    }
  }
  return relevant;
}

export function resetDebugIdCache(): void {
  cachedKeyCount = -1;
  cachedMap = {};
}
