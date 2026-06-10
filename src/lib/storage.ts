import { cloudStorage } from '@tma.js/sdk-react';

import { reportSyncStatus } from '@/lib/sync-status';
import { showToast } from '@/components/Toast';

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
  lists: 'finance.lists',
  reminders: 'finance.reminders',
  notes: 'notes.items',
  people: 'people.items',
  calculator: 'calculator.items',
  wardrobe: 'wardrobe.items',
  outfits: 'wardrobe.outfits',
  collections: 'wardrobe.collections',
  inspiration: 'wardrobe.inspiration',
  fitting: 'wardrobe.fitting',
  wishlist: 'wardrobe.wishlist',
  sizes: 'wardrobe.sizes',
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

// ---------------------------------------------------------------------------
// Server-backed storage. The source of truth is the VPS (POST /api/store/*,
// authenticated by Telegram initData), which never loses data the way the
// webview's localStorage can and isn't subject to CloudStorage's tiny limits.
// localStorage is kept as an instant offline cache; existing CloudStorage data
// is migrated to the server on first read.
// ---------------------------------------------------------------------------
let serverAuth: string | undefined;

/** Provide the Telegram initData so app data can persist on the server. */
export function setServerAuth(rawInitData: string | undefined): void {
  serverAuth = rawInitData || undefined;
}

/** The Telegram initData used to authenticate server requests (uploads, store). */
export function getServerAuth(): string | undefined {
  return serverAuth;
}

async function serverCall<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: serverAuth, ...body }),
  });
  if (!res.ok) throw new Error(`store-${res.status}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Pending-writes queue: server writes are queued and retried with backoff, so
// a flaky network can't silently drop data. Latest value per key wins (a newer
// set() simply replaces the queued value). Status is reported for the
// SyncIndicator; after 3 consecutive failures the user is told via a toast,
// while retries keep going in the background.
// ---------------------------------------------------------------------------
const pendingWrites = new Map<string, unknown>();
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let inErrorState = false;

function reportPending(): void {
  const n = pendingWrites.size;
  if (n === 0) {
    consecutiveFailures = 0;
    if (inErrorState) {
      inErrorState = false;
      showToast('Данные сохранены');
    }
    reportSyncStatus('idle', 0);
  } else {
    reportSyncStatus(consecutiveFailures >= 3 ? 'error' : 'saving', n);
  }
}

function scheduleFlush(delayMs = 0): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, delayMs);
}

async function flushPending(): Promise<void> {
  if (flushing || !serverAuth) return;
  flushing = true;
  try {
    while (pendingWrites.size > 0) {
      const [key, value] = pendingWrites.entries().next().value as [string, unknown];
      try {
        await serverCall('/api/store/set', { key, value });
        // Drop only if it wasn't replaced by a newer value while in flight.
        if (pendingWrites.get(key) === value) pendingWrites.delete(key);
        consecutiveFailures = 0;
        reportPending();
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures === 3 && !inErrorState) {
          inErrorState = true;
          showToast('Не удалось сохранить — повторяю…', 'error');
        }
        reportPending();
        // Backoff: 1s → 3s → 9s → 27s, capped at 30s.
        const delay = Math.min(1000 * 3 ** Math.min(consecutiveFailures - 1, 3), 30_000);
        scheduleFlush(delay);
        return;
      }
    }
    reportPending();
  } finally {
    flushing = false;
  }
}

// Re-kick the queue when connectivity or visibility returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (pendingWrites.size) scheduleFlush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingWrites.size) scheduleFlush();
  });
}

class ServerStorage implements Storage {
  constructor(
    private cache: Storage,
    private migrate: Storage | null,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    if (serverAuth) {
      try {
        const { values } = await serverCall<{ values: Record<string, T | null> }>(
          '/api/store/get',
          { keys: [key] },
        );
        const value = values?.[key] ?? null;
        if (value !== null) {
          void this.cache.set(key, value).catch(() => {});
          return value;
        }
        // Server has nothing yet — migrate from CloudStorage / localStorage once.
        const fallback =
          (this.migrate ? await this.migrate.get<T>(key) : null) ?? (await this.cache.get<T>(key));
        if (fallback !== null) {
          void serverCall('/api/store/set', { key, value: fallback }).catch(() => {});
          void this.cache.set(key, fallback).catch(() => {});
        }
        return fallback;
      } catch {
        // Offline / server error → best available local copy.
        return (
          (await this.cache.get<T>(key)) ?? (this.migrate ? await this.migrate.get<T>(key) : null)
        );
      }
    }
    return (this.migrate ? await this.migrate.get<T>(key) : null) ?? (await this.cache.get<T>(key));
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.cache.set(key, value).catch(() => {});
    if (serverAuth) {
      // When the app is being hidden/closed, a normal fetch may be killed —
      // sendBeacon is delivered reliably by the browser.
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        typeof navigator !== 'undefined' &&
        navigator.sendBeacon
      ) {
        try {
          const blob = new Blob([JSON.stringify({ initData: serverAuth, key, value })], {
            type: 'application/json',
          });
          if (navigator.sendBeacon('/api/store/set', blob)) {
            // The beacon carries the latest value — any queued older one is stale.
            pendingWrites.delete(key);
            reportPending();
            return;
          }
        } catch {
          /* fall through to the queue */
        }
      }
      pendingWrites.set(key, value);
      reportPending();
      scheduleFlush();
    } else if (this.migrate) {
      await this.migrate.set(key, value).catch(() => {});
    }
  }

  async remove(key: string): Promise<void> {
    await this.cache.remove(key).catch(() => {});
    if (serverAuth) {
      await serverCall('/api/store/remove', { key }).catch(() => {});
    } else if (this.migrate) {
      await this.migrate.remove(key).catch(() => {});
    }
  }

  async keys(): Promise<string[]> {
    return this.cache.keys();
  }
}

let cached: Storage | null = null;

/** Returns the active storage backend (memoized). */
export function getStorage(): Storage {
  if (cached) return cached;
  // In dev we run against the mocked Telegram env — plain localStorage.
  if (import.meta.env.DEV) {
    cached = new LocalStorageImpl();
    return cached;
  }
  let cloudOk = false;
  try {
    cloudOk = cloudStorage.isSupported();
  } catch {
    cloudOk = false;
  }
  // Server is the source of truth; localStorage caches; CloudStorage (if any)
  // is read once to migrate a returning user's existing data.
  cached = new ServerStorage(new LocalStorageImpl(), cloudOk ? new CloudStorageImpl() : null);
  return cached;
}
