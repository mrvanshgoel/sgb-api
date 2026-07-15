// ─── Pluggable Cache Layer ───────────────────────────────────────────────
// Default: in-memory Map with TTL. Self-hosters can swap in Redis or any
// other backend by implementing CacheProvider and passing it to buildApp().

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Human-readable name reported by /health */
  readonly name: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix ms; Infinity = never expires
}

/** Default cache: in-process Map with lazy TTL eviction. */
export class InMemoryCache implements CacheProvider {
  readonly name = 'in-memory';
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const expiresAt = ttlSeconds <= 0 ? Infinity : Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
