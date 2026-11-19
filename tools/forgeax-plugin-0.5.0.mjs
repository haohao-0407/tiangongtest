import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// A project-local fork of the published connector, not an official ForgeAX release.
const command = process.argv[2];
const { values: options } = parseArgs({ args: process.argv.slice(3), options: {
  project: { type: 'string' }, run: { type: 'boolean', default: false },
} });
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(workspace, '.launcher', 'forgeax-plugin-0.5.0');
const plugin = join(runtime, 'node_modules', '@forgeax', 'game');
const entry = join(plugin, 'dist', 'main.js');
const game = options.project ? resolve(options.project) : join(workspace, 'game');
const localVersion = '0.4.2-engine.0.5.0.local.1';
const patchRevision = 3;
const upstreamHash = 'ece60e0e17dd56d75b8811438381fab415200166864cd2e3e588c9514a1edfca';
const carrierIntegrity = 'sha512-LoB3ATTiP5DEwjcYZPOl6OF3ffFYjmRdW/kpY2Hlm84VX/IVugR0JUQ05ZTW6B++aHCu6OgxIMwwaUjJTBjiAg==';
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const teamLock = join(dirname(fileURLToPath(import.meta.url)), 'forgeax-plugin-0.5.0.lock.json');

function validateProject() {
  assert.equal(readJson(join(game, 'package.json')).dependencies?.['@forgeax/engine'], '0.5.0',
    'The selected game must declare exactly @forgeax/engine 0.5.0.');
  assert(existsSync(join(game, 'forge.json')), 'The selected directory has no forge.json.');
}

