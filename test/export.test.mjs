import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readExport, normalizeConversation } from '../scripts/lib/sources/export.mjs';

const fixturePath = new URL('./fixtures/chatgpt-synthetic.json', import.meta.url);
const sample = async () => JSON.parse(await readFile(fixturePath, 'utf8'))[0];
const temporary = async (fn) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-export-test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('preserves all branches, bridges excluded parents and selects original active branch', async () => {
  const { conversation, warnings } = normalizeConversation(await sample());
  assert.deepEqual(conversation.messages.map(({ id, parentId }) => [id, parentId]), [
    ['question', null], ['answer-a', 'question'], ['answer-b', 'question'],
  ]);
  assert.equal(conversation.activeMessageId, 'answer-b');
  assert.equal(conversation.messages[0].text, 'Hello 世界 — keep https://example.com');
  assert.equal(conversation.messages[1].text, "console.log('A');");
  assert.equal(conversation.createdAt, '2023-11-14T22:13:20.000Z');
  assert.ok(warnings.some((warning) => warning.includes('System, tool')));
});

test('rejects dangling parents, cycles, conflicting IDs, and inconsistent child references', async () => {
  const base = await sample();
  const dangling = structuredClone(base);
  dangling.mapping.question.parent = 'missing';
  for (const node of Object.values(dangling.mapping)) delete node.children;
  assert.throws(() => normalizeConversation(dangling), /dangling parent/);
  const cyclic = structuredClone(base);
  for (const node of Object.values(cyclic.mapping)) delete node.children;
  cyclic.mapping.root.parent = 'answer-a';
  assert.throws(() => normalizeConversation(cyclic), /parent cycle/);
  assert.throws(() => normalizeConversation({ ...base, conversation_id: 'another' }), /IDs disagree/);
  const wrongChild = structuredClone(base);
  wrongChild.mapping.root.children.push('answer-a');
  assert.throws(() => normalizeConversation(wrongChild), /children|child references/);
});

test('missing or omitted active nodes never choose a random alternative', async () => {
  const base = await sample();
  const omitted = normalizeConversation({ ...base, current_node: 'tool' });
  assert.equal(omitted.conversation.activeMessageId, 'question');
  assert.ok(omitted.warnings.some((warning) => warning.includes('active source node')));
  const missing = normalizeConversation({ ...base, current_node: 'unknown' });
  assert.equal(missing.conversation.activeMessageId, undefined);
  assert.equal(missing.conversation.messages.length, 3);
  assert.ok(missing.warnings.some((warning) => warning.includes('without guessing')));
});

test('reports structured/attachment omissions while retaining available text', async () => {
  const base = await sample();
  base.mapping.question.message.content = { content_type: 'multimodal_text', parts: ['Caption', { image_asset_pointer: 'synthetic' }] };
  base.mapping['answer-a'].message.content = { content_type: 'new_future_type', secret: 'DO NOT PRINT' };
  base.mapping['answer-b'].message.metadata = { citations: [{ url: 'https://example.com' }] };
  const result = normalizeConversation(base);
  assert.deepEqual(result.conversation.messages.map((m) => m.id), ['question', 'answer-b']);
  assert.equal(result.conversation.messages[0].text, 'Caption');
  assert.ok(result.warnings.some((w) => w.includes('Non-text')));
  assert.ok(result.warnings.some((w) => w.includes('Citation')));
  assert.ok(!JSON.stringify(result).includes('DO NOT PRINT'));
});

test('omits invalid timestamps instead of substituting current time', async () => {
  const base = await sample();
  base.create_time = 'yesterday';
  base.mapping.question.message.create_time = 1e30;
  const result = normalizeConversation(base);
  assert.equal(result.conversation.createdAt, undefined);
  assert.equal(result.conversation.messages[0].createdAt, undefined);
  assert.ok(result.warnings.some((w) => w.includes('timestamps')));
});

