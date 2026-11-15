import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectPushInput, runPushReview, validatePushEvent } from './review.mjs';

const execFileAsync = promisify(execFile);
const repository = 'example/colony';
const zeroSha = '0'.repeat(40);
const knownBefore = 'a'.repeat(40);
const knownAfter = 'b'.repeat(40);

function pushEvent(before = knownBefore, after = knownAfter, overrides = {}) {
  return {
    repository: { full_name: repository },
    ref: 'refs/heads/master',
    before,
    after,
    deleted: false,
    ...overrides,
  };
}

async function gitFixture(t) {
  let tempRoot;
  try { tempRoot = realpathSync(tmpdir()); }
  catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    const workspaceTemp = fileURLToPath(new URL('../../.launcher/pr-review-test-tmp/', import.meta.url));
    await mkdir(workspaceTemp, { recursive: true });
    tempRoot = realpathSync(workspaceTemp);
  }
  const directory = await mkdtemp(join(tempRoot, 'tiangong-push-review-'));
  const isolatedConfig = join(directory, 'empty-global-config');
  const emptyHooks = join(directory, 'empty-hooks');
  await writeFile(isolatedConfig, '');
  await mkdir(emptyHooks);
  const fixtureEnvironment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: isolatedConfig,
    GIT_TERMINAL_PROMPT: '0',
  };
  delete fixtureEnvironment.OPENAI_API_KEY;
  delete fixtureEnvironment.GITHUB_TOKEN;
  delete fixtureEnvironment.GH_TOKEN;
  delete fixtureEnvironment.GIT_EXTERNAL_DIFF;
  const git = async (args, options = {}) => execFileAsync('git', args, {
    cwd: directory,
    env: fixtureEnvironment,
    windowsHide: true,
    shell: false,
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    encoding: 'utf8',
    ...options,
  });
  t.after(async () => {
    // This is the only recursive removal: verify the concrete mkdtemp target first.
    const target = realpathSync(directory);
    assert.equal(dirname(target).toLowerCase(), tempRoot.toLowerCase());
    assert.ok(basename(target).startsWith('tiangong-push-review-'));
    assert.ok(target.toLowerCase().startsWith(`${tempRoot}${sep}`.toLowerCase()));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });
  await git(['init', '--initial-branch=master']);
  await git(['config', 'user.name', 'Review fixture']);
  await git(['config', 'user.email', 'review-fixture@example.invalid']);
  await git(['config', 'core.autocrlf', 'false']);
  await git(['config', 'core.hooksPath', emptyHooks]);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'tag.gpgsign', 'false']);
  await git(['config', 'core.quotePath', 'false']);
  // These files only isolate the test runner; they never belong to a fixture commit.
  await writeFile(join(directory, '.git', 'info', 'exclude'), '/empty-global-config\n/empty-hooks/\n/review-output/\n/step-summary.md\n');

  const write = async (path, content) => {
    const target = resolve(directory, path);
    assert.ok(target.startsWith(`${directory}${sep}`));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  const commit = async (message, { allowEmpty = false } = {}) => {
    await git(['add', '--all']);
    await git(['commit', '--no-gpg-sign', ...(allowEmpty ? ['--allow-empty'] : []), '-m', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  const commands = [];
  const gitRunner = async (args, options = {}) => {
    assert.ok(Array.isArray(args));
    assert.equal(options.shell, false);
    assert.equal(resolve(options.cwd), directory);
    assert.equal(Object.hasOwn(options.env ?? {}, 'OPENAI_API_KEY'), false);
    assert.equal(Object.hasOwn(options.env ?? {}, 'GITHUB_TOKEN'), false);
    commands.push([...args]);
    return git(args, { ...options, env: { ...options.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: isolatedConfig, GIT_TERMINAL_PROMPT: '0' } });
  };
  const apiRequests = [];
  const github = {
    async request(method, path) {
      apiRequests.push({ method, path });
      assert.equal(method, 'GET', 'Push review must never post a GitHub comment');
      const prefix = `/repos/${repository}/git/`;
      assert.ok(path.startsWith(prefix), `Unexpected non-Git endpoint in push review: ${path}`);
      const suffix = path.slice(prefix.length);
      const match = /^(commits|trees|blobs)\/([a-f0-9]{40})$/.exec(suffix);
      assert.ok(match, `Unexpected Git object request: ${suffix}`);
      const [, type, sha] = match;
      if (type === 'commits') {
        const result = await git(['cat-file', '-p', sha]);
        const tree = /^tree ([a-f0-9]{40})$/m.exec(result.stdout);
        assert.ok(tree);
        return { sha, tree: { sha: tree[1] } };
      }
      if (type === 'trees') {
        const result = await git(['ls-tree', '-z', sha]);
        const tree = result.stdout.split('\0').filter(Boolean).map((entry) => {
          const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
          assert.ok(match);
          return { mode: match[1], type: match[2], sha: match[3], path: match[4] };
        });
        return { sha, truncated: false, tree };
      }
      const result = await git(['cat-file', 'blob', sha], { encoding: 'buffer' });
      return { sha, size: result.stdout.length, encoding: 'base64', content: result.stdout.toString('base64') };
    },
    async paginate(path) { throw new Error(`Push review must not call PR or comment pagination: ${path}`); },
  };
  const collect = (before, after) => collectPushInput({ github, repository, event: pushEvent(before, after), gitRunner, cwd: directory });
  return { directory, git, write, commit, commands, github, gitRunner, apiRequests, collect };
}

test('push events bind the configured repository, master ref, and immutable before/after commits', () => {
  const validated = validatePushEvent(pushEvent(), repository);
  assert.equal(validated.repository, repository);
  assert.equal(validated.ref, 'refs/heads/master');
  assert.equal(validated.before, knownBefore);
  assert.equal(validated.after, knownAfter);
  for (const event of [
    pushEvent(undefined, undefined, { repository: { full_name: 'attacker/other' } }),
    pushEvent(undefined, undefined, { ref: 'refs/heads/feature' }),
    pushEvent(undefined, undefined, { ref: 'refs/tags/master' }),
    pushEvent('--unsafe-revision', knownAfter),
    pushEvent(knownBefore, `${knownAfter};echo-untrusted`),
  ]) {
    assert.throws(() => validatePushEvent(event, repository));
  }
});

test('deletion, initial branch creation, and identical revisions are explicit skips', () => {
  for (const event of [
    pushEvent(knownBefore, zeroSha, { deleted: true }),
    pushEvent(knownBefore, zeroSha),
    pushEvent(zeroSha, knownAfter),
    pushEvent(knownBefore, knownBefore),
  ]) {
    const result = validatePushEvent(event, repository);
    assert.equal(result.skipped, true);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  }
});

test('a multi-commit push reviews the complete before-to-after tree change', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('src/balance.ts', 'export const balance = 0;\n');
  const before = await fixture.commit('initial');
  await fixture.write('src/balance.ts', 'export const balance = 1;\n');
  await fixture.write('src/temporary.ts', 'temporary\n');
  await fixture.commit('intermediate');
  await fixture.write('src/balance.ts', 'export const balance = 2;\n');
  await fixture.write('src/final.ts', 'export const final = true;\n');
  await fixture.git(['rm', '--', 'src/temporary.ts']);
  const after = await fixture.commit('final');
  const result = await fixture.collect(before, after);
  assert.deepEqual(result.files.map((file) => file.path).sort(), ['src/balance.ts', 'src/final.ts']);
  const balance = result.files.find((file) => file.path === 'src/balance.ts');
  assert.equal(balance.base, 'export const balance = 0;\n');
  assert.equal(balance.head, 'export const balance = 2;\n');
  assert.match(balance.patch, /-export const balance = 0;/);
  assert.match(balance.patch, /\+export const balance = 2;/);
  assert.equal(result.input.change.before, before);
  assert.equal(result.input.change.after, after);
  assert.equal(result.input.change.type, 'push');
  assert.ok(!fixture.apiRequests.some(({ path }) => /\/pulls\/|\/issues\/|\/compare\//.test(path)));
});

test('a push containing a merge includes both merged and mainline changes', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('seed.ts', 'seed\n');
  const before = await fixture.commit('initial');
  await fixture.git(['checkout', '-b', 'feature']);
  await fixture.write('feature.ts', 'feature\n');
  await fixture.commit('feature change');
  await fixture.git(['checkout', 'master']);
  await fixture.write('mainline.ts', 'mainline\n');
  await fixture.commit('mainline change');
  await fixture.git(['merge', '--no-ff', 'feature', '-m', 'merge fixture']);
  const after = (await fixture.git(['rev-parse', 'HEAD'])).stdout.trim();
  const result = await fixture.collect(before, after);
  assert.deepEqual(result.files.map((file) => file.path).sort(), ['feature.ts', 'mainline.ts']);
  assert.ok(result.files.every((file) => file.base === null));
});

test('a diverged force push compares the actual old tip instead of substituting its merge base', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const common = await fixture.commit('common ancestor');
  const previousSource = 'const value = 1;\nconst oldOnly = true;\n';
  await fixture.write('state.ts', previousSource);
  const before = await fixture.commit('old published tip');
  await fixture.git(['checkout', '-b', 'replacement', common]);
  const replacementSource = 'const value = 2;\nconst replacementOnly = true;\n';
  await fixture.write('state.ts', replacementSource);
  const after = await fixture.commit('replacement tip');
  const result = await fixture.collect(before, after);
  assert.equal(result.files[0].base, previousSource);
  assert.equal(result.files[0].head, replacementSource);
  assert.match(result.files[0].patch, /-const oldOnly = true;/);
  assert.match(result.files[0].patch, /\+const replacementOnly = true;/);
  assert.ok(!fixture.commands.some((args) => args.includes('merge-base')));
  assert.ok(fixture.apiRequests.some(({ path }) => path === `/repos/${repository}/git/commits/${before}`));
});

test('literal special paths are reviewed without executing external diff, textconv, or repository scripts', async (t) => {
  const fixture = await gitFixture(t);
  const unusualPath = 'space dir/[literal] $value # 中文.ts';
  const leadingPath = '--leading-option.ts';
  const markerPath = join(fixture.directory, '.git', 'tripwire-executed');
  const tripwirePath = join(fixture.directory, '.git', 'tripwire.cjs');
  await writeFile(tripwirePath, `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed'); process.exit(41);\n`);
  const tripwire = `"${process.execPath.replaceAll('\\', '/')}" "${tripwirePath.replaceAll('\\', '/')}"`;
  await fixture.write('.gitattributes', '*.ts diff=tripwire\n');
  await fixture.write('package.json', JSON.stringify({ scripts: { test: tripwire, preinstall: tripwire } }));
  await fixture.write(unusualPath, 'const value = 0;\n');
  await fixture.write(leadingPath, 'const leading = 0;\n');
  const before = await fixture.commit('initial special paths');
  await fixture.write(unusualPath, 'const value = 1;\n');
  await fixture.write(leadingPath, 'const leading = 1;\n');
  const after = await fixture.commit('change special paths');
  await fixture.git(['config', 'diff.external', tripwire]);
  await fixture.git(['config', 'diff.tripwire.textconv', tripwire]);
  const result = await fixture.collect(before, after);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [unusualPath, leadingPath].sort());
  assert.equal(result.files.find((file) => file.path === unusualPath).head, 'const value = 1;\n');
  await assert.rejects(access(markerPath), { code: 'ENOENT' });
  for (const args of fixture.commands.filter((args) => args.includes('diff'))) {
    assert.ok(args.includes('--no-ext-diff'));
    assert.ok(args.includes('--no-textconv'));
  }
});

test('missing push objects fail explicitly without fetching or using another revision', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const after = await fixture.commit('initial');
  await assert.rejects(fixture.collect('f'.repeat(40), after));
  assert.ok(!fixture.commands.some((args) => args.includes('fetch') || args.includes('merge-base')));
  assert.equal(fixture.apiRequests.length, 0);
});

