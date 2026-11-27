import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

const logs = (requests: any[]) =>
  requests
    .filter((r) => r.path.endsWith("/logs"))
    .flatMap((r) =>
      r.body.resourceLogs.flatMap((r: any) =>
        r.scopeLogs.flatMap((s: any) => s.logRecords),
      ),
    );
for (const framework of ["vanilla", "react", "svelte", "vue"]) {
  test(`${framework}: OpAMP errors, messages, replay and breadcrumbs`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = async () => (await request.get(`/case/${id}/state`)).json();
    await request.post(`/case/${id}/control`, {
      data: { config: { schemaVersion: 1 } },
    });
    await page.goto(`/${framework}?case=${id}`);
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => (window as any).sdk.refreshConfig());
    await page.locator("#private").fill("never-send-this-secret");
    await page.locator("#checkout").click();
    await expect(page.locator("#result")).toHaveText("Checkout completed");
    await page.locator("#error").click();
    await page.evaluate(() => (window as any).sdk.flush());
    await expect
      .poll(async () => JSON.stringify((await state()).requests))
      .toContain("checkout failed");
    const sent = (await state()).requests;
    expect(sent.every((r: any) => r.auth === "Bearer browser")).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("never-send-this-secret");
    const records = logs(sent);
    const issue = records.find((r) => r.eventName === "exception");
    expect(issue).toBeTruthy();
    expect(
      records.some((r) => r.body?.stringValue === "checkout message"),
    ).toBe(true);
    expect(records.some((r) => r.eventName === "checkout.completed")).toBe(
      true,
    );
    const exceptionId = issue.attributes.find(
      (a: any) => a.key === "traceway.exception.id",
    ).value.stringValue;
    const clips = sent
      .filter((r: any) => r.path.endsWith("/recordings"))
      .flatMap((r: any) => r.body.segments);
    expect(
      clips.some(
        (s: any) =>
          s.exceptionId === exceptionId &&
          s.events.some((e: any) => e.type === 2),
      ),
    ).toBe(true);
    // Change a running app from buffering to streaming, then turn collection off.
    await request.post(`/case/${id}/control`, {
      data: { config: { signals: { custom: { mode: "stream" } } } },
    });
    await page.evaluate(async () => {
      const sdk = (window as any).sdk;
      await sdk.refreshConfig();
      sdk.track("remote-streamed");
      await sdk.flush();
    });
    expect(
      logs((await state()).requests).some(
        (r) => r.eventName === "remote-streamed",
      ),
    ).toBe(true);
    await request.post(`/case/${id}/control`, {
      data: { config: { enabled: false } },
    });
    await page.evaluate(async () => {
      const sdk = (window as any).sdk;
      await sdk.refreshConfig();
      sdk.captureException(new Error("disabled-error"));
      sdk.track("disabled-event");
      await sdk.flush();
    });
    expect(JSON.stringify((await state()).requests)).not.toContain(
      "disabled-error",
    );
    expect(JSON.stringify((await state()).requests)).not.toContain(
      "disabled-event",
    );
    await page.evaluate(() => (window as any).sdk.shutdown());
    // The Vue development fixture throws from its event handler after the SDK reports it.
    expect(errors).toEqual(framework === "vue" ? ["checkout failed"] : []);
  });
}

