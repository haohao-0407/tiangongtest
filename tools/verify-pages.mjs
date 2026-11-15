import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const manifestName = 'forgeax-dist.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePath = (value) => typeof value === 'string' && value.length > 0
  && !/[\\:%?#\u0000-\u001f]/.test(value)
  && value.split('/').every((part) => part && part !== '.' && part !== '..');

function checkBase(base) {
  assert.ok(typeof base === 'string' && base.startsWith('/') && base.endsWith('/'), 'Base must start and end with /');
  assert.ok(base === '/' || safePath(base.slice(1, -1)), 'Base contains an unsafe path');
  return base;
}

function checkBytes(bytes, artifact) {
  assert.equal(bytes.length, artifact.bytes, `${artifact.path}: size mismatch`);
  assert.equal(digest(bytes), artifact.sha256, `${artifact.path}: SHA-256 mismatch`);
}

function checkHtml(html, base, artifacts) {
  const pageUrl = new URL(base, 'https://pages.invalid');
  assert.ok(!/<base\b/i.test(html), 'HTML base tags are not supported by this check');
  // Only HTML entry references; the engine manifest owns the complete asset list.
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attribute = tag[0].match(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!attribute) continue;
    const value = attribute[1] ?? attribute[2] ?? attribute[3];
    const url = new URL(value.replaceAll('&amp;', '&'), pageUrl);
    if (url.protocol === 'data:' || url.origin !== pageUrl.origin) continue;
    assert.ok(url.pathname.startsWith(base), `HTML resource escapes Pages base: ${value}`);
    const relative = decodeURIComponent(url.pathname.slice(base.length));
    assert.ok(artifacts.has(relative), `HTML resource is absent from manifest: ${value}`);
  }
}

async function localBuild(dist, expectedBase) {
  const root = await realpath(dist);
  const manifestBytes = await readFile(path.join(root, manifestName));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion, '1.0.0', 'Unsupported distribution manifest');
  assert.equal(manifest.target, 'browser', 'Expected a browser build');
  assert.equal(manifest.base, checkBase(expectedBase), 'Build base differs from the deployment base');
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0, 'Missing artifact inventory');
  const artifacts = new Map();
  for (const artifact of manifest.artifacts) {
    assert.ok(safePath(artifact.path), `Unsafe artifact path: ${artifact.path}`);
    assert.ok(!artifacts.has(artifact.path), `Duplicate artifact: ${artifact.path}`);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0, `Invalid size: ${artifact.path}`);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `Invalid digest: ${artifact.path}`);
    const file = await realpath(path.join(root, artifact.path));
    const relative = path.relative(root, file);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `Artifact escapes output directory: ${artifact.path}`);
    checkBytes(await readFile(file), artifact);
    artifacts.set(artifact.path, artifact);
  }
  assert.ok(artifacts.has('index.html'), 'Manifest does not contain index.html');
  checkHtml(await readFile(path.join(root, 'index.html'), 'utf8'), expectedBase, artifacts);
  return { manifestBytes, artifacts };
}

function checkMime(response, artifact) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const allowed = artifact.path.endsWith('.wasm') ? ['application/wasm']
    : /\.(?:m?js)$/.test(artifact.path) ? ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript']
      : artifact.path.endsWith('.html') ? ['text/html'] : null;
  if (allowed) assert.ok(allowed.includes(type), `${artifact.path}: unexpected Content-Type ${type}`);
}

async function download(site, artifact, retries) {
  const url = new URL(artifact.path, site);
  assert.equal(url.origin, site.origin, 'Resource changed origin');
  assert.ok(url.pathname.startsWith(site.pathname), 'Resource escaped site path');
  let failure;
  for (const wait of retries) {
    if (wait) await delay(wait);
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-cache' });
      assert.ok(response.ok, `${artifact.path}: HTTP ${response.status}`);
      checkMime(response, artifact);
      checkBytes(Buffer.from(await response.arrayBuffer()), artifact);
      return;
    } catch (error) { failure = error; }
  }
  throw new Error(`${artifact.path}: deployment verification failed after ${retries.length} attempts`, { cause: failure });
}

export async function verifyPages({ dist, base, url, retries = [0, 2000, 5000, 10000] }) {
  const { manifestBytes, artifacts } = await localBuild(dist, base);
  if (url) {
    const site = new URL(url);
    assert.ok(site.protocol === 'https:' || (site.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(site.hostname)), 'Site must use HTTPS (HTTP is allowed only for localhost tests)');
    assert.ok(!site.username && !site.password && !site.search && !site.hash, 'Site URL must not contain credentials, query or fragment');
    assert.equal(site.pathname, base, 'Site URL path differs from deployment base');
    assert.ok(retries.length > 0, 'At least one HTTP attempt is required');
    await download(site, { path: manifestName, bytes: manifestBytes.length, sha256: digest(manifestBytes) }, retries);
    const queue = [...artifacts.values()];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) await download(site, queue.shift(), retries);
    }));
  }
  return { artifacts: artifacts.size, base, url: url ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      assert.ok(['--dist', '--base', '--url'].includes(key) && process.argv[i + 1], `Invalid argument: ${key}`);
      options[key.slice(2)] = process.argv[i + 1];
    }
    assert.ok(options.dist && options.base, 'Usage: node tools/verify-pages.mjs --dist game/dist --base /tiangongtest/ [--url https://owner.github.io/tiangongtest/]');
    const result = await verifyPages(options);
    console.log(`Pages verification passed: ${result.artifacts} artifacts, base ${result.base}${result.url ? `, ${result.url}` : ' (local build)'}`);
  } catch (error) {
    console.error(`Pages verification failed: ${error.message}${error.cause ? `: ${error.cause.message}` : ''}`);
    process.exitCode = 1;
  }
}
