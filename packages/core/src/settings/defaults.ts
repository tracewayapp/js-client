import type { Ceilings, Mode, SignalName, Settings, Trigger } from "./types.js";
import { SIGNALS } from "./types.js";

export const DEFAULT_EXCEPTION_TRIGGER_ID = "default-exception";

export function defaultExceptionTrigger(): Trigger {
  return {
    id: DEFAULT_EXCEPTION_TRIGGER_ID,
    name: "Error clip",
    enabled: true,
    sampleRate: 1,
    cooldownSeconds: 5,
    maxPerSession: 20,
    steps: [{ match: { key: "event.name", op: "eq", value: "exception" } }],
    actions: [
      { type: "flush", lookbackSeconds: 600, signals: ["*"], replay: false },
      { type: "flush", lookbackSeconds: 30, signals: [], replay: true },
    ],
  };
}

export interface DefaultSettingsOptions {
  /**
   * 1.x `recordAllSessions`: stream every replay segment instead of keeping it for errors, and the breadcrumbs the
   * player shows next to it (console, network, navigation, clicks, app events), which travel as telemetry.
   */
  recordAllSessions?: boolean;
  baselineSampleRate?: number;
}

export function defaultSettings(
  options: DefaultSettingsOptions = {},
): Settings {
  const breadcrumbs: Mode = options.recordAllSessions ? "stream" : "buffer";
  return {
    schemaVersion: 1,
    enabled: true,
    signals: {
      errors: { mode: "stream", sampleRate: 1 },
      messages: { mode: "stream", sampleRate: 1 },
      network: { mode: breadcrumbs, sampleRate: 1 },
      console: { mode: breadcrumbs, sampleRate: 1, minSeverity: "info" },
      navigation: { mode: breadcrumbs, sampleRate: 1 },
      userActions: { mode: breadcrumbs, sampleRate: 1 },
      webVitals: { mode: "stream", sampleRate: 1 },
      resourceTiming: { mode: "off", sampleRate: 1 },
      custom: { mode: breadcrumbs, sampleRate: 1 },
    },
    sessions: {
      enabled: true,
      baselineSampleRate: Number.isFinite(options.baselineSampleRate)
        ? Math.min(1, Math.max(0, options.baselineSampleRate!))
        : 0,
    },
    replay: {
      mode: options.recordAllSessions ? "stream" : "buffer",
      sessionSampleRate: 1,
      maskAllInputs: true,
    },
    buffer: {
      maxBytes: 2 * 1024 * 1024,
      maxAgeSeconds: 600,
      replayMaxBytes: 8 * 1024 * 1024,
      persist: true,
    },
    triggers: [defaultExceptionTrigger()],
    captures: [],
  };
}

export interface CeilingOptions {
  enabled?: boolean;
  sessionRecording?: boolean;
  captureLogs?: boolean;
  captureNetwork?: boolean;
  captureNavigation?: boolean;
  captureUserActions?: boolean;
  captureWebVitals?: boolean;
  captureResourceTiming?: boolean;
  sessions?: boolean;
}

export function ceilingsFrom(options: CeilingOptions = {}): Ceilings {
  const allow = (flag: boolean | undefined): Mode =>
    flag === false ? "off" : "stream";
  const signals = {} as Record<SignalName, Mode>;
  for (const signal of SIGNALS) signals[signal] = "stream";
  signals.console = allow(options.captureLogs);
  signals.network = allow(options.captureNetwork);
  signals.navigation = allow(options.captureNavigation);
  signals.userActions = allow(options.captureUserActions);
  signals.webVitals = allow(options.captureWebVitals);
  signals.resourceTiming = allow(options.captureResourceTiming);
  return {
    enabled: options.enabled !== false,
    signals,
    replay: allow(options.sessionRecording),
    sessions: options.sessions !== false,
  };
}
