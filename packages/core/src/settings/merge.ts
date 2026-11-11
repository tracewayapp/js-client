import type {
  Capture,
  Ceilings,
  Condition,
  ConditionOp,
  Matcher,
  Mode,
  Settings,
  SignalSelector,
  Trigger,
  TriggerAction,
  TriggerStep,
} from "./types.js";
import { MODES, SEVERITIES, SIGNALS } from "./types.js";

export class SettingsError extends Error {}

const CONDITION_OPS: readonly ConditionOp[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "icontains",
  "starts_with",
  "glob",
  "exists",
  "not_exists",
  "gt",
  "gte",
  "lt",
  "lte",
  "version",
];

const MAX_MATCHER_DEPTH = 8;
const MAX_STEP_COUNT = 1000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_BUFFER_AGE_SECONDS = 24 * 60 * 60;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as readonly string[]).includes(value)
  );
}

function rate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

function positive(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, max)
    : undefined;
}

/** Parses the document the server sent. Throws for anything this SDK cannot apply. */
export function parseSettingsDocument(body: string | Uint8Array): Json {
  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsError("settings document is not valid JSON");
  }
  if (!isObject(parsed)) {
    throw new SettingsError("settings document must be a JSON object");
  }
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
    throw new SettingsError(
      `unsupported settings schemaVersion ${String(parsed.schemaVersion)}`,
    );
  }
  return parsed;
}

function scalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function parseMatcher(value: unknown, depth = 0): Matcher | null {
  if (!isObject(value) || depth > MAX_MATCHER_DEPTH) return null;
  if (Array.isArray(value.all) || Array.isArray(value.any)) {
    const key = Array.isArray(value.all) ? "all" : "any";
    const items: Matcher[] = [];
    for (const item of value[key] as unknown[]) {
      const parsed = parseMatcher(item, depth + 1);
      if (!parsed) return null;
      items.push(parsed);
    }
    return key === "all" ? { all: items } : { any: items };
  }
  if (value.not !== undefined) {
    const inner = parseMatcher(value.not, depth + 1);
    return inner ? { not: inner } : null;
  }
  if (typeof value.key !== "string" || !value.key) return null;
  if (
    typeof value.op !== "string" ||
    !(CONDITION_OPS as readonly string[]).includes(value.op)
  )
    return null;
  const condition: Condition = { key: value.key, op: value.op as ConditionOp };
  if (value.value !== undefined) {
    if (!scalar(value.value)) return null;
    condition.value = value.value;
  }
  if (value.values !== undefined) {
    if (!Array.isArray(value.values) || !value.values.every(scalar))
      return null;
    condition.values = value.values as Array<string | number | boolean>;
  }
  return condition;
}

function parseSignalSelector(value: unknown): SignalSelector | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = value.filter(
    (s): s is SignalSelector[number] =>
      s === "*" || (SIGNALS as readonly unknown[]).includes(s),
  );
  return known;
}

function parseAction(value: unknown): TriggerAction | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "flush": {
      const lookbackSeconds = positive(
        value.lookbackSeconds,
        MAX_BUFFER_AGE_SECONDS,
      );
      if (lookbackSeconds === undefined) return null;
      return {
        type: "flush",
        lookbackSeconds,
        signals: parseSignalSelector(value.signals),
        replay: value.replay === true,
      };
    }
    case "stream": {
      const durationSeconds = positive(
        value.durationSeconds,
        MAX_BUFFER_AGE_SECONDS,
      );
      if (durationSeconds === undefined) return null;
      return {
        type: "stream",
        durationSeconds,
        signals: parseSignalSelector(value.signals),
        replay: value.replay === true,
      };
    }
    case "startReplay": {
      const durationSeconds = positive(
        value.durationSeconds,
        MAX_BUFFER_AGE_SECONDS,
      );
      return durationSeconds === undefined
        ? null
        : { type: "startReplay", durationSeconds };
    }
    case "capture": {
      const durationSeconds = positive(
        value.durationSeconds,
        MAX_BUFFER_AGE_SECONDS,
      );
      if (durationSeconds === undefined) return null;
      const action: TriggerAction = {
        type: "capture",
        durationSeconds,
        signals: parseSignalSelector(value.signals),
        replay: value.replay === true,
      };
      const lookbackSeconds = positive(
        value.lookbackSeconds,
        MAX_BUFFER_AGE_SECONDS,
      );
      if (lookbackSeconds !== undefined)
        action.lookbackSeconds = lookbackSeconds;
      return action;
    }
    case "emit": {
      if (typeof value.eventName !== "string" || !value.eventName) return null;
      const attributes: Record<string, string> = {};
      if (isObject(value.attributes)) {
        for (const [k, v] of Object.entries(value.attributes)) {
          if (typeof v === "string") attributes[k] = v;
        }
      }
      return { type: "emit", eventName: value.eventName, attributes };
    }
  }
  return null;
}

