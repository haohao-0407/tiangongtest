import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMENT_MARKER,
  collectReviewInput,
  createGitHubClient,
  hasCompletedReview,
  parseAddedLines,
  publishReview,
  renderComment,
  runAgent,
  validateReview,
} from './review.mjs';

const repository = 'example/colony';
const prNumber = 17;
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const baseRef = 'master';
const mergeBaseSha = 'e'.repeat(40);
const review = { summary: 'No actionable defects found.', findings: [] };
const files = [{
  path: 'game/assets/colony/save.ts',
  status: 'modified',
  patch: '@@ -9,3 +9,4 @@\n context\n-old\n+new\n+extra\n context',
  base: 'old',
  head: 'new',
}];

function reviewInput(coverage = {}) {
  return {
    repository,
    pr: { number: prNumber, title: 'Fix saving', body: '', baseSha, baseRef, headSha },
    files,
    projectRules: [],
    coverage: {
      partial: false,
      omitted: [],
      truncated: [],
      totalChangedFiles: 1,
      reviewedFiles: 1,
      ...coverage,
    },
  };
}

function githubForPublishing({ sha = headSha, base = baseSha, comments = [] } = {}) {
  const writes = [];
  return {
    writes,
    async request(method, path, body) {
      if (method === 'GET' && path === `/repos/${repository}/pulls/${prNumber}`) {
        return { state: 'open', draft: false, head: { sha }, base: { sha: base, ref: 'master' } };
      }
      if (['PATCH', 'POST'].includes(method)) {
        writes.push({ method, path, body });
        return { id: 9001 };
      }
      throw new Error(`Unexpected GitHub request: ${method} ${path}`);
    },
    async paginate(path) {
      assert.equal(path.split('?')[0], `/repos/${repository}/issues/${prNumber}/comments`);
      return comments;
    },
  };
}

function githubForCollection({ changes, sources, fork = repository, finalHeadSha = headSha, finalBaseSha = baseSha, finalBaseRef = 'master' }) {
  const reads = [];
  let prReads = 0;
  return {
    reads,
    async request(method, path) {
      assert.equal(method, 'GET');
      if (path === `/repos/${repository}/pulls/${prNumber}`) {
        prReads += 1;
        return {
          state: 'open', draft: false, title: 'Review fixture', body: '', changed_files: changes.length,
          base: { sha: prReads > 1 ? finalBaseSha : baseSha, ref: prReads > 1 ? finalBaseRef : 'master', repo: { full_name: repository } },
          head: { sha: prReads > 1 ? finalHeadSha : headSha, repo: { full_name: fork } },
        };
      }
      if (path === `/repos/${repository}/compare/${baseSha}...${headSha}?per_page=1`) {
        return { merge_base_commit: { sha: mergeBaseSha } };
      }
      reads.push(path);
      if (!sources.has(path)) {
        const error = new Error('File not present');
        error.status = 404;
        throw error;
      }
      return { type: 'file', encoding: 'base64', content: Buffer.from(sources.get(path)).toString('base64') };
    },
    async paginate(path) {
      assert.equal(path.split('?')[0], `/repos/${repository}/pulls/${prNumber}/files`);
      return changes;
    },
  };
}

