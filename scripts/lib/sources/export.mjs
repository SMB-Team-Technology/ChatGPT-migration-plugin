import { open, lstat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { readZip, MAX_INPUT_BYTES } from '../zip.mjs';
import { LIMITS, validateItems } from '../validate.mjs';

const CONVERSATION_FILE = /^conversations(?:-\d+)?\.json$/i;
const MAX_NODES = 100_000;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireShape = (condition, message) => {
  if (!condition) throw new Error(message);
};
const assertExportLayout = (names) => {
  const hasWhole = names.some((name) => /^conversations\.json$/i.test(name));
  const hasSplit = names.some((name) => /^conversations-\d+\.json$/i.test(name));
  requireShape(!(hasWhole && hasSplit), 'Whole and split conversation exports are ambiguous; select one export layout');
};
const validId = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 300;
const parseJson = (bytes) => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Conversation payload is not valid UTF-8 JSON');
  }
};
const date = (value, note) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(new Date(value * 1000).getTime())) {
    note('invalid_timestamps', 'Invalid source timestamps were omitted; no replacement dates were invented.');
    return undefined;
  }
  const iso = new Date(value * 1000).toISOString();
  if (!/^\d{4}-/.test(iso)) {
    note('invalid_timestamps', 'Source timestamps outside the supported four-digit year range were omitted.');
    return undefined;
  }
  return iso;
};
const textOf = (message, note) => {
  const content = message.content;
  if (!object(content)) {
    note('malformed_content_messages', 'Messages with missing or malformed content were omitted.');
    return '';
  }
  if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
    if (!Array.isArray(content.parts)) {
      note('malformed_content_messages', 'Text messages without a parts array were omitted.');
      return '';
    }
    if (content.parts.some((part) => typeof part !== 'string')) {
      note('non_text_parts', 'Non-text message parts, including attachments and images, were omitted.', content.parts.filter((part) => typeof part !== 'string').length);
    }
    return content.parts.filter((part) => typeof part === 'string').join('\n');
  }
  if (content.content_type === 'code' && typeof content.text === 'string') return content.text;
  note('unsupported_content_messages', 'Unsupported structured content and reasoning payloads were omitted.');
  return '';
};