test('reads explicitly selected JSON and nested split conversation files', async () => temporary(async (dir) => {
  const a = await sample();
  const b = { ...a, id: 'second', conversation_id: 'second' };
  await mkdir(path.join(dir, 'nested'));
  await writeFile(path.join(dir, 'nested', 'conversations-000.json'), JSON.stringify([a]));
  await writeFile(path.join(dir, 'nested', 'conversations-001.json'), JSON.stringify([b]));
  await writeFile(path.join(dir, 'users.json'), 'This account metadata is not read');
  const result = await readExport(dir);
  assert.deepEqual(result.conversations.map((c) => c.id), ['synthetic-chat', 'second']);
  assert.equal(result.sourceFiles.length, 2);
  const direct = await readExport(path.join(dir, 'nested', 'conversations-000.json'));
  assert.equal(direct.conversations.length, 1);
}));

test('rejects duplicate conversations across export files', async () => temporary(async (dir) => {
  const content = JSON.stringify([await sample()]);
  await writeFile(path.join(dir, 'conversations-000.json'), content);
  await writeFile(path.join(dir, 'conversations-001.json'), content);
  await assert.rejects(readExport(dir), /Duplicate conversation IDs/);
}));

test('rejects whole and split payloads in one folder before reading their contents', async () => temporary(async (dir) => {
  const a = await sample();
  const b = { ...a, id: 'second-account', conversation_id: 'second-account' };
  for (const [index, names] of [
    ['conversations.json', 'conversations-000.json'],
    ['CONVERSATIONS.JSON', 'Conversations-000.JSON'],
  ].entries()) {
    const nested = path.join(dir, String(index));
    await mkdir(nested);
    const whole = path.join(nested, names[0]);
    await writeFile(whole, JSON.stringify([a]));
    const wholeOnly = await readExport(nested);
    assert.deepEqual(wholeOnly.conversations.map((chat) => chat.id), [a.id]);
    await writeFile(path.join(nested, names[1]), JSON.stringify([b]));
    await assert.rejects(readExport(nested), /Whole and split conversation exports are ambiguous/);
    const direct = await readExport(whole);
    assert.deepEqual(direct.conversations.map((chat) => chat.id), [a.id]);
    await writeFile(whole, 'Not valid JSON');
    await assert.rejects(readExport(nested), /Whole and split conversation exports are ambiguous/);
  }
}));

test('rejects manifests, malformed JSON and unrecognized payload shape without leaking contents', async () => temporary(async (dir) => {
  const file = path.join(dir, 'export.json');
  for (const [content, pattern] of [
    [JSON.stringify({ export_url: 'SECRET URL', data_files: [] }), /Expected a ChatGPT conversation array/],
    ['[SECRET STRING', /not valid UTF-8 JSON/],
    [JSON.stringify([{ uuid: 'claude-chat', chat_messages: [] }]), /mapping object/],
  ]) {
    await writeFile(file, content);
    await assert.rejects(readExport(file), (error) => pattern.test(error.message) && !error.message.includes('SECRET'));
  }
}));

test('does not follow input or directory symlinks', async () => temporary(async (dir) => {
  const real = path.join(dir, 'actual.json');
  await writeFile(real, JSON.stringify([await sample()]));
  const link = path.join(dir, 'conversations.json');
  await symlink(real, link);
  await assert.rejects(readExport(link), /Symlink/);
  await assert.rejects(readExport(dir), /No conversations/);
}));

test('keeps account completeness unknown for empty exports', async () => temporary(async (dir) => {
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, '[]');
  const result = await readExport(file);
  assert.deepEqual(result.conversations, []);
  assert.ok(result.warnings.some((warning) => warning.includes('does not prove account-wide completeness')));
}));