function agentFixture({ status = 'completed', output = review, hang = false, deleteConflicts = 0 } = {}) {
  const calls = [];
  const sessionId = 'sess_review_fixture';
  const turn = { id: 'turn_review_fixture', session_id: sessionId, status, subagent_id: null };
  const controller = new AbortController();
  let creates = 0;
  let deletes = 0;
  const stream = {
    controller,
    withResultCollection() { return this; },
    async *[Symbol.asyncIterator]() {
      yield { type: 'agent.session.created', session: { id: sessionId } };
      yield { type: 'agent.session.turn.started', turn: { ...turn, status: 'in_progress' } };
      if (hang) {
        await new Promise((resolve, reject) => {
          const abort = () => reject(new Error('Observation aborted'));
          if (controller.signal.aborted) abort();
          else controller.signal.addEventListener('abort', abort, { once: true });
        });
      }
      yield { type: `agent.session.turn.${status}`, turn };
      yield { type: 'agent.session.idle', session: { id: sessionId } };
    },
    async finalResult() {
      return { turn, session_id: sessionId, turn_id: turn.id, output_text: typeof output === 'string' ? output : JSON.stringify(output) };
    },
  };
  const client = {
    beta: {
      agents: {
        sessions: {
          async create(body, options) {
            creates += 1;
            calls.push({ action: 'create', body });
            options?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
            return stream;
          },
          events: {
            async create(id, body) {
              assert.equal(id, sessionId);
              calls.push({ action: 'event', body });
            },
          },
          async delete(id) {
            assert.equal(id, sessionId);
            deletes += 1;
            calls.push({ action: 'delete' });
            if (deletes <= deleteConflicts) {
              const error = new Error('Sandbox is still settling');
              error.status = 409;
              throw error;
            }
            return { deleted: true };
          },
        },
      },
    },
  };
  return { client, calls, stream, get creates() { return creates; }, get deletes() { return deletes; } };
}

test('diff locations count context and deletions correctly across separate hunks', () => {
  const patch = [
    '--- a/save.ts',
    '+++ b/save.ts',
    '@@ -9,3 +9,4 @@',
    ' context',
    '-old',
    '+new',
    '+extra',
    ' context',
    '@@ -40,2 +41,3 @@',
    ' context',
    '+addition',
    ' context',
    '\\ No newline at end of file',
  ].join('\n');
  assert.deepEqual([...parseAddedLines(patch)], [10, 11, 42]);
  assert.deepEqual([...parseAddedLines('@@ -4 +4,0 @@\n-deleted')], []);
});

test('GitHub client rejects attacker-controlled absolute and protocol-relative URLs before fetching', async () => {
  const requests = [];
  const github = createGitHubClient({
    token: 'test-only-token',
    fetchImpl: async (...args) => { requests.push(args); return Response.json({}); },
  });
  for (const path of ['https://attacker.invalid/collect', '//attacker.invalid/collect', '/\\attacker.invalid/collect']) {
    await assert.rejects(async () => github.request('GET', path));
  }
  assert.equal(requests.length, 0, 'No credential-bearing request may reach an untrusted URL');
});

test('GitHub pagination retains all pages from a same-origin Link header', async () => {
  const requests = [];
  const endpoint = `/repos/${repository}/pulls/${prNumber}/files`;
  const github = createGitHubClient({
    token: 'test-only-token',
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (requests.length === 1) {
        return Response.json([{ filename: 'first.ts' }], {
          headers: { link: `<https://api.github.com${endpoint}?page=2>; rel="next"` },
        });
      }
      assert.equal(new URL(url).searchParams.get('page'), '2');
      return Response.json([{ filename: 'second.ts' }]);
    },
  });
  assert.deepEqual(await github.paginate(endpoint), [{ filename: 'first.ts' }, { filename: 'second.ts' }]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => new URL(url).origin === 'https://api.github.com'));
});

test('GitHub pagination refuses a next-page URL on another origin', async () => {
  let requests = 0;
  const github = createGitHubClient({
    token: 'test-only-token',
    fetchImpl: async () => {
      requests += 1;
      return Response.json([{ filename: 'first.ts' }], {
        headers: { link: '<https://attacker.invalid/collect?page=2>; rel="next"' },
      });
    },
  });
  await assert.rejects(async () => github.paginate(`/repos/${repository}/pulls/${prNumber}/files`));
  assert.equal(requests, 1);
});

