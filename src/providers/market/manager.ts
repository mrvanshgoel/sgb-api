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
    const s = nseSessionManager.stats;
    // Derive a status from consecutive failures without touching response formats.
    let status: 'healthy' | 'degraded' | 'dead';
    if (s.consecutiveFailures === 0 && s.lastSuccess) status = 'healthy';
    else if (s.consecutiveFailures >= 3) status = 'dead';
    else if (s.consecutiveFailures > 0) status = 'degraded';
    else status = 'healthy';

    return {
      provider: this.primaryProvider.name,
      status,
      // Service-liveness flag consumed by /health — the API is up even when
      // NSE's IP-reputation block degrades the provider. Provider health is
      // reported via `status` / `consecutiveFailures` on /provider/health.
      healthy: true,
      transportMode: nseSessionManager.transportMode,
      cookieAgeSeconds: nseSessionManager.getCookieAgeSeconds(),
      cacheHitRate: this.calculateHitRate(),
      cacheStats: this.primaryProvider.stats,
      sessionStats: s,
      consecutiveFailures: s.consecutiveFailures,
      lastLatencyMs: s.lastLatencyMs,
      lastHttpStatus: s.lastHttpStatus,
      lastSuccess: s.lastSuccess?.toISOString() || null,
      lastFailure: s.lastFailure?.toISOString() || null,
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