/** Converts mapping nodes without flattening branches or inventing project/GPT associations. */
export const normalizeConversation = (raw) => {
  requireShape(object(raw) && object(raw.mapping), 'Expected a ChatGPT conversation with a mapping object');
  const id = raw.id ?? raw.conversation_id;
  requireShape(validId(id), 'Conversation needs a stable source ID of at most 300 characters');
  requireShape(raw.id === undefined || raw.conversation_id === undefined || raw.id === raw.conversation_id,
    'Conversation source IDs disagree');
  requireShape(raw.title === undefined || raw.title === null || typeof raw.title === 'string', 'Conversation title must be text');
  const warnings = new Set();
  const omissions = {};
  const note = (code, warning, count = 1) => {
    omissions[code] = (omissions[code] ?? 0) + count;
    warnings.add(warning);
  };
  const nodes = new Map(Object.entries(raw.mapping));
  requireShape(nodes.size <= MAX_NODES, 'Conversation exceeds 100,000 mapping nodes');
  const parents = new Map();
  for (const [nodeId, node] of nodes) {
    requireShape(validId(nodeId) && object(node), 'Invalid conversation mapping node');
    requireShape(node.id === undefined || node.id === nodeId, 'Mapping node ID disagrees with its key');
    requireShape(node.parent === null || node.parent === undefined || validId(node.parent), 'Invalid mapping parent ID');
    const parent = node.parent ?? null;
    requireShape(parent === null || nodes.has(parent), 'Conversation has a dangling parent reference');
    parents.set(nodeId, parent);
    if (node.children !== undefined) {
      requireShape(Array.isArray(node.children) && node.children.every(validId), 'Invalid mapping children');
      requireShape(new Set(node.children).size === node.children.length, 'Duplicate mapping child references');
      for (const child of node.children) {
        requireShape(nodes.has(child) && nodes.get(child).parent === nodeId, 'Conversation child references disagree with parents');
      }
    }
  }
  const complete = new Set();
  for (const start of nodes.keys()) {
    const chain = new Set();
    let cursor = start;
    while (cursor !== null && !complete.has(cursor)) {
      requireShape(!chain.has(cursor), 'Conversation contains a parent cycle');
      chain.add(cursor);
      cursor = parents.get(cursor);
    }
    for (const nodeId of chain) complete.add(nodeId);
  }
  const retained = new Map();
  for (const [nodeId, node] of nodes) {
    if (node.message === null || node.message === undefined) continue;
    requireShape(object(node.message), 'Invalid mapping message');
    const message = node.message;
    const role = message.author?.role;
    if (message.metadata?.is_visually_hidden_from_conversation === true) {
      note('hidden_messages', 'Messages marked visually hidden by the source were omitted.');
      continue;
    }
    if ((role !== 'user' && role !== 'assistant') ||
        (message.recipient != null && message.recipient !== 'all') || message.channel === 'analysis') {
      const canvas = typeof message.recipient === 'string' && message.recipient.startsWith('canmore.');
      const code = canvas ? 'canvas_messages' : message.channel === 'analysis' ? 'reasoning_messages'
        : role === 'system' ? 'system_messages' : role === 'tool' ? 'tool_messages' : 'routed_or_unknown_messages';
      note(code, canvas
        ? 'Canvas tool messages (canmore.*) were omitted; Canvas document content is not reconstructed from tool calls.'
        : 'System, tool, internal routing, or reasoning messages were omitted.');
      continue;
    }
    const text = textOf(message, note);
    if (!text.trim()) {
      note('empty_visible_messages', 'Messages without supported visible text were omitted.');
      if (role === 'user') note('user_turn_gaps', 'A user turn with no supported visible text was omitted, leaving a conversation gap.');
      continue;
    }
    if (message.metadata?.citations?.length || message.metadata?.content_references?.length) {
      note('citation_metadata_messages', 'Citation metadata was omitted; original inline text and links are unchanged.');
    }
    if (Array.isArray(message.metadata?.attachments) && message.metadata.attachments.length) note('attachment_files', 'Attached files were not migrated.', message.metadata.attachments.length);
    const createdAt = date(message.create_time, note);
    retained.set(nodeId, { id: nodeId, role, text, ...(createdAt ? { createdAt } : {}) });
  }
  const nearestCache = new Map([[null, null]]);
  const nearest = (start) => {
    const skipped = [];
    let cursor = start;
    while (!nearestCache.has(cursor) && !retained.has(cursor)) {
      skipped.push(cursor);
      cursor = parents.get(cursor);
    }
    const result = retained.has(cursor) ? cursor : nearestCache.get(cursor);
    for (const nodeId of skipped) nearestCache.set(nodeId, result);
    return result;
  };
  const messages = [...retained.values()].map((message) => ({ ...message, parentId: nearest(parents.get(message.id)) }));
  let activeMessageId;
  if (typeof raw.current_node === 'string' && nodes.has(raw.current_node)) {
    activeMessageId = nearest(raw.current_node);
    if (activeMessageId !== raw.current_node) note('active_selection_changed', 'The active source node was omitted; the nearest retained ancestor is selected when available.');
  } else {
    note('active_selection_unavailable', 'The active source branch is unavailable; all retained branches are preserved without guessing a selection.');
  }
  if (raw.is_archived) note('archive_status', 'Source archive status is not applied at the destination.');
  if (raw.gizmo_id) note('gpt_project_metadata', 'GPT/project metadata was not used to infer project membership or GPT configuration.');
  const createdAt = date(raw.create_time, note);
  const updatedAt = date(raw.update_time, note);
  if (!messages.length) note('empty_conversations', 'A conversation with no supported visible messages was omitted.');
  return {
    conversation: {
      id,
      title: raw.title?.trim() ? raw.title : 'Imported ChatGPT chat',
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      messages,
      ...(activeMessageId ? { activeMessageId } : {}),
    },
    warnings: [...warnings],
    omissions,
  };
};

const assertNoSymlink = async (target) => {
  const info = await lstat(target);
  requireShape(!info.isSymbolicLink(), 'Symlink inputs are not supported; select the real export path');
  return info;
};
const readBounded = async (target, budget) => {
  const before = await assertNoSymlink(target);
  requireShape(before.isFile(), 'Input must be a regular file');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    requireShape(info.isFile(), 'Input must be a regular file');
    requireShape(info.size <= budget.remaining, 'Selected input exceeds the 256 MiB input limit');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      requireShape(bytesRead > 0, 'Input changed while reading; select a completed export');
      offset += bytesRead;
    }
    const after = await handle.stat();
    requireShape(after.size === info.size && after.mtimeMs === info.mtimeMs, 'Input changed while reading; select a completed export');
    budget.remaining -= bytes.length;
    return bytes;
  } finally {
    await handle.close();
  }
};
const folderFiles = async (dir, files, warnings, state, depth = 0) => {
  requireShape(depth <= 10, 'Export folder exceeds 10 nesting levels');
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    state.entries++;
    requireShape(state.entries <= 20_000, 'Export folder has too many entries');
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      warnings.add('Symlink entries were not followed.');
      continue;
    }
    if (entry.isDirectory()) await folderFiles(full, files, warnings, state, depth + 1);
    else if (entry.isFile() && CONVERSATION_FILE.test(entry.name)) files.push(full);
  }
};

