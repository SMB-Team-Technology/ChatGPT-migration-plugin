import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_FORMAT, LIMITS, validateBundle, validateItems } from '../scripts/lib/validate.mjs';

const date = '2026-10-28T12:00:00.000Z';
const chat = () => ({
  id: 'chat-1', title: 'Synthetic branching example', activeMessageId: 'right',
  messages: [
    { id: 'root', parentId: null, role: 'user', text: 'Synthetic question', createdAt: date },
    { id: 'left', parentId: 'root', role: 'assistant', text: 'First alternative' },
    { id: 'right', parentId: 'root', role: 'assistant', text: 'Second alternative' },
  ],
});
const bundle = (extra = {}) => ({
  format: BUNDLE_FORMAT, version: 1, createdAt: date,
  generator: { name: 'chatgpt-migration-plugin', version: '0.1.0' },
  conversations: [chat()], ...extra,
});
const task = () => ({
  id: 'task-1', name: 'Synthetic weekday reminder', prompt: 'Use this literal prompt',
  scheduleType: 'recurring', cron: '0 8 * * 1-5', timezone: 'America/Los_Angeles', enabled: false,
});

test('accepts all canonical categories without rewriting literal source content', () => {
  const original = bundle({
    projects: [{ id: 'project-1', name: 'Synthetic project', description: 'Literal description', instructions: '  exact instructions\n', context: '' }],
    memories: [{ id: 'memory-1', value: '  exact memory\n', key: 'Preference' }],
    skills: [{ id: 'skill-1', name: 'Synthetic skill', description: '', content: '---\nname: example\n---\n', files: [{ path: 'references/example.md', content: '  exact reference\n' }] }],
    scheduledTasks: [task()],
    artifacts: [{ id: 'artifact-1', title: 'Example', type: 'text/markdown', content: 'Exact content', conversationId: 'chat-1' }],
    migrationWarnings: ['Synthetic coverage warning'],
  });
  original.conversations[0].projectId = 'project-1';
  const before = JSON.stringify(original);
  assert.equal(validateBundle(original), original);
  assert.equal(JSON.stringify(original), before);
});

test('rejects incomplete and empty bundles', () => {
  assert.throws(() => validateBundle(bundle({ conversations: [{ id: 'sample' }] })), /title/);
  assert.throws(() => validateBundle(bundle({ conversations: [] })), /no selected items/);
  assert.throws(() => validateBundle(bundle({ conversations: null })), /must be a list/);
  assert.throws(() => validateBundle(bundle({ version: 2 })), /unsupported bundle version/);
  assert.throws(() => validateBundle(bundle({ format: 'claude-migration-bundle' })), /not a ChatGPT migration bundle/);
});

test('rejects unknown fields at every level without disclosing arbitrary keys or content', () => {
  for (const mutate of [
    (value) => { value['PRIVATE-KEY-NAME'] = 'PRIVATE-CONTENT'; },
    (value) => { value.generator['PRIVATE-KEY-NAME'] = 'PRIVATE-CONTENT'; },
    (value) => { value.conversations[0]['PRIVATE-KEY-NAME'] = 'PRIVATE-CONTENT'; },
    (value) => { value.conversations[0].messages[0]['PRIVATE-KEY-NAME'] = 'PRIVATE-CONTENT'; },
  ]) {
    const value = bundle(); mutate(value);
    assert.throws(() => validateBundle(value), (error) => {
      assert.match(error.message, /unsupported fields/);
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    });
  }
});

test('graph validation preserves branches and rejects malformed parent relationships', () => {
  for (const [mutate, reason] of [
    [(value) => { value.messages[2].id = 'left'; }, /duplicate message id/],
    [(value) => { value.messages[2].parentId = 'missing'; }, /missing parent/],
    [(value) => { value.messages[0].parentId = 'left'; }, /parent cycle/],
    [(value) => { value.messages[0].parentId = 'root'; }, /parent cycle/],
    [(value) => { delete value.messages[0].parentId; }, /parentId/],
    [(value) => { value.activeMessageId = 'missing'; }, /retained message/],
  ]) {
    const value = chat(); mutate(value);
    assert.throws(() => validateItems('conversations', [value]), reason);
  }
  assert.equal(validateItems('conversations', [chat()])[0].messages.length, 3);
});

test('graph validation is iterative on a full 5,000-node chain', () => {
  const value = chat();
  value.messages = Array.from({ length: LIMITS.messages }, (_, index) => ({
    id: `message-${index}`, parentId: index ? `message-${index - 1}` : null,
    role: index % 2 ? 'assistant' : 'user', text: 'Synthetic',
  }));
  value.activeMessageId = 'message-4999';
  assert.equal(validateItems('conversations', [value])[0], value);
  value.messages.push({ id: 'extra', parentId: 'message-4999', role: 'user', text: 'Extra' });
  assert.throws(() => validateItems('conversations', [value]), /5000/);
});

