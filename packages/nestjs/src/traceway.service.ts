import { Inject, Injectable } from "@nestjs/common";
import {
  init,
  shutdown,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  startSpan,
  endSpan,
  measureTask,
  setTraceAttribute,
  setTraceAttributes,
  getTraceId,
  getTraceContext,
  withTraceContext,
  type SpanHandle,
  type TraceContextOptions,
} from "@traceway/backend";
import { TRACEWAY_MODULE_OPTIONS } from "./traceway.constants.js";
import type { TracewayModuleOptions } from "./traceway.interfaces.js";

@Injectable()
export class TracewayService {
  constructor(
    @Inject(TRACEWAY_MODULE_OPTIONS)
    private readonly options: TracewayModuleOptions,
  ) {}

  initialize(): void {
    init(this.options.connectionString, {
      debug: this.options.debug,
      version: this.options.version,
      serverName: this.options.serverName,
      sampleRate: this.options.sampleRate,
      errorSampleRate: this.options.errorSampleRate,
    });
  }

  async shutdownAsync(): Promise<void> {
    await shutdown();
  }

  captureException(error: Error): void {
    captureException(error);
  }

  captureExceptionWithAttributes(
    error: Error,
    attributes?: Record<string, string>,
    traceId?: string,
  ): void {
    captureExceptionWithAttributes(error, attributes, traceId);
  }

  captureMessage(msg: string, attributes?: Record<string, string>): void {
    captureMessage(msg, attributes);
  }

  startSpan(name: string): SpanHandle {
    return startSpan(name);
  }

  endSpan(span: SpanHandle, addToContext: boolean = true): void {
    endSpan(span, addToContext);
  }

  measureTask(title: string, fn: () => void | Promise<void>): void {
    measureTask(title, fn);
  }

  setTraceAttribute(key: string, value: string): void {
    setTraceAttribute(key, value);
  }

  setTraceAttributes(attributes: Record<string, string>): void {
    setTraceAttributes(attributes);
  }

  getTraceId(): string | undefined {
    return getTraceId();
  }

  getTraceContext() {
    return getTraceContext();
  }

  withTraceContext<T>(options: TraceContextOptions, fn: () => T): T {
    return withTraceContext(options, fn);
  }

  getOptions(): TracewayModuleOptions {
    return this.options;
  }
}
