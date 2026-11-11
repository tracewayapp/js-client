import { describe, expect, it } from "vitest";
import { resolveEndpoints } from "./connection.js";
import { uuidv7, unitHash, uuidToBytes } from "./ids.js";
import {
  ceilingsFrom,
  defaultSettings,
  DEFAULT_EXCEPTION_TRIGGER_ID,
} from "./settings/defaults.js";
import {
  applyOverlay,
  clampToCeilings,
  parseSettingsDocument,
  SettingsError,
} from "./settings/merge.js";
import { ControlState } from "./control/control-state.js";

describe("resolveEndpoints", () => {
  it.each([
    ["https://t.example.com", "https://t.example.com"],
    ["https://t.example.com/", "https://t.example.com"],
    ["https://t.example.com/api/report", "https://t.example.com"],
    ["https://t.example.com/api", "https://t.example.com"],
    ["https://example.com/traceway/api/report", "https://example.com/traceway"],
  ])("derives endpoints from %s", (input, base) => {
    const endpoints = resolveEndpoints(input);
    expect(endpoints.base).toBe(base);
    expect(endpoints.logs).toBe(`${base}/api/otel/v1/logs`);
    expect(endpoints.traces).toBe(`${base}/api/otel/v1/traces`);
    expect(endpoints.opamp).toBe(`${base}/api/otel/v1/opamp`);
    expect(endpoints.recordings).toBe(`${base}/api/recordings`);
  });
});

