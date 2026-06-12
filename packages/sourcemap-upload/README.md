<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/sourcemap-upload"><img src="https://img.shields.io/npm/v/@tracewayapp/sourcemap-upload.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Source Map Upload CLI

Uploads `.map` files (and their minified bundles) to your Traceway backend so the dashboard can resolve minified production stack traces back to the original file, line, column, and function name. Run it once per build, after your bundler has emitted the maps.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Walks a directory and uploads every `.map` file it finds, plus the matching `.js`/`.cjs`/`.mjs` bundle next to it
- Single-purpose CLI — no config file, no plugin, just one command
- Reads credentials from flags or environment variables (CI-friendly)
- Maps are resolved by filename — the most recent upload of each file wins, so content-hashed bundle names (the default in Vite, Next, etc.) just work
- Skips files larger than 50 MB

## Generate an Upload Token

1. Open your Traceway dashboard
2. Go to the **Connection** page
3. Under **Source Map Upload**, click **Generate Upload Token**
4. Copy the token

The upload token is separate from the project's reporting token. It can be revoked or rotated independently and only allows uploading source maps for that project.

## Quick Start

Run after your production build:

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --directory dist/assets
```

The backend resolves each minified stack frame to its map by filename, so there is nothing to configure beyond pointing the CLI at your build output. Re-running the upload replaces the map for any filename it uploads; the most recent upload of each file wins.

## Options

| Flag | Env variable | Required | Description |
|------|--------------|----------|-------------|
| `--url` | `TRACEWAY_URL` | Yes | Traceway backend URL (no trailing slash) |
| `--token` | `TRACEWAY_SOURCEMAP_TOKEN` | Yes | Source map upload token from the dashboard |
| `--directory` | — | No | Directory to walk for `.map` files and their bundles (default: `.`) |

### Environment variables

In CI/CD, prefer environment variables so the token is never on the command line:

```bash
export TRACEWAY_URL=https://traceway.example.com
export TRACEWAY_SOURCEMAP_TOKEN=$TRACEWAY_TOKEN_FROM_SECRETS

npx @tracewayapp/sourcemap-upload \
  --directory dist/assets
```

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

- Each uploaded file must be under 50 MB
- Each `.map` is uploaded with its sibling minified bundle (`.js`/`.cjs`/`.mjs`) when one exists; other siblings (`.css`, source files, etc.) are ignored. Uploading the bundle is what lets the backend resolve function names — without it, symbolication is location-only
- Maps are stored permanently and addressed by filename on the backend; re-running the upload overwrites the map for any filename it uploads. Uploads are never auto-deleted or expired.

## How Maps Are Matched

There is nothing to wire up at runtime. When an exception arrives, the backend resolves each minified frame in two steps:

1. **By debug ID**, when the build used [`@tracewayapp/bundler-plugin`](https://www.npmjs.com/package/@tracewayapp/bundler-plugin): every bundle and its map share an embedded ECMA-426 debug ID, the upload endpoint detects it in the files automatically, and frames resolve against the map from that exact build, immune to filename collisions and concurrent deploys.
2. **By filename** otherwise: the backend looks up the map you uploaded under the frame's filename; the most recent upload wins. Content-hashed bundle filenames (the default in Vite, Next, Angular, and most bundlers) keep every build's maps distinct automatically.

The SDK's `version` option is unrelated to source maps: it is plain metadata shown on exceptions in the dashboard, useful for filtering by build, and you can set it or leave it unset independently of uploads.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
