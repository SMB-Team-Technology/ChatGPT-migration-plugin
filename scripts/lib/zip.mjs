import { inflateRawSync } from 'node:zlib';

export const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const checksum = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const ensure = (condition, message = 'Corrupt ZIP archive') => {
  if (!condition) throw new Error(message);
};
const range = (buffer, offset, length) => ensure(offset >= 0 && length >= 0 && offset + length <= buffer.length);
const safeName = (name) => {
  ensure(name.length > 0 && !name.includes('\0') && !name.includes('\\'), 'Unsafe ZIP entry path');
  ensure(!name.startsWith('/') && !/^[a-z]:/i.test(name), 'Unsafe ZIP entry path');
  ensure(!name.split('/').some((part) => part === '..' || part === '.'), 'Unsafe ZIP entry path');
};

/** Reads stored/deflated ZIPs lazily without extracting files; rejects unsupported and unsafe archives. */
export const readZip = (buffer) => {
  ensure(Buffer.isBuffer(buffer) && buffer.length <= MAX_INPUT_BYTES, 'ZIP exceeds the 256 MiB input limit');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      eocd = i;
      break;
    }
  }
  ensure(eocd !== -1, 'Not a complete ZIP archive');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  ensure(total !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff,
    'ZIP64 is not supported; extract the export and select its conversations folder');
  ensure(buffer.readUInt16LE(eocd + 4) === 0 && buffer.readUInt16LE(eocd + 6) === 0 &&
    buffer.readUInt16LE(eocd + 8) === total, 'Multi-disk ZIP archives are not supported');
  ensure(total <= MAX_ENTRIES, 'ZIP has too many entries');
  ensure(centralOffset + centralSize === eocd, 'Corrupt ZIP central directory');
  const entries = new Map();
  const seenNames = new Set();
  const spans = [];
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let i = 0; i < total; i++) {
    range(buffer, cursor, 46);
    ensure(buffer.readUInt32LE(cursor) === 0x02014b50, 'Corrupt ZIP central entry');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    ensure(compressedSize !== 0xffffffff && size !== 0xffffffff && localOffset !== 0xffffffff,
      'ZIP64 is not supported; extract the export and select its conversations folder');
    ensure(!(flags & 0x41), 'Encrypted ZIP archives are not supported');
    ensure(method === 0 || method === 8, 'Unsupported ZIP compression method');
    ensure(buffer.readUInt16LE(cursor + 34) === 0, 'Multi-disk ZIP archives are not supported');
    const mode = buffer.readUInt32LE(cursor + 38) >>> 16;
    ensure((mode & 0xf000) !== 0xa000, 'ZIP symlink entries are not supported');
    range(buffer, cursor + 46, nameLength + extraLength + commentLength);
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    safeName(name);
    ensure(!seenNames.has(name), 'Duplicate ZIP entry names are ambiguous');
    seenNames.add(name);
    cursor += 46 + nameLength + extraLength + commentLength;
    ensure(cursor <= eocd, 'Corrupt ZIP central directory size');
    expandedBytes += size;
    ensure(expandedBytes <= MAX_INPUT_BYTES, 'ZIP expanded contents exceed the 256 MiB limit');
    range(buffer, localOffset, 30);
    ensure(buffer.readUInt32LE(localOffset) === 0x04034b50, 'Corrupt ZIP local header');
    ensure(buffer.readUInt16LE(localOffset + 6) === flags && buffer.readUInt16LE(localOffset + 8) === method,
      'ZIP local and central headers disagree');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    range(buffer, localOffset + 30, localNameLength + localExtraLength);
    ensure(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes),
      'ZIP local and central filenames disagree');
    ensure(dataStart + compressedSize <= centralOffset, 'Truncated ZIP payload');
    if (!(flags & 8)) {
      ensure(buffer.readUInt32LE(localOffset + 14) === crc &&
        buffer.readUInt32LE(localOffset + 18) === compressedSize && buffer.readUInt32LE(localOffset + 22) === size,
        'ZIP local and central sizes or checksums disagree');
    }
    spans.push([localOffset, dataStart + compressedSize]);
    if (name.endsWith('/')) {
      ensure(size === 0, 'Invalid ZIP directory entry');
      continue;
    }
    entries.set(name, () => {
      const packed = buffer.subarray(dataStart, dataStart + compressedSize);
      let unpacked;
      try {
        unpacked = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new Error('Corrupt ZIP compressed data');
      }
      ensure(unpacked.length === size && checksum(unpacked) === crc, 'ZIP payload size or checksum mismatch');
      return unpacked;
    });
  }
  ensure(cursor === eocd, 'Corrupt ZIP central directory size');
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) ensure(spans[i][0] >= spans[i - 1][1], 'Overlapping ZIP entries');
  return entries;
};
