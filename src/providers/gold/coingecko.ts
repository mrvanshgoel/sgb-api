import { GoldProvider } from '../interfaces.js';
import type { GoldPriceResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class CoinGeckoGoldProvider implements GoldProvider {
  public readonly name = 'CoinGecko';

  public async getPrice(): Promise<GoldPriceResult> {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether-gold,kinesis-silver&vs_currencies=inr');
      if (!res.ok) {
        throw new Error(`CoinGecko returned ${res.status}`);
      }
      
      const json = await res.json() as any;
      
      if (!json['tether-gold'] || !json['kinesis-silver']) {
        throw new Error('CoinGecko missing expected token data');
      }

      const goldOunce = json['tether-gold'].inr;
      const silverOunce = json['kinesis-silver'].inr;
      
      const TROY_OUNCE_GRAMS = 31.1034768;

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
      logger.error(`CoinGecko request failed: ${e.message}`);
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
