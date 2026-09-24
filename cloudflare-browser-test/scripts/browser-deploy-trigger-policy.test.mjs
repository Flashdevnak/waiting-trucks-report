import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const deploy = readFileSync(new URL('.github/workflows/deploy-browser-worker.yml', root), 'utf8');
const regression = readFileSync(new URL('.github/workflows/tbr-test-runtime-regression.yml', root), 'utf8');

function eventBlock(source, event) {
  const on = source.match(/^on:[ \t]*\n([\s\S]*?)(?=^[^\s#]|(?![\s\S]))/m)?.[1];
  assert.ok(on, 'workflow must have an on: section');
  const block = on.match(new RegExp(`^  ${event}:[ \\t]*\\n([\\s\\S]*?)(?=^  [\\w-]+:|(?![\\s\\S]))`, 'm'))?.[1];
  assert.ok(block, `workflow must have an ${event}: event`);
  return block;
}

function paths(source, event) {
  const block = eventBlock(source, event);
  const section = block.match(/^    paths:[ \t]*\n((?:^      - .*\n)+)/m)?.[1];
  assert.ok(section, `${event} must contain paths`);
  return [...section.matchAll(/^      - (.+)$/gm)].map(([, value]) => value.replace(/^(['"])(.*)\1$/, '$2'));
}

function steps(source) {
  const section = source.match(/^    steps:[ \t]*\n([\s\S]*?)(?=^  [\w-]+:|(?![\s\S]))/m)?.[1];
  assert.ok(section, 'deploy job must have steps');
  return section.split(/(?=^      - (?:name|uses): )/m).filter(part => /^      - (?:name|uses): /m.test(part));
}

function globMatch(glob, path) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  return new RegExp(`^${pattern}$`).test(path);
}

function selected(patterns, changed) {
  return changed.some(path => patterns.reduce((match, entry) => {
    const exclude = entry.startsWith('!');
    return globMatch(exclude ? entry.slice(1) : entry, path) ? !exclude : match;
  }, false));
}

const deployPaths = paths(deploy, 'push');
const regressionPushPaths = paths(regression, 'push');
const regressionPrPaths = paths(regression, 'pull_request');
const deploySteps = steps(deploy);

test('ordered deploy paths exclude tests but retain every runtime input', () => {
  const positive = deployPaths.indexOf('cloudflare-browser-test/scripts/**');
  assert.ok(positive >= 0);
  for (const negative of [
    '!cloudflare-browser-test/scripts/*.test.mjs',
    '!cloudflare-browser-test/scripts/**/*.test.mjs',
  ]) assert.ok(deployPaths.indexOf(negative) > positive, `${negative} must follow scripts/**`);
  for (const input of [
    'cloudflare-browser-test/src/**',
    'cloudflare-browser-test/wrangler.jsonc',
    'cloudflare-browser-test/package.json',
    'cloudflare-browser-test/package-lock.json',
  ]) assert.ok(deployPaths.includes(input), `${input} must deploy`);
  assert.ok(!deployPaths.includes('.github/workflows/deploy-browser-worker.yml'));
  assert.match(deploy, /^  workflow_dispatch:\s*$/m);
  assert.match(eventBlock(deploy, 'push'), /^    branches: \[main\]$/m);
});

test('actual path filters make the historical test-only commit validation-only', () => {
  const incident = [
    'cloudflare-browser-test/scripts/tbr-intelligence.test.mjs',
    'cloudflare-browser-test/scripts/tbr-intelligence-entry.test.mjs',
  ];
  assert.equal(selected(deployPaths, incident), false);
  assert.equal(selected(regressionPushPaths, incident), true);
  assert.equal(selected(regressionPrPaths, incident), true);
  for (const patterns of [regressionPushPaths, regressionPrPaths]) {
    assert.ok(patterns.includes('cloudflare-browser-test/**'));
    assert.ok(patterns.includes('.github/workflows/deploy-browser-worker.yml'));
  }
});

test('path decision matrix uses the workflow rules', () => {
  const cases = [
    ['cloudflare-browser-test/scripts/tbr-intelligence.test.mjs', false],
    ['cloudflare-browser-test/scripts/tbr-intelligence-entry.test.mjs', false],
    ['cloudflare-browser-test/scripts/connection-error-intelligence.test.mjs', false],
    ['cloudflare-browser-test/scripts/intelligence-ui-persisted.test.mjs', false],
    ['cloudflare-browser-test/scripts/tbr-bus-retry.test.mjs', false],
    ['cloudflare-browser-test/scripts/tbr-bus-daily-split.test.mjs', false],
    ['cloudflare-browser-test/scripts/tests/future.test.mjs', false],
    ['cloudflare-browser-test/scripts/apply-tbr-intelligence-v2.mjs', true],
    ['cloudflare-browser-test/scripts/patch-connector-recovery.mjs', true],
    ['cloudflare-browser-test/scripts/future-runtime-patch.mjs', true],
    ['cloudflare-browser-test/src/index.js', true],
    ['cloudflare-browser-test/src/tbr-shadow.js', true],
    ['cloudflare-browser-test/wrangler.jsonc', true],
    ['cloudflare-browser-test/package.json', true],
    ['cloudflare-browser-test/package-lock.json', true],
    ['.github/workflows/deploy-browser-worker.yml', false],
    ['cloudflare-browser-test/scripts/browser-deploy-trigger-policy.test.mjs', false],
  ];
  for (const [path, expected] of cases) assert.equal(selected(deployPaths, [path]), expected, path);
  const fixture = 'cloudflare-browser-test/scripts/tbr-intelligence.test.mjs';
  for (const runtime of ['cloudflare-browser-test/src/index.js', 'cloudflare-browser-test/scripts/apply-tbr-intelligence-v2.mjs']) {
    assert.equal(selected(deployPaths, [fixture, runtime]), true, runtime);
  }
  for (const path of [fixture, 'cloudflare-browser-test/scripts/tests/future.test.mjs', '.github/workflows/deploy-browser-worker.yml', 'cloudflare-browser-test/scripts/browser-deploy-trigger-policy.test.mjs']) {
    assert.equal(selected(regressionPushPaths, [path]), true, path);
  }
});

test('first step rejects unauthorized event and ref before pinned checkout', () => {
  const [guard, checkout] = deploySteps;
  assert.match(guard, /^      - name: Authorize Browser Worker source ref$/m);
  assert.match(checkout, /^      - uses: actions\/checkout@v4$/m);
  assert.match(checkout, /^          ref: \$\{\{ github\.sha \}\}$/m);
  assert.match(guard, /case "\$\{GITHUB_EVENT_NAME:-\}" in/);
  assert.match(guard, /push\|workflow_dispatch\)/);
  assert.match(guard, /"\$\{GITHUB_REF:-\}" != 'refs\/heads\/main'/);
  const script = guard.match(/^        run: \|\s*\n([\s\S]*)$/m)?.[1];
  assert.ok(script, 'authorization step must run a shell guard');
  const cases = [
    ['push', 'refs/heads/main', true],
    ['workflow_dispatch', 'refs/heads/main', true],
    ['workflow_dispatch', 'refs/heads/codex/dev-recovery-contract-v2', false],
    ['workflow_dispatch', 'refs/heads/feature/example', false],
    ['workflow_dispatch', 'refs/tags/example', false],
    ['pull_request', 'refs/heads/main', false],
    ['workflow_run', 'refs/heads/main', false],
    ['workflow_dispatch', '', false],
  ];
  for (const [event, ref, allow] of cases) {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
      env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: event, GITHUB_REF: ref }, encoding: 'utf8',
    });
    assert.equal(result.status === 0, allow, `${event} ${ref}: ${result.stderr}`);
  }
});

test('deploy step has its own exact event/ref condition after policy validation', () => {
  const deployIndex = deploySteps.findIndex(step => /^      - name: Deploy Browser Worker$/m.test(step));
  assert.ok(deployIndex > 0);
  const deployStep = deploySteps[deployIndex];
  const expected = "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";
  const condition = deployStep.match(/^        if: \$\{\{ (.*?) \}\}$/m)?.[1];
  assert.equal(condition?.replace(/\s+/g, ' '), expected);
  assert.match(deployStep, /^        run: npx wrangler deploy --config wrangler\.jsonc$/m);
  assert.ok(deploySteps.slice(0, deployIndex).some(step => step.includes('node --test scripts/browser-deploy-trigger-policy.test.mjs')));
});

test('regression runs policy and package check without a deployment command', () => {
  const validation = steps(regression).find(step => step.includes('node --test scripts/browser-deploy-trigger-policy.test.mjs'));
  assert.ok(validation, 'regression must invoke the policy test');
  assert.match(validation, /^        working-directory: cloudflare-browser-test$/m);
  assert.match(validation, /^          npm run check$/m);
  assert.ok(validation.indexOf('node --test scripts/browser-deploy-trigger-policy.test.mjs') < validation.indexOf('npm run check'));
  assert.doesNotMatch(regression, /\bwrangler deploy\b(?![^\n]*--dry-run)/);
});
