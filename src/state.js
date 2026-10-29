import fs from 'node:fs/promises';
import path from 'node:path';

export const emptyState = () => ({
  version: 1,
  createdAt: null,
  baselineDone: false,
  lastHeartbeatAt: null,
  outage: null, // { since, alertedAt, error } while the site can't be read
  listings: {}, // sku -> last known listing (+ firstSeenAt, missCount, priceHistory)
  gone: {}, // sku -> slim record of listings that disappeared (so a re-listing is recognised)
});

export async function loadState(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
  try {
    const parsed = JSON.parse(text);
    return { ...emptyState(), ...parsed, listings: parsed.listings ?? {}, gone: parsed.gone ?? {} };
  } catch (err) {
    throw new Error(`State file ${file} is unreadable (${err.message}). Fix or delete it to start a fresh baseline.`);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

const withoutStamp = (state) => {
  const { updatedAt, ...rest } = state;
  return rest;
};

/**
 * Writes the state only when something other than the timestamp changed, so an idle poll leaves the
 * file (and therefore the git history) untouched. Returns true when the file was written.
 */
export async function saveState(file, state, now = new Date()) {
  const next = sortKeys(withoutStamp(state));
  let previous = null;
  try {
    previous = JSON.stringify(sortKeys(withoutStamp(JSON.parse(await fs.readFile(file, 'utf8')))));
  } catch {
    /* missing or unreadable: write fresh */
  }
  if (previous === JSON.stringify(next)) return false;

  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ ...next, updatedAt: now.toISOString() }, null, 2)}\n`);
  await fs.rename(tmp, file);
  return true;
}