test('GitHub pagination cannot be redirected to another GitHub API endpoint', async () => {
  let requests = 0;
  const github = createGitHubClient({
    token: 'test-only-token',
    fetchImpl: async () => {
      requests += 1;
      return Response.json([], {
        headers: { link: '<https://api.github.com/user/emails?page=2>; rel="next"' },
      });
    },
  });
  await assert.rejects(async () => github.paginate(`/repos/${repository}/pulls/${prNumber}/files`));
  assert.equal(requests, 1);
});

test('review findings must point to an actually added line in a changed file', () => {
  const finding = { priority: 'P1', path: files[0].path, line: 10, title: 'Save content is lost', body: 'The new branch drops stored data.' };
  assert.equal(validateReview({ ...review, findings: [finding] }, files).findings.length, 1);
  assert.throws(() => validateReview({ ...review, findings: [{ ...finding, line: 9 }] }, files));
  assert.throws(() => validateReview({ ...review, findings: [{ ...finding, path: 'unrelated.ts' }] }, files));
});

test('renamed files use the merge-base before image and fork head, while rules come from the current base', async () => {
  const fork = 'contributor/colony-fork';
  const oldPath = `/repos/${repository}/contents/game/old.ts?ref=${mergeBaseSha}`;
  const newPath = `/repos/${fork}/contents/game/new.ts?ref=${headSha}`;
  const rulePath = `/repos/${repository}/contents/AGENTS.md?ref=${baseSha}`;
  const github = githubForCollection({
    fork,
    changes: [{ filename: 'game/new.ts', previous_filename: 'game/old.ts', status: 'renamed', patch: '@@ -1 +1 @@\n-old\n+new' }],
    sources: new Map([[oldPath, 'old'], [newPath, 'new'], [rulePath, 'Trusted base conventions']]),
  });
  const result = await collectReviewInput({ github, repository, prNumber });
  assert.equal(result.files[0].base, 'old');
  assert.equal(result.files[0].head, 'new');
  assert.equal(result.input.pr.headSha, headSha);
  assert.deepEqual(result.input.projectRules, [{ path: 'AGENTS.md', content: 'Trusted base conventions' }]);
  assert.ok(github.reads.includes(oldPath));
  assert.ok(github.reads.includes(newPath));
  assert.ok(github.reads.includes(rulePath));
  assert.ok(!github.reads.some((path) => path.startsWith(`/repos/${fork}/`) && /AGENTS\.md/.test(path)));
});

test('changes to the PR head, base, or target branch during collection invalidate the mixed snapshot', async (t) => {
  for (const changedRevision of ['head', 'base', 'target']) {
    await t.test(changedRevision, async () => {
      const sourcePath = `/repos/${repository}/contents/game/new.ts?ref=${headSha}`;
      const github = githubForCollection({
        changes: [{ filename: 'game/new.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+new' }],
        sources: new Map([[sourcePath, 'new']]),
        ...(changedRevision === 'head' ? { finalHeadSha: 'c'.repeat(40) } : changedRevision === 'base' ? { finalBaseSha: 'd'.repeat(40) } : { finalBaseRef: 'release' }),
      });
      await assert.rejects(collectReviewInput({ github, repository, prNumber }), /changed|stale|supersed/i);
    });
  }
});

test('collection marks oversized source and skipped binary files as partial coverage', async () => {
  const sourcePath = `/repos/${repository}/contents/game/large.ts?ref=${headSha}`;
  const github = githubForCollection({
    changes: [
      { filename: 'game/large.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+const value = 1;' },
      { filename: 'game/preview.png', status: 'added' },
    ],
    sources: new Map([[sourcePath, 'x'.repeat(90_000)]]),
  });
  const result = await collectReviewInput({ github, repository, prNumber });
  assert.equal(result.partial, true);
  assert.equal(result.input.coverage.partial, true);
  assert.equal(result.input.coverage.totalChangedFiles, 2);
  assert.equal(result.input.coverage.reviewedFiles, 1);
  assert.ok(Buffer.byteLength(result.files[0].head) < 90_000);
  assert.ok(result.input.coverage.truncated.some((item) => item.path === 'game/large.ts'));
  assert.ok(result.input.coverage.omitted.some((item) => item.path === 'game/preview.png'));
  assert.ok(!github.reads.some((path) => path.includes('preview.png')));
});

