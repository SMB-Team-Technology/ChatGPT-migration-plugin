import { GENERATOR } from './metadata.mjs';
import { createHash } from 'node:crypto';
import { readExport } from './sources/export.mjs';
import { readStaged } from './sources/staged.mjs';
import { findSecret, findSecretIn } from './secrets.mjs';
import { BUNDLE_FORMAT, BUNDLE_VERSION, CATEGORIES, validateItems, validateBundle } from './validate.mjs';

export { CATEGORIES, validateBundle };
export { GENERATOR };
const empty = () => Object.fromEntries(CATEGORIES.map((category) => [category, []]));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const itemKey = (category, item) => `${category}:${createHash('sha256').update(JSON.stringify(canonical(item))).digest('hex')}`;
const sourceKey = (item) => createHash('sha256').update(JSON.stringify([item.origin, item.sourceIndex, item.id ?? null])).digest('hex');
const credential = (item) => findSecretIn(item);
const titleOf = (item) => item.title ?? item.name ?? '(no title)';
const safeTitle = (item) => credential({ title: titleOf(item) }) ? '[credential-like title omitted]' : titleOf(item).slice(0, 300);

function mergeStagedConversations(result, chats) {
  const sourceIds = new Set(result.conversationWarnings.filter((item) => item.id).map((item) => item.id));
  for (const chat of chats) {
    const id = typeof chat?.id === 'string' ? chat.id : undefined;
    if (id && sourceIds.has(id)) throw new Error('Duplicate conversation ID across supplied records. Staging does not replace export records; supply each chat once.');
    if (id) sourceIds.add(id);
  }
  for (let index = 0; index < chats.length; index++) {
    const chat = chats[index];
    const outcome = {
      origin: 'staged', sourceIndex: index + 1,
      ...(typeof chat?.id === 'string' ? { id: chat.id } : {}),
      ...(typeof chat?.title === 'string' ? { title: chat.title } : {}),
      warnings: [], omissions: {}, rejected: false, omitted: false,
    };
    try {
      validateItems('conversations', [chat]);
      result.conversations.push(chat);
    } catch (error) {
      outcome.rejected = true;
      outcome.omitted = true;
      outcome.reasonCode = 'invalid_staged_conversation';
      outcome.warnings = [`Staged conversation quarantined by pilot validation: ${error.message}`];
    }
    result.conversationWarnings.push(outcome);
  }
}

export function checkCategories(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.some((category) => !CATEGORIES.includes(category))) {
    throw new Error('Choose one or more supported categories.');
  }
  if (new Set(categories).size !== categories.length) throw new Error('Categories must not repeat.');
  return categories;
}

/** Collection is scoped before input reads; there is no implicit home-directory discovery. */
export async function collect({ exportPath, inputsDir, categories = CATEGORIES } = {}) {
  checkCategories(categories);
  if (!exportPath && !inputsDir) throw new Error('Provide an explicit --export or --inputs source.');
  const result = { ...empty(), requested: categories, present: [], sourceWarnings: [], conversationWarnings: [] };
  if (exportPath && categories.includes('conversations')) {
    const exported = await readExport(exportPath);
    result.conversations = exported.conversations;
    result.sourceWarnings.push(...exported.warnings);
    result.conversationWarnings = exported.conversationWarnings.map((item) => ({ ...item, origin: 'export' }));
    result.present.push('conversations');
  }
  const staged = await readStaged(inputsDir, categories);
  for (const category of categories) {
    if (category === 'conversations') mergeStagedConversations(result, staged.conversations ?? []);
    else result[category].push(...(staged[category] ?? []));
    validateItems(category, result[category]);
  }
  result.present = [...new Set([...result.present, ...staged.present])];
  return result;
}

export function summarize(collected, { showTitles = false } = {}) {
  const chatIssues = new Map(collected.conversationWarnings.filter((item) => item.id).map((item) => [item.id, item]));
  return CATEGORIES.map((category) => ({
    category,
    status: !collected.requested.includes(category) ? 'not-selected'
      : !collected.present.includes(category) ? 'not-collected'
        : category === 'conversations' && collected.conversationWarnings.some((item) => item.warnings.length || item.omitted) ? 'partial'
          : !collected[category].length ? 'empty-supplied-input' : 'collected',
    count: collected[category].length,
    items: collected[category].map((item) => ({
      key: itemKey(category, item),
      ...(showTitles ? { title: safeTitle(item) } : {}),
      ...(category === 'conversations' ? {
        messages: item.messages.length,
        warnings: chatIssues.get(item.id)?.warnings ?? [],
        omissions: chatIssues.get(item.id)?.omissions ?? {},
      } : {}),
      credentialWarning: credential(item),
    })),
  }));
}

