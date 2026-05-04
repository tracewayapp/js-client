import type { TracewayReactNativeClient } from "./client.js";
import type { LogEvent } from "@tracewayapp/core";

const METHODS: Array<{ name: keyof Console; level: LogEvent["level"] }> = [
  { name: "debug", level: "debug" },
  { name: "log", level: "info" },
  { name: "info", level: "info" },
  { name: "warn", level: "warn" },
  { name: "error", level: "error" },
];

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return Object.prototype.toString.call(arg);
    }
  }
  return String(arg);
}

/**
 * Mirrors `console.{debug,log,info,warn,error}` calls into the client's log
 * buffer. The original console output is preserved — we only piggyback on the
 * call.
 */
export function installConsoleInstrumentation(
  client: TracewayReactNativeClient,
): void {
  if (typeof console === "undefined") return;

  for (const { name, level } of METHODS) {
    const original = console[name] as
      | ((...args: unknown[]) => void)
      | undefined;
    if (typeof original !== "function") continue;

    (console as unknown as Record<string, unknown>)[name as string] =
      function (...args: unknown[]) {
        try {
          const message = args.map(stringifyArg).join(" ");
          client.recordLog(level, message);
        } catch {
          // Never let log capture break the host app.
        }
        return original.apply(console, args);
      };
  }
}
