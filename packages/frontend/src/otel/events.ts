import type { SignalName } from "@tracewayapp/core";

export const EVENT_EXCEPTION = "exception";
export const EVENT_MESSAGE = "traceway.message";
export const EVENT_ACTION = "traceway.action";
export const EVENT_SESSION_START = "session.start";
export const EVENT_SESSION_END = "session.end";
export const EVENT_SESSION_UPDATE = "traceway.session.update";
export const EVENT_TRIGGER_FIRED = "traceway.trigger.fired";
export const EVENT_CAPTURE_STARTED = "traceway.capture.started";
export const EVENT_CONFIG_APPLIED = "traceway.config.applied";

export const ATTR_SESSION_ID = "session.id";
export const ATTR_SESSION_STARTED_AT = "traceway.session.started_at";
export const ATTR_EXCEPTION_ID = "traceway.exception.id";
export const ATTR_DEBUG_IDS = "traceway.debug_ids";

const CONTROL_EVENTS = new Set([
  EVENT_SESSION_START,
  EVENT_SESSION_END,
  EVENT_SESSION_UPDATE,
  EVENT_TRIGGER_FIRED,
  EVENT_CAPTURE_STARTED,
  EVENT_CONFIG_APPLIED,
]);

/** `control` records describe the SDK itself (sessions, triggers, config) and are always sent. */
export type RecordSignal = SignalName | "control";

export function classifyLog(eventName: string | undefined): RecordSignal {
  switch (eventName) {
    case EVENT_EXCEPTION:
      return "errors";
    case EVENT_MESSAGE:
      return "messages";
    case "browser.console":
    case undefined:
    case "":
      return "console";
    case "browser.navigation":
      return "navigation";
    case "browser.user_action.click":
      return "userActions";
    case "browser.web_vital":
      return "webVitals";
    case "browser.resource_timing":
    case "browser.navigation_timing":
      return "resourceTiming";
  }
  return CONTROL_EVENTS.has(eventName) ? "control" : "custom";
}

const SEVERITY_NUMBERS: Record<string, number> = { trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };

export function severityNumberOf(severity: string): number {
  return SEVERITY_NUMBERS[severity] ?? 0;
}
