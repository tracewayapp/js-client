import type { Logger, LoggerProvider } from "@opentelemetry/api-logs";
import type {
  Instrumentation,
  InstrumentationConfig,
} from "@opentelemetry/instrumentation";
import type { PerformanceSink } from "./metrics-recorder.js";

/**
 * Base of the SDK's own performance instrumentations. They only emit log records, so this is the small part of
 * `InstrumentationBase` they need, without its enable-in-the-constructor step: `registerInstrumentations` enables
 * them once the logger provider is set.
 */
export abstract class LogInstrumentation implements Instrumentation {
  readonly instrumentationVersion = "1";
  protected logger: Logger | null = null;
  protected enabled = false;
  /** Where the measurement goes as an aggregate, besides the log event. Set before the instrumentation is enabled. */
  sink: PerformanceSink | null = null;

  constructor(readonly instrumentationName: string) {}

  protected abstract attach(): void;
  protected abstract detach(): void;

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    try {
      this.attach();
    } catch {
      // A browser without the API collects nothing.
    }
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      this.detach();
    } catch {
      // ignore
    }
  }

  setLoggerProvider(loggerProvider: LoggerProvider): void {
    this.logger = loggerProvider.getLogger(
      this.instrumentationName,
      this.instrumentationVersion,
    );
  }

  setTracerProvider(): void {}
  setMeterProvider(): void {}
  setConfig(): void {}

  getConfig(): InstrumentationConfig {
    return { enabled: false };
  }
}

export function supportsEntryType(type: string): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes(type)
  );
}

export function epochMs(performanceTime: number): number {
  return performance.timeOrigin + performanceTime;
}
