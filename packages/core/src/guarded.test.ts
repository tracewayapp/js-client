import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricAggregator } from "./metrics/aggregator.js";
import { routeFromParams } from "./metrics/route.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function load() {
  return await import("./guarded.js");
}

describe("guarded", () => {
  it("returns the block's value and contains its failure", async () => {
    const { guarded } = await load();
    expect(guarded("ok", () => 42)).toBe(42);
    expect(
      guarded("boom", () => {
        throw new Error("sdk bug");
      }),
    ).toBeUndefined();
    expect(
      guarded(
        "boom",
        (): number => {
          throw new Error("sdk bug");
        },
        7,
      ),
    ).toBe(7);
  });

  it("is silent without debug, and logs one line per place with it", async () => {
    // The module keeps the console.warn it found when it loaded, before any SDK patching.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { guarded, setGuardedDebug } = await load();
    const fail = () => {
      throw new Error("sdk bug");
    };
    guarded("quiet", fail);
    expect(warn).not.toHaveBeenCalled();
    setGuardedDebug(true);
    guarded("timer", fail);
    guarded("timer", fail);
    guarded("listener", fail);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toBe("Traceway: timer failed");
    setGuardedDebug(false);
  });

  it("survives a console that throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console gone");
    });
    const { guarded, setGuardedDebug } = await load();
    setGuardedDebug(true);
    expect(() =>
      guarded("x", () => {
        throw new Error("sdk bug");
      }),
    ).not.toThrow();
    setGuardedDebug(false);
  });
});

describe("debugLog and setupWarning (JS2-15)", () => {
  it("debugLog is silent without debug; with it, one line per call, or per text with once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { debugLog, setGuardedDebug } = await load();
    debugLog("quiet");
    expect(warn).not.toHaveBeenCalled();
    setGuardedDebug(true);
    const error = new Error("cause");
    debugLog("dropped by ignoreErrors: TypeError: x");
    debugLog("beforeCapture threw", error);
    debugLog("budget used up", undefined, true);
    debugLog("budget used up", undefined, true);
    expect(warn.mock.calls).toEqual([
      ["Traceway: dropped by ignoreErrors: TypeError: x"],
      ["Traceway: beforeCapture threw", error],
      ["Traceway: budget used up"],
    ]);
    setGuardedDebug(false);
  });

  it("setupWarning logs without debug, once per text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setupWarning } = await load();
    setupWarning("jQuery was not found");
    setupWarning("jQuery was not found");
    expect(warn.mock.calls).toEqual([["Traceway: jQuery was not found"]]);
  });
});

describe("MetricAggregator with values a histogram cannot hold", () => {
  it("creates no cell for NaN, negative or non-number values", () => {
    const agg = new MetricAggregator({ now: () => 1000 });
    agg.observe("checkout.duration", NaN);
    agg.observe("checkout.duration", -1);
    agg.observe("checkout.duration", "12" as unknown as number);
    expect(agg.size).toBe(0);
    expect(agg.drain()).toBeNull();
    agg.observe("checkout.duration", 12);
    expect(agg.drain()!.histograms[0]!.histogram.count).toBe(1);
  });
});

describe("routeFromParams with what a router may hand over", () => {
  it("never throws, and leaves a path it cannot read as it is", () => {
    expect(routeFromParams(42 as unknown as string, { id: "1" })).toBe("");
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("x");
        },
      },
    );
    expect(routeFromParams("/orders/1", hostile as never)).toBe("/orders/1");
    expect(routeFromParams("/orders/1", { id: "1" })).toBe("/orders/:id");
  });
});
