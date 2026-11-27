# Changelog

## 2.1.0 — unreleased

All ten workspace packages move to 2.1.0 together, as the repo releases them: the browser packages (`core`,
`opamp`, `frontend`, `react`, `vue`, `svelte`, `jquery`) and `react-native`, `sourcemap-upload` and
`bundler-plugin`. `@tracewayapp/react-native` only shares the version number; its API did not change.

### New start API (`@tracewayapp/frontend`, React, Vue, Svelte, jQuery)

- `init({ token: "YOUR_TOKEN" })` starts the SDK: `token` is the project token, `baseUrl` (default
  `https://cloud.tracewayapp.com`) is only needed for a self-hosted server, and every other option goes in the same
  object. React `<TracewayProvider token={…} baseUrl={…} options={…}>`, Vue `createTracewayPlugin({ token, baseUrl,
  options })`, Svelte `setupTraceway({ token, baseUrl, options })`, jQuery `init({ token, … })`.
- The 2.0 form `init("token@https://host", options)` and the wrappers' `connectionString` prop or field still work,
  deprecated, with one console warning that names the new form (never the token). Every variation is read the same
  way (CONTRACT §16.1): with or without `/api` or `/api/report`, trailing slashes, a query string or whitespace;
  without a scheme `https://` is added (`http://` for `localhost`, `127.0.0.1`, `10.0.2.2` and `[::1]`); a server
  under a sub-path keeps its path. A `baseUrl` passed alone is normalized by the same rules. A string or URL the SDK
  cannot use leaves it off with one warning; `init()` never throws.
- Without a token and without a `telemetry` destination, the warning says what to pass and asks whether the
  environment variable is set in this build, instead of a message about standalone telemetry.
- `telemetry` (an OTLP/HTTP `url`, `headers`, per-signal `logs`/`traces`/`metrics`) sends logs, traces and metrics
  to another OpenTelemetry provider; with a token, errors, replay, captures and remote config stay on Traceway;
  without one the SDK runs standalone.

### Browser (`@tracewayapp/frontend`, re-exported by the React, Vue, Svelte and jQuery packages)

- `log(message, level?, attributes?)` records a log line (`TracewayLogLevel`), a console-signal record with
  `log.source = "api"`, like the mobile SDKs' `log`.
- New in this release: the `traceway-mask` class hides text (`*`) and pictures (placeholder boxes) in the replay, and
  `traceway-blank` records an empty box of the element's size. Inside them it also hides attribute values that carry
  text (`title`, `alt`, `aria-*`, `data-*`, `placeholder`, `label`, `href`, `value`), what is typed into fields with
  `maskAllInputs` off, `src`/`srcset`/`poster` and pictures in `style` attributes, and text that shadow roots and
  same-origin frames inside them render or change after recording started. rrweb's `rr-mask`, `rr-block` and
  `rr-ignore` keep working.
- Exceptions, messages, log lines (`console.*`, `log()`) and actions (`recordAction`, clicks) carry the screen keys of
  the mobile SDKs: `app.screen.name` (the route template, else the path), `app.screen.route`, `app.screen.previous`,
  `app.screen.duration_ms` and `viewport`. History navigations carry the name and route template of the screen they
  arrive at.
- `recordNavigation(path, action = "push", from?, route?)` records a navigation the address does not show, with the
  mobile SDKs' record (`url.full`, `navigation.action`, `browser.navigation.type`, `navigation.to`,
  `navigation.from`, `app.screen.name`, `app.screen.route`). Each arrival is a page view of the performance metrics
  (memory and hash routers, modals, wizard steps), `"replace"` of the same path is not, and `"remove"` is not an
  arrival: no `navigation.to`, the screen stays, as on Android. A route change the SDK follows from the address that
  the app also reports counts once.
- `tracer()` returns the SDK's OpenTelemetry tracer for spans of your own (`undefined` before `init()`); they carry the
  session id and nest under the interaction whose `run()` they start in. The SDK still registers no OpenTelemetry
  globals.
