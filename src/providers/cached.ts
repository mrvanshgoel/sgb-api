// ─── Caching Provider Wrappers ───────────────────────────────────────────
// Decorators that add TTL caching in front of any GoldProvider without 
// the underlying provider knowing about the cache.

import type { GoldPriceResult } from '../types/index.js';
import type { GoldProvider } from './interfaces.js';
import type { CacheProvider } from '../cache/index.js';

export class CachedGoldProvider implements GoldProvider {
  constructor(
    private inner: GoldProvider,
    private cache: CacheProvider,
    private ttlSeconds: number,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async getPrice(): Promise<GoldPriceResult> {
    const key = `gold:${this.inner.name}`;
    const cached = await this.cache.get<GoldPriceResult>(key);
    if (cached) return cached;

    const result = await this.inner.getPrice();
    if (result.priceStatus !== 'unavailable') {
      await this.cache.set(key, result, this.ttlSeconds);
    }
    return result;
  }
}
