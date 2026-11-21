import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { releaseTag, compareVersions, orderPackages, setVersions, checkExisting, ensureGitTag } from '../../scripts/release.mjs';

test('only stable versions can update latest; beta versions require the beta channel', () => {
  assert.equal(releaseTag('2.1.0', 'stable'), 'latest');
  assert.equal(releaseTag('2.1.0-beta.1', 'beta'), 'beta');
  for (const [v, c] of [['2.1.0-beta.1', 'stable'], ['2.1.0', 'beta'], ['v2.1.0', 'stable'], ['2.01.0', 'stable'], ['2.1.0-beta.01', 'beta'], ['2.1.0; echo bad', 'stable'], ['2.1.0', 'latest']]) {
    assert.throws(() => releaseTag(v, c));
  }
});
test('numeric version ordering prevents tag rollback', () => {
  assert.equal(compareVersions('2.1.0-beta.10', '2.1.0-beta.9'), 1);
  assert.equal(compareVersions('2.1.0', '2.1.0-beta.10'), 1);
  assert.equal(compareVersions('2.1.0', '2.2.0'), -1);
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0);
});
test('workspace dependencies publish first and all internal references move together', () => {
  const packages = [
    { dir: 'packages/react', data: { name: '@tracewayapp/react', dependencies: { '@tracewayapp/frontend': '1.0.0', react: '^18' } } },
    { dir: 'packages/frontend', data: { name: '@tracewayapp/frontend', optionalDependencies: { '@tracewayapp/core': '1.0.0' } } },
    { dir: 'packages/core', data: { name: '@tracewayapp/core' } },
  ];
  assert.deepEqual(orderPackages(packages).map((p) => p.data.name), ['@tracewayapp/core', '@tracewayapp/frontend', '@tracewayapp/react']);
  setVersions(packages, '2.1.0-beta.3');
  assert.equal(packages[0].data.dependencies['@tracewayapp/frontend'], '2.1.0-beta.3');
  assert.equal(packages[0].data.dependencies.react, '^18');
  assert.equal(packages[1].data.optionalDependencies['@tracewayapp/core'], '2.1.0-beta.3');
  assert.equal(packages[2].data.repository.directory, 'packages/core');
  packages[2].data.dependencies = { '@tracewayapp/react': '2.1.0-beta.3' };
  assert.throws(() => orderPackages(packages), /cycle/);
});
test('partial releases can resume only when contents and channel still match', () => {
  const pkg = { name: '@tracewayapp/core', integrity: 'sha512-matching' };
  const remote = { dist: { integrity: pkg.integrity } };
  checkExisting(pkg, null, { latest: '2.0.0' }, '2.1.0', 'latest');
  checkExisting(pkg, remote, { beta: '2.1.0-beta.1' }, '2.1.0-beta.1', 'beta');
  assert.throws(() => checkExisting(pkg, { dist: { integrity: 'other' } }, {}, '2.1.0', 'latest'), /different contents/);
  assert.throws(() => checkExisting(pkg, null, { latest: '2.2.0' }, '2.1.0', 'latest'), /backwards/);
  assert.throws(() => checkExisting(pkg, remote, { latest: '2.0.0' }, '2.1.0', 'latest'), /repair the dist-tag/);
});
test('prepare and pack produce versioned tarballs with repository metadata and a synced lockfile', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actions-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(`${dir}/packages/core/dist`, { recursive: true });
  fs.writeFileSync(`${dir}/package.json`, JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/core'] }));
  fs.writeFileSync(`${dir}/packages/core/package.json`, JSON.stringify({ name: '@tracewayapp/core', version: '2.0.0', files: ['dist'] }));
  fs.writeFileSync(`${dir}/packages/core/dist/index.js`, 'export const value = 1;');
  for (const mode of ['prepare', 'pack']) {
    const r = spawnSync(process.execPath, [path.resolve('scripts/release.mjs'), mode, '2.1.0-beta.2', 'beta'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const lock = JSON.parse(fs.readFileSync(`${dir}/package-lock.json`));
  assert.equal(lock.packages['packages/core'].version, '2.1.0-beta.2');
  const manifest = JSON.parse(fs.readFileSync(`${dir}/.cache/release/manifest.json`));
  assert.equal(manifest.tag, 'beta');
  assert.equal(manifest.packages.length, 1);
  const packed = spawnSync('tar', ['-xOf', `${dir}/.cache/release/${manifest.packages[0].filename}`, 'package/package.json'], { encoding: 'utf8' });
  const data = JSON.parse(packed.stdout);
  assert.equal(data.version, '2.1.0-beta.2');
  assert.equal(data.repository.url, 'git+https://github.com/tracewayapp/js-client.git');
});

function tagFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'checkout');
  fs.mkdirSync(cwd);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--bare', path.join(dir, 'remote.git'));
  git('init');
  git('config', 'user.email', 'release@example.test');
  git('config', 'user.name', 'Release test');
  git('commit', '--allow-empty', '-m', 'Release source');
  git('remote', 'add', 'origin', path.join(dir, 'remote.git'));
  return { cwd, git, source: git('rev-parse', 'HEAD') };
}

test('tag preflight is read-only; publishing tags the source and retries preserve the tag', (t) => {
  const { cwd, git, source } = tagFixture(t);
  ensureGitTag('2.0.1', source, { cwd });
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
  for (const version of ['2.0.1', '2.1.0-beta.1']) {
    ensureGitTag(version, source, { cwd, push: true });
    ensureGitTag(version, source, { cwd, push: true });
    assert.equal(git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`), `${source}\trefs/tags/v${version}`);
  }
});

test('annotated tags are accepted at the same source and conflicting tags are never moved', (t) => {
  const { cwd, git, source } = tagFixture(t);
  git('tag', '-a', 'v2.0.1', '-m', 'Existing release');
  git('push', 'origin', 'refs/tags/v2.0.1');
  const before = git('ls-remote', '--tags', 'origin');
  ensureGitTag('2.0.1', source, { cwd, push: true });
  assert.equal(git('ls-remote', '--tags', 'origin'), before);
  git('commit', '--allow-empty', '-m', 'Another source');
  assert.throws(() => ensureGitTag('2.0.1', source, { cwd }), /does not match/);
  const other = git('rev-parse', 'HEAD');
  for (const push of [false, true]) {
    assert.throws(() => ensureGitTag('2.0.1', other, { cwd, push }), /another commit/);
  }
  assert.equal(git('ls-remote', '--tags', 'origin'), before);
});

test('publish creates no tag on npm failure, then tags only after a successful retry', (t) => {
  const { cwd, git, source } = tagFixture(t);
  fs.mkdirSync(`${cwd}/packages/core`, { recursive: true });
  fs.mkdirSync(`${cwd}/.cache/release`, { recursive: true });
  fs.mkdirSync(`${cwd}/bin`);
  fs.writeFileSync(`${cwd}/package.json`, JSON.stringify({ workspaces: ['packages/core'] }));
  fs.writeFileSync(`${cwd}/packages/core/package.json`, JSON.stringify({ name: '@tracewayapp/core', version: '2.0.1' }));
  const tarball = Buffer.from('test tarball');
  fs.writeFileSync(`${cwd}/.cache/release/core.tgz`, tarball);
  fs.writeFileSync(`${cwd}/.cache/release/manifest.json`, JSON.stringify({
    version: '2.0.1', tag: 'latest', source,
    packages: [{ name: '@tracewayapp/core', filename: 'core.tgz', integrity: 'sha512-' + createHash('sha512').update(tarball).digest('base64') }],
  }));
  fs.writeFileSync(`${cwd}/registry.cjs`, 'global.fetch = async () => ({status: 404});');
  fs.writeFileSync(`${cwd}/bin/npm`, '#!/bin/sh\nexit "${NPM_TEST_EXIT:-0}"\n', { mode: 0o755 });
  const run = (code) => spawnSync(process.execPath, ['--require', `${cwd}/registry.cjs`, path.resolve('scripts/release.mjs'), 'publish', '2.0.1', 'stable'], {
    cwd, encoding: 'utf8', env: { ...process.env, PATH: `${cwd}/bin:${process.env.PATH}`, NPM_TEST_EXIT: code,
      GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'tracewayapp/js-client', GITHUB_SHA: source },
  });
  const failed = run('1');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /npm publish failed/);
  assert.equal(git('ls-remote', '--tags', 'origin'), '');
  const passed = run('0');
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(git('ls-remote', '--tags', 'origin', 'refs/tags/v2.0.1'), `${source}\trefs/tags/v2.0.1`);
});
