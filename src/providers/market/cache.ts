import type { SGBRecord, FullMarketData } from '../../types/index.js';
import type { MarketPriceProvider } from '../interfaces.js';

interface CacheEntry {
  data: FullMarketData;
  expiresAt: number;
}

export class CachedMarketPriceProvider implements MarketPriceProvider {
  private cache = new Map<string, CacheEntry>();
  
  public stats = {
    hit: 0,
    miss: 0,
    stale: 0,
    expired: 0
  };

  private readonly TTL_LIVE_MS = 30 * 1000; // 30 seconds
  private readonly TTL_NEGATIVE_MS = 10 * 60 * 1000; // 10 minutes
  
  constructor(private inner: MarketPriceProvider) {}

  get name(): string {
    return this.inner.name;
  }

  public async getPrice(record: SGBRecord): Promise<FullMarketData> {
    const symbol = record.tradingSymbol;
    if (!symbol) {
      return this.getFallback('No symbol');
    }

    const now = Date.now();
    const cached = this.cache.get(symbol);

    if (cached) {
      if (now < cached.expiresAt) {
        this.stats.hit++;
        return { ...cached.data, quote: { ...cached.data.quote, cached: true } };
      } else {
        this.stats.expired++;
      }
    } else {
      this.stats.miss++;
    }

    // Fetch fresh data
    const result = await this.inner.getPrice(record);
    
    // Set TTL based on whether data was successfully retrieved
    const ttl = result.quote.liveAvailable ? this.TTL_LIVE_MS : this.TTL_NEGATIVE_MS;
    
    this.cache.set(symbol, {
      data: result,
      expiresAt: now + ttl
    });

    return result;
  }

  public async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const results = new Map<string, FullMarketData>();
    const toFetch: SGBRecord[] = [];
    const now = Date.now();

    for (const record of records) {
      const symbol = record.tradingSymbol;
      if (!symbol) continue;

      const cached = this.cache.get(symbol);
      if (cached && now < cached.expiresAt) {
        this.stats.hit++;
        results.set(symbol, { ...cached.data, quote: { ...cached.data.quote, cached: true } });
      } else {
        if (cached) this.stats.expired++;
        else this.stats.miss++;
        toFetch.push(record);
      }
    }

    if (toFetch.length > 0) {
      const fetchedResults = await this.inner.getMultiple(toFetch);
      for (const [symbol, data] of fetchedResults) {
        const ttl = data.quote.liveAvailable ? this.TTL_LIVE_MS : this.TTL_NEGATIVE_MS;
        this.cache.set(symbol, { data, expiresAt: now + ttl });
        results.set(symbol, data);
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
