<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/bundler-plugin"><img src="https://img.shields.io/npm/v/@tracewayapp/bundler-plugin.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Bundler Plugin

Vite, Rollup, and webpack plugins that inject [ECMA-426 debug IDs](https://github.com/tc39/ecma426/blob/main/proposals/debug-id.md) into your bundles and source maps. A debug ID ties a deployed bundle to the exact source map produced by the same build, so Traceway symbolicates production stack traces against the right map regardless of filenames, CDNs, or concurrent deploys.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## What It Does

For every emitted JS chunk, the plugin:

- Derives a deterministic debug ID from the chunk's content (SHA-256, formatted as a UUID)
- Injects a tiny runtime snippet that registers the ID in a `_tracewayDebugIds` global, so the Traceway SDK can report which bundles were involved in an exception
- Appends the spec's `//# debugId=<uuid>` comment to the chunk
- Writes the `debugId` field into the source map JSON (plus `debug_id` for Sentry-tooling compatibility)

The format follows the ECMA-426 Debug ID proposal (the same convention used by Sentry, Rollup's `output.sourcemapDebugIds`, and Bun), so artifacts stay interoperable across tooling.

## Installation

```bash
npm install -D @tracewayapp/bundler-plugin
```

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

## Uploading

Upload your build output with [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload) as usual; the Traceway backend detects debug IDs in the uploaded files automatically and indexes the artifacts by ID. Frames without a debug ID (or uploads from builds without this plugin) keep resolving by filename.

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --directory dist/assets
```

## Node Bundles

The injected snippet detects `window`, `globalThis`, `global`, and `self`, so it works in bundled Node services the same way it does in browsers.

## Links

- [Documentation](https://docs.tracewayapp.com/client/js-sdk/debug-ids)
- [Source map upload CLI](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload)
- [Symbolication pipeline](https://docs.tracewayapp.com/learn/symbolication-js)
- [GitHub](https://github.com/tracewayapp/traceway)