function parseSteps(value: unknown): TriggerStep[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const steps: TriggerStep[] = [];
  for (const raw of value) {
    if (!isObject(raw)) return null;
    const match = parseMatcher(raw.match);
    if (!match) return null;
    const within = raw.withinSeconds;
    const step: TriggerStep = {
      match,
      withinSeconds: typeof within === "number" && within > 0 ? within : null,
    };
    if (
      typeof raw.count === "number" &&
      Number.isInteger(raw.count) &&
      raw.count > 1
    ) {
      step.count = Math.min(raw.count, MAX_STEP_COUNT);
      const period = raw.periodSeconds;
      step.periodSeconds =
        typeof period === "number" && period > 0
          ? Math.min(period, MAX_BUFFER_AGE_SECONDS)
          : null;
    }
    steps.push(step);
  }
  return steps;
}

function parseActions(value: unknown): TriggerAction[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const actions = value.map(parseAction);
  return actions.every((a): a is TriggerAction => a !== null) ? actions : null;
}

function mergeTrigger(base: Trigger | undefined, raw: Json): Trigger | null {
  const steps = raw.steps === undefined ? base?.steps : parseSteps(raw.steps);
  const actions =
    raw.actions === undefined ? base?.actions : parseActions(raw.actions);
  if (!steps || !actions) return null;
  const merged: Trigger = {
    ...(base ?? { id: String(raw.id) }),
    steps,
    actions,
  };
  if (typeof raw.name === "string") merged.name = raw.name;
  if (typeof raw.enabled === "boolean") merged.enabled = raw.enabled;
  const sampleRate = rate(raw.sampleRate);
  if (sampleRate !== undefined) merged.sampleRate = sampleRate;
  if (typeof raw.cooldownSeconds === "number" && raw.cooldownSeconds >= 0)
    merged.cooldownSeconds = raw.cooldownSeconds;
  if (typeof raw.maxPerSession === "number" && raw.maxPerSession >= 0)
    merged.maxPerSession = raw.maxPerSession;
  return merged;
}

function parseCapture(value: unknown): Capture | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.until !== "string"
  )
    return null;
  if (!Number.isFinite(Date.parse(value.until))) return null;
  const capture: Capture = {
    id: value.id,
    until: value.until,
    replay: value.replay === true,
  };
  const lookback =
    value.lookbackSeconds === 0
      ? 0
      : positive(value.lookbackSeconds, MAX_BUFFER_AGE_SECONDS);
  if (lookback !== undefined) capture.lookbackSeconds = lookback;
  const signals = parseSignalSelector(value.signals);
  if (signals) capture.signals = signals;
  return capture;
}

function cloneSettings(settings: Settings): Settings {
  return JSON.parse(JSON.stringify(settings)) as Settings;
}

/**
 * Lays a remote overlay over `base`. Fields this SDK does not know are ignored
 * so a newer server can add settings; malformed values of known fields are
 * skipped individually instead of rejecting the whole document.
 */
