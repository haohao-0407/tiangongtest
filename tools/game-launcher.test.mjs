import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, installedManager, needsSessionRecovery, parseOptions, parseResult, runProcess } from './game-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempBase = path.join(root, '.launcher', 'tests');
fs.mkdirSync(tempBase, { recursive: true });

test('a noisy CLI failure is preserved, not mistaken for a successful process', async () => {
  const chunks = [];
  const result = await runProcess(process.execPath, ['-e', 'console.log("progress");console.error("diagnostic");console.log(JSON.stringify({ok:false,error:{code:"dependency-mismatch"}}));process.exit(7)'],
    { cwd: root, timeoutMs: 5000, log: chunk => chunks.push(chunk) });
  assert.equal(result.code, 7);
  assert.equal(parseResult(result.stdout).error.code, 'dependency-mismatch');
  assert.match(chunks.join(''), /diagnostic/);
});

test('invalid or truncated CLI output cannot produce success', () => {
  assert.throws(() => parseResult('startup in progress\n{"ok":true'), /有效结果/);
  assert.throws(() => parseResult('{"phase":"ready"}'), /有效结果/);
});

test('paths with spaces, Chinese and shell metacharacters pass without interpretation', async () => {
  const dir = fs.mkdtempSync(path.join(tempBase, '中文 & space '));
  const script = path.join(dir, 'child file.mjs');
  const argument = 'literal %PATH% & whoami $(not-a-command)';
  try {
    fs.writeFileSync(script, 'console.log(JSON.stringify({ok:true,value:process.argv.slice(2)}))');
    const result = await runProcess(process.execPath, [script, argument], { cwd: dir, timeoutMs: 5000 });
    assert.equal(result.code, 0);
    assert.deepEqual(parseResult(result.stdout).value, [argument]);
  } finally { fs.unlinkSync(script); fs.rmdirSync(dir); }
});

test('a hung child is bounded and reports an actionable timeout', async () => {
  const started = Date.now();
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: root, timeoutMs: 150 }), { code: 'launcher-timeout' });
  assert.ok(Date.now() - started < 6000);
});

test('a second launcher cannot acquire or remove an active operation lock', () => {
  const dir = fs.mkdtempSync(path.join(tempBase, 'lock-'));
  const file = path.join(dir, 'operation.lock');
  const release = acquireLock(file);
  try {
    assert.throws(() => acquireLock(file), /另一个启动器/);
    assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid);
  } finally { release(); fs.rmdirSync(dir); }
});

test('an interrupted launcher lock is recoverable without touching engine state', () => {
  const dir = fs.mkdtempSync(path.join(tempBase, 'stale-'));
  const file = path.join(dir, 'operation.lock');
  fs.writeFileSync(file, JSON.stringify({ pid: 2147483647 }));
  const release = acquireLock(file);
  try { assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid); }
  finally { release(); fs.rmdirSync(dir); }
});

test('an old empty lock recovers, while a new empty lock preserves the active writer', () => {
  const dir = fs.mkdtempSync(path.join(tempBase, 'empty-'));
  const file = path.join(dir, 'operation.lock');
  fs.writeFileSync(file, '');
  assert.throws(() => acquireLock(file), /初始化/);
  fs.utimesSync(file, new Date(0), new Date(0));
  const release = acquireLock(file);
  try { assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid); }
  finally { release(); fs.rmdirSync(dir); }
});

test('recovery preserves healthy, busy, and merely waiting connected sessions', () => {
  for (const phase of ['ready', 'starting', 'reloading', 'stopped']) assert.equal(needsSessionRecovery({ phase, bridgeConnected: false }), false);
  assert.equal(needsSessionRecovery({ phase: 'waiting', bridgeConnected: true }), false);
  assert.equal(needsSessionRecovery({ phase: 'waiting', bridgeConnected: false }), true);
  assert.equal(needsSessionRecovery({ phase: 'failed' }), true);
});

test('both old and new pnpm metadata expose a wrong installed manager', () => {
  assert.equal(installedManager('{"packageManager":"pnpm@11.25.0"}'), 'pnpm@11.25.0');
  assert.equal(installedManager('packageManager: pnpm@12.15.0\nstoreDir: some/path'), 'pnpm@12.15.0');
});

test('ambiguous operations and missing timeout values fail before changing anything', () => {
  assert.throws(() => parseOptions(['--stop', '--repair']), /每次只能/);
  assert.throws(() => parseOptions(['--timeout-seconds']), /不完整/);
  assert.throws(() => parseOptions(['--timeout-seconds', '0']), /30–1800/);
});
