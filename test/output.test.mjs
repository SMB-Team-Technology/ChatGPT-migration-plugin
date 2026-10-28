import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishNoReplace } from '../scripts/lib/output.mjs';

const setup = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-output-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const temporary = path.join(dir, 'private.tmp');
  const out = path.join(dir, 'bundle.json');
  await writeFile(temporary, '{"synthetic":true}', { flag: 'wx', mode: 0o600 });
  return { dir, temporary, out };
};
const failure = (code) => async () => { throw Object.assign(new Error('Synthetic filesystem failure'), { code }); };

test('publishes with a hard link without changing source contents or permissions', async (t) => {
  const { temporary, out } = await setup(t);
  await publishNoReplace(temporary, out);
  assert.equal(await readFile(out, 'utf8'), '{"synthetic":true}');
  assert.equal(await readFile(temporary, 'utf8'), '{"synthetic":true}');
  assert.equal((await stat(out)).ino, (await stat(temporary)).ino);
  if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600);
});

test('existing destination is preserved without attempting a copy fallback', async (t) => {
  const { temporary, out } = await setup(t);
  await writeFile(out, 'existing output');
  let copied = false;
  await assert.rejects(publishNoReplace(temporary, out, {
    copy: async () => { copied = true; },
  }), { code: 'EEXIST' });
  assert.equal(copied, false);
  assert.equal(await readFile(out, 'utf8'), 'existing output');
});

test('unsupported hard links fall back to real exclusive copies preserving private mode', async (t) => {
  const { temporary, dir } = await setup(t);
  for (const code of ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV']) {
    const out = path.join(dir, `${code}.json`);
    await publishNoReplace(temporary, out, { linkFile: failure(code) });
    assert.equal(await readFile(out, 'utf8'), '{"synthetic":true}');
    assert.notEqual((await stat(out)).ino, (await stat(temporary)).ino);
    if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600);
  }
});

test('copy fallback refuses an existing file and an existing symlink', async (t) => {
  const { temporary, out, dir } = await setup(t);
  await writeFile(out, 'keep file');
  await assert.rejects(publishNoReplace(temporary, out, { linkFile: failure('ENOTSUP') }), { code: 'EEXIST' });
  assert.equal(await readFile(out, 'utf8'), 'keep file');
  const alias = path.join(dir, 'alias.json');
  await symlink(out, alias);
  await assert.rejects(publishNoReplace(temporary, alias, { linkFile: failure('EPERM') }), { code: 'EEXIST' });
  assert.equal(await readFile(out, 'utf8'), 'keep file');
});

test('unrelated filesystem errors propagate without fallback', async (t) => {
  const { temporary, out } = await setup(t);
  let copied = false;
  for (const code of ['EEXIST', 'ENOSPC', 'EIO', 'ENOENT', 'EACCES']) {
    await assert.rejects(publishNoReplace(temporary, out, {
      linkFile: failure(code),
      copy: async () => { copied = true; },
    }), { code });
  }
  assert.equal(copied, false);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('concurrent fallback publishers converge on one unchanged output', async (t) => {
  const { temporary, out, dir } = await setup(t);
  const other = path.join(dir, 'other.tmp');
  await writeFile(other, '{"other":true}', { mode: 0o600 });
  const results = await Promise.allSettled([
    publishNoReplace(temporary, out, { linkFile: failure('ENOTSUP') }),
    publishNoReplace(other, out, { linkFile: failure('ENOTSUP') }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = results.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'EEXIST');
  assert.ok(['{"synthetic":true}', '{"other":true}'].includes(await readFile(out, 'utf8')));
});

test('failed fallback cleans its partial output and allows retry without altering the source', async (t) => {
  const { temporary, out } = await setup(t);
  for (const code of ['ENOSPC', 'EIO', 'EEXIST']) {
    await assert.rejects(publishNoReplace(temporary, out, {
      linkFile: failure('ENOTSUP'),
      copy: async (_source, destination) => {
        await destination.writeFile('partial');
        throw Object.assign(new Error('Synthetic copy failure'), { code });
      },
    }), { code });
    await assert.rejects(stat(out), { code: 'ENOENT' });
    assert.equal(await readFile(temporary, 'utf8'), '{"synthetic":true}');
  }
  await publishNoReplace(temporary, out, { linkFile: failure('ENOTSUP') });
  assert.equal(await readFile(out, 'utf8'), '{"synthetic":true}');
});

test('fallback read failure removes only its newly created destination', async (t) => {
  const { out, dir } = await setup(t);
  const missing = path.join(dir, 'missing.tmp');
  await assert.rejects(publishNoReplace(missing, out, { linkFile: failure('ENOTSUP') }), { code: 'ENOENT' });
  await assert.rejects(stat(out), { code: 'ENOENT' });
  await writeFile(out, 'existing output');
  await assert.rejects(publishNoReplace(missing, out, { linkFile: failure('ENOTSUP') }), { code: 'EEXIST' });
  assert.equal(await readFile(out, 'utf8'), 'existing output');
});

test('failed-copy cleanup preserves an output replaced by another file', async (t) => {
  const { temporary, out, dir } = await setup(t);
  const replacement = path.join(dir, 'replacement.json');
  await writeFile(replacement, 'replacement output');
  await assert.rejects(publishNoReplace(temporary, out, {
    linkFile: failure('ENOTSUP'),
    copy: async (_source, destination) => {
      await destination.writeFile('partial');
      await rename(replacement, out);
      throw Object.assign(new Error('Synthetic copy failure'), { code: 'EIO' });
    },
  }), { code: 'EIO' });
  assert.equal(await readFile(out, 'utf8'), 'replacement output');
});

test('fallback preserves content across multiple copy chunks', async (t) => {
  const { temporary, out } = await setup(t);
  const content = 'Synthetic Unicode content: \u03bb\n'.repeat(10_000);
  await writeFile(temporary, content);
  await publishNoReplace(temporary, out, { linkFile: failure('ENOTSUP') });
  assert.equal(await readFile(out, 'utf8'), content);
});
