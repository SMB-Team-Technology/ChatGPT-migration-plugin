import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const FILES = {
  projects: 'projects.json', conversations: 'conversations.json', memories: 'memories.json',
  skills: 'skills.json', scheduledTasks: 'scheduled-tasks.json', artifacts: 'artifacts.json',
};
const MAX_BYTES = 25 * 1024 * 1024;

/** Reads only selected canonical staging files, never infers account data from prose. */
export async function readStaged(dir, categories) {
  const result = { present: [] };
  if (!dir) return result;
  const root = await lstat(dir);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Staging input must be a real directory.');
  let totalBytes = 0;
  for (const category of categories) {
    const file = path.join(dir, FILES[category]);
    const info = await lstat(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw new Error('Cannot inspect staging input.');
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Staged ${category} must be a regular file.`);
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let rows;
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Error(`Staged ${category} must be a regular file.`);
      totalBytes += opened.size;
      if (totalBytes > MAX_BYTES) throw new Error('Selected staging inputs exceed 25 MiB.');
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('Staged input changed while reading.');
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Staged input changed while reading.');
      try { rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error(`Staged ${category} is not valid UTF-8 JSON.`); }
    } finally {
      await handle.close();
    }
    if (!Array.isArray(rows)) throw new Error(`Staged ${category} must be an array of canonical records.`);
    result[category] = rows;
    result.present.push(category);
  }
  return result;
}