test('handles deep excluded ancestry iteratively', () => {
  const mapping = {};
  for (let i = 0; i < 12_000; i++) mapping[`n${i}`] = { parent: i ? `n${i - 1}` : null, message: null };
  mapping.answer = { parent: 'n11999', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Visible answer'] } } };
  const result = normalizeConversation({ id: 'deep', mapping, current_node: 'answer' });
  assert.equal(result.conversation.messages[0].parentId, null);
});

test('separates clean, partial and omitted chat warnings from global limitations', async () => temporary(async (dir) => {
  const clean = {
    id: 'clean', title: '  Original title spacing  ', current_node: 'a',
    mapping: {
      q: { parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } } },
      a: { parent: 'q', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer'] } } },
    },
  };
  const partial = await sample();
  const omitted = {
    id: 'omitted-source-identifier', current_node: 'internal', mapping: {
      internal: { parent: null, message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['Not collected'] } } },
    },
  };
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, JSON.stringify([clean, partial, omitted]));
  const result = await readExport(file);
  assert.deepEqual(result.conversationWarnings.find((entry) => entry.id === 'clean').warnings, []);
  assert.equal(result.conversations.find((chat) => chat.id === 'clean').title, '  Original title spacing  ');
  assert.ok(result.conversationWarnings.find((entry) => entry.id === partial.id).warnings.some((warning) => warning.includes('System, tool')));
  assert.ok(result.conversationWarnings.find((entry) => entry.id === 'omitted-source-identifier').warnings.some((warning) => warning.includes('no supported visible messages')));
  assert.equal(result.conversations.some((chat) => chat.id === 'omitted-source-identifier'), false);
  assert.equal(result.warnings.some((warning) => warning.includes('System, tool')), false);
  assert.equal(result.conversationWarnings.some((entry) => entry.warnings.some((warning) => warning.includes(entry.id))), false);
  assert.deepEqual(result.conversations.find((chat) => chat.id === partial.id).messages.map(({ id, parentId, text }) => ({ id, parentId, text })), [
    { id: 'question', parentId: null, text: 'Hello 世界 — keep https://example.com' },
    { id: 'answer-a', parentId: 'question', text: "console.log('A');" },
    { id: 'answer-b', parentId: 'question', text: 'Alternative B' },
  ]);
}));

test('omits visually hidden messages and bridges their visible descendants', () => {
  const source = {
    id: 'visibility-test', current_node: 'answer', mapping: {
      question: { parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Visible question'] } } },
      hidden: { parent: 'question', message: { author: { role: 'assistant' }, metadata: { is_visually_hidden_from_conversation: true }, content: { content_type: 'text', parts: ['Hidden content must not appear'] } } },
      answer: { parent: 'hidden', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Visible answer'] } } },
    },
  };
  const result = normalizeConversation(source);
  assert.deepEqual(result.conversation.messages.map(({ id, parentId }) => [id, parentId]), [['question', null], ['answer', 'question']]);
  assert.ok(result.warnings.some((warning) => warning.includes('visually hidden')));
  assert.equal(JSON.stringify(result.conversation).includes('Hidden content must not appear'), false);
  const hiddenActive = normalizeConversation({ ...source, current_node: 'hidden' });
  assert.equal(hiddenActive.conversation.activeMessageId, 'question');
});

test('preserves visible user and assistant messages with null recipient', () => {
  const result = normalizeConversation({
    id: 'null-recipient', current_node: 'answer', mapping: {
      question: { parent: null, message: { recipient: null, author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } } },
      answer: { parent: 'question', message: { recipient: null, author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer'] } } },
    },
  });
  assert.deepEqual(result.conversation.messages.map((message) => message.text), ['Question', 'Answer']);
  assert.deepEqual(result.warnings, []);
});

test('rejects a FIFO input promptly without blocking on open', { skip: process.platform === 'win32' }, async () => temporary(async (dir) => {
  const file = path.join(dir, 'conversations.json');
  const fifo = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 2000 });
  assert.equal(fifo.status, 0, fifo.stderr);
  const script = 'const { readExport } = await import(process.argv[1]); await readExport(process.argv[2]);';
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script, new URL('../scripts/lib/sources/export.mjs', import.meta.url).href, file], {
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.error, undefined, 'Input processing must complete rather than time out');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Input must be a regular file/);
}));

const simpleChat = (id, text = 'Visible message') => ({
  id, title: `Exact title for ${id}`, current_node: 'm',
  mapping: { m: { parent: null, message: { author: { role: 'user' }, content: { content_type: 'text', parts: [text] } } } },
});

