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

Uploads `.map` files to your Traceway backend so the dashboard can resolve minified production stack traces back to the original file, line, and column. Run it once per build, after your bundler has emitted the maps.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Walks a directory and uploads every `.map` file it finds
- Single-purpose CLI — no config file, no plugin, just one command
- Reads credentials from flags or environment variables (CI-friendly)
- Tags each map with the version you pass; the SDK's `version` option ties production exceptions back to the right map
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
  --version 1.0.0 \
  --directory dist/assets
```

The `--version` you pass here must match the `version` option you give the SDK at runtime — the dashboard joins exceptions and maps by that string.

## Options

| Flag | Env variable | Required | Description |
|------|--------------|----------|-------------|
| `--url` | `TRACEWAY_URL` | Yes | Traceway backend URL (no trailing slash) |
| `--token` | `TRACEWAY_SOURCEMAP_TOKEN` | Yes | Source map upload token from the dashboard |
| `--version` | — | Yes | App version to associate with the source maps |
| `--directory` | — | No | Directory to walk for `.map` files (default: `.`) |

### Environment variables

In CI/CD, prefer environment variables so the token is never on the command line:

```bash
export TRACEWAY_URL=https://traceway.example.com
export TRACEWAY_SOURCEMAP_TOKEN=$TRACEWAY_TOKEN_FROM_SECRETS

npx @tracewayapp/sourcemap-upload \
  --version $CI_COMMIT_SHA \
  --directory dist/assets
```

## CI/CD Integration

Add source-map upload as a step after your build. Use the same `--version` you embed in the SDK so the dashboard can resolve stack traces.

### GitHub Actions

```yaml
- name: Build
  run: npm run build

- name: Upload source maps
  run: |
    npx @tracewayapp/sourcemap-upload \
      --url ${{ secrets.TRACEWAY_URL }} \
      --token ${{ secrets.TRACEWAY_SOURCEMAP_TOKEN }} \
      --version ${{ github.sha }} \
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
        --version $CI_COMMIT_SHA
        --directory dist/assets
```

## Limits

- Each `.map` file must be under 50 MB
- Only `.map` files are uploaded — siblings (`.js`, `.css`, etc.) are ignored
- Maps are identified by `(version, filename)` on the backend, so re-running the upload for the same version overwrites previous uploads

## Tying Maps to Exceptions

Pass the same `version` to the SDK at runtime so the backend can resolve uploaded maps:

```ts
// Browser
init("token@https://traceway.example.com/api/report", { version: "1.0.0" });

// React Native
<TracewayProvider connectionString={DSN} options={{ version: "1.0.0" }}>
```

Once a map is uploaded, every exception captured under that `version` shows the original source location in the dashboard.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
