import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collect, select, summarize, itemKey, makeBundle } from '../scripts/lib/bundle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'scripts/aiwp-migrate.mjs');
const fixture = path.join(root, 'test/fixtures/chatgpt-synthetic.json');
const run = (args, cwd = tmpdir(), script = cli) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const temp = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-migration-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const chat = (id = 'chat') => ({ id, title: 'Private fixture title', messages: [{ id: 'm', parentId: null, role: 'user', text: 'Exact synthetic text' }], activeMessageId: 'm' });

test('CLI builds and validates a graph from unrelated cwd without mutating source', async (t) => {
  const dir = await temp(t);
  const before = await readFile(fixture);
  const scan = run(['scan', '--export', fixture, '--categories', 'conversations']);
  assert.equal(scan.status, 0, scan.stderr);
  const summary = JSON.parse(scan.stdout);
  assert.equal(summary.categories.find((c) => c.category === 'conversations').count, 1);
  assert.equal(summary.categories.find((c) => c.category === 'memories').status, 'not-selected');
  assert.equal(summary.coverage.verifiedAtDestination, false);
  const out = path.join(dir, 'bundle.json');
  const built = run(['build', '--export', fixture, '--out', out]);
  assert.equal(built.status, 0, built.stderr);
  const bundle = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(bundle.format, 'chatgpt-migration-bundle');
  assert.equal(bundle.conversations[0].messages.length, 3);
  assert.ok(bundle.conversations[0].activeMessageId);
  assert.equal(run(['validate', out]).status, 0);
  if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(fixture), before);
});

test('CLI never overwrites existing files and rejects repo and symlinked repo destinations', async (t) => {
  const dir = await temp(t);
  const existing = path.join(dir, 'existing.json');
  await writeFile(existing, 'preserve me');
  assert.notEqual(run(['build', '--export', fixture, '--out', existing]).status, 0);
  assert.equal(await readFile(existing, 'utf8'), 'preserve me');
  const repo = path.join(dir, 'repo');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  assert.notEqual(run(['build', '--export', fixture, '--out', path.join(repo, 'nested', 'bundle.json')]).status, 0);
  await symlink(repo, path.join(dir, 'shortcut'), 'dir');
  assert.notEqual(run(['build', '--export', fixture, '--out', path.join(dir, 'shortcut', 'bundle.json')]).status, 0);
  assert.notEqual(run(['build', '--export', fixture, '--out', path.join(root, 'private-bundle.json')]).status, 0);
});

test('category scoping avoids unrequested files and export sources', async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, 'memories.json'), JSON.stringify([{ id: 'memory', value: 'Synthetic preference' }]));
  await writeFile(path.join(dir, 'conversations.json'), 'THIS IS NOT JSON');
  const collected = await collect({ inputsDir: dir, exportPath: '/not-a-real-export', categories: ['memories'] });
  assert.equal(collected.memories.length, 1);
  assert.equal(collected.conversations.length, 0);
  await assert.rejects(collect({ inputsDir: dir, categories: ['conversations'] }), /valid UTF-8 JSON/);
});

test('credentials default to exclusion, approvals are item-specific, reports omit content', async (t) => {
  const dir = await temp(t);
  const secret = `sk-proj-${'x'.repeat(64)}`;
  const first = chat('first'); first.messages[0].text = secret;
  const second = chat('second'); second.messages[0].text = secret;
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify([first, second, chat('safe')]));
  const collected = await collect({ inputsDir: dir, categories: ['conversations'] });
  assert.equal(select(collected).chosen.conversations.length, 1);
  const allowed = itemKey('conversations', first);
  const selected = select(collected, { allowFlagged: [allowed] });
  assert.deepEqual(selected.chosen.conversations.map((c) => c.id), ['first', 'safe']);
  assert.equal(selected.skipped.length, 1);
  const output = run(['scan', '--inputs', dir]);
  assert.equal(output.status, 0, output.stderr);
  assert.ok(!output.stdout.includes(secret));
  assert.ok(!output.stdout.includes('Private fixture title'));
  assert.ok(!output.stdout.includes('Exact synthetic text'));
  assert.ok(JSON.stringify(summarize(collected, { showTitles: true })).includes('Private fixture title'));
  assert.throws(() => select(collected, { allowFlagged: ['unrecognized'] }), /unknown key/);
  collected.conversations[0].messages[0].text = `${secret} changed since review`;
  assert.throws(() => select(collected, { allowFlagged: [allowed] }), /unknown key/);
});

test('excluding projects cascades to chats and artifacts instead of detaching them', async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Test project', instructions: '', context: '' }]));
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify([{ ...chat(), projectId: 'p' }]));
  await writeFile(path.join(dir, 'artifacts.json'), JSON.stringify([{ id: 'a', title: 'Artifact', type: 'text/markdown', content: 'Test', conversationId: 'chat' }]));
  const collected = await collect({ inputsDir: dir });
  assert.equal(makeBundle(select(collected).chosen).artifacts.length, 1);
  const selected = select(collected, { exclude: [itemKey('projects', collected.projects[0])] });
  assert.equal(selected.chosen.conversations.length, 0);
  assert.equal(selected.chosen.artifacts.length, 0);
  assert.equal(selected.skipped.length, 3);
});

test('strict staging rejects symlinks and duplicate IDs, quarantines invalid chat records', async (t) => {
  const dir = await temp(t);
  await symlink(fixture, path.join(dir, 'conversations.json'));
  await assert.rejects(collect({ inputsDir: dir, categories: ['conversations'] }), /regular file/);
  await rm(path.join(dir, 'conversations.json'));
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify([chat(), chat()]));
  await assert.rejects(collect({ inputsDir: dir }), /Duplicate conversation ID/);
  const wrongRole = chat('wrong-role');
  wrongRole.messages[0].role = 'unexpected';
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify([{ ...chat(), unexpected: 'do not echo this' }, wrongRole]));
  const failed = run(['scan', '--inputs', dir]);
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).coverage.conversationCounts.quarantined, 2);
  assert.equal(JSON.parse(failed.stdout).categories.find((c) => c.category === 'conversations').status, 'partial');
  assert.ok(!failed.stdout.includes('do not echo this'));
});

test('selection failure, empty sources and misleading command options fail before output', async (t) => {
  const dir = await temp(t);
  const out = path.join(dir, 'empty.json');
  assert.notEqual(run(['build', '--inputs', dir, '--out', out]).status, 0);
  assert.notEqual(run(['scan', '--export', fixture, '--categories', 'invented']).status, 0);
  assert.notEqual(run(['scan', '--export', fixture, '--exclude', 'ignored']).status, 0);
  assert.notEqual(run(['scan', '--export', fixture, 'extra']).status, 0);
  assert.equal(run(['doctor']).status, 0);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('copied package runs outside checkout and protects its root even without git', async (t) => {
  const dir = await temp(t);
  const installed = path.join(dir, 'installed-package');
  await cp(path.join(root, 'scripts'), path.join(installed, 'scripts'), { recursive: true });
  await cp(path.join(root, 'package.json'), path.join(installed, 'package.json'));
  const entry = path.join(installed, 'scripts', 'aiwp-migrate.mjs');
  const out = path.join(dir, 'bundle.json');
  assert.equal(run(['build', '--export', fixture, '--out', out], dir, entry).status, 0);
  assert.notEqual(run(['build', '--export', fixture, '--out', path.join(installed, 'data.json')], dir, entry).status, 0);
});
