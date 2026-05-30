import { cloudStorage } from '@tma.js/sdk-react';

// ---------------------------------------------------------------------------
// Persistence abstraction.
// Inside Telegram (production) → Telegram CloudStorage (synced to the user's
// account across devices). In the browser / dev → localStorage.
// CloudStorage limits handled: key names must match [A-Za-z0-9_-], and each
// value is capped (~4 KB), so large blobs are transparently chunked.
// ---------------------------------------------------------------------------

export interface Storage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const STORAGE_KEYS = {
  expenses: 'finance.expenses',
  savings: 'finance.savings',
  recurring: 'finance.recurring',
  meta: 'app.meta',
} as const;

/** CloudStorage key names allow only [A-Za-z0-9_-]; sanitize logical keys. */
function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_');
}

const CHUNK_SIZE = 4000; // stay safely under Telegram's per-value limit

class LocalStorageImpl implements Storage {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = window.localStorage.getItem(sanitize(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T): Promise<void> {
    window.localStorage.setItem(sanitize(key), JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    window.localStorage.removeItem(sanitize(key));
  }
  async keys(): Promise<string[]> {
    return Object.keys(window.localStorage);
  }
}

interface Manifest {
  chunks: number;
}

function parseManifest(raw: string): Manifest | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Manifest;
    return typeof m.chunks === 'number' ? m : null;
  } catch {
    return null;
  }
}

class CloudStorageImpl implements Storage {
  async get<T>(key: string): Promise<T | null> {
    const sk = sanitize(key);
    const manifest = parseManifest(await cloudStorage.getItem(sk));
    if (!manifest || manifest.chunks <= 0) return null;
    const chunkKeys = Array.from({ length: manifest.chunks }, (_, i) => `${sk}__${i}`);
    const map = await cloudStorage.getItems(chunkKeys);
    const joined = chunkKeys.map((k) => map[k] ?? '').join('');
    try {
      return JSON.parse(joined) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const sk = sanitize(key);
    const str = JSON.stringify(value);
    const parts: string[] = [];
    for (let i = 0; i < str.length; i += CHUNK_SIZE) parts.push(str.slice(i, i + CHUNK_SIZE));
    if (parts.length === 0) parts.push('');

    const oldManifest = parseManifest(await cloudStorage.getItem(sk).catch(() => ''));
    const oldChunks = oldManifest?.chunks ?? 0;

    for (let i = 0; i < parts.length; i++) {
      await cloudStorage.setItem(`${sk}__${i}`, parts[i]);
    }
    await cloudStorage.setItem(sk, JSON.stringify({ chunks: parts.length } satisfies Manifest));

    // Remove any now-stale higher-index chunks from a previous larger value.
    for (let i = parts.length; i < oldChunks; i++) {
      await cloudStorage.deleteItem(`${sk}__${i}`).catch(() => {});
    }
  }

  async remove(key: string): Promise<void> {
    const sk = sanitize(key);
    const manifest = parseManifest(await cloudStorage.getItem(sk).catch(() => ''));
    const chunks = manifest?.chunks ?? 0;
    const keys = [sk, ...Array.from({ length: chunks }, (_, i) => `${sk}__${i}`)];
    await cloudStorage.deleteItem(keys).catch(() => {});
  }

  async keys(): Promise<string[]> {
    const all = await cloudStorage.getKeys();
    return all.filter((k) => !k.includes('__'));
  }
}

let cached: Storage | null = null;

/** Returns the active storage backend (memoized). */
export function getStorage(): Storage {
  if (cached) return cached;
  let useCloud = false;
  // In dev we run against the mocked Telegram env, which can't answer CloudStorage
  // requests — always use localStorage there.
  if (!import.meta.env.DEV) {
    try {
      useCloud = cloudStorage.isSupported();
    } catch {
      useCloud = false;
    }
  }
  cached = useCloud ? new CloudStorageImpl() : new LocalStorageImpl();
  return cached;
}