/** Reads only conversation JSON from an explicitly selected file, completed ZIP, or extracted folder. */
export const readExport = async (target) => {
  const warnings = new Set();
  const sourceFiles = [];
  const payloads = [];
  const budget = { remaining: MAX_INPUT_BYTES };
  const info = await assertNoSymlink(target);
  if (info.isDirectory()) {
    const files = [];
    await folderFiles(target, files, warnings, { entries: 0 });
    requireShape(new Set(files.map((file) => path.dirname(file))).size <= 1, 'Multiple conversation export roots are ambiguous; select one export folder');
    assertExportLayout(files.map((file) => path.basename(file)));
    for (const file of files.sort()) {
      payloads.push(parseJson(await readBounded(file, budget)));
      sourceFiles.push(path.relative(target, file));
    }
  } else if (path.extname(target).toLowerCase() === '.json') {
    payloads.push(parseJson(await readBounded(target, budget)));
    sourceFiles.push(path.basename(target));
  } else if (path.extname(target).toLowerCase() === '.zip') {
    const entries = readZip(await readBounded(target, budget));
    const names = [...entries.keys()].filter((name) => CONVERSATION_FILE.test(name.split('/').at(-1))).sort();
    requireShape(new Set(names.map((name) => path.posix.dirname(name))).size <= 1, 'Multiple conversation export roots are ambiguous; select one export archive');
    assertExportLayout(names.map((name) => path.posix.basename(name)));
    for (const name of names) {
      payloads.push(parseJson(entries.get(name)()));
      sourceFiles.push(name);
    }
  } else {
    throw new Error('Select a completed ChatGPT export ZIP, conversation JSON, or extracted folder');
  }
  requireShape(payloads.length > 0, 'No conversations.json or conversations-NNN.json payload found');
  for (const payload of payloads) {
    requireShape(Array.isArray(payload), 'Expected a ChatGPT conversation array, not an index, bundle, or account metadata');
  }
  const records = payloads.flat();
  requireShape(records.length <= LIMITS.conversations, 'Export exceeds 10,000 conversations');
  requireShape(records.length === 0 || records.some((raw) => object(raw) && object(raw.mapping)),
    'No recognizable ChatGPT conversation mapping object found');
  const seen = new Set();
  for (const raw of records) {
    const sourceIds = object(raw) ? new Set([raw.id, raw.conversation_id].filter(validId)) : new Set();
    for (const id of sourceIds) {
      requireShape(!seen.has(id), 'Duplicate conversation IDs across supplied export payloads');
      seen.add(id);
    }
  }
  const conversations = [];
  const conversationWarnings = [];
  const reject = (reasonCode, reason) => Object.assign(new Error(reason), { reasonCode });
  for (const [index, raw] of records.entries()) {
    const sourceId = object(raw) ? raw.id ?? raw.conversation_id : undefined;
    const identity = {
      ...(validId(sourceId) ? { id: sourceId } : {}),
      sourceIndex: index + 1,
      ...(typeof raw?.title === 'string' ? { title: raw.title } : {}),
    };
    let normalized;
    try {
      normalized = normalizeConversation(raw);
      const chat = normalized.conversation;
      if (chat.title.length > 300) throw reject('title_too_long', 'Conversation title exceeds the supported length; the record was quarantined without truncation.');
      if (chat.messages.length > LIMITS.messages) throw reject('too_many_messages', 'Conversation exceeds the supported message count; the record was quarantined without truncation.');
      if (chat.messages.some((message) => message.text.length > LIMITS.messageChars)) throw reject('message_too_long', 'Conversation contains text exceeding the supported length; the record was quarantined without truncation.');
      if (chat.messages.length) validateItems('conversations', [chat]);
      conversationWarnings.push({ ...identity, warnings: normalized.warnings, omissions: normalized.omissions,
        omitted: chat.messages.length === 0, rejected: false });
      if (chat.messages.length) conversations.push(chat);
    } catch (error) {
      const reasonCode = error.reasonCode ?? (/parent|mapping|child/i.test(error.message) ? 'invalid_graph'
        : /source ID/i.test(error.message) ? 'invalid_source_id' : 'invalid_conversation');
      const reason = error.reasonCode ? error.message : reasonCode === 'invalid_graph'
        ? 'Conversation has an invalid or unsupported message graph; the record was quarantined.'
        : reasonCode === 'invalid_source_id' ? 'Conversation has invalid source identity; the record was quarantined.'
          : 'Conversation does not satisfy the supported schema; the record was quarantined.';
      conversationWarnings.push({ ...identity, warnings: [...(normalized?.warnings ?? []), reason], omissions: { ...(normalized?.omissions ?? {}), [reasonCode]: 1 },
        omitted: true, rejected: true, reasonCode });
    }
  }
  warnings.add('Export parsing does not prove account-wide completeness. Only supported conversation content in the supplied files was collected.');
  warnings.add('Projects, memories, skills, schedules, artifacts, attachments, and Codex history are not automatically collected by this export adapter.');
  return { conversations, warnings: [...warnings], conversationWarnings, sourceFiles };
};