test('quarantines invalid or oversized chats while preserving valid neighbors without truncation', async () => temporary(async (dir) => {
  const valid = simpleChat('valid');
  const huge = simpleChat('message-count');
  huge.mapping = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`m${i}`, {
    parent: i ? `m${i - 1}` : null,
    message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Message'] } },
  }]));
  huge.current_node = 'm5000';
  const longText = simpleChat('long-text', 'x'.repeat(500_001));
  const longTitle = { ...simpleChat('long-title'), title: 't'.repeat(301) };
  const cycle = simpleChat('cycle'); cycle.mapping.m.parent = 'm';
  const orphan = simpleChat('orphan'); orphan.mapping.m.parent = 'missing';
  const malformed = { id: 'malformed', title: 'Retain source title for internal review', mapping: null };
  const timestamp = { ...simpleChat('extended-year'), create_time: 253402300800 };
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, JSON.stringify([valid, huge, longText, longTitle, cycle, orphan, malformed, timestamp]));
  const result = await readExport(file);
  assert.deepEqual(result.conversations.map((chat) => chat.id), ['valid', 'extended-year']);
  assert.equal(result.conversations[1].createdAt, undefined);
  assert.deepEqual(result.conversationWarnings.map((entry) => entry.sourceIndex), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(result.conversationWarnings.filter((entry) => entry.rejected).map((entry) => entry.reasonCode), [
    'too_many_messages', 'message_too_long', 'title_too_long', 'invalid_graph', 'invalid_graph', 'invalid_graph',
  ]);
  assert.equal(result.conversationWarnings[3].title, longTitle.title);
  assert.equal(result.conversationWarnings[7].omissions.invalid_timestamps, 1);
  assert.ok(result.conversationWarnings.filter((entry) => entry.rejected).every((entry) => entry.omitted && entry.omissions[entry.reasonCode] === 1));
  assert.equal(result.conversationWarnings.flatMap((entry) => entry.warnings).some((warning) => warning.includes('Retain source title')), false);
}));

test('duplicate raw source identities remain fatal even when one record would be quarantined', async () => temporary(async (dir) => {
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, JSON.stringify([{ ...simpleChat('same'), title: 'x'.repeat(301) }, simpleChat('same')]));
  await assert.rejects(readExport(file), /Duplicate conversation IDs/);
}));

test('reports Canvas and missing user-turn omissions with counts and exact internal titles', async () => temporary(async (dir) => {
  const source = {
    id: 'PRIVATE_SOURCE_ID', title: 'Private exact title', current_node: 'answer', mapping: {
      image: { parent: null, message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [{ image_asset_pointer: 'private-image' }] } } },
      canvas: { parent: 'image', message: { author: { role: 'assistant' }, recipient: 'canmore.update_textdoc', content: { content_type: 'text', parts: ['private-canvas'] } } },
      answer: { parent: 'canvas', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Kept answer'] } } },
    },
  };
  const empty = { ...simpleChat('image-only'), current_node: 'm' };
  empty.mapping.m.message.content = { content_type: 'multimodal_text', parts: [{ image_asset_pointer: 'another-image' }] };
  const file = path.join(dir, 'conversations.json');
  await writeFile(file, JSON.stringify([source, empty]));
  const result = await readExport(file);
  assert.deepEqual(result.conversations[0].messages.map(({ id, parentId, text }) => ({ id, parentId, text })), [
    { id: 'answer', parentId: null, text: 'Kept answer' },
  ]);
  const outcome = result.conversationWarnings[0];
  assert.equal(outcome.title, source.title);
  assert.equal(outcome.omissions.canvas_messages, 1);
  assert.equal(outcome.omissions.user_turn_gaps, 1);
  assert.equal(outcome.omissions.non_text_parts, 1);
  assert.ok(outcome.warnings.some((warning) => warning.includes('Canvas')));
  assert.ok(outcome.warnings.some((warning) => warning.includes('conversation gap')));
  assert.equal(outcome.warnings.join(' ').includes(source.id), false);
  assert.equal(outcome.warnings.join(' ').includes(source.title), false);
  assert.equal(result.conversationWarnings[1].omitted, true);
  assert.equal(result.conversationWarnings[1].rejected, false);
  assert.equal(result.conversationWarnings[1].omissions.empty_conversations, 1);
}));

test('rejects multiple export roots in a folder even with disjoint source IDs', async () => temporary(async (dir) => {
  await mkdir(path.join(dir, 'account-a'));
  await mkdir(path.join(dir, 'account-b'));
  await writeFile(path.join(dir, 'account-a', 'conversations.json'), JSON.stringify([simpleChat('a')]));
  await writeFile(path.join(dir, 'account-b', 'conversations-000.json'), JSON.stringify([simpleChat('b')]));
  await assert.rejects(readExport(dir), /Multiple conversation export roots/);
}));
