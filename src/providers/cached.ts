// ─── Caching Provider Wrappers ───────────────────────────────────────────
// Decorators that add TTL caching in front of any MarketPriceProvider /
// GoldProvider without the underlying provider knowing about the cache.

import type { SGBRecord, MarketPriceResult, GoldPriceResult } from '../types/index.js';
import type { MarketPriceProvider, GoldProvider } from './interfaces.js';
import type { CacheProvider } from '../cache/index.js';

export class CachedMarketPriceProvider implements MarketPriceProvider {
  constructor(
    private inner: MarketPriceProvider,
    private cache: CacheProvider,
    private ttlSeconds: number,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async getPrice(record: SGBRecord): Promise<MarketPriceResult> {
    const key = `market:${this.inner.name}:${record.tradingSymbol}`;
    const cached = await this.cache.get<MarketPriceResult>(key);
    if (cached) return cached;

    const result = await this.inner.getPrice(record);
    // Only cache real data — a transient failure shouldn't pin
    // "unavailable" for the full TTL.
    if (result.priceStatus !== 'unavailable') {
      await this.cache.set(key, result, this.ttlSeconds);
    }
    return result;
  }
}

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
