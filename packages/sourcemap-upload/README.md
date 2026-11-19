<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/sourcemap-upload"><img src="https://img.shields.io/npm/v/@tracewayapp/sourcemap-upload.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Source Map Upload CLI

Uploads `.map` files (and their minified bundles) to your Traceway backend so the dashboard can resolve minified production stack traces back to the original file, line, column, and function name. Run it once per build, after your bundler has emitted the maps.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> **Version 2.0.0.** This package is versioned in lockstep with the Traceway browser SDK. The CLI itself is the same as in 1.x: same flags, same environment variables, same upload endpoint. It works with any version of the Traceway SDKs.

## Features

- Walks a directory and uploads every `.map` file it finds, plus the matching `.js`/`.cjs`/`.mjs` bundle next to it
- Single-purpose CLI — no config file, no plugin, just one command
- Reads credentials from flags or environment variables (CI-friendly)
- Maps are resolved by filename — the most recent upload of each file wins, so content-hashed bundle names (the default in Vite, Next, etc.) just work
- Checks every file against the 50 MB limit before it uploads anything, and exits with an error if one is larger

## Installation

```bash
npm install -D @tracewayapp/sourcemap-upload
```

This installs 2.x and provides the `traceway-sourcemaps` command; `@tracewayapp/sourcemap-upload@2` pins the major, `@1` stays on 1.x. Without installing, `npx @tracewayapp/sourcemap-upload` runs the same command. Requires Node.js 18, 20, or 22 and newer.

## Generate an Upload Token

1. Open your Traceway dashboard
2. Go to the **Connection** page of the project
3. In the **Source Map Upload** card, click **Generate Upload Token**
4. Copy the token

The upload token is separate from the project token in your connection string and only allows uploads for that project. **Regenerate** on the same card issues a new token and invalidates the current one immediately. Members with the `readonly` role do not see the card.

## Quick Start

Run after your production build:

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --directory dist/assets
```

`--url` is the origin of your Traceway instance, not the SDK connection string: the CLI appends `/api/sourcemaps/upload` itself.

The backend resolves each minified stack frame to its map by filename, so there is nothing to configure beyond pointing the CLI at your build output. Re-running the upload replaces the map for any filename it uploads; the most recent upload of each file wins.

Make sure the build actually emits `.map` files (Vite `build.sourcemap: true`, Rollup `output.sourcemap: true`, webpack `devtool: "source-map"`). With none on disk the CLI prints `No .map files found in <dir>` and exits with code 0, so the step looks green while nothing was uploaded.

## Options

| Flag | Env variable | Required | Description |
|------|--------------|----------|-------------|
| `--url <url>` | `TRACEWAY_URL` | Yes | Traceway backend URL (a trailing slash is ignored) |
| `--token <token>` | `TRACEWAY_SOURCEMAP_TOKEN` | Yes | Source map upload token from the dashboard |
| `--directory <dir>` | — | No | Directory to search recursively for `.map` files and their bundles (default: `.`, the current directory) |
| `--help`, `-h` | — | No | Print the usage and exit |

A flag takes precedence over its environment variable. Write each flag and its value as two arguments (`--url https://...`); the `--url=https://...` form is not parsed.

### Environment variables

In CI/CD, prefer environment variables so the token is never on the command line:

```bash
export TRACEWAY_URL=https://traceway.example.com
export TRACEWAY_SOURCEMAP_TOKEN=$TRACEWAY_TOKEN_FROM_SECRETS

npx @tracewayapp/sourcemap-upload \
  --directory dist/assets
```

### Exit codes

| Code | When |
|------|------|
| `0` | The upload succeeded (`Successfully uploaded N file(s)`), no `.map` file was found, or `--help` was printed |
| `1` | `--url` or `--token` is missing, a file is larger than 50 MB (nothing is uploaded), the request failed, or the backend answered with a non-2xx status (`Upload failed (<status>): <body>`) |

## CI/CD Integration

Add source-map upload as a step after your build, pointing it at your bundler's output directory.

### GitHub Actions

```yaml
- name: Build
  run: npm run build

- name: Upload source maps
  run: |
    npx @tracewayapp/sourcemap-upload \
      --url ${{ secrets.TRACEWAY_URL }} \
      --token ${{ secrets.TRACEWAY_SOURCEMAP_TOKEN }} \
      --directory dist/assets
```

### GitLab CI

```yaml
deploy:
  script:
    - npm run build
    - npx @tracewayapp/sourcemap-upload
        --url $TRACEWAY_URL
        --token $TRACEWAY_SOURCEMAP_TOKEN
        --directory dist/assets
```

## Limits

- Each uploaded file must be under 50 MB. The CLI checks this itself before it sends anything; the backend rejects a larger file with `400`
- Everything is sent in one request, which the backend caps at 250 MB (`413`) and 1000 files (`422`), maps and bundles together. Split a larger build by running the CLI once per subdirectory
- Every `*.map` under the directory is uploaded, whatever it maps, so point `--directory` at the build output. The default `.` also picks up maps under `node_modules`
- Each `.map` is uploaded with its sibling minified bundle (`.js`/`.cjs`/`.mjs`) when one exists; other siblings (`.css`, source files, etc.) are ignored. Uploading the bundle is what lets the backend resolve function names — without it, symbolication is location-only
- Files are stored under their base name, without the directory. Two maps with the same name in different subdirectories overwrite each other
- Maps are stored permanently and addressed by filename on the backend; re-running the upload overwrites the map for any filename it uploads. Uploads are never auto-deleted or expired.

## How Maps Are Matched

There is nothing to wire up at runtime. When an exception arrives, the backend resolves each minified frame in two steps:

1. **By debug ID**, when the build used [`@tracewayapp/bundler-plugin`](https://www.npmjs.com/package/@tracewayapp/bundler-plugin): every bundle and its map share an embedded ECMA-426 debug ID, the upload endpoint detects it in the files automatically, and frames resolve against the map from that exact build, immune to filename collisions and concurrent deploys.
2. **By filename** otherwise: the backend looks up the map you uploaded under the frame's filename; the most recent upload wins. Content-hashed bundle filenames (the default in Vite, Next, Angular, and most bundlers) keep every build's maps distinct automatically.

Debug IDs are reported by the browser SDK (`@tracewayapp/frontend` and its wrappers). `@tracewayapp/react-native` does not report them, so React Native maps are matched by filename.

Uploads take effect immediately: the backend drops what it had cached for the uploaded filenames before it answers.

The SDK's `version` option is unrelated to source maps: it is plain metadata shown on exceptions in the dashboard, useful for filtering by build, and you can set it or leave it unset independently of uploads.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com/client/js-sdk/sourcemap-upload)
- [Bundler plugin (debug IDs)](https://www.npmjs.com/package/@tracewayapp/bundler-plugin)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
