<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/bundler-plugin"><img src="https://img.shields.io/npm/v/@tracewayapp/bundler-plugin.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Bundler Plugin

Vite, Rollup, and webpack plugins that inject [ECMA-426 debug IDs](https://github.com/tc39/ecma426/blob/main/proposals/debug-id.md) into your bundles and source maps. A debug ID ties a deployed bundle to the exact source map produced by the same build, so Traceway symbolicates production stack traces against the right map regardless of filenames, CDNs, or concurrent deploys.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> **Version 2.0.0.** This package is versioned in lockstep with the Traceway browser SDK. The plugins themselves are the same as in 1.x: same entry points, same injected snippet, same debug ID format. Bundles built with either version work with both the 1.x and the 2.x browser SDK.

## What It Does

For every emitted JS chunk (`.js`, `.mjs`, `.cjs`), the plugin:

- Derives a deterministic debug ID from the chunk's content (SHA-256, formatted as a UUID), so rebuilding identical input yields the identical ID
- Injects a tiny runtime snippet at the top of the chunk (after a shebang and a `"use strict"` directive, if present) that registers the ID in a `_tracewayDebugIds` global, so the Traceway SDK can report which bundles were involved in an exception. The source map is adjusted for the insertion
- Appends the spec's `//# debugId=<uuid>` comment to the chunk, above a trailing `//# sourceMappingURL=` comment
- Writes the `debugId` field into the source map JSON (plus `debug_id` for Sentry-tooling compatibility). A map that already carries a valid `debugId` is left as it is

The format follows the ECMA-426 Debug ID proposal (the same convention used by Sentry, Rollup's `output.sourcemapDebugIds`, and Bun), so artifacts stay interoperable across tooling.

The plugin does not turn source maps on and does not upload anything. Enable source maps in your bundler as shown below (the `debugId` field is written into the `.map` file the build emits, so an inline source map gets none), then [upload](#uploading) the build output.

## Installation

```bash
npm install -D @tracewayapp/bundler-plugin
```

This installs 2.x; `@tracewayapp/bundler-plugin@2` pins the major, `@1` stays on 1.x.

The plugins take no options.

## Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { tracewayDebugIds } from "@tracewayapp/bundler-plugin/vite";

export default defineConfig({
  build: {
    sourcemap: true,
  },
  plugins: [tracewayDebugIds()],
});
```

The Vite plugin runs for `vite build` only (`apply: "build"`); the dev server is untouched.

## Rollup

```js
// rollup.config.js
import { tracewayDebugIds } from "@tracewayapp/bundler-plugin/rollup";

export default {
  output: {
    sourcemap: true,
  },
  plugins: [tracewayDebugIds()],
};
```

## webpack (5+)

```js
// webpack.config.js
const {
  TracewayDebugIdsWebpackPlugin,
} = require("@tracewayapp/bundler-plugin/webpack");

module.exports = {
  devtool: "source-map",
  plugins: [new TracewayDebugIdsWebpackPlugin()],
};
```

Hot-update chunks (`*.hot-update.*`) are skipped.

The three plugins are also exported from the package root as `tracewayDebugIdsVite`, `tracewayDebugIdsRollup` and `TracewayDebugIdsWebpackPlugin`.

## Uploading

Upload your build output with [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload) as usual; the Traceway backend detects debug IDs in the uploaded files automatically and indexes the artifacts by ID. Frames without a debug ID (or uploads from builds without this plugin) keep resolving by filename.

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --directory dist/assets
```

## How the SDK Reports the IDs

When the browser SDK (`@tracewayapp/frontend` and its React, Vue, Svelte and jQuery wrappers) captures an exception, it reads `_tracewayDebugIds` (and `_sentryDebugIds`, so bundles processed by Sentry tooling work too), keeps the bundles whose file name appears in the stack trace, and sends a file name to debug ID map with the exception. There is nothing to configure in the SDK.

- **2.x** sends the map as JSON in the `traceway.debug_ids` attribute of the exception's OTLP log record.
- **1.x** sent the same map in the exception's `debugIds` field.

The backend resolves each frame against the map uploaded with that exact debug ID and falls back to filename matching when it has none.

`@tracewayapp/react-native` does not read the registry; React Native source maps are matched by filename.

## Node Bundles

The injected snippet detects `window`, `globalThis`, `global`, and `self`, so the registry is filled in bundled Node services the same way it is in browsers. OpenTelemetry has no debug ID convention and its Node SDKs do not read the registry, so a Node service has to attach the `traceway.debug_ids` attribute itself when it reports an exception; without it, frames resolve by filename.

## Links

- [Documentation](https://docs.tracewayapp.com/client/js-sdk/debug-ids)
- [Source map upload CLI](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload)
- [Symbolication pipeline](https://docs.tracewayapp.com/symbolicator/javascript)
- [GitHub](https://github.com/tracewayapp/traceway)