- `startInteraction(name, attributes?)` returns a `TracewayInteraction` with the mobile SDKs' members: `traceId`,
  `spanId`, `isEnded`, `run`, `bind`, `setAttribute(key, value)`, `captureException` and `end(failed?)`
  (`end(true)` marks it failed without an exception). Before `init()` the same members exist and only run the work.
- `beforeCapture` receives `TracewayCapturedError` (`CapturedException` stays as a deprecated alias) with the mobile
  SDKs' `error`, the value thrown or passed to `captureException` (undefined for a message), and `isMessage`, so
  `beforeCapture: (e) => !(e.error instanceof PaymentDeclined)` works.
- The replay honours `replay.images` (default `"wifi"`): `"off"` records pictures as empty boxes of their size,
  `"wifi"` keeps URL references, `"always"` also adds small copies of the pictures the page may read (displayed size,
  at most 384 px, JPEG 0.45, at most 48 KiB each, 128 kept, 4 MiB per session) without touching the page's own
  `<img>` elements. A picture with transparency is never JPEG, which would replay it as a black box: it is PNG at
  most 192 px. Session events carry `traceway.replay.images` and `traceway.replay.image_bytes`.
- `replayImages` (`"off" | "wifi" | "always"`, `TracewayImagePolicy`, default `"always"`; in the React, Vue, Svelte
  and jQuery options too) is the ceiling of `replay.images`, as on the mobile SDKs: the lower of the two applies
  (`off` < `wifi` < `always`), so no Data Collection rule can put pictures into the replay that the code ruled out.
  A value that is not one of the three counts as `"off"`, with one warning; without replay the policy is `"off"`.
  `collection.replay.maskAllInputs: true` is a floor: a rule's `maskAllInputs: false` leaves the inputs masked.
  Session events report the policy that applies.
- `debug: true` explains what is captured and why something is dropped, with the page's own `console.warn` (Traceway
  never records these lines): the start (`Traceway: started (…/api/otel/v1/logs), session …`), remote config
  applied, rejected or unavailable, every exception or message dropped and why (`ignoreErrors`, `beforeCapture`,
  `errorLimits`, the session upload budget), a repeated `init()`, and SDK failures it contained.
- Crash safety (CONTRACT §13): every public function, hook, listener, timer and wrapped browser method runs inside
  one guard (`guarded` of `@tracewayapp/core`). An SDK failure, a garbage argument or a call before `init()` or after
  `shutdown()` never reaches the app; the page's own errors still reach its handlers unchanged. `init()` never
  throws and logs one warning when it cannot start.
- Server-side rendering: `init()` does nothing without `window`, so `getClient()` stays `null` on the server, no
  attributes are shared between requests, and a server build without its token warns nothing per request.
- `ErrorLimits` and `CollectionLimits`, the types of the `errorLimits` and `collectionLimits` options, are exported.
- The SDK no longer records its own uploads as resource timing entries, which kept a streaming `resourceTiming`
  signal sending a batch a second.
- The published JavaScript no longer contains comments (the `.d.ts` files keep the documentation); the ESM bundle is
  43.1 KB gzipped.

### Wrappers

- React, Vue, Svelte and jQuery re-export every value and type of `@tracewayapp/frontend` (new: `getClient`,
  `SDK_VERSION`, `TracewayInteraction`, `TracewayCapturedError`, `ErrorLimits`, `CollectionLimits`, `Settings`,
  `Trigger`, `TriggerAction`, `Capture`, `Mode`, `SignalName` and the event types), except `init` and
  `TracewayFrontendClient`; Vue keeps its own `trackRouter` and Svelte has `trackRoute`. The wrappers depend on
  `@tracewayapp/core`.
- `@tracewayapp/react` ships with `"use client"`: in the Next.js App Router `<TracewayProvider>` goes straight into
  `app/layout.tsx`, without a wrapper file.
