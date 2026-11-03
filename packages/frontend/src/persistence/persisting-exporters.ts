import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { logsToJson, spansToJson } from "./otlp-json.js";
import type { Outbox } from "./outbox.js";

/** Hands a batch the OTLP exporter gave up on to the outbox instead of dropping it. */
export class PersistingLogExporter implements LogRecordExporter {
  constructor(
    private readonly inner: LogRecordExporter,
    private readonly outbox: () => Outbox | null,
    private readonly allowed: (eventName: string | undefined) => boolean,
  ) {}

  export(
    records: ReadableLogRecord[],
    done: (result: ExportResult) => void,
  ): void {
    records = records.filter((record) => this.allowed(record.eventName));
    if (!records.length) {
      done({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.inner.export(records, (result) => {
      const outbox = this.outbox();
      if (
        result.code !== ExportResultCode.SUCCESS &&
        outbox &&
        records.length > 0
      ) {
        void outbox
          .add("logs", logsToJson(records))
          .finally(() => done(result));
        return;
      }
      done(result);
    });
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export class PersistingSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly outbox: () => Outbox | null,
    private readonly allowed: () => boolean,
  ) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    if (!this.allowed()) {
      done({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.inner.export(spans, (result) => {
      const outbox = this.outbox();
      if (
        result.code !== ExportResultCode.SUCCESS &&
        outbox &&
        spans.length > 0
      ) {
        void outbox
          .add("traces", spansToJson(spans))
          .finally(() => done(result));
        return;
      }
      done(result);
    });
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