/** Per-item approval never turns off credential filtering for other items. */
export function select(collected, { exclude = [], allowFlagged = [] } = {}) {
  const chosen = empty();
  const skipped = [];
  const keys = new Set(CATEGORIES.flatMap((category) => collected[category].map((item) => itemKey(category, item))));
  if ([...exclude, ...allowFlagged].some((key) => !keys.has(key))) throw new Error('Selection contains an unknown key; scan the same inputs again.');
  const excluded = new Set(exclude);
  const approved = new Set(allowFlagged);
  for (const category of CATEGORIES) {
    for (const item of collected[category]) {
      const key = itemKey(category, item);
      const reason = excluded.has(key) ? 'excluded' : credential(item) && !approved.has(key) ? 'credential-like content' : null;
      if (reason) skipped.push({ key, category, reason });
      else chosen[category].push(item);
    }
  }
  const projectIds = new Set(chosen.projects.map((item) => item.id));
  chosen.conversations = chosen.conversations.filter((item) => {
    if (!item.projectId || projectIds.has(item.projectId)) return true;
    skipped.push({ key: itemKey('conversations', item), category: 'conversations', reason: 'linked project not selected or unavailable' });
    return false;
  });
  const conversationIds = new Set(chosen.conversations.map((item) => item.id));
  chosen.artifacts = chosen.artifacts.filter((item) => {
    if (!item.conversationId || conversationIds.has(item.conversationId)) return true;
    skipped.push({ key: itemKey('artifacts', item), category: 'artifacts', reason: 'linked conversation not selected or unavailable' });
    return false;
  });
  return { chosen, skipped };
}

export function coverage(collected, { showTitles = false } = {}) {
  const retained = new Map(collected.conversations.map((chat) => [chat.id, chat]));
  const rejected = collected.conversationWarnings.filter((item) => item.rejected).length;
  const omitted = collected.conversationWarnings.filter((item) => item.omitted && !item.rejected).length;
  return {
    verifiedAtDestination: false,
    accountCompletenessVerified: false,
    conversationCounts: {
      sourceRecords: collected.conversationWarnings.length,
      accepted: collected.conversations.length,
      quarantined: rejected,
      omitted,
    },
    conversationIssues: collected.conversationWarnings.filter((item) => item.warnings.length || item.omitted).map((item) => ({
      sourceKey: sourceKey(item),
      sourceRecord: { kind: item.origin, index: item.sourceIndex },
      status: item.rejected ? 'quarantined' : item.omitted ? 'omitted' : 'partial',
      ...(item.reasonCode ? { reasonCode: item.reasonCode } : {}),
      ...(retained.has(item.id) ? { selectionKey: itemKey('conversations', retained.get(item.id)) } : {}),
      ...(showTitles ? { title: safeTitle(item), titleTruncated: titleOf(item).length > 300 } : {}),
      warnings: item.warnings,
      omissions: item.omissions ?? {},
      omitted: item.omitted,
    })),
    warnings: [
      'Requires a compatible AIWP ChatGPT importer with MongoDB transaction support. This bundle has not been verified at its destination.',
      'Only explicitly supplied data was inspected; zero items does not establish an empty account.',
      'Attachments, project files, connectors, and source access permissions are not transferred.',
      'Credential detection is best-effort. Review selected content before sharing the bundle.',
      ...(rejected ? [`${rejected} conversation(s) quarantined because they are malformed or exceed pilot limits; their contents are not in this bundle. Review the scan issues.`] : []),
      ...(omitted ? [`${omitted} conversation(s) omitted because no supported visible content could be collected. Review the scan issues.`] : []),
      ...collected.sourceWarnings,
      ...new Set(collected.conversationWarnings.flatMap((item) => item.warnings)),
    ],
  };
}

export function makeBundle(chosen, warnings = []) {
  const bounded = warnings.slice(0, 999).map((warning) => findSecret(warning) ? 'A source warning containing credential-like data was omitted.' : warning.slice(0, 2000));
  if (warnings.length > 999) bounded.push(`${warnings.length - 999} additional warnings omitted; inspect the scan report.`);
  return validateBundle({
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, createdAt: new Date().toISOString(), generator: GENERATOR,
    migrationWarnings: bounded,
    ...Object.fromEntries(CATEGORIES.filter((category) => chosen[category].length).map((category) => [category, chosen[category]])),
  });
}