describe("ids", () => {
  it("uuidv7 encodes the timestamp, version and variant", () => {
    const id = uuidv7(0x0190_1234_5678);
    expect(id).toMatch(
      /^01901234-5678-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(uuidToBytes(id)?.length).toBe(16);
  });

  it("unitHash is stable and within [0, 1)", () => {
    const h = unitHash("0195f2a0-0000-7000-8000-00000000cafe");
    expect(h).toBe(unitHash("0195f2a0-0000-7000-8000-00000000cafe"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  });
});

describe("settings", () => {
  it("defaults keep healthy context local and bound error clips", () => {
    const s = defaultSettings();
    expect(s.signals.errors.mode).toBe("stream");
    expect(s.signals.console.mode).toBe("buffer");
    expect(s.replay.mode).toBe("buffer");
    expect(s.sessions).toEqual({ enabled: true, baselineSampleRate: 0 });
    expect(s.triggers[0]?.cooldownSeconds).toBe(5);
    expect(s.triggers[0]?.maxPerSession).toBe(20);
    expect(s.triggers.map((t) => t.id)).toEqual([DEFAULT_EXCEPTION_TRIGGER_ID]);
    expect(defaultSettings({ recordAllSessions: true }).replay.mode).toBe(
      "stream",
    );
  });

  it("applies known fields and ignores unknown or malformed ones", () => {
    const merged = applyOverlay(defaultSettings(), {
      schemaVersion: 1,
      futureSetting: { anything: true },
      signals: {
        network: { mode: "off" },
        console: { mode: "stream", minSeverity: "warn", sampleRate: 7 },
        errors: { mode: "sideways" },
        nonsense: { mode: "stream" },
      },
      sessions: { baselineSampleRate: 0.01 },
      replay: { sessionSampleRate: 0.25 },
      buffer: { maxBytes: -5, maxAgeSeconds: 120 },
    });
    expect(merged.signals.network.mode).toBe("off");
    expect(merged.signals.console).toEqual({
      mode: "stream",
      minSeverity: "warn",
      sampleRate: 1,
    });
    expect(merged.signals.errors.mode).toBe("stream");
    expect(merged.replay.sessionSampleRate).toBe(0.25);
    expect(merged.sessions.baselineSampleRate).toBe(0.01);
    expect(merged.buffer.maxBytes).toBe(defaultSettings().buffer.maxBytes);
    expect(merged.buffer.maxAgeSeconds).toBe(120);
  });

  it("merges triggers by id: disables, patches and appends", () => {
    const base = defaultSettings();
    const merged = applyOverlay(base, {
      triggers: [
        { id: DEFAULT_EXCEPTION_TRIGGER_ID, enabled: false },
        {
          id: "failed-requests",
          steps: [
            {
              match: {
                key: "attributes.http.response.status_code",
                op: "gte",
                value: 500,
              },
            },
          ],
          actions: [{ type: "stream", durationSeconds: 300, signals: ["*"] }],
        },
        {
          id: "broken",
          steps: [{ match: { key: "x", op: "explode" } }],
          actions: [{ type: "flush", lookbackSeconds: 5 }],
        },
      ],
    });
    expect(merged.triggers).toHaveLength(2);
    expect(merged.triggers[0]!.enabled).toBe(false);
    expect(merged.triggers[0]!.steps).toEqual(base.triggers[0]!.steps);
    expect(merged.triggers[1]!.id).toBe("failed-requests");
    expect(base.triggers[0]!.enabled).toBe(true);
  });

  it("replaces captures and drops invalid ones", () => {
    const merged = applyOverlay(defaultSettings(), {
      captures: [
        {
          id: "c1",
          until: "2026-11-01T12:00:00Z",
          lookbackSeconds: 600,
          replay: true,
        },
        { id: "c2", until: "not a date" },
      ],
    });
    expect(merged.captures).toEqual([
      {
        id: "c1",
        until: "2026-11-01T12:00:00Z",
        lookbackSeconds: 600,
        replay: true,
      },
    ]);
  });

  it("rejects documents this SDK cannot apply", () => {
    expect(() => parseSettingsDocument("{")).toThrow(SettingsError);
    expect(() => parseSettingsDocument("[]")).toThrow(SettingsError);
    expect(() => parseSettingsDocument('{"schemaVersion":2}')).toThrow(
      SettingsError,
    );
    expect(
      parseSettingsDocument(new TextEncoder().encode('{"schemaVersion":1}')),
    ).toEqual({ schemaVersion: 1 });
  });

  it("clamps to the ceilings set in init()", () => {
    const ceilings = ceilingsFrom({
      captureLogs: false,
      sessionRecording: false,
    });
    const clamped = clampToCeilings(
      applyOverlay(defaultSettings(), {
        signals: { console: { mode: "stream" } },
        replay: { mode: "stream" },
      }),
      ceilings,
    );
    expect(clamped.signals.console.mode).toBe("off");
    expect(clamped.replay.mode).toBe("off");
    expect(clamped.signals.network.mode).toBe("buffer");
  });
});

describe("ControlState", () => {
  it("resolves modes through remote config, ceilings and overrides", () => {
    let now = 1_000;
    const state = new ControlState(
      defaultSettings(),
      ceilingsFrom({ captureNetwork: false }),
      () => now,
    );
    expect(state.modeFor("console")).toBe("buffer");
    expect(state.modeFor("network")).toBe("off");

    state.addOverride({ signals: ["*"], replay: true, untilMs: 2_000 });
    expect(state.modeFor("console")).toBe("stream");
    expect(state.modeFor("resourceTiming")).toBe("off");
    expect(state.modeFor("network")).toBe("off");
    expect(state.replayMode()).toBe("stream");

    state.addOverride({
      signals: ["resourceTiming"],
      replay: false,
      untilMs: 2_000,
    });
    expect(state.modeFor("resourceTiming")).toBe("stream");

    now = 2_500;
    expect(state.modeFor("console")).toBe("buffer");
    expect(state.replayMode()).toBe("buffer");
  });

  it("lets a capture bring back signals rules switched off, but not past the ceilings or the plan", () => {
    const now = 1_000;
    const state = new ControlState(
      defaultSettings(),
      ceilingsFrom({ captureNavigation: false }),
      () => now,
    );
    state.applyRemote({
      signals: {
        console: { mode: "off" },
        network: { mode: "off" },
        navigation: { mode: "stream" },
      },
      replay: { mode: "off" },
    });

    state.addOverride({ signals: ["*"], replay: false, untilMs: 2_000 });
    expect(state.modeFor("console")).toBe("off");

    state.addOverride({
      signals: ["*"],
      replay: true,
      untilMs: 2_000,
      includeOff: true,
    });
    expect(state.modeFor("console")).toBe("stream");
    expect(state.modeFor("network")).toBe("stream");
    expect(state.modeFor("navigation")).toBe("off");
    expect(state.modeFor("resourceTiming")).toBe("off");
    expect(state.replayMode()).toBe("stream");

    state.applyRemote({
      signals: { console: { mode: "off" }, errors: { mode: "off" } },
      replay: { mode: "off" },
      limits: { signals: { console: "off", errors: "off" }, replay: "off" },
    });
    expect(state.modeFor("console")).toBe("off");
    expect(state.modeFor("errors")).toBe("off");
    expect(state.replayMode()).toBe("off");
    expect(state.modeFor("network")).toBe("stream");

    state.applyRemote(null);
    expect(state.modeFor("console")).toBe("stream");
    expect(state.replayMode()).toBe("stream");
  });

  it("streams breadcrumbs by default when every session is recorded", () => {
    const all = defaultSettings({ recordAllSessions: true });
    for (const signal of [
      "console",
      "network",
      "navigation",
      "userActions",
      "custom",
    ] as const) {
      expect(all.signals[signal].mode).toBe("stream");
      expect(defaultSettings().signals[signal].mode).toBe("buffer");
    }
    expect(all.signals.resourceTiming.mode).toBe("off");
  });

  it("notifies listeners and honours the kill switch", () => {
    const state = new ControlState(defaultSettings(), ceilingsFrom());
    const seen: boolean[] = [];
    state.onChange((s) => seen.push(s.enabled));
    state.applyRemote({ enabled: false });
    expect(seen).toEqual([false]);
    expect(state.modeFor("errors")).toBe("off");
    expect(state.replayMode()).toBe("off");
    state.applyRemote(null);
    expect(state.modeFor("errors")).toBe("stream");
  });
});
