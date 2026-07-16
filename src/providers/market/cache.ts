import type { SGBRecord, FullMarketData } from '../../types/index.js';
import type { MarketPriceProvider } from '../interfaces.js';
import { logger } from '../../utils/logger.js';

interface CacheEntry {
  data: FullMarketData;
  timestamp: number;
  staleAt: number;
  expiresAt: number;
}

export class CachedMarketPriceProvider implements MarketPriceProvider {
  private cache = new Map<string, CacheEntry>();
  // To prevent multiple background fetches for the same symbol
  private activeFetches = new Map<string, Promise<FullMarketData>>();
  
  public stats = {
    hit: 0,
    miss: 0,
    stale: 0,
    expired: 0
  };

  private readonly STALE_LIVE_MS: number;
  private readonly CACHE_LIVE_MS: number;

  private readonly STALE_NEGATIVE_MS: number;
  private readonly CACHE_NEGATIVE_MS: number;

  private readonly STALE_403_MS: number;
  private readonly CACHE_403_MS: number;

  // TTLs default to the original NSE tuning so existing behaviour is byte-for-byte
  // unchanged. The SGBAnalyzer fallback passes overrides (success 30s, failures 10s).
  constructor(
    private inner: MarketPriceProvider,
    ttls?: {
      staleLiveMs?: number;
      cacheLiveMs?: number;
      staleNegativeMs?: number;
      cacheNegativeMs?: number;
      stale403Ms?: number;
      cache403Ms?: number;
    }
  ) {
    this.STALE_LIVE_MS = ttls?.staleLiveMs ?? 60 * 1000; // 60 seconds
    this.CACHE_LIVE_MS = ttls?.cacheLiveMs ?? 60 * 60 * 1000; // 1 hour
    this.STALE_NEGATIVE_MS = ttls?.staleNegativeMs ?? 10 * 60 * 1000; // 10 mins
    this.CACHE_NEGATIVE_MS = ttls?.cacheNegativeMs ?? 60 * 60 * 1000; // 1 hour
    this.STALE_403_MS = ttls?.stale403Ms ?? 10 * 1000; // 10 seconds
    this.CACHE_403_MS = ttls?.cache403Ms ?? 10 * 1000; // 10 seconds
  }

  get name(): string {
    return this.inner.name;
  }

  private setCache(symbol: string, result: FullMarketData) {
    const now = Date.now();
    let staleMs = result.quote.liveAvailable ? this.STALE_LIVE_MS : this.STALE_NEGATIVE_MS;
    let cacheMs = result.quote.liveAvailable ? this.CACHE_LIVE_MS : this.CACHE_NEGATIVE_MS;
    
    if (result.quote.reason?.includes('403') || result.quote.reason?.includes('401')) {
       staleMs = this.STALE_403_MS;
       cacheMs = this.CACHE_403_MS;
    }

    this.cache.set(symbol, {
      data: result,
      timestamp: now,
      staleAt: now + staleMs,
      expiresAt: now + cacheMs
    });
  }

  private async backgroundFetch(record: SGBRecord) {
    const symbol = record.tradingSymbol!;
    if (this.activeFetches.has(symbol)) return;

    const promise = this.inner.getPrice(record).then(result => {
      if (result.quote.liveAvailable) {
         logger.info(`Background refresh successful for ${symbol}`);
         this.setCache(symbol, result);
      } else {
         // Don't overwrite a good cached value with a failed live attempt
         logger.warn(`Background refresh failed for ${symbol}: ${result.quote.reason}`);
         // If it's a 403, we should update the cache to prevent infinite loops, but maybe with a short TTL
         const existing = this.cache.get(symbol);
         if (existing && existing.data.quote.liveAvailable && (result.quote.reason?.includes('403') || result.quote.reason?.includes('401'))) {
           // We have a good value, but just got a 403. Let's extend the stale time slightly so we don't spam
           existing.staleAt = Date.now() + this.STALE_403_MS;
         } else {
           this.setCache(symbol, result);
         }
      }
      return result;
    }).finally(() => {
      this.activeFetches.delete(symbol);
    });

    this.activeFetches.set(symbol, promise);
  }

