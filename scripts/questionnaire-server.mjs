#!/usr/bin/env node
// Small, bounded MCP stdio surface: no network, user-file access, or persisted state.
import { readFile } from 'node:fs/promises';
import { GENERATOR, CATEGORIES } from './lib/bundle.mjs';
const uri = 'ui://chatgpt-migration/categories.html';
const mimeType = 'text/html;profile=mcp-app';
const html = await readFile(
  new URL('../ui/categories.html', import.meta.url),
  'utf8',
);
const choices = [
  [
    'projects',
    'Projects',
    'Supplied instructions and text context; original files handled separately.',
  ],
  [
    'conversations',
    'Chats',
    'Supported conversation text and branches from your export.',
  ],
  ['memories', 'Memories', 'Exact saved memories you supply.'],
  [
    'skills',
    'Skills',
    'Authorized instructions and supporting text resources you supply.',
  ],
  [
    'scheduledTasks',
    'Scheduled tasks',
    'Exact prompts and schedules you supply; tasks remain paused.',
  ],
  [
    'artifacts',
    'Artifacts',
    'Actual document or Canvas content you supply, not just links.',
  ],
].map(([id, label, description]) => ({ id, label, description }));
const inputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const result = (data, text) => ({
  content: [{ type: 'text', text }],
  structuredContent: data,
});
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
const tools = [
  {
    name: 'choose_migration_categories',
    description:
      'Open the six-checkbox migration category form. Wait for the user to click Continue before collecting data. Do not replace this form with single-choice questions.',
    inputSchema,
    annotations,
    _meta: { ui: { resourceUri: uri }, 'openai/outputTemplate': uri },
  },
  {
    name: 'confirm_migration_categories',
    description:
      'Validate the category choices submitted by the checkbox form. Does not collect, save, upload or import data.',
    annotations,
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string', enum: CATEGORIES },
          minItems: 1,
          maxItems: 6,
          uniqueItems: true,
        },
      },
      required: ['categories'],
      additionalProperties: false,
    },
    _meta: { ui: { visibility: ['app'] } },
  },
];
let initialized = false;
let ready = false;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function dispatch(request) {
  if (
    !request ||
    Array.isArray(request) ||
    request.jsonrpc !== '2.0' ||
    typeof request.method !== 'string'
  )
    return { error: { code: -32600, message: 'Invalid request' } };
  const { method, params = {} } = request;
  if (method === 'initialize') {
    initialized = true;
    return {
      result: {
        protocolVersion: [
          '2025-11-25',
          '2025-06-18',
          '2025-03-26',
          '2024-11-05',
        ].includes(params.protocolVersion)
          ? params.protocolVersion
          : '2025-11-25',
        capabilities: { tools: {}, resources: {} },
        serverInfo: {
          name: 'chatgpt-migration-questionnaire',
          version: GENERATOR.version,
        },
      },
    };
  }
  if (method === 'notifications/initialized') {
    ready = initialized;
    return;
  }
  if (method.startsWith('notifications/')) return;
  if (method === 'ping') return { result: {} };
  if (!ready)
    return { error: { code: -32002, message: 'Initialize the server first' } };
  if (method === 'tools/list') return { result: { tools } };
  if (method === 'resources/list')
    return {
      result: { resources: [{ uri, name: 'Migration categories', mimeType }] },
    };
  if (method === 'resources/templates/list')
    return { result: { resourceTemplates: [] } };
  if (method === 'resources/read')
    return params.uri === uri
      ? {
          result: {
            contents: [
              {
                uri,
                mimeType,
                text: html,
                _meta: {
                  ui: {
                    prefersBorder: true,
                    csp: { connectDomains: [], resourceDomains: [] },
                  },
                },
              },
            ],
          },
        }
      : { error: { code: -32602, message: 'Unknown resource' } };
  if (method === 'tools/call') {
    const args = params.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return { result: fail('Expected an argument object.') };
    if (params.name === 'choose_migration_categories')
      return {
        result: Object.keys(args).length
          ? fail('This form takes no arguments.')
          : result(
              { choices, selected: [] },
              'Choose one or more categories in the form and click Continue. Wait for the selection before asking the next question.',
            ),
      };
    if (params.name === 'confirm_migration_categories') {
      const ids = args.categories;
      if (
        Object.keys(args).length !== 1 ||
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 6 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !CATEGORIES.includes(id))
      )
        return {
          result: fail(
            'Select one or more of the six supported categories, without duplicates.',
          ),
        };
      const categories = CATEGORIES.filter((id) => ids.includes(id));
      return {
        result: result(
          {
            categories,
            categoryLabels: categories.map(
              (id) => choices.find((choice) => choice.id === id).label,
            ),
          },
          'Category choices validated. No data has been collected or imported.',
        ),
      };
    }
    return { error: { code: -32602, message: 'Unknown tool' } };
  }
  return { error: { code: -32601, message: 'Method not found' } };
}
// Serialize requests and cap line size; stdout contains protocol messages only.
let buffer = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (Buffer.byteLength(line) > 65536) {
      process.exitCode = 1;
      process.stdin.destroy();
      break;
    }
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      continue;
    }
    try {
      const response = await dispatch(request);
      if (response && Object.hasOwn(request ?? {}, 'id'))
        send({ jsonrpc: '2.0', id: request.id, ...response });
    } catch {
      if (Object.hasOwn(request ?? {}, 'id'))
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: 'Questionnaire request failed' },
        });
    }
  }
  if (Buffer.byteLength(buffer) > 65536) {
    process.exitCode = 1;
    process.stdin.destroy();
    break;
  }
}
