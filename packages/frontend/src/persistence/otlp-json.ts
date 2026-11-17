import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
} from "@opentelemetry/otlp-transformer";

const decoder = new TextDecoder();

/**
 * A buffered record is serialized to size it, again when the page is hidden and again when it is sent. The
 * result is kept per record; whoever changes a record afterwards calls forgetJson.
 */
const serialized = new WeakMap<object, string>();

export function recordJson(
  item:
    | { kind: "log"; record: ReadableLogRecord }
    | { kind: "span"; span: ReadableSpan },
): string {
  const key = item.kind === "log" ? item.record : item.span;
  let json = serialized.get(key);
  if (json === undefined) {
    json =
      item.kind === "log"
        ? logsToJson([item.record])
        : spansToJson([item.span]);
    serialized.set(key, json);
  }
  return json;
}

export function forgetJson(record: object): void {
  serialized.delete(record);
}

export function logsToJson(records: ReadableLogRecord[]): string {
  return decoder.decode(JsonLogsSerializer.serializeRequest(records));
}

export function spansToJson(spans: ReadableSpan[]): string {
  return decoder.decode(JsonTraceSerializer.serializeRequest(spans));
}

export const ATTR_CAPTURE_IDS = "traceway.capture.ids";

/** The capture ids a record already carries, joined with the captures running now. */
export function withCaptureIds(existing: unknown, ids: string[]): string {
  let known: unknown = [];
  try {
    known = typeof existing === "string" ? JSON.parse(existing) : [];
  } catch {
    known = [];
  }
  return JSON.stringify([
    ...new Set([...(Array.isArray(known) ? known.map(String) : []), ...ids]),
  ]);
}

function stampCaptureIds(
  kind: "logs" | "traces",
  resources: unknown[],
  ids: string[],
): void {
  for (const resource of resources as any[]) {
    for (const scope of (kind === "logs"
      ? resource?.scopeLogs
      : resource?.scopeSpans) ?? []) {
      for (const record of (kind === "logs" ? scope?.logRecords : scope?.spans) ??
        []) {
        const attributes: any[] = (record.attributes ??= []);
        const found = attributes.find((a) => a?.key === ATTR_CAPTURE_IDS);
        const value = withCaptureIds(found?.value?.stringValue, ids);
        if (found) found.value = { stringValue: value };
        else attributes.push({ key: ATTR_CAPTURE_IDS, value: { stringValue: value } });
      }
    }
  }
}

/**
 * Joins OTLP JSON requests of one signal into one request; OTLP allows a resource to repeat. With `captureIds`
 * every record is marked as part of those captures.
 */
export function mergeRequests(
  kind: "logs" | "traces",
  bodies: string[],
  captureIds: string[] = [],
): string {
  const field = kind === "logs" ? "resourceLogs" : "resourceSpans";
  const merged: unknown[] = [];
  for (const body of bodies) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown[]>;
      const resources = parsed[field] ?? [];
      if (captureIds.length) stampCaptureIds(kind, resources, captureIds);
      merged.push(...resources);
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