function prepare() {
  mkdirSync(runtime, { recursive: true });
  writeJson(join(runtime, 'package.json'), {
    name: 'local-forgeax-plugin-engine-0.5.0', version: '1.0.0', private: true,
    dependencies: { '@forgeax/game': '0.4.2' },
    overrides: { '@forgeax/game': { '@forgeax/engine-sdk': '0.5.0', pnpm: '12.15.0' } },
  });
  if (!existsSync(entry)) {
    const npmCli = [
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      process.env.npm_execpath,
    ].find((candidate) => candidate && existsSync(candidate));
    assert(npmCli, 'Run this script with a Node installation that includes npm.');
    assert(existsSync(teamLock), 'The bundled forgeax-plugin-0.5.0.lock.json is missing.');
    copyFileSync(teamLock, join(runtime, 'package-lock.json'));
    const installed = spawnSync(process.execPath, [npmCli, 'ci', '--prefix', runtime,
      '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(workspace, '.launcher', 'npm-cache')],
    { stdio: 'inherit', windowsHide: true });
    assert.equal(installed.status, 0, 'Local connector dependency installation failed.');
  }
  const reportPath = join(runtime, 'compatibility.json');
  const current = readFileSync(entry, 'utf8');
  const previous = existsSync(reportPath) ? readJson(reportPath) : undefined;
  if (previous && sha256(current) === previous.patchedSha256 && previous.patchRevision === patchRevision) {
    console.log(`Already prepared: ${localVersion}`);
    return;
  }
  const isUpstream = sha256(current) === upstreamHash;
  if (previous && !isUpstream) assert.equal(sha256(current), previous.patchedSha256, 'Local connector was edited; refusing to overwrite it.');
  const original = isUpstream ? current : readFileSync(join(runtime, 'main.upstream.js'), 'utf8');
  assert.equal(sha256(original), upstreamHash, 'Unknown connector bytes; refusing to patch.');
  const sdkRoot = join(runtime, 'node_modules', '@forgeax', 'engine-sdk', 'sdk');
  const sdk = readJson(join(sdkRoot, 'sdk-manifest.json'));
  assert.equal(sdk.sdkVersion, '0.5.0');
  assert.equal(sdk.engineCommit, '9e2cad3cfea08269cb30e21beb0a0cce1b323722');
  assert.equal(sdk.schemaVersion, '1.11.0');
  assert.equal(sdk.requirements.pnpm, '12.15.0');
  const lock = readJson(join(runtime, 'package-lock.json'));
  assert.equal(lock.packages['node_modules/@forgeax/engine-sdk'].integrity, carrierIntegrity);
  assert.equal(readJson(join(runtime, 'node_modules', 'pnpm', 'package.json')).version, '12.15.0');
  let patched = original;
  const replacements = [
    ['"0.4.8"', '"0.5.0"', 4],
    ['"70caac9757c894947fb233825a057c23496be6d6"', JSON.stringify(sdk.engineCommit), 1],
    ['"12.10.1"', '"12.15.0"', 2],
    ['var SDK_MANIFEST_SCHEMA = "1.9.0";', 'var SDK_MANIFEST_SCHEMA = "1.11.0";', 1],
    ['version: "0.4.2",', `version: "${localVersion}",`, 1],
    ['"sha512-3+FNevA+YsKqVdqtQS7jslUbt+YoKlHdVT5l/clvUD4yWTUge5m5o+H+vHKlMnUjBgEjZXiP26Am/Tz9U03Qwg=="', JSON.stringify(carrierIntegrity), 1],
    ['sdkManifestDigest: `sha256:${"0".repeat(64)}`',
      `sdkManifestDigest: "sha256:${sha256(readFileSync(join(sdkRoot, 'sdk-manifest.json')))}"`, 1],
    ['if (!entry.isDirectory() || !isEngineSkill(entry.name))',
      'if (!(entry.isDirectory() || entry.isSymbolicLink()) || !isEngineSkill(entry.name))', 1],
    ['function processStartIdentity(pid) {\n  if (!Number.isInteger(pid) || pid <= 0)\n    return;\n',
      `function processStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return;
  if (process.platform === "win32") {
    const executable = join4(process.env.SystemRoot || "C:\\\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const query = "(Get-Process -Id " + pid + " -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)";
    const result = spawnSync2(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query], {
      encoding: "utf8", timeout: 5000, windowsHide: true
    });
    const ticks = result.status === 0 ? result.stdout.trim() : "";
    return /^\\d+$/.test(ticks) ? "win32:" + ticks : undefined;
  }
`, 1],
  ];
  for (const [before, after, count] of replacements) {
    assert.equal(patched.split(before).length - 1, count, `Unexpected occurrence count: ${before}`);
    patched = patched.replaceAll(before, after);
  }
  const manifest = readJson(join(plugin, 'package.json'));
  assert(['0.4.2', localVersion].includes(manifest.version));
  manifest.version = localVersion;
  manifest.dependencies['@forgeax/engine-sdk'] = '0.5.0';
  manifest.dependencies.pnpm = '12.15.0';
  manifest.devDependencies['@forgeax/engine'] = '0.5.0';
  manifest.devDependencies['@forgeax/view'] = '0.5.0';
  writeFileSync(join(runtime, 'main.upstream.js'), original);
  writeFileSync(entry, patched);
  writeJson(join(plugin, 'package.json'), manifest);
  writeJson(reportPath, {
    kind: 'local-compatibility-fork', upstreamVersion: '0.4.2', localVersion, patchRevision,
    upstreamSha256: upstreamHash, patchedSha256: sha256(patched),
    engineVersion: sdk.sdkVersion, engineCommit: sdk.engineCommit,
    sdkManifestSchema: sdk.schemaVersion, pnpm: sdk.requirements.pnpm, carrierIntegrity,
    scope: 'Core stdio MCP status, exact Engine build and owned Preview. Optional native panels and asset extensions are unverified.',
  });
  console.log(`Prepared ${localVersion}\n${entry}`);
}

function bind() {
  validateProject();
  const source = join(plugin, 'assets', 'skills', 'forgeax-game', 'SKILL.md');
  const destination = join(game, '.agents', 'skills', 'forgeax-game');
  mkdirSync(destination, { recursive: true });
  copyFileSync(source, join(destination, 'SKILL.md'));
  const updated = spawnSync(process.execPath, [entry, 'agents', 'update'], {
    cwd: game, stdio: 'inherit', windowsHide: true,
  });
  assert.equal(updated.status, 0, 'Project routing update failed.');
  console.log('Bound connector guidance; existing Engine skill junctions are preserved.');
}

function install() {
  if (options.project) validateProject();
  prepare();
  if (options.project) bind();
  // Register from an unbound directory so the upstream installer only changes
  // this user's MCP launcher and does not recopy a project's Engine skills.
  const installCwd = mkdtempSync(join(tmpdir(), 'forgeax-team-install-'));
  try {
    const result = spawnSync(process.execPath, [entry, 'install', '--ide', 'codex', '--local'], {
      cwd: installCwd, stdio: 'inherit', windowsHide: true,
    });
    assert.equal(result.status, 0, 'Codex registration failed; see the installer output above.');
  } finally {
    rmdirSync(installCwd);
  }
  console.log(`Installed ${localVersion}. Keep this directory in place and restart Codex.`);
}

async function verify(run) {
  validateProject();
  const report = readJson(join(runtime, 'compatibility.json'));
  assert.equal(sha256(readFileSync(entry)), report.patchedSha256);
  const child = spawn(process.execPath, [entry, 'mcp'], {
    cwd: game, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, FORGEAX_GAME_CRASH_LOG: join(runtime, 'mcp-crash.log') },
  });
  let buffer = '', stderr = '', nextId = 1;
  const pending = new Map();
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16384); });
  const rejectPending = (error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  child.on('error', rejectPending);
  child.on('exit', (code) => rejectPending(new Error(`MCP exited ${code}: ${stderr}`)));
  child.stdout.on('data', (data) => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) { rejectPending(error); continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  const rpc = (method, params, timeout = 30000) => new Promise((resolveRequest, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP ${method} timed out after ${timeout} ms`));
    }, timeout);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const contentText = (value) => (value.content ?? value.contents ?? []).map((item) => item.text ?? '').join('\n');
  const evidence = { localVersion, checks: [], createdAt: new Date().toISOString() };
  const evidenceName = run ? 'verification.json' : 'status-verification.json';
  const record = (name, value) => { evidence.checks.push({ name, ...value }); writeJson(join(runtime, evidenceName), evidence); };
  try {
    const hello = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'local-forgeax-compatibility-check', version: '1.0.0' } });
    assert.equal(hello.serverInfo.version, localVersion);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await rpc('tools/list', {});
    const resources = await rpc('resources/list', {});
    assert(tools.tools.some((tool) => tool.name === 'forgeax_run_current_game'));
    assert(resources.resources.some((resource) => resource.uri === 'forgeax://status'));
    const identity = JSON.parse(contentText(await rpc('resources/read', { uri: 'forgeax://release-identity' })));
    assert.equal(identity.engineSdkVersion, '0.5.0');
    assert.equal(identity.engineSourceCommit, report.engineCommit);
    assert.equal(identity.pnpmVersion, '12.15.0');
    assert.equal(identity.carrierIntegrity, carrierIntegrity);
    record('handshake-and-release-identity', { passed: true, tools: tools.tools.map((tool) => tool.name), identity });
    const status = await rpc('tools/call', { name: 'forgeax_status_lite', arguments: { target_dir: game } });
    const statusText = contentText(status);
    console.log(statusText);
    assert(!status.isError && !statusText.includes('status: unavailable'), 'Engine release resolution failed.');
    assert(statusText.includes('0.5.0') && statusText.includes(report.engineCommit));
    record('project-status', { passed: true, text: statusText });
    const fixture = join(runtime, 'negative-version-fixture');
    mkdirSync(fixture, { recursive: true });
    writeJson(join(fixture, 'forge.json'), { id: 'wrong-release', schemaVersion: '3.0.0', roots: {} });
    writeJson(join(fixture, 'package.json'), { dependencies: { '@forgeax/engine': '0.4.8' } });
    const rejected = await rpc('tools/call', { name: 'forgeax_run_current_game', arguments: { target_dir: fixture } });
    assert.equal(rejected.isError, true);
    assert.match(contentText(rejected), /engine_release_mismatch.*expected 0\.5\.0/);
    record('wrong-engine-still-rejected', { passed: true, text: contentText(rejected) });
    if (run) {
      console.log('Building and starting the real game through MCP...');
      const preview = await rpc('tools/call', { name: 'forgeax_run_current_game', arguments: { target_dir: game } }, 165000);
      const previewText = contentText(preview);
      record('real-project-build-and-preview', { passed: !preview.isError, text: previewText });
      console.log(previewText);
      assert(!preview.isError, 'MCP build/Preview failed; see verification.json and returned logs.');
      for (const field of ['preview.status: ready', 'engine.version: 0.5.0', `engine.commit: ${report.engineCommit}`,
        `preview.root: ${game}`, 'preview.instance_id:', 'preview.build_digest:']) assert(previewText.includes(field), field);
      const reused = await rpc('tools/call', { name: 'forgeax_run_current_game', arguments: { target_dir: game } }, 165000);
      const reusedText = contentText(reused);
      record('owned-preview-reuse', { passed: !reused.isError && reusedText.includes('preview.reused: true'), text: reusedText });
      assert(!reused.isError && reusedText.includes('preview.reused: true'));
      console.log('Verified exact Engine build, Preview ownership, and reuse. Closing the test MCP stops its Preview.');
    }
  } finally {
    const exit = child.pid && child.exitCode === null && child.signalCode === null
      ? once(child, 'exit') : Promise.resolve();
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 10000);
    try { await exit; } finally { clearTimeout(timer); }
  }
}

if (command === 'prepare') prepare();
else if (command === 'install') install();
else if (command === 'bind') bind();
else if (command === 'verify') await verify(options.run);
else throw new Error('Usage: node tools/forgeax-plugin-0.5.0.mjs prepare | install | bind | verify [--run] [--project <game-directory>]');
