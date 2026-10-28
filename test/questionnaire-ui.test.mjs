import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const html = await readFile(
  new URL('../ui/categories.html', import.meta.url),
  'utf8',
);
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness({ toolError = false, messageError = false } = {}) {
  const boxes = [...html.matchAll(/type="checkbox" value="([^"]+)"/g)].map(
    (match) => ({ value: match[1], checked: false }),
  );
  const ids = [
    'form',
    'choices',
    'all',
    'clear',
    'continue',
    'status',
    'count',
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        disabled: id === 'continue',
        textContent: '',
        listeners: {},
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        querySelectorAll() {
          return boxes;
        },
      },
    ]),
  );
  const calls = [];
  let receive;
  const parent = {
    postMessage(message) {
      calls.push(message);
      if (message.id === undefined) return;
      queueMicrotask(() => {
        let result = {};
        if (message.method === 'tools/call')
          result = toolError
            ? { isError: true }
            : {
                structuredContent: {
                  categories: message.params.arguments.categories,
                },
              };
        if (message.method === 'ui/message' && messageError) {
          receive({
            source: parent,
            data: { jsonrpc: '2.0', id: message.id, error: { code: -1 } },
          });
          return;
        }
        receive({
          source: parent,
          data: { jsonrpc: '2.0', id: message.id, result },
        });
      });
    },
  };
  const window = {
    parent,
    addEventListener(type, fn) {
      receive = fn;
    },
  };
  const document = {
    getElementById: (id) => elements[id],
    documentElement: { scrollHeight: 700 },
  };
  vm.runInNewContext(code, {
    window,
    document,
    setTimeout,
    clearTimeout,
    console,
  });
  return {
    boxes,
    elements,
    calls,
    click: async (id) => {
      await elements[id].listeners.click?.();
    },
    submit: () => elements.form.listeners.submit({ preventDefault() {} }),
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
test('six independent checkboxes support all, clear and an exact subset; Continue emits one selection', async () => {
  const h = harness();
  await h.settle();
  assert.equal(h.boxes.length, 6);
  assert.equal(h.elements.continue.disabled, true);
  await h.click('all');
  assert.equal(h.boxes.filter((x) => x.checked).length, 6);
  assert.equal(h.elements.continue.disabled, false);
  await h.click('clear');
  assert.equal(h.boxes.filter((x) => x.checked).length, 0);
  assert.equal(h.elements.continue.disabled, true);
  h.boxes[1].checked = true;
  h.boxes[4].checked = true;
  h.elements.choices.listeners.change();
  await h.submit();
  const tool = h.calls.find((x) => x.method === 'tools/call');
  assert.deepEqual(JSON.parse(JSON.stringify(tool.params.arguments)), {
    categories: ['conversations', 'scheduledTasks'],
  });
  const messages = h.calls.filter((x) => x.method === 'ui/message');
  assert.equal(messages.length, 1);
  assert.match(
    messages[0].params.content[0].text,
    /conversations, scheduledTasks/,
  );
  assert.equal(h.elements.continue.textContent, 'Submitted');
  assert.equal(h.elements.choices.disabled, true);
  await h.submit();
  assert.equal(h.calls.filter((x) => x.method === 'ui/message').length, 1);
});
test('no selection cannot submit and no source reading is requested by checkbox interaction', async () => {
  const h = harness();
  await h.settle();
  await h.submit();
  await h.click('all');
  await h.click('clear');
  assert.equal(
    h.calls.filter(
      (x) => x.method === 'tools/call' || x.method === 'ui/message',
    ).length,
    0,
  );
});
test('validation and message failures retain checked choices and allow retry', async () => {
  for (const flags of [{ toolError: true }, { messageError: true }]) {
    const h = harness(flags);
    await h.settle();
    h.boxes[0].checked = true;
    h.elements.choices.listeners.change();
    await h.submit();
    assert.equal(h.boxes[0].checked, true);
    assert.equal(h.elements.continue.disabled, false);
    assert.equal(h.elements.choices.disabled, false);
    assert.match(h.elements.status.textContent, /retry/);
    if (flags.toolError)
      assert.equal(h.calls.filter((x) => x.method === 'ui/message').length, 0);
  }
});