for (const framework of ["vanilla", "react", "svelte", "vue"]) {
  test(`${framework}: OpAMP full sessions survive reload and pagehide`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    await request.post(`/case/${id}/control`, {
      data: { config: {} },
    });
    const url = `/${framework}?case=${id}&options=${encodeURIComponent(JSON.stringify({ recordAllSessions: true }))}`;
    await page.goto(url);
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => (window as any).sdk.refreshConfig());
    const sessionId = await page.evaluate(() =>
      (window as any).sdk.getClient().currentSessionId(),
    );
    await page.locator("#checkout").click();
    await expect(page.locator("#result")).toHaveText("Checkout completed");
    await page.evaluate(async () => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      await (window as any).sdk.flush();
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => (window as any).sdk.refreshConfig());
    expect(
      await page.evaluate(() =>
        (window as any).sdk.getClient().currentSessionId(),
      ),
    ).toBe(sessionId);
    await page.locator("#checkout").click();
    await expect(page.locator("#result")).toHaveText("Checkout completed");
    await page.evaluate(() => (window as any).sdk.shutdown());
    const sent = (await (await request.get(`/case/${id}/state`)).json())
      .requests;
    const recordings = sent
      .filter((r: any) => r.path.endsWith("/recordings"))
      .flatMap((r: any) => r.body.segments);
    const streams = recordings.filter((s: any) => !s.exceptionId);
    expect(streams.length).toBeGreaterThanOrEqual(2);
    expect(streams.every((s: any) => s.sessionId === sessionId)).toBe(true);
    expect(new Set(streams.map((s: any) => s.segmentIndex)).size).toBe(
      streams.length,
    );
  });

  test(`${framework}: OpAMP local capture opt-outs are respected`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    await request.post(`/case/${id}/control`, {
      data: {
        config: {
          replay: { mode: "stream" },
          signals: { console: { mode: "stream" } },
        },
      },
    });
    const options = {
      sessionRecording: false,
      captureLogs: false,
      captureNetwork: false,
      captureUserActions: false,
    };
    await page.goto(
      `/${framework}?case=${id}&options=${encodeURIComponent(JSON.stringify(options))}`,
    );
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => (window as any).sdk.refreshConfig());
    await page.locator("#checkout").click();
    await expect(page.locator("#result")).toHaveText("Checkout completed");
    await page.locator("#error").click();
    await page.evaluate(() => (window as any).sdk.shutdown());
    const sent = (await (await request.get(`/case/${id}/state`)).json())
      .requests;
    expect(JSON.stringify(sent)).toContain("checkout failed");
    expect(JSON.stringify(sent)).not.toContain("checkout breadcrumb");
    expect(JSON.stringify(sent)).not.toContain("application-request");
    const recordings = sent
      .filter((r: any) => r.path.endsWith("/recordings"))
      .flatMap((r: any) => r.body.segments);
    expect(recordings.every((s: any) => s.events.length === 0)).toBe(true);
  });
}

// A server without OpAMP: remote config turns off, local settings apply, and everything still goes out as OTLP.
for (const transport of [undefined, "legacy"]) {
  test(`OpAMP 404${transport ? ` with transport "${transport}"` : ""}: errors still arrive as OTLP logs, never at /api/report`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    const state = async () =>
      (await (await request.get(`/case/${id}/state`)).json()).requests;
    await request.post(`/case/${id}/control`, { data: { status: 404 } });
    await page.goto(
      `/vanilla?case=${id}&options=${encodeURIComponent(JSON.stringify(transport ? { transport } : {}))}`,
    );
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => (window as any).sdk.refreshConfig());
    await page.locator("#error").click();
    await page.evaluate(() => (window as any).sdk.flush());
    await expect
      .poll(async () => JSON.stringify(logs(await state())))
      .toContain("checkout failed");
    await page.evaluate(() => (window as any).sdk.shutdown());
    const sent = await state();
    const paths = sent.map((r: any) => r.path);
    expect(paths).not.toContain("/api/report");
    expect(
      paths.filter(
        (path: string) =>
          ![
            "/api/otel/v1/opamp",
            "/api/otel/v1/logs",
            "/api/otel/v1/traces",
            "/api/otel/v1/metrics",
            "/api/recordings",
          ].includes(path),
      ),
    ).toEqual([]);
    // The 404 stops polling: refreshConfig() does not ask again.
    expect(paths.filter((path: string) => path.endsWith("/opamp"))).toHaveLength(
      1,
    );
    expect(sent.every((r: any) => r.auth === "Bearer browser")).toBe(true);
    const issue = logs(sent).find(
      (r) =>
        r.eventName === "exception" &&
        JSON.stringify(r).includes("checkout failed"),
    );
    expect(issue).toBeTruthy();
    const exceptionId = issue.attributes.find(
      (a: any) => a.key === "traceway.exception.id",
    ).value.stringValue;
    const clips = sent
      .filter((r: any) => r.path.endsWith("/recordings"))
      .flatMap((r: any) => r.body.segments);
    expect(
      clips.some(
        (s: any) =>
          s.exceptionId === exceptionId &&
          s.events.some((e: any) => e.type === 2),
      ),
    ).toBe(true);
    expect(
      warnings.filter((w) => w.includes("transport option is deprecated")),
    ).toHaveLength(transport ? 1 : 0);
    expect(
      warnings.filter((w) => w.includes("connection strings are deprecated")),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
