import { test, expect } from "@playwright/test";

// Point these at disposable servers seeded with the test project/user below.
// Never run against a production project: these tests create a temporary collection rule.
for (const kind of ["OLD", "NEW"]) {
  const base = process.env[`TRACEWAY_BROWSER_${kind}_URL`];
  test.describe(`${kind.toLowerCase()} Traceway persistence`, () => {
    test.skip(
      !base,
      "Set TRACEWAY_BROWSER_OLD_URL / TRACEWAY_BROWSER_NEW_URL to disposable Traceway servers",
    );
    test.describe.configure({ mode: "serial" });
    let token: string;
    let projectId: string;
    let ruleId: string;
    test.beforeAll(async ({ request }) => {
      const response = await request.post(`${base}/api/login`, {
        data: {
          email: "browser@example.test",
          password: "browser-test-password",
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const login = await response.json();
      token = login.token || login.accessToken;
      projectId = login.projects[0].id;
      expect(token).toBeTruthy();
      if (kind === "NEW") {
        const rule = await request.post(
          `${base}/api/sdk-config/rules?projectId=${projectId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            data: {
              name: "Browser compatibility test",
              enabled: true,
              conditions: {},
              settings: { signals: { custom: { mode: "stream" } } },
            },
          },
        );
        expect(rule.ok(), await rule.text()).toBe(true);
        ruleId = (await rule.json()).id;
      }
    });
    test.afterAll(async ({ request }) => {
      if (ruleId)
        await request.delete(
          `${base}/api/sdk-config/rules/${ruleId}?projectId=${projectId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
    });
    for (const framework of ["vanilla", "react", "svelte", "vue"]) {
      test(`${framework} persists linked issues, messages, sessions and real replay`, async ({
        page,
        request,
      }) => {
        const marker = `live-${kind}-${framework}-${Date.now()}`;
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const api = async (path: string, data: any) => {
          const response = await request.post(
            `${base}/api${path}?projectId=${projectId}`,
            { headers: { Authorization: `Bearer ${token}` }, data },
          );
          expect(response.ok(), await response.text()).toBe(true);
          return response.json();
        };
        await page.goto(
          `/${framework}?connection=${encodeURIComponent(`browser-test-token@${base}/api/report`)}`,
        );
        await page.waitForFunction(() => (window as any).ready);
        await page.evaluate(() => (window as any).sdk.refreshConfig());
        if (kind === "NEW")
          expect(
            await page.evaluate(
              () =>
                (window as any).sdk.getClient().control.settings().signals
                  .custom.mode,
            ),
          ).toBe("stream");
        await page.locator("#private").fill("live-secret-must-be-masked");
        await page.locator("#checkout").click();
        await expect(page.locator("#result")).toHaveText("Checkout completed");
        await page.evaluate(async (marker) => {
          const sdk = (window as any).sdk;
          sdk.setAttribute("test.marker", marker);
          sdk.captureException(new Error(marker));
          sdk.captureMessage(`${marker}-message`);
          sdk.track(marker);
          await sdk.flush();
        }, marker);
        const session = await page.evaluate(() =>
          (window as any).sdk.getClient().currentSessionId(),
        );
        const range = {
          fromDate: new Date(Date.now() - 3600000).toISOString(),
          toDate: new Date(Date.now() + 60000).toISOString(),
          pagination: { page: 1, pageSize: 100 },
        };
        let issue: any;
        await expect
          .poll(
            async () => {
              const result = await api("/exception-stack-traces", range);
              issue = result.data.find(
                (e: any) =>
                  e.stackTrace.includes(marker) &&
                  !e.stackTrace.includes(`${marker}-message`),
              );
              return (
                Boolean(issue) &&
                result.data.some((e: any) =>
                  e.stackTrace.includes(`${marker}-message`),
                )
              );
            },
            { timeout: 20000 },
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              const detail = await api(
                `/exception-stack-traces/${issue.exceptionHash}`,
                range,
              );
              return JSON.stringify(detail.sessionRecording);
            },
            { timeout: 20000 },
          )
          .toContain("Checkout completed");
        const detail = await api(
          `/exception-stack-traces/${issue.exceptionHash}`,
          range,
        );
        expect(detail.sessionId).toBe(session);
        expect(JSON.stringify(detail.sessionRecording)).not.toContain(
          "live-secret-must-be-masked",
        );
        const sessions = await api("/sessions", range);
        expect(sessions.data.some((s: any) => s.id === session)).toBe(true);
        if (kind === "NEW") {
          const logs = await api("/logs", {
            ...range,
            attributeFilters: [
              { scope: "log", key: "event.name", value: marker },
            ],
          });
          expect(
            logs.data.some(
              (l: any) => l.logAttributes["event.name"] === marker,
            ),
          ).toBe(true);
        }
        await page.evaluate(() => (window as any).sdk.shutdown());
        expect(errors).toEqual([]);
      });
    }
  });
}