test('an empty commit has no content changes and does not require an agent review', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const before = await fixture.commit('initial');
  const after = await fixture.commit('empty', { allowEmpty: true });
  assert.notEqual(before, after);
  const result = await fixture.collect(before, after);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-changes');
});

test('advancing the repository again does not change a push review of fixed before and after commits', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const before = await fixture.commit('initial');
  await fixture.write('state.ts', 'const value = 1;\n');
  const after = await fixture.commit('push under review');
  await fixture.write('state.ts', 'const value = 2;\n');
  await fixture.write('later-only.ts', 'later\n');
  await fixture.commit('a subsequent push');
  const result = await fixture.collect(before, after);
  assert.deepEqual(result.files.map((file) => file.path), ['state.ts']);
  assert.equal(result.files[0].base, 'const value = 0;\n');
  assert.equal(result.files[0].head, 'const value = 1;\n');
});

test('push review produces Markdown, JSON, and an appended summary without PR comments', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const before = await fixture.commit('initial');
  await fixture.write('state.ts', 'const value = 1;\n');
  const after = await fixture.commit('change');
  const outputPath = join(fixture.directory, 'review-output', 'push.md');
  const summaryPath = join(fixture.directory, 'step-summary.md');
  await writeFile(summaryPath, 'Existing build summary\n');
  let agentCalls = 0;
  const review = {
    summary: 'Fixture review completed.',
    findings: [{ priority: 'P2', path: 'state.ts', line: 1, title: 'Fixture finding', body: 'A concrete fixture defect.' }],
  };
  const result = await runPushReview({
    github: fixture.github, repository, event: pushEvent(before, after), client: {},
    model: 'gpt-6-astra', reasoningEffort: 'max', outputPath, summaryPath,
    gitRunner: fixture.gitRunner, cwd: fixture.directory,
    async agentRunner(options) {
      agentCalls += 1;
      assert.equal(options.input.change.before, before);
      assert.equal(options.input.change.after, after);
      assert.equal(options.model, 'gpt-6-astra');
      assert.equal(options.reasoningEffort, 'max');
      return review;
    },
  });
  assert.equal(agentCalls, 1);
  assert.equal(result.status, 'completed');
  const report = JSON.parse(await readFile(join(dirname(outputPath), 'review.json'), 'utf8'));
  assert.equal(report.mode, 'push');
  assert.equal(report.status, 'completed');
  assert.equal(report.repository, repository);
  assert.equal(report.ref, 'refs/heads/master');
  assert.equal(report.before, before);
  assert.equal(report.after, after);
  assert.equal(report.model, 'gpt-6-astra');
  assert.equal(report.reasoningEffort, 'max');
  assert.deepEqual(report.review, review);
  assert.deepEqual(report.findings, review.findings);
  const markdown = await readFile(outputPath, 'utf8');
  assert.ok(markdown.includes(before));
  assert.ok(markdown.includes(after));
  const summary = await readFile(summaryPath, 'utf8');
  assert.ok(summary.startsWith('Existing build summary\n'));
  assert.ok(summary.includes(after));
  assert.ok(fixture.apiRequests.every(({ method, path }) => method === 'GET' && path.includes('/git/')));
});