test('comments disclose omitted and truncated review scope', () => {
  const input = reviewInput({
    partial: true,
    totalChangedFiles: 3,
    omitted: [{ path: 'game/assets/huge.bin', reason: 'binary file' }],
    truncated: [{ path: files[0].path, reason: 'context limit' }],
  });
  const comment = renderComment({ review, input, headSha });
  assert.ok(comment.includes(COMMENT_MARKER));
  assert.match(comment.replaceAll('\\.', '.'), /huge\.bin/);
  assert.match(comment.replaceAll('\\.', '.'), /save\.ts/);
  assert.match(comment, /partial|incomplete|truncat|部分|截断|未完整/i);
});

test('a review of a stale PR commit never publishes', async () => {
  const github = githubForPublishing({ sha: 'c'.repeat(40) });
  const body = renderComment({ review, input: reviewInput(), headSha });
  const result = await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(result.published, false);
  assert.equal(github.writes.length, 0);
});

test('a PR updated while comments are being read is checked again before publishing', async () => {
  const github = githubForPublishing();
  const request = github.request;
  let headReads = 0;
  github.request = async (method, path, body) => {
    const response = await request(method, path, body);
    if (method === 'GET') {
      headReads += 1;
      if (headReads > 1) response.head.sha = 'd'.repeat(40);
    }
    return response;
  };
  const body = renderComment({ review, input: reviewInput(), headSha });
  const result = await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(result.published, false);
  assert.ok(headReads >= 2);
  assert.equal(github.writes.length, 0);
});

test('a base revision changed during model work prevents publication even when the PR head is unchanged', async () => {
  const github = githubForPublishing({ base: 'c'.repeat(40) });
  const body = renderComment({ review, input: reviewInput(), headSha });
  const result = await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(result.published, false);
  assert.equal(github.writes.length, 0);
});

test('a base revision changed while reading comments is rechecked before publication', async () => {
  const github = githubForPublishing();
  const request = github.request;
  let snapshotReads = 0;
  github.request = async (method, path, body) => {
    const response = await request(method, path, body);
    if (method === 'GET') {
      snapshotReads += 1;
      if (snapshotReads > 1) response.base.sha = 'd'.repeat(40);
    }
    return response;
  };
  const body = renderComment({ review, input: reviewInput(), headSha });
  const result = await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(result.published, false);
  assert.ok(snapshotReads >= 2);
  assert.equal(github.writes.length, 0);
});

test('deduplication requires a bot review of both current head and base revisions', () => {
  const user = { login: 'github-actions[bot]', type: 'Bot' };
  const snapshot = { headSha, baseSha, baseRef };
  const currentBody = renderComment({ review, input: reviewInput(), headSha });
  const oldInput = reviewInput();
  oldInput.pr.baseSha = 'c'.repeat(40);
  const staleBody = renderComment({ review, input: oldInput, headSha });
  assert.equal(hasCompletedReview([{ user, body: currentBody }], snapshot), true);
  assert.equal(hasCompletedReview([{ user, body: staleBody }], snapshot), false);
  assert.equal(hasCompletedReview([{ user, body: `${COMMENT_MARKER}\n提交：\`${headSha}\`` }], snapshot), false);
  assert.equal(hasCompletedReview([{ user: { login: 'contributor', type: 'User' }, body: currentBody }], snapshot), false);
  const targetedInput = reviewInput();
  targetedInput.pr.baseRef = 'master';
  const targetedBody = renderComment({ review, input: targetedInput, headSha });
  assert.equal(hasCompletedReview([{ user, body: targetedBody }], { ...snapshot, baseRef: 'master' }), true);
  assert.equal(hasCompletedReview([{ user, body: targetedBody }], { ...snapshot, baseRef: 'release' }), false);
});

