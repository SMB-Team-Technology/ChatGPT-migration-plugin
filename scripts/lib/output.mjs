import { link, open, lstat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const UNSUPPORTED_LINK = new Set(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV']);

const copyContents = async (temporary, destination) => {
  for await (const chunk of createReadStream(temporary)) await destination.writeFile(chunk);
};

/** Only remove a failed copy when the path still refers to the file we created. */
const removeOwnedOutput = async (out, identity) => {
  const current = await lstat(out).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (current?.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(out);
};

/** Exclusive creation establishes ownership before copying, including when copying fails. */
async function copyExclusive(temporary, out, copy) {
  const destination = await open(out, 'wx', 0o600);
  let identity;
  try {
    identity = await destination.stat();
    await copy(temporary, destination);
    await destination.close();
  } catch (error) {
    await destination.close().catch(() => {});
    try {
      if (!identity) throw new Error('Could not establish output identity');
      await removeOwnedOutput(out, identity);
    } catch (cleanupError) {
      throw new Error('Copy failed and incomplete output cleanup could not be confirmed. Check the destination before retrying.', { cause: cleanupError });
    }
    throw error;
  }
}

/** Copy errors are cleaned up; abrupt process termination still is not atomic. */
export async function publishNoReplace(temporary, out, { linkFile = link, copy = copyContents } = {}) {
  try {
    await linkFile(temporary, out);
  } catch (error) {
    if (!UNSUPPORTED_LINK.has(error.code)) throw error;
    await copyExclusive(temporary, out, copy);
  }
}
