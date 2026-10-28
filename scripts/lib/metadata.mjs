import { readFileSync } from 'node:fs';

// One runtime version source for the CLI, MCP server, and rendered questionnaire.
const { name, version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
export const GENERATOR = Object.freeze({ name, version });
