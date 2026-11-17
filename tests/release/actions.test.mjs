import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseTag, compareVersions, orderPackages, setVersions, checkExisting } from '../../scripts/release.mjs';

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
