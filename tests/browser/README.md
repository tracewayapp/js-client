# Browser compatibility tests

Run `npm ci`, `npx playwright install chromium`, then `npm run test:e2e`.
Playwright builds real vanilla, React 18, Svelte 4 and Vue 3 fixtures against the workspace packages.
The HTTP fixtures cover OpAMP settings, legacy capability responses, issue/replay linkage, input masking,
local opt-outs, full-session recording, reloads, pagehide, and recovery after an initial network failure.
Failures retain Playwright traces in `test-results/`. `npm run test:browser` runs the additional v2 regression suite.

For real server/database/storage validation, provide two Traceway source checkouts:

```sh
TRACEWAY_OLD_SOURCE=/path/to/traceway-main \
TRACEWAY_NEW_SOURCE=/path/to/traceway-opamp \
npm run test:e2e:live
```

The runner builds isolated Go modules with the checkouts' backend and CLI dependencies, starts disposable SQLite
servers on ports 4330/4331, and stops both after testing. It needs the Go toolchain declared by those checkouts.
It seeds a browser project and a test login, creates and removes a collection rule on the new server, and verifies
issues, messages, session links, masked rrweb replay, and streamed custom events through the dashboard APIs.
Both servers are exercised from a different browser origin, including actual CORS preflight behavior.
Data stays under `.cache/browser-live-*` for diagnosis; no existing database or project is used.

To use already-running **disposable** servers seeded with the same project/user (see `scripts/browser-live.mjs`):

```sh
TRACEWAY_BROWSER_OLD_URL=http://127.0.0.1:4330 \
TRACEWAY_BROWSER_NEW_URL=http://127.0.0.1:4331 \
npx playwright test live.spec.ts
```

Without those environment variables, live-server tests are explicitly skipped. The regular HTTP fixture tests
still run. The fixture server on port 4318 is managed and stopped by Playwright.

Initial live validation used Traceway `main` at `4d53d9c9` (without OpAMP) and
`otel-browser-sdk` at `851b3435` (with OpAMP). All four framework integrations passed against both.
