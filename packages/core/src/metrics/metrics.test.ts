import { describe, expect, it } from "vitest";
import { MetricAggregator } from "./aggregator.js";
import { Histogram, bucketIndex } from "./histogram.js";
import { encodeMetrics } from "./otlp.js";
import { normalizePath, routeFromParams } from "./route.js";

describe("Histogram", () => {
  it("puts a value in the bucket whose bounds contain it", () => {
    for (const value of [0.001, 0.1, 1, 2.5, 100, 2500, 60_000]) {
      const index = bucketIndex(value);
      expect(value).toBeGreaterThan(2 ** (index / 8) * (1 - 1e-9));
      expect(value).toBeLessThanOrEqual(2 ** ((index + 1) / 8) * (1 + 1e-9));
    }
  });

  it("keeps count, sum, min and max exact and counts zero apart", () => {
    const h = new Histogram();
    for (const v of [0, 10, 20, 30]) h.record(v);
    expect(h.count).toBe(4);
    expect(h.sum).toBe(60);
    expect(h.min).toBe(0);
    expect(h.max).toBe(30);
    expect(h.zeroCount).toBe(1);
    expect([...h.buckets.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("refuses values a histogram cannot hold", () => {
    const h = new Histogram();
    expect(h.record(-1)).toBe(false);
    expect(h.record(NaN)).toBe(false);
    expect(h.record(Infinity)).toBe(false);
    expect(h.count).toBe(0);
  });
});

describe("MetricAggregator", () => {
  it("merges observations of one metric and dimension set into one cell", () => {
    const agg = new MetricAggregator({ now: () => 1000 });
    agg.observe("lcp", 1200, { rating: "good", "url.path": "/" }, "ms");
    agg.observe("lcp", 1300, { "url.path": "/", rating: "good" }, "ms");
    agg.observe("lcp", 5000, { rating: "poor", "url.path": "/" }, "ms");
    const batch = agg.drain()!;
    expect(batch.histograms).toHaveLength(2);
    expect(batch.histograms[0]!.histogram.count).toBe(2);
    expect(agg.drain()).toBeNull();
  });

  it("stores a ratio as a part counter and a total counter", () => {
    const agg = new MetricAggregator();
    agg.ratio("request.failed", 1, 4, { host: "api" });
    agg.ratio("request.failed", 0, 6, { host: "api" });
    const sums = Object.fromEntries(
      agg.drain()!.sums.map((s) => [s.name, s.value]),
    );
    expect(sums).toEqual({ "request.failed.total": 10, "request.failed": 1 });
  });

  it("folds the view to other at the cell limit instead of growing", () => {
    const agg = new MetricAggregator({ maxCells: 3 });
    for (let i = 0; i < 10; i++)
      agg.observe("route", 100, { "url.path": `/p${i}` });
    const batch = agg.drain()!;
    expect(batch.histograms).toHaveLength(4);
    const other = batch.histograms.find((h) => h.dims["url.path"] === "other")!;
    expect(other.histogram.count).toBe(7);
    expect(agg.dropped).toBe(0);
  });

  it("drops and counts a new cell that cannot be folded", () => {
    const agg = new MetricAggregator({ maxCells: 1 });
    agg.count("a");
    agg.count("b");
    expect(agg.dropped).toBe(1);
    expect(agg.drain()!.sums).toHaveLength(1);
  });

  it("keeps the three largest exemplars", () => {
    const agg = new MetricAggregator();
    [5, 9, 1, 7, 3].forEach((v, i) => agg.observe("lcp", v, {}, "ms", `s${i}`));
    const values = agg.drain()!.histograms[0]!.exemplars.map((e) => e.value);
    expect(values.sort()).toEqual([5, 7, 9]);
  });
});

describe("encodeMetrics", () => {
  it("renders delta exponential histograms and sums", () => {
    let now = 1_700_000_000_000;
    const agg = new MetricAggregator({ now: () => now });
    agg.observe("browser.web_vital.lcp", 1000, { rating: "good" }, "ms");
    agg.observe(
      "browser.web_vital.lcp",
      4000,
      { rating: "good" },
      "ms",
      "sess",
    );
    agg.count("browser.page_view", 2, { "url.path": "/" });
    now += 5000;
    const body = encodeMetrics(
      agg.drain()!,
      { "service.version": "1.0", "traceway.sample_rate": 0.5 },
      { name: "traceway", version: "2.1.0" },
    ) as any;
    const rm = body.resourceMetrics[0];
    expect(rm.resource.attributes).toContainEqual({
      key: "traceway.sample_rate",
      value: { doubleValue: 0.5 },
    });
    const [hist, sum] = rm.scopeMetrics[0].metrics;
    expect(hist.unit).toBe("ms");
    expect(hist.exponentialHistogram.aggregationTemporality).toBe(1);
    const dp = hist.exponentialHistogram.dataPoints[0];
    expect(dp.scale).toBe(3);
    expect(dp.count).toBe(2);
    expect(dp.startTimeUnixNano).toBe("1700000000000000000");
    expect(dp.timeUnixNano).toBe("1700000005000000000");
    expect(dp.positive.offset).toBe(bucketIndex(1000));
    expect(dp.positive.bucketCounts).toHaveLength(
      bucketIndex(4000) - bucketIndex(1000) + 1,
    );
    expect(
      dp.positive.bucketCounts.reduce((a: number, b: number) => a + b),
    ).toBe(2);
    expect(dp.exemplars[0].filteredAttributes[0]).toEqual({
      key: "session.id",
      value: { stringValue: "sess" },
    });
    expect(dp.exemplars[0].filteredAttributes).toHaveLength(1);
    expect(sum.sum.isMonotonic).toBe(true);
    expect(sum.sum.dataPoints[0].asDouble).toBe(2);
  });
});

describe("exemplar culprit", () => {
  it("carries the target next to the session when one is known", () => {
    const agg = new MetricAggregator();
    agg.observe("browser.web_vital.lcp", 5000, {}, "ms", {
      sessionId: "sess",
      target: "#hero>img",
    });
    agg.observe("browser.web_vital.lcp", 6000, {}, "ms", { sessionId: "" });
    const batch = agg.drain()!;
    expect(batch.histograms[0]!.exemplars).toHaveLength(1);
    const body = encodeMetrics(batch, {}, { name: "t", version: "1" }) as any;
    const dp =
      body.resourceMetrics[0].scopeMetrics[0].metrics[0].exponentialHistogram
        .dataPoints[0];
    expect(dp.exemplars[0].filteredAttributes).toEqual([
      { key: "session.id", value: { stringValue: "sess" } },
      { key: "traceway.target", value: { stringValue: "#hero>img" } },
    ]);
  });
});

describe("normalizePath", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/orders/8841", "/orders/:id"],
    ["/orders/8841/", "/orders/:id"],
    ["/orders/8841?x=1#y", "/orders/:id"],
    ["/u/3f2b8c1e-9a4d-4c7e-8b1a-2d3e4f5a6b7c/edit", "/u/:id/edit"],
    ["/commit/9fceb02d0ae598e9", "/commit/:id"],
    ["/reset/dGhpcyBpcyBhIHRva2VuIHZhbHVl0", "/reset/:id"],
    ["/products/blue-suede-shoes", "/products/blue-suede-shoes"],
    ["/deadbeef", "/deadbeef"],
    ["/a/b/c/d/e/f/g/h", "/a/b/c/d/e/f/*"],
    ["/search/hello%20world", "/search/:id"],
    [
      "/endpoints/POST%20%2Ftasks%2F%7BtaskId%7D/9fceb02d0ae598e9",
      "/endpoints/:id/:id",
    ],
    ["/caf%C3%A9/menu", "/caf%C3%A9/menu"],
    ["/:lang?/about", "/:lang?/about"],
    ["/:locale(en|fr)?/products/:slug", "/:locale(en|fr)?/products/:slug"],
    ["/users/:id?", "/users/:id"],
    ["/orders/8841?/next", "/orders/:id"],
    // Route templates as real routers write them (Nuxt, Next.js, TanStack) pass unchanged.
    ["/products/:slug()", "/products/:slug()"],
    ["/docs/:slug(.*)*", "/docs/:slug(.*)*"],
    ["/docs/:slug*", "/docs/:slug*"],
    ["/posts/$postId", "/posts/$postId"],
    ["/posts/[id]", "/posts/[id]"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("never returns more than 64 characters", () => {
    const long = `/${"segment-that-is-long/".repeat(8)}`;
    const out = normalizePath(long);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith("/*")).toBe(true);
  });
});

describe("routeFromParams", () => {
  it.each([
    ["/orders/8841", { id: "8841" }, "/orders/:id"],
    ["/orders/8841/", { id: "8841" }, "/orders/:id"],
    ["/orders/8841?tab=items#top", { id: "8841" }, "/orders/:id"],
    ["/", {}, "/"],
    ["/pricing", undefined, "/pricing"],
    ["/teams/acme/users/42", { team: "acme", id: "42" }, "/teams/:team/users/:id"],
    // React Router's splat and a Next.js catch-all
    ["/files/a/b/c", { "*": "a/b/c" }, "/files/*"],
    ["/docs/guides/setup", { slug: ["guides", "setup"] }, "/docs/:slug*"],
    ["/docs/intro", { slug: ["intro"] }, "/docs/:slug*"],
    // The path is encoded, the param may be either
    ["/search/hello%20world", { q: "hello world" }, "/search/:q"],
    ["/search/hello%20world", { q: "hello%20world" }, "/search/:q"],
    // A value equal to a static segment names the deeper one
    ["/users/users", { name: "users" }, "/users/:name"],
    // Both params have the same value
    ["/compare/7/7", { left: "7", right: "7" }, "/compare/:left/:right"],
    ["/orders/8841", { id: "9999" }, "/orders/8841"],
    ["/orders/8841", { id: undefined }, "/orders/8841"],
  ])("%s with %o -> %s", (pathname, params, expected) => {
    expect(routeFromParams(pathname, params)).toBe(expected);
  });
});
