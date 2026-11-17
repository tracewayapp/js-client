import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
export function releaseTag(version, channel) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const beta = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
  if (channel === 'stable' && stable.test(version)) return 'latest';
  if (channel === 'beta' && beta.test(version)) return 'beta';
  throw new Error('Use stable with X.Y.Z, or beta with X.Y.Z-beta.N (no v prefix).');
}
export function compareVersions(a, b) {
  const parts = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(v);
    if (!m) throw new Error(`Cannot compare version ${v}; inspect the registry tag manually.`);
    return m.slice(1).map((n) => n === undefined ? null : BigInt(n));
  };
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 4; i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === null) return 1;
    if (y[i] === null) return -1;
    return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
export function orderPackages(packages) {
  const byName = new Map(packages.map((p) => [p.data.name, p]));
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(p) {
    if (visited.has(p.data.name)) return;
    if (visiting.has(p.data.name)) throw new Error('Workspace dependency cycle');
    visiting.add(p.data.name);
    for (const name of Object.keys({ ...p.data.dependencies, ...p.data.optionalDependencies, ...p.data.peerDependencies })) {
      if (byName.has(name)) visit(byName.get(name));
    }
    visiting.delete(p.data.name);
    visited.add(p.data.name);
    ordered.push(p);
  }
  packages.forEach(visit);
  return ordered;
}
export function setVersions(packages, version) {
  const names = new Set(packages.map((p) => p.data.name));
  for (const { dir, data } of packages) {
    data.version = version;
    data.repository = { type: 'git', url: 'git+https://github.com/tracewayapp/js-client.git', directory: dir };
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(data[field] || {})) {
        if (names.has(name)) data[field][name] = version;
      }
    }
  }
}
function npm(args, capture = false) {
  const r = spawnSync('npm', [...args, '--registry', registry], { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`npm ${args[0]} failed: ${r.stderr || r.status}`);
  return r.stdout;
}
async function metadata(name, version) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}${version ? `/${version}` : ''}`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry lookup for ${name}: HTTP ${response.status}`);
  return response.json();
}
export function checkExisting(pkg, remote, tags, version, tag) {
  if (remote && remote.dist?.integrity !== pkg.integrity) throw new Error(`${pkg.name}@${version} already has different contents; choose a new version.`);
  if (tags?.[tag] && compareVersions(version, tags[tag]) < 0) throw new Error(`Refusing to move ${pkg.name}'s ${tag} backwards from ${tags[tag]} to ${version}.`);
  if (remote && tags?.[tag] !== version) throw new Error(`${pkg.name}@${version} exists but ${tag} points elsewhere; use a new version or repair the dist-tag manually.`);
}
async function main() {
  const [mode, version, channel] = process.argv.slice(2);
  const tag = releaseTag(version, channel);
  const out = path.resolve('.cache/release');
  const packages = orderPackages(JSON.parse(fs.readFileSync('package.json')).workspaces.map((dir) => {
    const data = JSON.parse(fs.readFileSync(`${dir}/package.json`));
    if (data.private || !data.name.startsWith('@tracewayapp/')) throw new Error(`Unexpected workspace ${dir}`);
    if (data.publishConfig?.tag && data.publishConfig.tag !== tag) throw new Error(`Conflicting publishConfig.tag in ${dir}`);
    return { dir, data };
  }));
  if (mode === 'prepare') {
    setVersions(packages, version);
    for (const { dir, data } of packages) fs.writeFileSync(`${dir}/package.json`, JSON.stringify(data, null, 2) + '\n');
    npm(['install', '--package-lock-only', '--ignore-scripts']);
    return;
  }
  if (mode === 'pack') {
    fs.mkdirSync(out, { recursive: true });
    const packed = packages.map(({ dir, data }) => {
      if (data.version !== version) throw new Error('Run prepare before packing');
      const [p] = JSON.parse(npm(['pack', `./${dir}`, '--ignore-scripts', '--json', '--pack-destination', out], true));
      if (p.name !== data.name || p.version !== version || !p.files.some((f) => f.path.startsWith('dist/'))) throw new Error(`Invalid tarball for ${data.name}`);
      return { name: p.name, filename: p.filename, integrity: p.integrity };
    });
    fs.writeFileSync(`${out}/manifest.json`, JSON.stringify({ version, tag, source: process.env.GITHUB_SHA, packages: packed }, null, 2) + '\n');
    return;
  }
  if (!['check', 'publish'].includes(mode)) throw new Error('Expected prepare, pack, check or publish');
  const manifest = JSON.parse(fs.readFileSync(`${out}/manifest.json`));
  if (manifest.version !== version || manifest.tag !== tag || manifest.packages.map((p) => p.name).join() !== packages.map((p) => p.data.name).join()) throw new Error('Release manifest mismatch');
  const existing = new Set();
  // Check every immutable version before the first publish; a registry outage is not a missing version.
  for (const p of manifest.packages) {
    if (path.basename(p.filename) !== p.filename) throw new Error('Invalid tarball filename');
    const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(`${out}/${p.filename}`)).digest('base64');
    if (integrity !== p.integrity) throw new Error(`Tarball changed: ${p.name}`);
    const [remote, info] = await Promise.all([metadata(p.name, version), metadata(p.name)]);
    checkExisting(p, remote, info?.['dist-tags'], version, tag);
    if (remote) existing.add(p.name);
  }
  if (mode === 'publish') {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'tracewayapp/js-client') throw new Error('Publish only from the main release workflow');
    for (const p of manifest.packages) {
      if (existing.has(p.name)) {
        console.log(`Already published with matching contents: ${p.name}@${version}`);
        continue;
      }
      npm(['publish', `${out}/${p.filename}`, '--tag', tag, '--access', 'public', '--provenance', '--ignore-scripts']);
    }
  }
  console.log(`${mode}: ${manifest.packages.length} packages at ${version}, npm tag ${tag}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
