import type { SGBRecord, FullMarketData } from '../../types/index.js';
import type { MarketPriceProvider } from '../interfaces.js';
import { CachedMarketPriceProvider } from './cache.js';
import { NseMarketPriceProvider } from './nse/provider.js';
import { nseSessionManager } from './nse/session.js';

export class MarketDataManager {
  private primaryProvider: CachedMarketPriceProvider;

  constructor() {
    const nseProvider = new NseMarketPriceProvider();
    this.primaryProvider = new CachedMarketPriceProvider(nseProvider);
  }

  public async getQuote(record: SGBRecord): Promise<FullMarketData> {
    return this.primaryProvider.getPrice(record);
  }

  public async getMultipleQuotes(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    return this.primaryProvider.getMultiple(records);
  }

  public getHealth() {
    return {
      provider: this.primaryProvider.name,
      healthy: true,
      cookieAgeSeconds: nseSessionManager.getCookieAgeSeconds(),
      cacheHitRate: this.calculateHitRate(),
      cacheStats: this.primaryProvider.stats,
      sessionStats: nseSessionManager.stats,
      lastSuccess: nseSessionManager.stats.lastSuccess?.toISOString() || null,
      lastFailure: nseSessionManager.stats.lastFailure?.toISOString() || null,
    };
  }

  private calculateHitRate(): string {
    const s = this.primaryProvider.stats;
    const total = s.hit + s.miss;
    if (total === 0) return '0%';
    return ((s.hit / total) * 100).toFixed(1) + '%';
  }
}

export const marketDataManager = new MarketDataManager();
