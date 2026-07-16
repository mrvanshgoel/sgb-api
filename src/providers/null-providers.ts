// ─── Null Providers (safe defaults) ──────────────────────────────────────
// The default out-of-the-box providers. They return the null-shaped
// contract honestly: no compliant public source is configured, so every
// price field is null with an explanatory reason. Self-hosters opt into
// real providers via env config or dependency injection.

import type { FullMarketData, SGBRecord, GoldPriceResult } from '../types/index.js';
import type { MarketPriceProvider, GoldProvider } from './interfaces.js';

export class NullMarketPriceProvider implements MarketPriceProvider {
  public readonly name = 'NullProvider';

  public async getPrice(_record: SGBRecord): Promise<FullMarketData> {
    return this.createNullData('Not configured');
  }

  public async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const map = new Map<string, FullMarketData>();
    for (const r of records) {
      if (r.tradingSymbol) {
        map.set(r.tradingSymbol, this.createNullData('Not configured'));
      }
    }
    return map;
  }

  private createNullData(reason: string): FullMarketData {
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

export function nullGoldResult(reason: string): GoldPriceResult {
  return {
    goldPricePerGram: null,
    goldPricePerOunce: null,
    silverPricePerGram: null,
    silverPricePerOunce: null,
    currency: 'INR',
    timestamp: null,
    source: null,
    cached: false,
    priceStatus: 'unavailable',
    reason
  };
}

export class NullGoldProvider implements GoldProvider {
  public readonly name = 'NullGoldProvider';

  public async getPrice(): Promise<GoldPriceResult> {
    return nullGoldResult('No gold price provider configured. Set GOLD_PRICE_PROVIDER=metals with METALS_API_KEY or inject a provider (see README).');
  }

  public getHealth() {
    return {
      status: 'dead',
      provider: 'None',
      consecutiveFailures: 0,
      lastSuccess: null,
      lastFailure: null
    };
  }
}
