import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZip } from '../scripts/lib/zip.mjs';
import { readExport } from '../scripts/lib/sources/export.mjs';

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const archive = (files, method = 8) => {
  const localChunks = [], centralChunks = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text);
    const packed = method === 0 ? data : deflateRawSync(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    localChunks.push(local, filename, packed); centralChunks.push(central, filename); offset += local.length + filename.length + packed.length;
  }
  const central = Buffer.concat(centralChunks), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, central, end]);
};
const centralOffset = (zip) => zip.readUInt32LE(zip.length - 6);

test('reads stored and deflated archives with verified CRC', () => {
  for (const method of [0, 8]) {
    const entries = readZip(archive({ 'nested/conversations.json': 'héllo 世界', 'empty.txt': '' }, method));
    assert.equal(entries.get('nested/conversations.json')().toString(), 'héllo 世界');
    assert.equal(entries.get('empty.txt')().length, 0);
  }
});

test('checks CRC against changed stored payload', () => {
  const zip = archive({ 'a.json': '123456789' }, 0);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  zip[30 + 'a.json'.length] ^= 1;
  assert.throws(() => readZip(zip).get('a.json')(), /checksum mismatch/);
});

test('rejects truncation, wrong directory sizes, and overlapping headers', () => {
  const zip = archive({ 'a.json': '[]', 'b.json': '[]' });
  assert.throws(() => readZip(zip.subarray(0, zip.length - 3)), /complete ZIP/);
  const badSize = Buffer.from(zip); badSize.writeUInt32LE(0, badSize.length - 10);
  assert.throws(() => readZip(badSize), /central directory/);
  const badOffset = Buffer.from(zip); badOffset.writeUInt32LE(0xffffffff - 1, centralOffset(zip) + 42);
  assert.throws(() => readZip(badOffset), /Corrupt ZIP/);
});

test('rejects encrypted, multidisk, ZIP64 and unsafe archive paths', () => {
  const zip = archive({ 'a.json': '[]' });
  const encrypted = Buffer.from(zip); encrypted.writeUInt16LE(1, centralOffset(zip) + 8);
  assert.throws(() => readZip(encrypted), /Encrypted/);
  const multidisk = Buffer.from(zip); multidisk.writeUInt16LE(1, multidisk.length - 18);
  assert.throws(() => readZip(multidisk), /Multi-disk/);
  const zip64 = Buffer.from(zip); zip64.writeUInt32LE(0xffffffff, centralOffset(zip) + 24);
  assert.throws(() => readZip(zip64), /ZIP64/);
  for (const name of ['../a.json', '/a.json', 'C:/a.json', 'a\\b.json']) {
    assert.throws(() => readZip(archive({ [name]: '[]' })), /Unsafe ZIP/);
  }
});

test('rejects duplicate entries and local header mismatch', () => {
  const zip = archive({ 'a.json': '[]', 'b.json': '[]' });
  const central = centralOffset(zip);
  const secondCentral = central + 46 + 'a.json'.length;
  zip[secondCentral + 46] = 'a'.charCodeAt(0);
  assert.throws(() => readZip(zip), /Duplicate ZIP/);
  const mismatch = archive({ 'a.json': '[]' });
  mismatch[30] = 'b'.charCodeAt(0);
  assert.throws(() => readZip(mismatch), /filenames disagree/);
});

test('rejects advertised decompression bombs and symlinks', () => {
  const zip = archive({ 'a.json': '[]' });
  const bomb = Buffer.from(zip); bomb.writeUInt32LE(257 * 1024 * 1024, centralOffset(zip) + 24);
  assert.throws(() => readZip(bomb), /256 MiB/);
  const symlink = Buffer.from(zip); symlink.writeUInt32LE((0xa000 * 65536) >>> 0, centralOffset(zip) + 38);
  assert.throws(() => readZip(symlink), /symlink/);
});

test('reads only known conversation entries from a complete export ZIP', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-zip-test-'));
  try {
    const fixture = await readFile(new URL('./fixtures/chatgpt-synthetic.json', import.meta.url), 'utf8');
    const zip = archive({ 'export/conversations-000.json': fixture, 'user.json': 'Not parsed', 'image.png': 'Synthetic bytes' });
    const file = path.join(dir, 'export.zip');
    await writeFile(file, zip);
    const result = await readExport(file);
    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0].messages.length, 3);
    assert.deepEqual(result.sourceFiles, ['export/conversations-000.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects multiple conversation roots in a ZIP before combining accounts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-zip-roots-'));
  try {
    const fixture = await readFile(new URL('./fixtures/chatgpt-synthetic.json', import.meta.url), 'utf8');
    const file = path.join(dir, 'two-accounts.zip');
    await writeFile(file, archive({ 'account-a/conversations.json': fixture, 'account-b/conversations-000.json': '[]' }));
    await assert.rejects(readExport(file), /Multiple conversation export roots/);
    const split = path.join(dir, 'single-account.zip');
    await writeFile(split, archive({ 'nested/conversations-000.json': fixture, 'nested/conversations-001.json': '[]' }));
    const result = await readExport(split);
    assert.equal(result.conversations.length, 1);
    assert.equal(result.sourceFiles.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects whole and split payloads in one ZIP folder before parsing their contents', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-zip-layout-'));
  try {
    const fixture = await readFile(new URL('./fixtures/chatgpt-synthetic.json', import.meta.url), 'utf8');
    const other = JSON.parse(fixture);
    other[0].id = 'second-account';
    other[0].conversation_id = 'second-account';
    const file = path.join(dir, 'export.zip');
    for (const [whole, split] of [
      ['nested/conversations.json', 'nested/conversations-000.json'],
      ['nested/CONVERSATIONS.JSON', 'nested/Conversations-000.JSON'],
    ]) {
      await writeFile(file, archive({ [whole]: fixture }));
      const wholeOnly = await readExport(file);
      assert.deepEqual(wholeOnly.conversations.map((chat) => chat.id), ['synthetic-chat']);
      await writeFile(file, archive({ [whole]: fixture, [split]: JSON.stringify(other) }));
      await assert.rejects(readExport(file), /Whole and split conversation exports are ambiguous/);
      await writeFile(file, archive({ [whole]: 'Not valid JSON', [split]: JSON.stringify(other) }));
      await assert.rejects(readExport(file), /Whole and split conversation exports are ambiguous/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
