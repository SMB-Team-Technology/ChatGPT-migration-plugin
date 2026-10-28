const PATTERNS = [
  ['an Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['an API secret key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['a signed download URL', /https?:\/\/[^\s"<>]+[?&](?:token|sig|signature|X-Amz-Signature|X-Goog-Signature|access_token)=[^\s"<>]+/i],
  ['a bearer token', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/i],
];

/** Names the first kind of credential found in `text`, or null. */
export const findSecret = (text) => {
  if (typeof text !== 'string') return null;
  const hit = PATTERNS.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : null;
};

/** Scan original string values so JSON escape characters cannot change token boundaries. */
export const findSecretIn = (value) => {
  const pending = [value];
  const visited = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') {
      const found = findSecret(current);
      if (found) return found;
      continue;
    }
    if (current === null || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const values = Object.values(current);
    for (let i = values.length - 1; i >= 0; i--) pending.push(values[i]);
  }
  return null;
};