  public async getPrice(record: SGBRecord): Promise<FullMarketData> {
    const symbol = record.tradingSymbol;
    if (!symbol) {
      return this.getFallback('No symbol');
    }

    const now = Date.now();
    const cached = this.cache.get(symbol);

    if (cached) {
      const cacheAgeSeconds = Math.floor((now - cached.timestamp) / 1000);
      const cachedData = { ...cached.data, quote: { ...cached.data.quote, cached: true, cacheAgeSeconds } };

      if (now < cached.staleAt) {
        this.stats.hit++;
        return cachedData;
      } else if (now < cached.expiresAt) {
        this.stats.stale++;
        logger.info(`Stale cache hit for ${symbol}, triggering background refresh`);
        this.backgroundFetch(record).catch(err => logger.error(err as Error));
        return cachedData;
      } else {
        this.stats.expired++;
      }
    } else {
      this.stats.miss++;
    }

    // Fetch fresh data if miss or expired
    const activeFetch = this.activeFetches.get(symbol);
    if (activeFetch) {
       const result = await activeFetch;
       return { ...result, quote: { ...result.quote, cached: false } };
    }

    const promise = this.inner.getPrice(record).then(result => {
      this.setCache(symbol, result);
      return result;
    }).finally(() => {
      this.activeFetches.delete(symbol);
    });
    
    this.activeFetches.set(symbol, promise);
    return await promise;
  }

  public async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const results = new Map<string, FullMarketData>();
    const toFetch: SGBRecord[] = [];
    const now = Date.now();

    for (const record of records) {
      const symbol = record.tradingSymbol;
      if (!symbol) continue;

      const cached = this.cache.get(symbol);
      if (cached) {
        const cacheAgeSeconds = Math.floor((now - cached.timestamp) / 1000);
        const cachedData = { ...cached.data, quote: { ...cached.data.quote, cached: true, cacheAgeSeconds } };
        
        if (now < cached.staleAt) {
          this.stats.hit++;
          results.set(symbol, cachedData);
        } else if (now < cached.expiresAt) {
          this.stats.stale++;
          logger.info(`Stale cache hit for ${symbol}, triggering background refresh`);
          this.backgroundFetch(record).catch(err => logger.error(err as Error));
          results.set(symbol, cachedData);
        } else {
          this.stats.expired++;
          toFetch.push(record);
        }
      } else {
        this.stats.miss++;
        toFetch.push(record);
      }
    }

    if (toFetch.length > 0) {
      // Grouping them all together. This might not be fully activeFetch-aware for bulk,
      // but getMultiple doesn't use activeFetches. We just await inner.getMultiple.
      const fetchedResults = await this.inner.getMultiple(toFetch);
      for (const [symbol, data] of fetchedResults) {
         if (data.quote.liveAvailable) {
            this.setCache(symbol, data);
            results.set(symbol, data);
         } else {
            const existing = this.cache.get(symbol);
            if (existing) {
               // Extend TTL slightly if we already had a value but live failed
               if (existing.data.quote.liveAvailable && (data.quote.reason?.includes('403') || data.quote.reason?.includes('401'))) {
                  existing.staleAt = Date.now() + this.STALE_403_MS;
               } else {
                  this.setCache(symbol, data);
               }
               results.set(symbol, { ...existing.data, quote: { ...existing.data.quote, cached: true } });
            } else {
               this.setCache(symbol, data);
               results.set(symbol, data);
            }
         }
      }
    }

    return results;
  }
  
  private getFallback(reason: string): FullMarketData {
    return {
      quote: {
        lastPrice: null, previousClose: null, change: null, changePercent: null,
        open: null, high: null, low: null, averagePrice: null, volume: null, valueTraded: null,
        lastUpdated: null, source: this.name, cached: false, latencyMs: 0, liveAvailable: false, reason
      },
      depth: {
        buyPrice1: null, buyQuantity1: null, buyPrice2: null, buyQuantity2: null, buyPrice3: null, buyQuantity3: null, buyPrice4: null, buyQuantity4: null, buyPrice5: null, buyQuantity5: null,
        sellPrice1: null, sellQuantity1: null, sellPrice2: null, sellQuantity2: null, sellPrice3: null, sellQuantity3: null, sellPrice4: null, sellQuantity4: null, sellPrice5: null, sellQuantity5: null,
        totalBuyQuantity: null, totalSellQuantity: null, buySellRatio: null, spread: null
      },
      trade: {
        volume: null, vwap: null, previousClose: null, open: null, upperCircuit: null, lowerCircuit: null,
        fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, faceValue: null, series: null, isin: null, securityCode: null
      }
    };
  }
}
