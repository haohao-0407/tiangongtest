import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPages } from './verify-pages.mjs';

async function fixture(t, html = '<script type="module" src="/tiangongtest/assets/game.js"></script>') {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'verify-pages-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(path.join(dist, 'assets'));
  const files = { 'index.html': html, 'assets/game.js': 'console.log("game");' };
  const manifest = { schemaVersion: '1.0.0', target: 'browser', base: '/tiangongtest/', artifacts: [] };
  for (const [name, content] of Object.entries(files)) {
    const bytes = Buffer.from(content);
    await writeFile(path.join(dist, name), bytes);
    manifest.artifacts.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(path.join(dist, 'forgeax-dist.json'), JSON.stringify(manifest));
  return { dist, base: manifest.base, manifest };
}

test('valid build passes; wrong base, missing files and same-size corruption fail', async (t) => {
  const options = await fixture(t);
  assert.equal((await verifyPages(options)).artifacts, 2);
  await assert.rejects(verifyPages({ ...options, base: '/wrong/' }), /Build base differs/);
  const asset = path.join(options.dist, 'assets/game.js');
  const content = await readFile(asset);
  await writeFile(asset, Buffer.alloc(content.length));
  await assert.rejects(verifyPages(options), /SHA-256 mismatch/);
  await rm(asset);
  await assert.rejects(verifyPages(options), /ENOENT/);
});

test('root-relative resource fails despite a correct manifest base', async (t) => {
  const options = await fixture(t, '<script src="/assets/game.js"></script>');
  await assert.rejects(verifyPages(options), /escapes Pages base/);
});

test('manifest traversal cannot read outside output', async (t) => {
  const options = await fixture(t);
  options.manifest.artifacts[1].path = '../private.txt';
  await writeFile(path.join(options.dist, 'forgeax-dist.json'), JSON.stringify(options.manifest));
  await assert.rejects(verifyPages(options), /Unsafe artifact path/);
});

test('online verification rejects an old manifest, corrupted asset and wrong JS MIME', async (t) => {
  const options = await fixture(t);
  let fault;
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(options.base.length);
    try {
      let body = await readFile(path.join(options.dist, name));
      if (fault === 'manifest' && name === 'forgeax-dist.json') body = Buffer.from('{}');
      if (fault === 'asset' && name.endsWith('.js')) body = Buffer.alloc(body.length);
      const mime = name.endsWith('.js') ? (fault === 'mime' ? 'text/html' : 'application/javascript')
        : name.endsWith('.html') ? 'text/html' : 'application/json';
      res.writeHead(200, { 'Content-Type': mime }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const online = { ...options, url: `http://127.0.0.1:${server.address().port}${options.base}`, retries: [0] };
  assert.equal((await verifyPages(online)).artifacts, 2);
  for (fault of ['manifest', 'asset', 'mime']) {
    await assert.rejects(verifyPages(online), /deployment verification failed/);
  }
});
