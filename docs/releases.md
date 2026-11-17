# npm releases from GitHub Actions

Workflow: [Release npm packages](https://github.com/tracewayapp/js-client/actions/workflows/release.yml).
It runs manually on `main`, using the GitHub-hosted runner and the `npm` environment.
No `NPM_TOKEN` or browser login is needed in Actions.

## One-time npm setup

Sign in to npm in your browser with an account that can manage these packages. For **each** of the ten
packages below, open **Settings → Trusted publishing → Add trusted publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `tracewayapp` |
| Repository | `js-client` |
| Workflow filename | `release.yml` (filename only) |
| Environment name | `npm` |
| Allowed actions | Enable direct publishing with `npm publish` |

Packages: `@tracewayapp/core`, `@tracewayapp/opamp`, `@tracewayapp/frontend`,
`@tracewayapp/react`, `@tracewayapp/react-native`, `@tracewayapp/vue`, `@tracewayapp/svelte`,
`@tracewayapp/jquery`, `@tracewayapp/sourcemap-upload`, and `@tracewayapp/bundler-plugin`.
Do not configure the deprecated backend/nestjs packages for this workflow.

The workflow does not use `npm stage publish` or `npm dist-tag`, so staged-only permission is insufficient
and dist-tag management permission is unnecessary. Newly configured publishers must complete their first
successful publish within two days; recreate an expired configuration before releasing.
See [npm's Trusted Publisher instructions](https://docs.npmjs.com/trusted-publishers/).

The GitHub `npm` environment is restricted to the `main` branch. This is already configured on GitHub.
You do not need to add repository secrets or change workflow token write permissions.

## Release or release beta

1. Open the workflow link above and select **Run workflow** on **main**.
2. Enter the exact new version, without a `v` prefix:
   - **beta** channel: `2.1.0-beta.1` (then `.2`, `.3`, etc.). Publishes under `beta` only.
   - **stable** channel: `2.1.0` (then the next appropriate version). Publishes under `latest`.
3. Leave **dry_run** checked first. This installs dependencies, builds all packages, runs unit/release/browser
   tests and bundle limits, packs tarballs, and checks the registry without publishing anything.
4. Once the dry run passes and npm trust is configured for every package, run again with the same version
   and channel and **dry_run unchecked**. This publishes public packages with provenance.

The workflow validates version/channel combinations and refuses to move an npm channel backwards.
It reads active packages from root `package.json`, updates all internal workspace dependencies to the
chosen version, and publishes dependencies first. It does not publish backend/nestjs.
Live Traceway server tests require separate disposable backends and remain a separate pre-release check;
see [browser tests](../tests/browser/README.md).

## Version records and retries

The workflow uses the source commit selected when the run starts. It changes versions only inside that
checkout; it does not push a version commit, create a Git tag, or create a GitHub Release. Each successful
validation uploads `npm-release-VERSION`, containing the ten exact tarballs plus `manifest.json` with the
version, npm tag, source SHA, and SHA-512 integrity of each tarball. This artifact is also uploaded before
publication, so it remains available if publication fails partway through.

For a partial publish failure, fix the npm configuration and **re-run the failed job in the same run**.
That keeps the source commit fixed. The workflow preflights every package before publishing any; it skips
already published packages only when their exact tarball integrity and channel match. npm package versions
are immutable. A different tarball requires a new version. If a channel was moved by a later release,
choose a new version or repair it manually after review; this workflow never silently retags old packages.

A dry run verifies the workflow and package contents, but cannot verify npm publishing authorization.
The first real publish validates that final connection. If npm reports E404/ENEEDAUTH, check all five
Trusted Publisher fields above, especially the environment and direct-publish permission.
