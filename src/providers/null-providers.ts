// ─── Null Providers (safe defaults) ──────────────────────────────────────
// The default out-of-the-box providers. They return the null-shaped
// contract honestly: no compliant public source is configured, so every
// price field is null with an explanatory reason. Self-hosters opt into
// real providers via env config or dependency injection.

import type { SGBRecord, MarketPriceResult, GoldPriceResult } from '../types/index.js';
import type { MarketPriceProvider, GoldProvider } from './interfaces.js';

export function nullMarketResult(reason: string): MarketPriceResult {
  return {
    marketPrice: null,
    previousClose: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    valueTraded: null,
    bid: null,
    ask: null,
    priceSource: null,
    priceTimestamp: null,
    priceDelay: null,
    priceStatus: 'unavailable',
    reason,
  };
}

export function nullGoldResult(reason: string): GoldPriceResult {
  return {
    pricePerGram: null,
    pricePerOunce: null,
    currency: 'INR',
    timestamp: null,
    source: null,
    priceStatus: 'unavailable',
    reason,
  };
}

export class NullMarketPriceProvider implements MarketPriceProvider {
  readonly name = 'null';

  async getPrice(_record: SGBRecord): Promise<MarketPriceResult> {
    return nullMarketResult(
      'No market data provider configured. Set MARKET_DATA_PROVIDER or inject a provider (see README).',
    );
  }
}

export class NullGoldProvider implements GoldProvider {
  readonly name = 'null';

  async getPrice(): Promise<GoldPriceResult> {
    return nullGoldResult(
      'No gold price provider configured. Set GOLD_PRICE_PROVIDER=metals with METALS_API_KEY or inject a provider (see README).',
    );
  }
}