test('skipped push reports do not claim a clean review or contact the agent', async (t) => {
  const fixture = await gitFixture(t);
  const outputPath = join(fixture.directory, 'review-output', 'push.md');
  const summaryPath = join(fixture.directory, 'step-summary.md');
  const result = await runPushReview({
    github: { request() { throw new Error('Skipped event must not call GitHub'); } },
    repository, event: pushEvent(zeroSha, knownAfter), client: {},
    model: 'gpt-6-astra', reasoningEffort: 'high', outputPath, summaryPath,
    gitRunner() { throw new Error('Skipped event must not run git'); }, cwd: fixture.directory,
    agentRunner() { throw new Error('Skipped event must not contact the model'); },
  });
  assert.equal(result.status, 'skipped');
  const report = JSON.parse(await readFile(join(dirname(outputPath), 'review.json'), 'utf8'));
  assert.equal(report.status, 'skipped');
  assert.equal(report.review, null);
  assert.equal(report.findings, null);
  assert.equal(report.reason, 'new-branch-before-unavailable');
});

test('a failed model call leaves explicit failed artifacts rather than an empty successful review', async (t) => {
  const fixture = await gitFixture(t);
  await fixture.write('state.ts', 'const value = 0;\n');
  const before = await fixture.commit('initial');
  await fixture.write('state.ts', 'const value = 1;\n');
  const after = await fixture.commit('change');
  const outputPath = join(fixture.directory, 'review-output', 'push.md');
  const summaryPath = join(fixture.directory, 'step-summary.md');
  await assert.rejects(runPushReview({
    github: fixture.github, repository, event: pushEvent(before, after), client: {},
    model: 'gpt-6-astra', reasoningEffort: 'high', outputPath, summaryPath,
    gitRunner: fixture.gitRunner, cwd: fixture.directory,
    agentRunner() { throw new Error('mock-sensitive-provider-value'); },
  }), (error) => {
    assert.ok(!error.message.includes('mock-sensitive-provider-value'));
    return true;
  });
  const reportText = await readFile(join(dirname(outputPath), 'review.json'), 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.status, 'failed');
  assert.equal(report.review, null);
  assert.equal(report.findings, null);
  assert.ok(!reportText.includes('mock-sensitive-provider-value'));
  assert.ok(!fixture.apiRequests.some(({ method }) => method !== 'GET'));
});
