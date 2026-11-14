// Windows entry point is Start-Game.ps1. This file uses only Node built-ins.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function parseOptions(args) {
  const options = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), timeoutSeconds: 180 };
  const switches = { '--check': 'check', '--restart': 'restart', '--stop': 'stop', '--repair': 'repair', '--no-browser': 'noBrowser' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (switches[arg]) options[switches[arg]] = true;
    else if (arg === '--root' && args[i + 1]) options.root = path.resolve(args[++i]);
    else if (arg === '--timeout-seconds' && args[i + 1]) options.timeoutSeconds = Number(args[++i]);
    else throw new Error(`未知或不完整的参数：${arg}`);
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 30 || options.timeoutSeconds > 1800) throw new Error('超时时间应为 30–1800 秒。');
  if ([options.check, options.restart, options.stop, options.repair].filter(Boolean).length > 1) throw new Error('Check、Restart、Stop、Repair 每次只能选择一项。');
  return options;
}

export function parseResult(output) {
  try {
    const result = JSON.parse(output.trim());
    if (typeof result?.ok === 'boolean') return result;
  } catch { /* Some tools write a progress line before their JSON result. */ }
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    try {
      const result = JSON.parse(line);
      if (typeof result?.ok === 'boolean') return result;
    } catch { /* Keep looking for the complete JSON envelope. */ }
  }
  throw new Error('引擎没有返回有效结果；请查看日志中的原始输出。');
}

export function needsSessionRecovery(status) {
  // A starting/reloading owner may simply be busy. Do not tear it down.
  return status?.phase === 'failed' || (status?.phase === 'waiting' && status.bridgeConnected === false);
}

export function installedManager(text) {
  // Current pnpm writes JSON; older pnpm releases wrote YAML.
  try { return JSON.parse(text).packageManager; } catch { /* YAML scalar below. */ }
  return text.match(/^\s*packageManager:\s*['"]?([^\s'"]+)/m)?.[1];
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function acquireLock(file) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { if (readJson(file).pid === process.pid) fs.unlinkSync(file); } catch { /* Already released. */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = readJson(file); } catch {
        // An interrupted exclusive create can leave an empty file. Allow the
        // active writer a grace period, then recover only this private lock.
        if (Date.now() - fs.statSync(file).mtimeMs < 10000) throw new Error('另一个启动器正在初始化，请稍后重试。');
        fs.unlinkSync(file);
        continue;
      }
      if (alive(owner.pid)) throw new Error(`另一个启动器正在运行（PID ${owner.pid}），请等待该窗口完成。`);
      // Only our own launcher lock is removed. Never edit the engine's session files.
      fs.unlinkSync(file);
    }
  }
  throw new Error('无法取得启动锁，请稍后重试。');
}

