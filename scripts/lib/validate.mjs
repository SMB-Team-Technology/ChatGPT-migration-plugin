export const BUNDLE_FORMAT = 'chatgpt-migration-bundle';
export const BUNDLE_VERSION = 1;
export const CATEGORIES = Object.freeze([
  'projects', 'conversations', 'memories', 'skills', 'scheduledTasks', 'artifacts',
]);
export const LIMITS = Object.freeze({
  projects: 1_000, conversations: 10_000, memories: 500, skills: 200,
  scheduledTasks: 100, artifacts: 1_000, messages: 5_000,
  messageChars: 500_000, contentChars: 1_000_000, promptChars: 100_000,
  skillFiles: 50, warningCount: 1_000, bundleBytes: 25 * 1024 * 1024,
});

const fail = (at, reason) => { throw new Error(`${at}: ${reason}`); };
const owns = (value, key) => Object.hasOwn(value, key);

const object = (value, allowed, at) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, 'must be an object');
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(at, 'contains unsupported fields');
};

const string = (value, at, max, nonempty = false) => {
  if (typeof value !== 'string' || value.length > max) fail(at, `must be text of at most ${max} characters`);
  if (nonempty && !value.trim()) fail(at, 'must not be empty');
};

const optionalString = (value, key, at, max, nonempty = false) => {
  if (owns(value, key)) string(value[key], `${at}.${key}`, max, nonempty);
};

const identifier = (value, at) => string(value, at, 300, true);
const optionalId = (value, key, at) => {
  if (owns(value, key)) identifier(value[key], `${at}.${key}`);
};

const date = (value, at) => {
  if (typeof value !== 'string') fail(at, 'must be an ISO timestamp with timezone');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) fail(at, 'must be an ISO timestamp with timezone');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[7];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) || !Number.isFinite(Date.parse(value))) {
    fail(at, 'must be a valid calendar timestamp');
  }
};

const optionalDate = (value, key, at) => {
  if (owns(value, key)) date(value[key], `${at}.${key}`);
};

const list = (value, at, max, min = 0) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(at, `must be a list containing ${min} to ${max} items`);
};

const graph = (chat, at) => {
  list(chat.messages, `${at}.messages`, LIMITS.messages, 1);
  const parents = new Map();
  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i];
    const location = `${at}.messages[${i}]`;
    object(message, ['id', 'parentId', 'role', 'text', 'thinking', 'createdAt'], location);
    identifier(message.id, `${location}.id`);
    if (parents.has(message.id)) fail(location, 'duplicate message id');
    if (message.parentId !== null) identifier(message.parentId, `${location}.parentId`);
    if (!['user', 'assistant'].includes(message.role)) fail(`${location}.role`, 'must be user or assistant');
    string(message.text, `${location}.text`, LIMITS.messageChars);
    optionalString(message, 'thinking', location, LIMITS.messageChars);
    if (owns(message, 'thinking') && message.role !== 'assistant') fail(location, 'thinking is supported only for assistant messages');
    if (!message.text.trim() && !message.thinking?.trim()) fail(location, 'has no supported visible content');
    optionalDate(message, 'createdAt', location);
    parents.set(message.id, message.parentId);
  }
  const visited = new Map();
  for (const id of parents.keys()) {
    const chain = [];
    let cursor = id;
    while (cursor !== null && visited.get(cursor) !== 2) {
      if (!parents.has(cursor)) fail(`${at}.messages`, 'contains a missing parent reference');
      if (visited.get(cursor) === 1) fail(`${at}.messages`, 'contains a parent cycle');
      visited.set(cursor, 1);
      chain.push(cursor);
      cursor = parents.get(cursor);
    }
    for (const item of chain) visited.set(item, 2);
  }
  if (owns(chat, 'activeMessageId')) {
    identifier(chat.activeMessageId, `${at}.activeMessageId`);
    if (!parents.has(chat.activeMessageId)) fail(`${at}.activeMessageId`, 'must reference a retained message');
  }
};

const cron = (value, at) => {
  string(value, at, 100, true);
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) fail(at, 'must use five numeric cron fields');
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < fields.length; i++) {
    const [min, max] = ranges[i];
    for (const part of fields[i].split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) fail(at, 'contains an unsupported cron expression');
      if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > max - min + 1)) fail(at, 'contains an invalid cron step');
      if (match[1] === '*') continue;
      const [start, end = start] = match[1].split('-').map(Number);
      if (start < min || end > max || start > end) fail(at, 'contains an out-of-range cron value');
    }
  }
};

