import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
} from "@opentelemetry/otlp-transformer";

const decoder = new TextDecoder();

export function logsToJson(records: ReadableLogRecord[]): string {
  return decoder.decode(JsonLogsSerializer.serializeRequest(records));
}

export function spansToJson(spans: ReadableSpan[]): string {
  return decoder.decode(JsonTraceSerializer.serializeRequest(spans));
}

/** Joins OTLP JSON requests of one signal into one request; OTLP allows a resource to repeat. */
export function mergeRequests(
  kind: "logs" | "traces",
  bodies: string[],
): string {
  const field = kind === "logs" ? "resourceLogs" : "resourceSpans";
  const merged: unknown[] = [];
  for (const body of bodies) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown[]>;
      merged.push(...(parsed[field] ?? []));
    } catch {
      // A body that no longer parses is skipped; the others still go.
    }
  }
  return JSON.stringify({ [field]: merged });
}

/** Rechecks collection policy when a persisted request is about to leave the device. */
export function filterRequest(
  kind: "logs" | "traces",
  body: string,
  logAllowed: (eventName: string | undefined) => boolean,
  spansAllowed: () => boolean,
): string {
  if (kind === "traces") return spansAllowed() ? body : "";
  try {
    const request = JSON.parse(body);
    let count = 0;
    for (const resource of request.resourceLogs ?? []) {
      for (const scope of resource.scopeLogs ?? []) {
        scope.logRecords = (scope.logRecords ?? []).filter(
          (record: { eventName?: string }) => logAllowed(record.eventName),
        );
        count += scope.logRecords.length;
      }
    }
    return count ? JSON.stringify(request) : "";
  } catch {
    return "";
  }
}
