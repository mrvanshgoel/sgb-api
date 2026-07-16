// ─── Pluggable Cache Layer ───────────────────────────────────────────────────
// Default: in-memory Map with TTL. Self-hosters can swap in Redis or any
// other backend by implementing CacheProvider and passing it to buildApp().

export interface CacheEntry<T> {
  value: T;
  timestamp: number; // Unix ms when it was cached
}

export interface CacheProvider {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Human-readable name reported by /health */
  readonly name: string;
}

interface InternalCacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number; // Unix ms; Infinity = never expires
}

/** Default cache: in-process Map with lazy TTL eviction. */
export class InMemoryCache implements CacheProvider {
  readonly name = 'in-memory';
  private store = new Map<string, InternalCacheEntry<unknown>>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { value: entry.value as T, timestamp: entry.timestamp };
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    const expiresAt = ttlSeconds <= 0 ? Infinity : now + ttlSeconds * 1000;
    this.store.set(key, { value, timestamp: now, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
