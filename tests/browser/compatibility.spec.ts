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
const frames = (requests: any[]) =>
  requests
    .filter((r) => r.path === "/api/report")
    .flatMap((r) => r.body.collectionFrames);
for (const framework of ["vanilla", "react", "svelte", "vue"]) {
  for (const status of [0, 404, 405, 501]) {
    test(`${framework}: ${status ? `legacy ${status}` : "OpAMP"} errors, messages, replay and breadcrumbs`, async ({
      page,
      request,
    }) => {
      const id = randomUUID();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const state = async () => (await request.get(`/case/${id}/state`)).json();
      await request.post(`/case/${id}/control`, {
        data: { status, config: { schemaVersion: 1 } },
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
      if (status) {
        expect(sent.filter((r: any) => r.path.endsWith("/opamp"))).toHaveLength(
          1,
        );
        expect(
          sent.every((r: any) =>
            ["/api/report", "/api/otel/v1/opamp"].includes(r.path),
          ),
        ).toBe(true);
        const all = frames(sent);
        const issue = all
          .flatMap((f) => f.stackTraces)
          .find((e) => e.stackTrace.includes("checkout failed"));
        expect(issue.isMessage).toBe(false);
        expect(
          all
            .flatMap((f) => f.stackTraces)
            .some((e) => e.isMessage && e.stackTrace === "checkout message"),
        ).toBe(true);
        const issueFrame = all.find((f) =>
          f.stackTraces.some((e) => e.stackTrace.includes("checkout failed")),
        );
        const clips = issueFrame.sessionRecordings.filter(
          (s) => s.exceptionId === issue.sessionRecordingId,
        );
        expect(clips.some((s) => s.events.some((e: any) => e.type === 2))).toBe(
          true,
        );
        expect(JSON.stringify(clips)).toContain("checkout breadcrumb");
        expect(JSON.stringify(clips)).toContain("clicked");
        expect(JSON.stringify(clips)).toContain("application-request");
        expect(clips.every((clip: any) => clip.sessionId === undefined)).toBe(
          true,
        );
      } else {
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
      }
      await page.evaluate(() => (window as any).sdk.shutdown());
      expect(errors).toEqual([]);
    });
  }
}

for (const framework of ["vanilla", "react", "svelte", "vue"]) {
  for (const legacy of [false, true]) {
    test(`${framework}: ${legacy ? "legacy" : "OpAMP"} full sessions survive reload and pagehide`, async ({
      page,
      request,
    }) => {
      const id = randomUUID();
      await request.post(`/case/${id}/control`, {
        data: { status: legacy ? 404 : 0, config: {} },
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
      const recordings = legacy
        ? frames(sent).flatMap((f) => f.sessionRecordings || [])
        : sent
            .filter((r: any) => r.path.endsWith("/recordings"))
            .flatMap((r: any) => r.body.segments);
      const streams = recordings.filter((s: any) => !s.exceptionId);
      expect(streams.length).toBeGreaterThanOrEqual(2);
      expect(streams.every((s: any) => s.sessionId === sessionId)).toBe(true);
      expect(new Set(streams.map((s: any) => s.segmentIndex)).size).toBe(
        streams.length,
      );
    });

    test(`${framework}: ${legacy ? "legacy" : "OpAMP"} local capture opt-outs are respected`, async ({
      page,
      request,
    }) => {
      const id = randomUUID();
      await request.post(`/case/${id}/control`, {
        data: {
          status: legacy ? 404 : 0,
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
      const recordings = legacy
        ? frames(sent).flatMap((f) => f.sessionRecordings || [])
        : sent
            .filter((r: any) => r.path.endsWith("/recordings"))
            .flatMap((r: any) => r.body.segments);
      expect(recordings.every((s: any) => s.events.length === 0)).toBe(true);
    });
  }
}

test("initial CORS/network failure falls back, then adopts a recovered OpAMP server", async ({
  page,
  request,
}) => {
  const id = randomUUID();
  await request.post(`/case/${id}/control`, {
    data: { config: { signals: { custom: { mode: "stream" } } } },
  });
  await page.clock.install();
  await page.route("**/api/otel/v1/opamp", (route) => route.abort("failed"));
  await page.goto(`/vanilla?case=${id}`);
  await page.waitForFunction(() => (window as any).ready);
  await page.evaluate(() => (window as any).sdk.refreshConfig());
  await page.locator("#error").click();
  const flush = page.evaluate(() => (window as any).sdk.flush());
  await page.clock.runFor(10);
  await flush;
  const state = async () =>
    (await (await request.get(`/case/${id}/state`)).json()).requests;
  expect(
    frames(await state())
      .flatMap((f) => f.stackTraces)
      .some((e) => e.stackTrace.includes("checkout failed")),
  ).toBe(true);
  await page.unroute("**/api/otel/v1/opamp");
  await page.clock.fastForward(31_000);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).sdk.getClient().control.settings().signals.custom
            .mode,
      ),
    )
    .toBe("stream");
  await page.evaluate(async () => {
    const sdk = (window as any).sdk;
    sdk.track("recovered-modern");
    await sdk.flush();
  });
  expect(
    logs(await state()).some((r) => r.eventName === "recovered-modern"),
  ).toBe(true);
  await page.evaluate(() => (window as any).sdk.shutdown());
});

test("explicit legacy mode works without any OpAMP request", async ({
  page,
  request,
}) => {
  const id = randomUUID();
  await request.post(`/case/${id}/control`, { data: { status: 404 } });
  await page.goto(
    `/vanilla?case=${id}&options=${encodeURIComponent(JSON.stringify({ transport: "legacy", remoteConfig: false }))}`,
  );
  await page.waitForFunction(() => (window as any).ready);
  await page.locator("#error").click();
  await page.evaluate(() => (window as any).sdk.shutdown());
  const sent = (await (await request.get(`/case/${id}/state`)).json()).requests;
  expect(sent.every((r: any) => r.path === "/api/report")).toBe(true);
  expect(
    frames(sent)
      .flatMap((f) => f.stackTraces)
      .some((e) => e.stackTrace.includes("checkout failed")),
  ).toBe(true);
});