const validators = {
  projects(item, at) {
    object(item, ['id', 'name', 'description', 'instructions', 'context'], at);
    string(item.name, `${at}.name`, 128, true);
    optionalString(item, 'description', at, LIMITS.promptChars);
    string(item.instructions, `${at}.instructions`, LIMITS.promptChars);
    string(item.context, `${at}.context`, LIMITS.promptChars);
  },
  conversations(item, at) {
    object(item, ['id', 'title', 'createdAt', 'updatedAt', 'projectId', 'messages', 'activeMessageId'], at);
    string(item.title, `${at}.title`, 300);
    optionalId(item, 'projectId', at);
    optionalDate(item, 'createdAt', at);
    optionalDate(item, 'updatedAt', at);
    graph(item, at);
  },
  memories(item, at) {
    object(item, ['id', 'value', 'key'], at);
    string(item.value, `${at}.value`, LIMITS.contentChars, true);
    optionalString(item, 'key', at, 100);
  },
  skills(item, at) {
    object(item, ['id', 'name', 'description', 'content', 'files'], at);
    string(item.name, `${at}.name`, 200, true);
    string(item.description, `${at}.description`, 2_000);
    string(item.content, `${at}.content`, LIMITS.contentChars, true);
    if (!owns(item, 'files')) return;
    list(item.files, `${at}.files`, LIMITS.skillFiles);
    const paths = new Set();
    for (let i = 0; i < item.files.length; i++) {
      const file = item.files[i];
      const location = `${at}.files[${i}]`;
      object(file, ['path', 'content'], location);
      string(file.path, `${location}.path`, 500, true);
      if (/[\\\x00-\x1f\x7f]/.test(file.path) || /^[A-Za-z]:/.test(file.path) ||
          file.path.split('/').some((part) => !part || part === '.' || part === '..')) {
        fail(`${location}.path`, 'must be a safe relative file path');
      }
      if (paths.has(file.path)) fail(`${location}.path`, 'duplicate supporting file path');
      paths.add(file.path);
      string(file.content, `${location}.content`, LIMITS.contentChars);
    }
  },
  scheduledTasks(item, at) {
    object(item, ['id', 'name', 'prompt', 'scheduleType', 'runAt', 'cron', 'timezone', 'enabled'], at);
    string(item.name, `${at}.name`, 128, true);
    string(item.prompt, `${at}.prompt`, LIMITS.promptChars, true);
    if (item.enabled !== false) fail(`${at}.enabled`, 'must be false; imported tasks remain paused');
    string(item.timezone, `${at}.timezone`, 100, true);
    try { new Intl.DateTimeFormat('en', { timeZone: item.timezone }); }
    catch { fail(`${at}.timezone`, 'must name a supported timezone'); }
    if (item.scheduleType === 'once') {
      if (owns(item, 'cron')) fail(at, 'one-time tasks cannot also contain cron');
      date(item.runAt, `${at}.runAt`);
      return;
    }
    if (item.scheduleType !== 'recurring') fail(`${at}.scheduleType`, 'must be once or recurring');
    if (owns(item, 'runAt')) fail(at, 'recurring tasks cannot also contain runAt');
    cron(item.cron, `${at}.cron`);
  },
  artifacts(item, at) {
    object(item, ['id', 'title', 'type', 'content', 'language', 'conversationId', 'createdAt'], at);
    string(item.title, `${at}.title`, 300, true);
    string(item.type, `${at}.type`, 100, true);
    string(item.content, `${at}.content`, LIMITS.contentChars, true);
    optionalString(item, 'language', at, 100);
    optionalId(item, 'conversationId', at);
    optionalDate(item, 'createdAt', at);
  },
};

/** Validate canonical items without requiring linked categories to have been collected yet. */
export const validateItems = (category, items) => {
  if (!CATEGORIES.includes(category)) fail('items', 'unknown category');
  list(items, category, LIMITS[category]);
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const at = `${category}[${i}]`;
    validators[category](item, at);
    identifier(item.id, `${at}.id`);
    if (seen.has(item.id)) fail(at, 'duplicate item id');
    seen.add(item.id);
  }
  return items;
};

/** The pilot contract is deliberately stricter than the legacy Claude bundle validator. */
export const validateBundle = (bundle) => {
  object(bundle, ['format', 'version', 'createdAt', 'generator', 'migrationWarnings', ...CATEGORIES], 'bundle');
  if (bundle.format !== BUNDLE_FORMAT) fail('bundle.format', 'not a ChatGPT migration bundle');
  if (bundle.version !== BUNDLE_VERSION) fail('bundle.version', 'unsupported bundle version');
  date(bundle.createdAt, 'bundle.createdAt');
  object(bundle.generator, ['name', 'version'], 'bundle.generator');
  string(bundle.generator.name, 'bundle.generator.name', 100, true);
  string(bundle.generator.version, 'bundle.generator.version', 100, true);
  if (owns(bundle, 'migrationWarnings')) {
    list(bundle.migrationWarnings, 'bundle.migrationWarnings', LIMITS.warningCount);
    bundle.migrationWarnings.forEach((warning, i) => string(warning, `bundle.migrationWarnings[${i}]`, 2_000));
  }
  let total = 0;
  for (const category of CATEGORIES) {
    if (!owns(bundle, category)) continue;
    validateItems(category, bundle[category]);
    total += bundle[category].length;
  }
  if (!total) fail('bundle', 'contains no selected items');
  const projects = new Set((bundle.projects ?? []).map((item) => item.id));
  const conversations = new Set((bundle.conversations ?? []).map((item) => item.id));
  (bundle.conversations ?? []).forEach((item, i) => {
    if (item.projectId && !projects.has(item.projectId)) fail(`conversations[${i}].projectId`, 'references a project not included in this bundle');
  });
  (bundle.artifacts ?? []).forEach((item, i) => {
    if (item.conversationId && !conversations.has(item.conversationId)) fail(`artifacts[${i}].conversationId`, 'references a conversation not included in this bundle');
  });
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > LIMITS.bundleBytes) fail('bundle', 'exceeds the 25 MiB pilot limit');
  return bundle;
};