export function applyOverlay(base: Settings, overlay: Json): Settings {
  const out = cloneSettings(base);
  if (typeof overlay.enabled === "boolean") out.enabled = overlay.enabled;

  if (isObject(overlay.signals)) {
    for (const signal of SIGNALS) {
      const raw = overlay.signals[signal];
      if (!isObject(raw)) continue;
      const target = out.signals[signal];
      if (isMode(raw.mode)) target.mode = raw.mode;
      const sampleRate = rate(raw.sampleRate);
      if (sampleRate !== undefined) target.sampleRate = sampleRate;
      if (
        typeof raw.minSeverity === "string" &&
        (SEVERITIES as readonly string[]).includes(raw.minSeverity)
      ) {
        target.minSeverity = raw.minSeverity as typeof target.minSeverity;
      }
    }
  }

  if (isObject(overlay.sessions)) {
    if (typeof overlay.sessions.enabled === "boolean")
      out.sessions.enabled = overlay.sessions.enabled;
    const baselineRate = rate(overlay.sessions.baselineSampleRate);
    if (baselineRate !== undefined)
      out.sessions.baselineSampleRate = baselineRate;
  }

  if (isObject(overlay.replay)) {
    if (isMode(overlay.replay.mode)) out.replay.mode = overlay.replay.mode;
    const sampleRate = rate(overlay.replay.sessionSampleRate);
    if (sampleRate !== undefined) out.replay.sessionSampleRate = sampleRate;
    if (typeof overlay.replay.maskAllInputs === "boolean")
      out.replay.maskAllInputs = overlay.replay.maskAllInputs;
  }

  if (isObject(overlay.buffer)) {
    const maxBytes = positive(overlay.buffer.maxBytes, MAX_BUFFER_BYTES);
    if (maxBytes !== undefined) out.buffer.maxBytes = maxBytes;
    const maxAge = positive(
      overlay.buffer.maxAgeSeconds,
      MAX_BUFFER_AGE_SECONDS,
    );
    if (maxAge !== undefined) out.buffer.maxAgeSeconds = maxAge;
    const replayMax = positive(overlay.buffer.replayMaxBytes, MAX_BUFFER_BYTES);
    if (replayMax !== undefined) out.buffer.replayMaxBytes = replayMax;
    if (typeof overlay.buffer.persist === "boolean")
      out.buffer.persist = overlay.buffer.persist;
  }

  if (Array.isArray(overlay.triggers)) {
    for (const raw of overlay.triggers) {
      if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) continue;
      const index = out.triggers.findIndex((t) => t.id === raw.id);
      const merged = mergeTrigger(
        index >= 0 ? out.triggers[index] : undefined,
        raw,
      );
      if (!merged) continue;
      if (index >= 0) out.triggers[index] = merged;
      else out.triggers.push(merged);
    }
  }

  if (Array.isArray(overlay.captures)) {
    out.captures = overlay.captures
      .map(parseCapture)
      .filter((c): c is Capture => c !== null);
  }

  return out;
}

const MODE_RANK: Record<Mode, number> = { off: 0, buffer: 1, stream: 2 };

export function lowerMode(a: Mode, b: Mode): Mode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

export function modeRank(mode: Mode): number {
  return MODE_RANK[mode];
}

/**
 * Lowers the page's ceilings to the `limits` a remote document carries: what the organization's plan accepts at
 * ingest. Rules cannot set them, and no trigger or capture can exceed them, the same as the `init()` ceilings.
 */
export function applyLimits(
  ceilings: Ceilings,
  overlay: Json | null,
): Ceilings {
  if (!overlay || !isObject(overlay.limits)) return ceilings;
  const limits = overlay.limits;
  const out: Ceilings = { ...ceilings, signals: { ...ceilings.signals } };
  if (isObject(limits.signals)) {
    for (const signal of SIGNALS) {
      const mode = limits.signals[signal];
      if (isMode(mode))
        out.signals[signal] = lowerMode(out.signals[signal], mode);
    }
  }
  if (isMode(limits.replay)) out.replay = lowerMode(out.replay, limits.replay);
  return out;
}

/** Holds every mode at or below what `init()` allowed on this page. */
export function clampToCeilings(
  settings: Settings,
  ceilings: Ceilings,
): Settings {
  const out = cloneSettings(settings);
  out.enabled = out.enabled && ceilings.enabled;
  for (const signal of SIGNALS) {
    out.signals[signal].mode = lowerMode(
      out.signals[signal].mode,
      ceilings.signals[signal],
    );
  }
  out.replay.mode = lowerMode(out.replay.mode, ceilings.replay);
  out.sessions.enabled = out.sessions.enabled && ceilings.sessions;
  return out;
}
