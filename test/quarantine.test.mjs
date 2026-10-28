import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collect, coverage, summarize } from '../scripts/lib/bundle.mjs';

const cli = fileURLToPath(new URL('../scripts/aiwp-migrate.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000 });
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-quarantine-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const conversation = (id = 'good', count = 2) => ({
  id, title: `Synthetic label ${id}`, current_node: `n${count - 1}`,
  mapping: Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, {
    id: `n${i}`, parent: i ? `n${i - 1}` : null,
    children: i === count - 1 ? [] : [`n${i + 1}`],
    message: { author: { role: i % 2 ? 'assistant' : 'user' }, content: { content_type: 'text', parts: ['Synthetic content'] } },
  }])),
});

test('valid neighboring chat still builds when other records exceed limits or have malformed graphs', async (t) => {
  const dir = await temporary(t);
  const longText = conversation('long-text');
  longText.mapping.n0.message.content.parts = ['x'.repeat(500_001)];
  const title = conversation('long-title'); title.title = 'x'.repeat(301);
  const orphan = conversation('orphan'); orphan.mapping.n1.parent = 'missing';
  const input = path.join(dir, 'conversations.json');
  await writeFile(input, JSON.stringify([conversation(), conversation('huge', 5_001), longText, title, orphan]));
  const before = await readFile(input);
  const scanned = run('scan', '--export', input, '--categories', 'conversations');
  assert.equal(scanned.status, 0, scanned.stderr);
  const report = JSON.parse(scanned.stdout);
  assert.equal(report.coverage.conversationCounts.sourceRecords, 5);
  assert.equal(report.coverage.conversationCounts.accepted, 1);
  assert.equal(report.coverage.conversationCounts.quarantined, 4);
  assert.equal(report.categories.find((c) => c.category === 'conversations').status, 'partial');
  assert.ok(!scanned.stdout.includes('Synthetic label'));
  const named = run('scan', '--export', input, '--show-titles');
  assert.equal(named.status, 0, named.stderr);
  assert.ok(JSON.parse(named.stdout).coverage.conversationIssues.some((item) => item.title === 'Synthetic label orphan'));
  const out = path.join(dir, 'bundle.json');
  const built = run('build', '--export', input, '--out', out);
  assert.equal(built.status, 0, built.stderr);
  const bundle = JSON.parse(await readFile(out));
  assert.deepEqual(bundle.conversations.map((c) => c.id), ['good']);
  assert.ok(bundle.migrationWarnings.some((warning) => warning.includes('4 conversation(s) quarantined')));
  assert.equal(run('validate', out).status, 0);
  assert.deepEqual(await readFile(input), before);
});

test('all rejected records are partial, not empty-account success; build emits no empty bundle', async (t) => {
  const dir = await temporary(t);
  const bad = conversation(); bad.mapping.n0.parent = 'absent';
  const input = path.join(dir, 'conversations.json');
  await writeFile(input, JSON.stringify([bad]));
  const scanned = run('scan', '--export', input);
  assert.equal(scanned.status, 0, scanned.stderr);
  const report = JSON.parse(scanned.stdout);
  assert.equal(report.categories.find((c) => c.category === 'conversations').status, 'partial');
  assert.equal(report.coverage.conversationCounts.quarantined, 1);
  const out = path.join(dir, 'bundle.json');
  const built = run('build', '--export', input, '--out', out);
  assert.equal(built.status, 1);
  assert.equal(built.stdout, '');
  assert.match(built.stderr, /Conversation collection: 1 quarantined, 0 omitted/);
  assert.match(built.stderr, /Run scan with the same inputs and categories to see the issues/);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('omitted image-only chats remain actionable without exposing bodies or signed title URLs', async (t) => {
  const dir = await temporary(t);
  const imageOnly = conversation('image-only', 1);
  imageOnly.mapping.n0.message.content = { content_type: 'multimodal_text', parts: [{ asset_pointer: 'synthetic-image' }] };
  const signed = conversation('signed', 1);
  signed.title = 'Download:\nhttps://files.oaiusercontent.com/file-test?sig=synthetic-secret';
  signed.mapping.n0.message.content = imageOnly.mapping.n0.message.content;
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, JSON.stringify([imageOnly, signed]));
  const collected = await collect({ exportPath: file });
  assert.equal(summarize(collected).find((c) => c.category === 'conversations').status, 'partial');
  const report = coverage(collected, { showTitles: true });
  assert.equal(report.conversationCounts.omitted, 2);
  assert.ok(report.conversationIssues.some((item) => item.title === imageOnly.title));
  assert.ok(report.conversationIssues.every((item) => item.omissions.user_turn_gaps === 1));
  assert.ok(!JSON.stringify(report).includes('synthetic-secret'));
  assert.ok(!JSON.stringify(coverage(collected)).includes(imageOnly.title));
  const out = path.join(dir, 'bundle.json');
  const built = run('build', '--export', file, '--out', out);
  assert.equal(built.status, 1);
  assert.equal(built.stdout, '');
  assert.match(built.stderr, /Conversation collection: 0 quarantined, 2 omitted/);
  assert.match(built.stderr, /Run scan with the same inputs and categories to see the issues/);
  assert.ok(!built.stderr.includes(imageOnly.title));
  assert.ok(!built.stderr.includes('synthetic-secret'));
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('empty supplied input retains ordinary selection guidance without quarantine claims', async (t) => {
  const dir = await temporary(t);
  const input = path.join(dir, 'conversations.json');
  await writeFile(input, '[]');
  const out = path.join(dir, 'bundle.json');
  const built = run('build', '--export', input, '--out', out);
  assert.equal(built.status, 1);
  assert.equal(built.stdout, '');
  assert.equal(built.stderr, 'Error: No selected data remains. Review inputs, dependencies, and credential exclusions.\n');
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('canonical staged chats quarantine independently and cannot replace an exported ID', async (t) => {
  const dir = await temporary(t);
  const staged = { id: 'staged', title: 'Exact title', messages: [{ id: 'a', parentId: null, role: 'user', text: 'Exact text' }] };
  await writeFile(path.join(dir, 'conversations.json'), JSON.stringify([staged, { ...staged, id: 'bad', messages: [] }]));
  const collected = await collect({ inputsDir: dir });
  assert.deepEqual(collected.conversations.map((c) => c.id), ['staged']);
  assert.equal(coverage(collected).conversationCounts.quarantined, 1);
  const source = path.join(dir, 'export.json');
  await writeFile(source, JSON.stringify([conversation('staged')]));
  await assert.rejects(collect({ exportPath: source, inputsDir: dir }), /Staging does not replace export records/);
});
