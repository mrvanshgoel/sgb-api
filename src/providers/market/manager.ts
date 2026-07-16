import type { SGBRecord, FullMarketData, SgbAnalytics } from '../../types/index.js';
import type { MarketPriceProvider } from '../interfaces.js';
import { CachedMarketPriceProvider } from './cache.js';
import { NseMarketPriceProvider } from './nse/provider.js';
import { SgbAnalyzerProvider } from './sgbanalyzer/provider.js';
import { nseSessionManager } from './nse/session.js';
import { logger } from '../../utils/logger.js';

export class MarketDataManager {
  private primaryProvider: CachedMarketPriceProvider;
  private fallbackProvider: CachedMarketPriceProvider;
  // Raw SGBAnalyzer provider kept for valuation analytics, which are sourced
  // only from its CSV and are not part of the NSE-first quote failover path.
  private analyticsProvider: SgbAnalyzerProvider;

  // Providers may be injected for testing. In production both are omitted and
  // the real NSE + SGBAnalyzer providers are used with their default caching.
  constructor(primary?: MarketPriceProvider, fallback?: MarketPriceProvider) {
    const nseProvider = primary ?? new NseMarketPriceProvider();
    // NSE caching is left exactly as it was — no TTL overrides.
    this.primaryProvider = new CachedMarketPriceProvider(nseProvider);

    // SGBAnalyzer fallback: successes cached 30s, failures 10s. This never
    // increases NSE request frequency; it only bounds the fallback path.
    const sgbaProvider = fallback ?? new SgbAnalyzerProvider();
    this.fallbackProvider = new CachedMarketPriceProvider(sgbaProvider, {
      staleLiveMs: 30 * 1000,
      cacheLiveMs: 30 * 1000,
      staleNegativeMs: 10 * 1000,
      cacheNegativeMs: 10 * 1000,
      stale403Ms: 10 * 1000,
      cache403Ms: 10 * 1000,
    });

    // Reuse the fallback instance for analytics when it is a real SGBAnalyzer
    // provider (production / matching tests); otherwise stand up a dedicated one.
    this.analyticsProvider =
      sgbaProvider instanceof SgbAnalyzerProvider ? sgbaProvider : new SgbAnalyzerProvider();
  }

  /** SGBAnalyzer valuation analytics for one symbol (rendered-page field names). */
  public async getAnalytics(record: SGBRecord): Promise<SgbAnalytics> {
    return this.analyticsProvider.getAnalytics(record);
  }

  /** Bulk SGBAnalyzer valuation analytics keyed by trading symbol. */
  public async getAllAnalytics(records: SGBRecord[]): Promise<Map<string, SgbAnalytics>> {
    return this.analyticsProvider.getAllAnalytics(records);
  }

  public async getQuote(record: SGBRecord): Promise<FullMarketData> {
    const symbol = record.tradingSymbol ?? '(unknown)';
    logger.info(`Requesting live quote ${symbol}`);

    const primary = await this.primaryProvider.getPrice(record);
    if (primary.quote.liveAvailable) {
      return primary;
    }

    logger.warn(`NSE unavailable (${primary.quote.reason ?? 'no data'})`);
    logger.info('Falling back to SGBAnalyzer');
    const fallback = await this.fallbackProvider.getPrice(record);
    if (fallback.quote.liveAvailable) {
      logger.info('Cache updated');
      return fallback;
    }

    // Neither source had a live price. Prefer whichever carries real context.
    return fallback.quote.reason ? fallback : primary;
  }

  public async getMultipleQuotes(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const primary = await this.primaryProvider.getMultiple(records);

    const failed = records.filter((r) => {
      const q = r.tradingSymbol ? primary.get(r.tradingSymbol) : undefined;
      return !q || !q.quote.liveAvailable;
    });

    if (failed.length === 0) {
      return primary;
    }

    logger.warn(`NSE unavailable for ${failed.length} symbol(s)`);
    logger.info('Falling back to SGBAnalyzer');
    const fallback = await this.fallbackProvider.getMultiple(failed);

    for (const [symbol, data] of fallback) {
      if (data.quote.liveAvailable) {
        primary.set(symbol, data);
      } else if (!primary.has(symbol)) {
        primary.set(symbol, data);
      }
    }
    return primary;
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
