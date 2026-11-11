import { gzipSync, gunzipSync, strToU8 } from "fflate";
import { ExportResultCode } from "@opentelemetry/core";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type {
  CollectionFrame,
  SessionRecordingPayload,
  TracewayEvent,
} from "@tracewayapp/core";
import type { ObservedRecord } from "../otel/router.js";
import { logsToJson } from "../persistence/otlp-json.js";

/** Bridges v2 collection to the report protocol understood by pre-OpAMP servers. */
export class LegacyTransport {
  enabled = false;
  ready: Promise<void> = Promise.resolve();
  private clips = new Map<string, SessionRecordingPayload[]>();
  private timeline: TracewayEvent[] = [];

  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly version: string,
  ) {}

  observe(record: ObservedRecord): void {
    if (record.routed === "off" || record.routed === "filtered") return;
    const timestamp = new Date(record.timeMs).toISOString();
    const get = (key: string) => record.lookup(key);
    let event: TracewayEvent | undefined;
    if (record.signal === "console") {
      event = {
        type: "log",
        timestamp,
        message: String(get("body") ?? ""),
        level:
          Number(get("severity")) >= 17
            ? "error"
            : Number(get("severity")) >= 13
              ? "warn"
              : Number(get("severity")) < 9
                ? "debug"
                : "info",
      };
    } else if (record.signal === "network") {
      event = {
        type: "network",
        timestamp,
        method: String(
          get("attributes.http.request.method") ??
            get("attributes.http.method") ??
            "GET",
        ),
        url: String(
          get("attributes.url.full") ?? get("attributes.http.url") ?? "",
        ),
        durationMs: Number(get("duration_ms") ?? 0),
        statusCode: Number(
          get("attributes.http.response.status_code") ??
            get("attributes.http.status_code") ??
            0,
        ),
      };
    } else if (record.signal === "navigation") {
      event = {
        type: "navigation",
        timestamp,
        action: String(get("attributes.browser.navigation.type") ?? "push"),
        to: String(get("attributes.url.full") ?? ""),
      };
    } else if (["custom", "userActions"].includes(record.signal)) {
      event = {
        type: "custom",
        timestamp,
        category: String(
          get("attributes.traceway.action.category") ?? record.signal,
        ),
        name: String(
          get("attributes.traceway.action.name") ??
            get("event.name") ??
            "event",
        ),
      };
      const data = get("attributes.traceway.action.data");
      if (typeof data === "string") {
        try {
          event.data = JSON.parse(data);
        } catch {
          /* optional */
        }
      }
    }
    if (event) this.timeline.push(event);
    this.timeline = this.timeline
      .filter((e) => Date.parse(e.timestamp) >= Date.now() - 30_000)
      .slice(-200);
  }

  private decorate(segment: SessionRecordingPayload): SessionRecordingPayload {
    return {
      ...segment,
      ...(segment.exceptionId
        ? { sessionId: undefined, segmentIndex: undefined }
        : {}),
      logs: this.timeline.filter((e) => e.type === "log"),
      actions: this.timeline.filter((e) => e.type !== "log"),
    };
  }

  async sendLogs(body: string, keepalive = false): Promise<Response> {
    // Replay sends independently of the OTel batch; join both in one legacy frame,
    // because older servers resolve exceptionId only within the report request.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame: CollectionFrame = {
      stackTraces: [],
      metrics: [],
      traces: [],
      sessions: [],
      sessionRecordings: [],
    };
    for (const resource of JSON.parse(body).resourceLogs ?? []) {
      for (const scope of resource.scopeLogs ?? [])
        for (const log of scope.logRecords ?? []) {
          const attributes = Object.fromEntries(
            (log.attributes ?? []).map((a: any) => [
              a.key,
              String(
                a.value.stringValue ??
                  a.value.intValue ??
                  a.value.doubleValue ??
                  a.value.boolValue ??
                  "",
              ),
            ]),
          );
          const recordedAt = new Date(
            Number(BigInt(log.timeUnixNano ?? "0") / 1_000_000n),
          ).toISOString();
          const sessionId = attributes["session.id"];
          if (
            [
              "session.start",
              "session.end",
              "traceway.session.update",
            ].includes(log.eventName) &&
            sessionId
          ) {
            frame.sessions!.push({
              id: sessionId,
              startedAt: new Date(
                Number(attributes["traceway.session.started_at"]) ||
                  Date.parse(recordedAt),
              ).toISOString(),
              ...(log.eventName === "session.end"
                ? { endedAt: recordedAt }
                : {}),
              attributes,
            });
          }
          if (
            log.eventName !== "exception" &&
            log.eventName !== "traceway.message"
          )
            continue;
          const exceptionId = attributes["traceway.exception.id"];
          let debugIds: Record<string, string> | undefined;
          try {
            debugIds = JSON.parse(attributes["traceway.debug_ids"]);
          } catch {
            /* optional */
          }
          frame.stackTraces.push({
            traceId: null,
            distributedTraceId: log.traceId || undefined,
            recordedAt,
            attributes,
            sessionId,
            stackTrace:
              attributes["exception.stacktrace"] ||
              attributes["exception.message"] ||
              log.body?.stringValue ||
              "",
            isMessage: log.eventName === "traceway.message",
            sessionRecordingId: exceptionId || undefined,
            debugIds,
          });
          // Preserve breadcrumbs even when replay is disabled or has not loaded yet.
          if (exceptionId) {
            const clips = this.clips.get(exceptionId);
            frame.sessionRecordings!.push(
              ...(clips?.length
                ? clips
                : [this.decorate({ exceptionId, events: [] })]),
            );
          }
        }
    }
    if (!frame.stackTraces.length && !frame.sessions!.length)
      return new Response(null, { status: 200 });
    const response = await this.report(frame, keepalive);
    if (response.ok)
      for (const issue of frame.stackTraces) {
        if (issue.sessionRecordingId)
          this.clips.delete(issue.sessionRecordingId);
      }
    return response;
  }

  async recordings(url: string, init?: RequestInit): Promise<Response> {
    await this.ready;
    if (!this.enabled) return fetch(url, init);
    const { segments } = JSON.parse(
      new TextDecoder().decode(gunzipSync(init!.body as Uint8Array)),
    );
    const streaming: SessionRecordingPayload[] = [];
    for (const segment of segments as SessionRecordingPayload[]) {
      const decorated = this.decorate(segment);
      if (segment.exceptionId) {
        const clips = this.clips.get(segment.exceptionId) ?? [];
        clips.push(decorated);
        this.clips.set(segment.exceptionId, clips);
        while (this.clips.size > 20)
          this.clips.delete(this.clips.keys().next().value!);
      } else streaming.push(decorated);
    }
    if (!streaming.length) return new Response(null, { status: 200 });
    return this.report(
      {
        stackTraces: [],
        metrics: [],
        traces: [],
        sessionRecordings: streaming,
      },
      init?.keepalive,
    );
  }

  wrapLogs(inner: LogRecordExporter): LogRecordExporter {
    return {
      export: (records, done) => {
        void this.ready
          .then(async () => {
            if (!this.enabled) return inner.export(records, done);
            const response = await this.sendLogs(logsToJson(records));
            done({
              code: response.ok
                ? ExportResultCode.SUCCESS
                : ExportResultCode.FAILED,
            });
          })
          .catch((error) => done({ code: ExportResultCode.FAILED, error }));
      },
      shutdown: () => inner.shutdown(),
      forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
    };
  }

  wrapSpans(inner: SpanExporter): SpanExporter {
    return {
      export: (spans, done) => {
        void this.ready
          .then(() => {
            // Network activity is attached to replay as legacy actions.
            if (this.enabled) done({ code: ExportResultCode.SUCCESS });
            else inner.export(spans, done);
          })
          .catch((error) => done({ code: ExportResultCode.FAILED, error }));
      },
      shutdown: () => inner.shutdown(),
      forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
    };
  }

  private report(frame: CollectionFrame, keepalive = false): Promise<Response> {
    const body = gzipSync(
      strToU8(
        JSON.stringify({
          appVersion: this.version,
          serverName: "",
          collectionFrames: [frame],
        }),
      ),
    );
    return fetch(`${this.base}/api/report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: body as BodyInit,
      keepalive: keepalive && body.length < 60 * 1024,
    });
  }
}
