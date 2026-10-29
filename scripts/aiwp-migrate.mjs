#!/usr/bin/env node
import { lstat, realpath, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CATEGORIES, GENERATOR, collect, summarize, select, makeBundle, validateBundle, checkCategories, coverage } from './lib/bundle.mjs';
import { publishNoReplace } from './lib/output.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BYTES = 25 * 1024 * 1024;
const USAGE = `ChatGPT migration pilot ${GENERATOR.version}
Usage:
  node scripts/aiwp-migrate.mjs doctor
  node scripts/aiwp-migrate.mjs scan --export <json|zip|folder> [--inputs <folder>] [--categories <list>] [--show-titles]
  node scripts/aiwp-migrate.mjs build --export <json|zip|folder> [--inputs <folder>] --out <new-file>
      [--categories <list>] [--exclude <keys>] [--allow-flagged <keys>]
  node scripts/aiwp-migrate.mjs validate <bundle.json>

An explicit --inputs folder can replace --export. Keys come from scan; comma-separate lists.
Categories: ${CATEGORIES.join(', ')}
PILOT: validation is local only. This helper does not verify the destination deployment or installed ChatGPT runtime.`;
const optionTypes = {
  export: { type: 'string' }, inputs: { type: 'string' }, out: { type: 'string' },
  categories: { type: 'string' }, exclude: { type: 'string' }, 'allow-flagged': { type: 'string' },
  'show-titles': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
};
const allowed = {
  doctor: [], scan: ['export', 'inputs', 'categories', 'show-titles'],
  build: ['export', 'inputs', 'categories', 'out', 'exclude', 'allow-flagged'], validate: [],
};
const csv = (value) => value === undefined ? undefined : value.split(',').map((entry) => entry.trim()).filter(Boolean);
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const counts = (value) => Object.fromEntries(CATEGORIES.map((category) => [category, value[category]?.length ?? 0]));
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
async function repositoryRoot(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (await lstat(path.join(current, '.git')).then(() => true, () => false)) return current;
    if (path.dirname(current) === current) return null;
  }
}
async function checkedOutput(file) {
  const out = path.resolve(file);
  if (inside(PACKAGE_ROOT, out) || await repositoryRoot(path.dirname(out))) {
    throw new Error('Save private bundles outside the plugin and all code repositories.');
  }
  await mkdir(path.dirname(out), { recursive: true });
  const parent = await realpath(path.dirname(out));
  const packageReal = await realpath(PACKAGE_ROOT);
  if (inside(packageReal, parent) || await repositoryRoot(parent)) {
    throw new Error('The output resolves inside a code repository or plugin. Choose another folder.');
  }
  return path.join(parent, path.basename(out));
}
async function writeBundle(file, bundle) {
  const serialized = JSON.stringify(bundle, null, 2);
  if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('Formatted bundle exceeds 25 MiB. Select fewer items.');
  const out = await checkedOutput(file);
  const temporary = path.join(path.dirname(out), `.aiwp-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
    await publishNoReplace(temporary, out);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output already exists; choose a new filename.');
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') { process.stdout.write(`${USAGE}\n`); return; }
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command. Use --help.');
  let parsed;
  try { parsed = parseArgs({ args: rest, options: optionTypes, allowPositionals: true }); }
  catch { throw new Error('Invalid command options. Use --help.'); }
  const { values, positionals } = parsed;
  if (values.help) { process.stdout.write(`${USAGE}\n`); return; }
  if (Object.keys(values).some((key) => !allowed[command].includes(key))) throw new Error('Option is not supported by this command.');
  if (command === 'validate' ? positionals.length !== 1 : positionals.length !== 0) throw new Error('Unexpected or missing positional argument. Use --help.');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
  if (command === 'doctor') {
    print({ generator: GENERATOR, node: process.versions.node, platform: process.platform,
      localRuntimeReady: true, installedChatGPTTested: false, aiwpImportVerified: false,
      notice: 'This checks this process only; it does not establish an installed ChatGPT Work runtime or AIWP support.' });
    return;
  }
  if (command === 'validate') {
    const info = await lstat(positionals[0]);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Validation input must be a regular bundle file no larger than 25 MiB.');
    let raw;
    try { raw = JSON.parse(await readFile(positionals[0], 'utf8')); }
    catch { throw new Error('Bundle is not valid JSON.'); }
    const bundle = validateBundle(raw);
    print({ valid: true, counts: counts(bundle), verifiedAtDestination: false,
      notice: 'Valid against the pilot contract only; not proof of destination acceptance or complete migration.' });
    return;
  }
  if (command === 'build' && !values.out) throw new Error('--out is required.');
  const categories = checkCategories(csv(values.categories) ?? CATEGORIES);
  const collected = await collect({ exportPath: values.export, inputsDir: values.inputs, categories });
  const report = coverage(collected, { showTitles: values['show-titles'] });
  if (command === 'scan') {
    print({ categories: summarize(collected, { showTitles: values['show-titles'] }), coverage: report });
    return;
  }
  const { chosen, skipped } = select(collected, { exclude: csv(values.exclude), allowFlagged: csv(values['allow-flagged']) });
  if (!CATEGORIES.some((category) => chosen[category].length)) {
    const { quarantined, omitted } = report.conversationCounts;
    const issues = quarantined || omitted
      ? ` Conversation collection: ${quarantined} quarantined, ${omitted} omitted. Run scan with the same inputs and categories to see the issues.`
      : '';
    throw new Error(`No selected data remains. Review inputs, dependencies, and credential exclusions.${issues}`);
  }
  const selectionWarnings = skipped.map((item) => `${item.category}: one item omitted (${item.reason}).`);
  const bundle = makeBundle(chosen, [...report.warnings, ...selectionWarnings]);
  const file = await writeBundle(values.out, bundle);
  print({ file, counts: counts(bundle), skipped, coverage: report,
    status: 'Bundle created. Use AIWP Import from ChatGPT on a compatible deployment. Review the preview before import; destination acceptance is not verified by this helper.' });
}

main().catch((error) => {
  const message = error.code ? `File operation failed (${error.code}). Check selected paths and permissions.` : error.message;
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
