import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(
  new URL('../scripts/questionnaire-server.mjs', import.meta.url),
);
const categories = [
  'projects',
  'conversations',
  'memories',
  'skills',
  'scheduledTasks',
  'artifacts',
];
async function exchange(requests) {
  const child = spawn(process.execPath, [server], {
    cwd: '/private/tmp',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exit = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  child.stdin.end(
    requests
      .map((request) =>
        typeof request === 'string' ? request : JSON.stringify(request),
      )
      .join('\n') + '\n',
  );
  assert.equal(await exit, 0, stderr);
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const init = [
  {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];
const call = (id, name, args = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
test('installed server discovers checkbox resource from unrelated cwd and starts unselected', async () => {
  const replies = await exchange([
    ...init,
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    call(2, 'choose_migration_categories'),
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'ui://chatgpt-migration/categories.html' },
    },
  ]);
  assert.equal(replies[0].result.protocolVersion, '2025-11-25');
  assert.equal(
    replies[1].result.tools[0]._meta.ui.resourceUri,
    'ui://chatgpt-migration/categories.html',
  );
  assert.deepEqual(replies[1].result.tools[1]._meta.ui.visibility, ['app']);
  assert.deepEqual(replies[2].result.structuredContent.selected, []);
  assert.deepEqual(
    replies[2].result.structuredContent.choices.map((x) => x.id),
    categories,
  );
  const resource = replies[3].result.contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.equal((resource.text.match(/type="checkbox"/g) || []).length, 6);
});
test('accepts every nonempty subset without adding categories or sharing selections across forms', async () => {
  const selections = Array.from({ length: 63 }, (_, i) =>
    categories.filter((_, index) => (i + 1) & (1 << index)),
  );
  const replies = await exchange([
    ...init,
    ...selections.map((selection, i) =>
      call(i + 1, 'confirm_migration_categories', { categories: selection }),
    ),
    call(100, 'choose_migration_categories'),
  ]);
  selections.forEach((selection, i) =>
    assert.deepEqual(
      replies[i + 1].result.structuredContent.categories,
      selection,
    ),
  );
  assert.deepEqual(replies.at(-1).result.structuredContent.selected, []);
});
test('rejects invalid, duplicate, empty and additional arguments without reflecting user content', async () => {
  const invalid = [
    {},
    { categories: [] },
    { categories: ['private-invalid-value'] },
    { categories: ['skills', 'skills'] },
    { categories: 'skills' },
    { categories: ['skills'], extra: 'private-invalid-value' },
    null,
  ];
  const replies = await exchange([
    ...init,
    ...invalid.map((args, i) =>
      call(i + 1, 'confirm_migration_categories', args),
    ),
  ]);
  for (const reply of replies.slice(1)) {
    assert.equal(reply.result.isError, true);
    assert.ok(!JSON.stringify(reply).includes('private-invalid-value'));
  }
});
test('rejects arbitrary resource reads, unknown tools, and uninitialized calls', async () => {
  const replies = await exchange([
    call(9, 'choose_migration_categories'),
    ...init,
    call(10, 'run_shell', { command: 'private-command' }),
    {
      jsonrpc: '2.0',
      id: 11,
      method: 'resources/read',
      params: { uri: 'file:///etc/passwd' },
    },
    '{bad json',
  ]);
  assert.equal(replies[0].error.code, -32002);
  assert.equal(replies[2].error.code, -32602);
  assert.equal(replies[3].error.code, -32602);
  assert.equal(replies[4].error.code, -32700);
});