test('publication rejects a report whose snapshot does not match the requested revisions', async () => {
  const github = githubForPublishing();
  const input = reviewInput();
  input.pr.baseSha = 'c'.repeat(40);
  const body = renderComment({ review, input, headSha });
  await assert.rejects(publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body }));
  assert.equal(github.writes.length, 0);
});

test('sticky comments update only the GitHub Actions bot comment, not a human marker spoof', async () => {
  const github = githubForPublishing({
    comments: [
      { id: 100, body: `${COMMENT_MARKER}\nHuman text`, user: { login: 'contributor', type: 'User' } },
      { id: 101, body: `${COMMENT_MARKER}\nBot text`, user: { login: 'github-actions[bot]', type: 'Bot' } },
    ],
  });
  const body = renderComment({ review, input: reviewInput(), headSha });
  const result = await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(result.published, true);
  assert.equal(github.writes.length, 1);
  assert.equal(github.writes[0].method, 'PATCH');
  assert.equal(github.writes[0].path, `/repos/${repository}/issues/comments/101`);
});

test('a marker in a human comment results in a new bot comment', async () => {
  const github = githubForPublishing({
    comments: [{ id: 100, body: COMMENT_MARKER, user: { login: 'github-actions[bot]', type: 'User' } }],
  });
  const body = renderComment({ review, input: reviewInput(), headSha });
  await publishReview({ github, repository, prNumber, headSha, baseSha, baseRef, body });
  assert.equal(github.writes.length, 1);
  assert.equal(github.writes[0].method, 'POST');
  assert.equal(github.writes[0].path, `/repos/${repository}/issues/${prNumber}/comments`);
});

test('completed agent returns structured review and deletes its sandbox session', async () => {
  const fixture = agentFixture();
  const result = await runAgent({ client: fixture.client, input: reviewInput(), timeoutMs: 1000, cleanupDelayMs: 0, log() {} });
  assert.deepEqual(result, review);
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.deletes, 1);
  assert.ok(!fixture.calls.some((call) => call.action === 'event'), 'Successful completed work should not need cancellation');
  const create = fixture.calls.find((call) => call.action === 'create').body;
  assert.equal(create.environment.network.access, 'disabled');
});

test('failed or cancelled agent turns cannot be reported as successful reviews', async (t) => {
  for (const status of ['failed', 'cancelled']) {
    await t.test(status, async () => {
      const fixture = agentFixture({ status });
      await assert.rejects(runAgent({ client: fixture.client, input: reviewInput(), timeoutMs: 1000, cleanupDelayMs: 0, log() {} }));
      assert.ok(fixture.deletes >= 1);
    });
  }
});

test('malformed structured output is rejected even after a completed turn', async () => {
  const fixture = agentFixture({ output: 'This is not JSON.' });
  await assert.rejects(runAgent({ client: fixture.client, input: reviewInput(), timeoutMs: 1000, cleanupDelayMs: 0, log() {} }));
  assert.equal(fixture.deletes, 1);
});

test('agent deadline cancels remote work and cleans up instead of merely disconnecting', { timeout: 2000 }, async () => {
  const fixture = agentFixture({ hang: true });
  await assert.rejects(runAgent({ client: fixture.client, input: reviewInput(), timeoutMs: 20, cleanupDelayMs: 0, log() {} }));
  assert.equal(fixture.creates, 1, 'A timeout must not launch a second paid review');
  assert.ok(fixture.calls.some((call) => call.action === 'event' && call.body.events.some((event) => event.type === 'agent.session.input.cancel')));
  assert.ok(fixture.deletes >= 1);
});

test('transient sandbox deletion conflicts retry without rerunning the review', async () => {
  const fixture = agentFixture({ deleteConflicts: 2 });
  assert.deepEqual(await runAgent({ client: fixture.client, input: reviewInput(), timeoutMs: 1000, cleanupDelayMs: 0, log() {} }), review);
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.deletes, 3);
});
