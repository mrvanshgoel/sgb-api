import { GoldProvider } from '../interfaces.js';
import type { GoldPriceResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class YahooFinanceGoldProvider implements GoldProvider {
  public readonly name = 'Yahoo Finance';

  public async getPrice(): Promise<GoldPriceResult> {
    try {
      // Fetch Gold Futures (GC=F), Silver Futures (SI=F) and USD/INR (INR=X)
      const [goldRes, silverRes, inrRes] = await Promise.all([
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d'),
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1m&range=1d'),
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1m&range=1d')
      ]);

      if (!goldRes.ok || !silverRes.ok || !inrRes.ok) {
         throw new Error(`Yahoo Finance returned Gold:${goldRes.status} Silver:${silverRes.status} INR:${inrRes.status}`);
      }

      const goldJson = await goldRes.json() as any;
      const silverJson = await silverRes.json() as any;
      const inrJson = await inrRes.json() as any;

      const goldUsd = goldJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
      const silverUsd = silverJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
      const usdInr = inrJson?.chart?.result?.[0]?.meta?.regularMarketPrice;

      if (!goldUsd || !silverUsd || !usdInr) {
        throw new Error('Yahoo Finance missing expected market prices');
      }

      const TROY_OUNCE_GRAMS = 31.1034768;
      
      const goldOunce = goldUsd * usdInr;
      const silverOunce = silverUsd * usdInr;

      return {
        goldPricePerOunce: goldOunce,
        goldPricePerGram: goldOunce / TROY_OUNCE_GRAMS,
        silverPricePerOunce: silverOunce,
        silverPricePerGram: silverOunce / TROY_OUNCE_GRAMS,
        currency: 'INR',
        timestamp: new Date().toISOString(),
        source: this.name,
        cached: false,
        priceStatus: 'verified',
        reason: null
      };
    } catch (e: any) {
      logger.error(`Yahoo Finance request failed: ${e.message}`);
      return {
        goldPricePerGram: null,
        goldPricePerOunce: null,
        silverPricePerGram: null,
        silverPricePerOunce: null,
        currency: 'INR',
        timestamp: null,
        source: this.name,
        cached: false,
        priceStatus: 'unavailable',
        reason: e.message
      };
    }
  }
}