- `@tracewayapp/jquery`: a new `jQuery` option for a bundled jQuery (`import $ from "jquery"; init({ token, jQuery: $
  })`), which sets no `window.jQuery`; without it and without a global jQuery the SDK warns once instead of skipping
  failed `$.ajax` calls silently. It now also exports `recordAction`, `DEFAULT_IGNORE_PATTERNS`, `SDK_VERSION`,
  `getClient`, `routeFromParams`, `trackRouter` and the types, its CDN build (`TracewayJQuery`) too, and it no longer
  declares global `jQuery`/`$` types, which clashed with `@types/jquery` and made `$` `any`. The CDN build has a size
  budget (146 KB gzipped).
- Vue's `trackRouter()` of something that is not a router no longer throws into the app's setup.
- `useTracewayAttributes` (React, Vue, Svelte) no longer breaks the app's render or effect for a value it cannot
  write (a Symbol) or a non-object after an object; the Vue getter's own errors still reach Vue.
- The Vue plugin's debug lines go through the SDK's debug log (`console.warn`) instead of three `console.error`
  calls, so they are not recorded as the app's own logs.

### Behaviour changes

- The `/api/report` transport and its auto-probe are removed: the SDK never requests `/api/report`. It always sends
  OTLP; a server without OpAMP (404, 405, 501) turns remote config off and the local settings apply. The `transport`
  option is accepted and ignored, with one deprecation warning. Servers from before OpAMP need an upgrade.
- No OpenTelemetry globals are registered (the propagator, context manager and providers are the SDK's own). An app
  whose own spans got W3C `traceparent` propagation from Traceway's global propagator registers its own.
- Fetch spans end when the response headers arrive, so request durations get shorter, and resource timing is no
  longer linked to fetch spans; the app's `body.cancel()` stops the download. `fetch(request)` sends a copy of the
  app's `Request`, which stays unread.
- The Vue plugin rethrows to Vue when the app has no `errorHandler`: development builds show the error the way Vue
  does without Traceway, production builds log it.
- `init()` never throws: what it cannot use is one warning and the SDK stays off. `debug` also logs contained SDK
  failures.
- `useTraceway()` and `getTraceway()` no longer throw outside the provider or plugin.
- jQuery no longer reports requests the app aborted (`jqXHR.abort()`).
- A click on an SVG is reported on the nearest HTML element.
- The replay upload queue holds at most 20 batches; dropped ones are counted in `traceway.replay.failed_segments`.
  Checkpoints over 512 KiB go to IndexedDB only, not to session storage.
- `metric()` ignores NaN, negative and non-number values.
- A rule with `replay.maskAllInputs: false` no longer unmasks the inputs of a page that set
  `collection.replay.maskAllInputs: true`. A page that leaves it out of `collection` is unchanged: masked by default,
  and a rule can switch it off.

### Core (`@tracewayapp/core`)

- `replay.images` in the collection settings (`TracewayImagePolicy`, `IMAGE_POLICIES`), default `"wifi"`.
- `Ceilings` and `CeilingOptions` take `replayImages` (default `"always"`) and `maskAllInputs` (a floor);
  `clampToCeilings` applies both, and `lowerImagePolicy(a, b)` is new.
- `parseConnectionString` reads every 2.0 variation by the rules of CONTRACT §16.1 and returns the normalized
  `baseUrl` next to `token` and `apiUrl`; `normalizeBaseUrl`, `DEFAULT_BASE_URL` and `startOptions` are new.
  `resolveEndpoints()` defaults to Traceway Cloud.
- `guarded`, `debugLog` and `setupWarning`: the one guard of the browser SDK and its two kinds of log line.

### Source map upload (`@tracewayapp/sourcemap-upload`)

- `--url` / `TRACEWAY_URL` is optional: without it the maps go to Traceway Cloud (`https://cloud.tracewayapp.com`),
  so Cloud projects need only the upload token. A blank value (an unset CI secret) counts as not given, and the
  URL is read like the SDK's `baseUrl` (`https://` added without a scheme, a trailing `/api`
  dropped). The success line names the endpoint.


## 2.0.3

### Behaviour changes

- Web vitals name their element with a stable selector (`data-testid`, `data-slot`, `name`, `role`, plain classes;
  no generated ids or utility classes, nothing the user typed). Web vitals attributed to an element
  (`browser.web_vital.target`, `browser.web_vital.attribution`) start new groups once after the upgrade.
