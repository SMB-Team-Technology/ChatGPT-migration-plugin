import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findSecret, findSecretIn } from '../scripts/lib/secrets.mjs';
import { collect, summarize, select, itemKey } from '../scripts/lib/bundle.mjs';

const patterns = [
  [`sk-proj-${'x'.repeat(64)}`, 'an API secret key'],
  [`sk-svcacct-${'x'.repeat(64)}`, 'an API secret key'],
  [`sk-ant-${'x'.repeat(64)}`, 'an Anthropic API key'],
  [`AKIA${'A'.repeat(16)}`, 'an AWS access key'],
  [`ghp_${'x'.repeat(36)}`, 'a GitHub token'],
  [`github_pat_${'x'.repeat(50)}`, 'a GitHub token'],
  [`AIza${'x'.repeat(35)}`, 'a Google API key'],
  [`xoxb-${'x'.repeat(20)}`, 'a Slack token'],
  [`Bearer ${'x'.repeat(40)}`, 'a bearer token'],
  ['https://example.invalid/download?token=synthetic-example-token', 'a signed download URL'],
  ['-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----', 'a private key'],
];

test('raw string scanning preserves credential boundaries after newline, tab and carriage return', () => {
  for (const [token, expected] of patterns) {
    for (const separator of ['', '\n', '\t', '\r', '\r\n']) {
      const text = `${separator}${token}`;
      assert.equal(findSecret(text), expected);
      assert.equal(findSecretIn({ nested: [{ text }] }), expected);
    }
  }
});

test('scans nested values without joining fields or creating token boundaries', () => {
  const token = `sk-proj-${'x'.repeat(64)}`;
  assert.equal(findSecretIn({ a: ['safe', { b: `before\n${token}\nafter` }] }), 'an API secret key');
  assert.equal(findSecretIn({ a: 'sk-proj-', b: 'x'.repeat(64) }), null);
  assert.equal(findSecretIn(['Bearer ', 'x'.repeat(40)]), null);
  assert.equal(findSecretIn({ [token]: 'No secret in this string value' }), null);
  assert.equal(findSecretIn({ a: `prefixAKIA${'A'.repeat(16)}`, b: `prefixghp_${'x'.repeat(36)}` }), null);
  assert.equal(findSecretIn({ a: null, b: 123, c: false, d: undefined }), null);
  assert.equal(findSecret({ toString: () => token }), null);
});

test('handles deep and cyclic containers without recursion or duplicate traversal', () => {
  const root = {};
  let current = root;
  for (let i = 0; i < 20_000; i++) {
    current.next = {};
    current = current.next;
  }
  current.loop = root;
  assert.equal(findSecretIn(root), null);
  current.text = `\nAKIA${'A'.repeat(16)}`;
  assert.equal(findSecretIn(root), 'an AWS access key');
});

test('multiline credentials are excluded from bundles and titles are redacted in CLI reports', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'migration-secret-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const token = `sk-proj-${'x'.repeat(64)}`;
  const chat = (id, title, text) => ({ id, title, messages: [{ id: 'message', parentId: null, role: 'user', text }] });
  const rows = [
    chat('flagged-body', 'Flagged body', `Before\n${token}`),
    chat('flagged-title', `Before\t${token}`, 'Synthetic safe text'),
    chat('safe', 'Safe synthetic chat', 'Synthetic safe text'),
  ];
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify(rows));
  const collected = await collect({ inputsDir: dir, categories: ['conversations'] });
  const summary = summarize(collected, { showTitles: true });
  const chats = summary.find((entry) => entry.category === 'conversations');
  assert.equal(chats.items[0].credentialWarning, 'an API secret key');
  assert.equal(chats.items[1].title, '[credential-like title omitted]');
  assert.ok(!JSON.stringify(summary).includes(token));
  assert.deepEqual(select(collected).chosen.conversations.map((entry) => entry.id), ['safe']);
  const approved = select(collected, { allowFlagged: [itemKey('conversations', rows[0])] });
  assert.deepEqual(approved.chosen.conversations.map((entry) => entry.id), ['flagged-body', 'safe']);
  const cli = fileURLToPath(new URL('../scripts/aiwp-migrate.mjs', import.meta.url));
  const scan = spawnSync(process.execPath, [cli, 'scan', '--inputs', dir, '--categories', 'conversations', '--show-titles'], { encoding: 'utf8' });
  assert.equal(scan.status, 0, scan.stderr);
  assert.ok(!`${scan.stdout}${scan.stderr}`.includes(token));
  assert.equal(JSON.parse(scan.stdout).categories.find((entry) => entry.category === 'conversations').items[1].title, '[credential-like title omitted]');
  const out = path.join(dir, 'bundle.json');
  const build = spawnSync(process.execPath, [cli, 'build', '--inputs', dir, '--categories', 'conversations', '--out', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const written = await readFile(out, 'utf8');
  assert.ok(!`${written}${build.stdout}${build.stderr}`.includes(token));
  assert.deepEqual(JSON.parse(written).conversations.map((entry) => entry.id), ['safe']);
});
