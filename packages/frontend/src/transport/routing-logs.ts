import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";

/** Route after enrichment and buffering, so both live and trigger-flushed exceptions keep their metadata. */
export class RoutingLogExporter implements LogRecordExporter {
  constructor(
    private readonly inner: LogRecordExporter,
    private readonly route: (record: ReadableLogRecord) => boolean,
  ) {}

  export(
    records: ReadableLogRecord[],
    done: (result: ExportResult) => void,
  ): void {
    const remaining = records.filter((record) => !this.route(record));
    if (remaining.length) this.inner.export(remaining, done);
    else done({ code: ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
