# @tracewayapp/sourcemap-upload

CLI tool for uploading source maps to Traceway. Enables original file names and line numbers in stack traces from minified JavaScript code.

## Setup

1. Go to the **Connection** page in the Traceway dashboard
2. Under **Source Map Upload**, click **Generate Upload Token**
3. Copy the token

## Usage

Run after your production build to upload all `.map` files:

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://your-traceway-instance.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --version 1.0.0 \
  --directory dist/assets
```

### Options

| Flag | Env Variable | Required | Description |
|------|-------------|----------|-------------|
| `--url` | `TRACEWAY_URL` | Yes | Traceway backend URL |
| `--token` | `TRACEWAY_SOURCEMAP_TOKEN` | Yes | Source map upload token from the dashboard |
| `--version` | — | Yes | App version to associate with the source maps |
| `--directory` | — | No | Directory to search for `.map` files (default: `.`) |

### Environment Variables

Instead of passing `--url` and `--token` as flags, you can set them as environment variables. This is useful in CI/CD pipelines:

```bash
export TRACEWAY_URL=https://your-traceway-instance.com
export TRACEWAY_SOURCEMAP_TOKEN=your_token_here

npx @tracewayapp/sourcemap-upload --version 1.0.0 --directory dist/assets
```

## CI/CD Integration

Add source map uploading as a step after your build. The `--version` should match the version you pass to the Traceway SDK via `appVersion`.

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

- Individual files must be under 50 MB
- Only files with a `.map` extension are uploaded