test('does not silently coerce roles or admit contentless messages', () => {
  const value = chat();
  value.messages[0].role = 'tool';
  assert.throws(() => validateItems('conversations', [value]), /user or assistant/);
  value.messages[0].role = 'user';
  value.messages[0].thinking = 'Should not be user thinking';
  assert.throws(() => validateItems('conversations', [value]), /only for assistant/);
  delete value.messages[0].thinking;
  value.messages[0].text = '  ';
  assert.throws(() => validateItems('conversations', [value]), /no supported visible content/);
  value.messages[0].role = 'assistant';
  value.messages[0].thinking = 'Visible exported content';
  validateItems('conversations', [value]);
});

test('validates IDs, count and text boundaries without exposing source values', () => {
  assert.throws(() => validateItems('memories', [{ id: 'same', value: 'one' }, { id: 'same', value: 'two' }]), /duplicate item id/);
  assert.throws(() => validateItems('memories', [{ id: ' ', value: 'one' }]), /must not be empty/);
  assert.throws(() => validateItems('memories', Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, value: 'x' }))), /500/);
  assert.throws(() => validateItems('projects', [{ id: 'project', name: 'x'.repeat(129), instructions: '', context: '' }]), /128/);
  const value = chat(); value.messages[0].text = 'x'.repeat(LIMITS.messageChars + 1);
  assert.throws(() => validateItems('conversations', [value]), /500000/);
  assert.throws(() => validateItems('private-category', []), /unknown category/);
});

test('timestamps require explicit zones and valid calendar dates', () => {
  for (const invalid of ['2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-28', '2026-10-28T12:00:00', '2026-10-28T24:00:00Z', '2026-10-28T12:00:00+25:00']) {
    assert.throws(() => validateBundle(bundle({ createdAt: invalid })), /timestamp/);
  }
  validateBundle(bundle({ createdAt: '2024-02-29T23:59:59.123456+05:30' }));
});

test('validates all cross-category references only when constructing the full bundle', () => {
  const value = chat(); value.projectId = 'not-collected';
  validateItems('conversations', [value]);
  assert.throws(() => validateBundle(bundle({ conversations: [value] })), /project not included/);
  const artifact = { id: 'artifact', title: 'Example', type: 'text/plain', content: 'Example', conversationId: 'not-collected' };
  validateItems('artifacts', [artifact]);
  assert.throws(() => validateBundle(bundle({ artifacts: [artifact] })), /conversation not included/);
});

test('supports paused numeric cron expressions, rejecting ambiguous or invalid schedules', () => {
  for (const expression of ['0 8 * * 1-5', '*/15 8-17 * 1,3,12 0,7', '1-30/2 * * * *']) {
    validateItems('scheduledTasks', [{ ...task(), cron: expression }]);
  }
  for (const expression of ['@daily', 'RRULE:FREQ=DAILY', '0 8 * * MON', '0 8 * * * *', '60 8 * * *', '0 24 * * *', '0 8 0 * *', '0 8 * 13 *', '0 8 * * 8', '*/0 * * * *', '*/61 * * * *', '5-1 * * * *', '0,,1 * * * *']) {
    assert.throws(() => validateItems('scheduledTasks', [{ ...task(), cron: expression }]), /cron/);
  }
  assert.throws(() => validateItems('scheduledTasks', [{ ...task(), timezone: 'PRIVATE-INVALID-ZONE' }]), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE/); return /timezone/.test(error.message);
  });
  assert.throws(() => validateItems('scheduledTasks', [{ ...task(), enabled: true }]), /paused/);
  assert.throws(() => validateItems('scheduledTasks', [{ ...task(), runAt: date }]), /cannot also/);
  const once = { ...task(), scheduleType: 'once', runAt: date }; delete once.cron;
  validateItems('scheduledTasks', [once]);
  assert.throws(() => validateItems('scheduledTasks', [{ ...once, cron: '* * * * *' }]), /cannot also/);
});

test('supporting files reject absolute, traversal, Windows and duplicate paths', () => {
  const skill = { id: 'skill', name: 'Example', description: '', content: 'Exact skill', files: [] };
  for (const filePath of ['/tmp/file', '../file', 'references/../file', './file', 'references//file', 'C:/file', 'references\\file', 'file\u0000.md']) {
    assert.throws(() => validateItems('skills', [{ ...skill, files: [{ path: filePath, content: '' }] }]), /safe relative file path/);
  }
  assert.throws(() => validateItems('skills', [{ ...skill, files: [{ path: 'a.md', content: 'a' }, { path: 'a.md', content: 'b' }] }]), /duplicate supporting file/);
  validateItems('skills', [{ ...skill, files: [{ path: 'references/例.md', content: '原文' }] }]);
});

test('caps total payload bytes even when each individual record is valid', () => {
  const value = bundle({ memories: Array.from({ length: 30 }, (_, i) => ({ id: `m-${i}`, value: 'x'.repeat(1_000_000) })) });
  assert.throws(() => validateBundle(value), /25 MiB/);
});