export async function runProcess(file, args, { cwd, env, timeoutMs, log = () => {}, progress = () => {}, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(file, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, settled = false, killTimer;
    const progressTimer = setInterval(() => progress(Math.round((Date.now() - started) / 1000)), 10000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      if (error) reject(error); else resolve(value);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      const error = new Error(`操作超过 ${Math.round(timeoutMs / 1000)} 秒，已停止等待。`);
      error.code = 'launcher-timeout';
      // Keep the operation locked until the known child tree has been stopped.
      killTimer = setTimeout(() => finish(error), 5000);
      if (process.platform === 'win32' && child.pid) {
        // Corepack/npm can spawn a package-manager child; stop only this known tree.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); finish(error); });
        killer.on('close', code => { if (code !== 0) child.kill(); finish(error); });
      } else {
        child.once('close', () => finish(error));
        child.kill();
      }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; log(chunk); if (stream) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; log(chunk); if (stream) process.stderr.write(chunk); });
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => {
      if (!timedOut) finish(null, { code, signal, stdout, stderr });
    });
  });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('需要 Node.js 22.13 或更高版本。');
  const gameRoot = path.join(options.root, 'game');
  const manifest = readJson(path.join(gameRoot, 'package.json'));
  const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(manifest.packageManager)?.[1];
  if (!pnpmVersion) throw new Error('game/package.json 必须指定准确的 pnpm 版本。');
  const stateRoot = path.join(options.root, '.launcher');
  const logsRoot = path.join(stateRoot, 'logs');
  fs.mkdirSync(logsRoot, { recursive: true });
  const logFile = path.join(logsRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
  const log = text => fs.appendFileSync(logFile, text);
  const say = text => { console.log(text); log(`${text}\n`); };
  const release = acquireLock(path.join(stateRoot, 'operation.lock'));
  const timeoutMs = options.timeoutSeconds * 1000;
  const nodeDir = path.dirname(process.execPath);
  const env = { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`,
    COREPACK_HOME: process.env.COREPACK_HOME || path.join(stateRoot, 'corepack'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_cache: process.env.npm_config_cache || path.join(stateRoot, 'npm-cache'),
    npm_config_store_dir: path.join(stateRoot, 'pnpm-store'),
    TEMP: path.join(stateRoot, 'tmp'), TMP: path.join(stateRoot, 'tmp') };
  fs.mkdirSync(env.TEMP, { recursive: true });
  let cli;
  const run = async (file, args, label, stream = false) => {
    say(`\n${label}`);
    const result = await runProcess(file, args, { cwd: gameRoot, env, timeoutMs, log, stream,
      progress: seconds => say(`  已等待 ${seconds} 秒，仍在处理；日志持续写入。`) });
    log(`\n[exit ${result.code}, signal ${result.signal ?? 'none'}]\n`);
    return result;
  };
  const engine = async (args, label) => {
    const raw = await run(process.execPath, [cli, ...args, '--json'], label);
    let result;
    try { result = parseResult(raw.stdout); } catch (error) {
      throw new Error(`${error.message}\n${raw.stderr.trim().slice(-1500)}`);
    }
    if (raw.code !== 0 || !result.ok) {
      const error = new Error(`${result.error?.code ?? `exit-${raw.code}`}\n${result.error?.hint ?? ''}\n${JSON.stringify(result.error?.detail ?? {})}`);
      error.code = result.error?.code;
      throw error;
    }
    return result.value;
  };
  try {
    say(`森屿 · 游戏启动器\n工程：${gameRoot}\nNode：${process.versions.node}\n日志：${logFile}`);
    // Stop remains available even when the dependency/package-manager check is broken.
    const engineManifestPath = path.join(gameRoot, 'node_modules', '@forgeax', 'engine', 'package.json');
    const locateCli = () => {
      const pkg = readJson(engineManifestPath);
      return path.resolve(path.dirname(engineManifestPath), typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.forgeax);
    };
    if (options.stop) {
      cli = locateCli();
      await engine(['dev', 'stop'], '正在停止此工程的游戏…');
      say('游戏已停止。');
      return;
    }

    // Use Corepack's exact version, never whichever pnpm happens to win PATH.
    const searchDirs = [...new Set([nodeDir, ...(process.env.PATH ?? '').split(path.delimiter)])];
    const corepack = searchDirs.map(dir => path.join(dir, 'node_modules', 'corepack', 'dist', 'corepack.js')).find(fs.existsSync);
    let managerArgs;
    if (corepack) {
      managerArgs = [corepack, `pnpm@${pnpmVersion}`];
      env.PATH = `${path.dirname(path.dirname(path.dirname(path.dirname(corepack))))}${path.delimiter}${env.PATH}`;
    } else {
      // Node distributions without Corepack get a private, versioned pnpm, not a global install.
      const toolRoot = path.join(stateRoot, 'toolchain', `pnpm-${pnpmVersion}`);
      const entry = path.join(toolRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
      if (!fs.existsSync(entry)) {
        const npm = searchDirs.map(dir => path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')).find(fs.existsSync);
        if (!npm) throw new Error('没有找到 Corepack 或 npm。请安装包含 npm 的 Node.js，再重新启动。');
        const result = await run(process.execPath, [npm, 'install', '--prefix', toolRoot, `pnpm@${pnpmVersion}`, '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund'], `准备 pnpm ${pnpmVersion}（仅安装到本工程）…`, true);
        if (result.code !== 0) throw new Error('下载 pnpm 失败，请检查网络和 npm registry 配置后重试。');
      }
      managerArgs = [entry];
      // pnpm's own optional binary is used directly by doctor/children on Windows.
      const binaryDir = path.join(toolRoot, 'node_modules', `@pnpm/exe.${process.platform}-${process.arch}`);
      if (!fs.existsSync(path.join(binaryDir, 'pnpm.exe'))) throw new Error('pnpm 本机可执行文件缺失，请检查 npm 的 optionalDependencies 配置。');
      env.PATH = `${binaryDir}${path.delimiter}${env.PATH}`;
    }
    const version = await run(process.execPath, [...managerArgs, '--version'], `检查 pnpm ${pnpmVersion}…`);
    if (version.code !== 0 || version.stdout.trim().split(/\r?\n/).at(-1) !== pnpmVersion) throw new Error(`无法启用 pnpm ${pnpmVersion}。\n${version.stderr.trim().slice(-1500)}`);

    const modulesFile = path.join(gameRoot, 'node_modules', '.modules.yaml');
    const installed = fs.existsSync(modulesFile) ? installedManager(fs.readFileSync(modulesFile, 'utf8')) : null;
    let installedEngine;
    try { installedEngine = readJson(engineManifestPath); } catch { /* Install missing/broken dependencies below. */ }
    const missing = !installedEngine || !fs.existsSync(locateCli());
    const mismatch = installed !== `pnpm@${pnpmVersion}` || installedEngine?.version !== manifest.dependencies['@forgeax/engine'];
    if ((missing || mismatch) && options.check) throw new Error(`依赖尚未就绪（安装记录：${installed ?? '缺失'}，需要 pnpm@${pnpmVersion}）。运行 Start-Game.ps1 -Repair 修复。`);
    if (missing || mismatch || options.repair) {
      // A moved repository or a changed package manager may invalidate old links.
      // pnpm owns the repair; the launcher never deletes node_modules or user saves.
      const install = await run(process.execPath, [...managerArgs, 'install', '--frozen-lockfile', '--force', '--store-dir', path.join(stateRoot, 'pnpm-store')], '正在安装/修复项目依赖（保持锁文件版本，首次需要下载）…', true);
      if (install.code !== 0) throw new Error('依赖安装失败。原始错误已保存在日志中；请修复网络或锁文件问题后重试。');
    }
    cli = locateCli();
    // doctor snapshots every installed package twice (very costly on Windows).
    // Keep full verification for explicit checks and installations. A normal
    // launch still validates versions and must pass the engine's compile/ready gate.
    if (options.check || options.repair || missing || mismatch) {
      await engine(['project', 'check'], '检查工程配置与依赖（完整扫描可能需要数分钟）…');
    }
    if (options.check || options.repair) {
      say(options.repair ? '修复完成，工程自检通过。现在可以双击“启动游戏.bat”。' : '自检通过。');
      return;
    }

    let before = await engine(['dev', 'status'], '检查已有游戏会话…');
    if (options.restart || needsSessionRecovery(before)) {
      await engine(['dev', 'stop'], options.restart ? '正在重启此工程的游戏…' : '检测到失效会话，正在恢复…');
      before = { phase: 'stopped' };
    }
    let started;
    try {
      started = await engine(['dev', 'start', '--headless', options.noBrowser ? 'true' : 'false'], '正在编译并打开游戏…');
    } catch (error) {
      if (error.code === 'launcher-timeout' && before?.phase === 'stopped') {
        try { await engine(['dev', 'stop'], '启动超时，正在停止本次未完成的启动…'); } catch (stopError) { say(`清理提示：${stopError.message}`); }
      }
      throw error;
    }
    const status = await engine(['dev', 'status'], '确认游戏已就绪…');
    if (status.phase !== 'ready') throw new Error(`游戏尚未就绪（${status.phase ?? 'unknown'}）。请运行 Start-Game.ps1 -Restart 重试。`);
    say(`\n启动成功\n游戏地址：${status.url ?? started.url}\n状态：${status.phase}\n${options.noBrowser ? '当前为后台验证模式，没有显示浏览器窗口。' : '游戏窗口已就绪。再次双击会复用正常会话。'}\n停止游戏：Start-Game.ps1 -Stop\n重新启动：Start-Game.ps1 -Restart`);
  } catch (error) {
    say(`\n操作失败：${error.message}\n完整日志：${logFile}\n引擎日志：${path.join(gameRoot, '.forgeax', 'dev.log')}`);
    error.reported = true;
    throw error;
  } finally { release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { if (!error.reported) console.error(error.message); process.exitCode = 1; });
}
