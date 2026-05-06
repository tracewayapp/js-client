import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionLifecycle } from "./session-lifecycle.js";

describe("SessionLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ends the session after the inactivity window elapses", () => {
    const onEnd = vi.fn();
    const lc = new SessionLifecycle({
      inactivityMs: 60_000,
      maxDurationMs: 10 * 60_000,
      checkIntervalMs: 1_000,
      onSessionEnd: onEnd,
    });
    lc.install();

    vi.advanceTimersByTime(30_000);
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(40_000);
    expect(onEnd).toHaveBeenCalledTimes(1);

    lc.uninstall();
  });

  it("ends the session at the max-duration cap even with continuous activity", () => {
    const onEnd = vi.fn();
    const lc = new SessionLifecycle({
      inactivityMs: 60 * 60_000,
      maxDurationMs: 5_000,
      checkIntervalMs: 1_000,
      onSessionEnd: onEnd,
    });
    lc.install();

    for (let i = 0; i < 10; i++) {
      lc.markActivity();
      vi.advanceTimersByTime(1_000);
    }
    expect(onEnd).toHaveBeenCalledTimes(1);

    lc.uninstall();
  });

  it("markActivity resets the inactivity timer", () => {
    const onEnd = vi.fn();
    const lc = new SessionLifecycle({
      inactivityMs: 5_000,
      maxDurationMs: 60 * 60_000,
      checkIntervalMs: 1_000,
      onSessionEnd: onEnd,
    });
    lc.install();

    vi.advanceTimersByTime(3_000);
    lc.markActivity();
    vi.advanceTimersByTime(3_000);
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(onEnd).toHaveBeenCalledTimes(1);

    lc.uninstall();
  });

  it("pagehide ends the session immediately", () => {
    const onEnd = vi.fn();
    const lc = new SessionLifecycle({
      onSessionEnd: onEnd,
    });
    lc.install();

    window.dispatchEvent(new Event("pagehide"));
    expect(onEnd).toHaveBeenCalledTimes(1);

    lc.uninstall();
  });

  it("onSoftFlush fires when the document goes hidden, without ending the session", () => {
    const onEnd = vi.fn();
    const onSoftFlush = vi.fn();
    const lc = new SessionLifecycle({
      onSessionEnd: onEnd,
      onSoftFlush,
    });
    lc.install();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onSoftFlush).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();

    lc.uninstall();
  });

  it("pageshow with persisted=true triggers onSessionRestart and resets the ended flag", () => {
    const onEnd = vi.fn();
    const onRestart = vi.fn();
    const lc = new SessionLifecycle({
      inactivityMs: 5_000,
      checkIntervalMs: 1_000,
      onSessionEnd: onEnd,
      onSessionRestart: onRestart,
    });
    lc.install();

    window.dispatchEvent(new Event("pagehide"));
    expect(onEnd).toHaveBeenCalledTimes(1);

    // Simulate bfcache restore.
    const restoreEvent = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restoreEvent, "persisted", { value: true });
    window.dispatchEvent(restoreEvent);
    expect(onRestart).toHaveBeenCalledTimes(1);

    // After restart, the inactivity timer must work again. Without reset,
    // ended=true would short-circuit every tick.
    vi.advanceTimersByTime(10_000);
    expect(onEnd).toHaveBeenCalledTimes(2);

    lc.uninstall();
  });

  it("pageshow with persisted=false (initial load) does NOT trigger restart", () => {
    const onRestart = vi.fn();
    const lc = new SessionLifecycle({
      onSessionEnd: vi.fn(),
      onSessionRestart: onRestart,
    });
    lc.install();

    const initialLoad = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(initialLoad, "persisted", { value: false });
    window.dispatchEvent(initialLoad);
    expect(onRestart).not.toHaveBeenCalled();

    lc.uninstall();
  });

  it("ends the session at most once even when multiple triggers fire", () => {
    const onEnd = vi.fn();
    const lc = new SessionLifecycle({
      inactivityMs: 1_000,
      checkIntervalMs: 100,
      onSessionEnd: onEnd,
    });
    lc.install();

    vi.advanceTimersByTime(2_000);
    window.dispatchEvent(new Event("pagehide"));
    expect(onEnd).toHaveBeenCalledTimes(1);

    lc.uninstall();
  });
});
