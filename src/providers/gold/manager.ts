import { GoldProvider } from '../interfaces.js';
import type { GoldPriceResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class GoldDataManager implements GoldProvider {
  public readonly name = 'GoldDataManager';
  private cache: { data: GoldPriceResult | null, expiresAt: number } = { data: null, expiresAt: 0 };
  private fallbackCache: GoldPriceResult | null = null;
  private readonly TTL_MS = 60 * 1000; // 60 seconds

  constructor(private providers: GoldProvider[]) {}

  public async getPrice(): Promise<GoldPriceResult> {
    const now = Date.now();
    
    if (this.cache.data && now < this.cache.expiresAt) {
      logger.info('Cache hit: Gold & Silver');
      return { ...this.cache.data, cached: true };
    }

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        const result = await provider.getPrice();
        
        if (result.priceStatus === 'verified') {
          logger.info(`Live gold/silver quote received from ${provider.name}`);
          
          this.cache = {
            data: result,
            expiresAt: now + this.TTL_MS
          };
          this.fallbackCache = result;
          
          return result;
        } else {
           if (i < this.providers.length - 1) {
             logger.warn(`${provider.name} provider unavailable, falling back to ${this.providers[i + 1].name}`);
           } else {
             logger.warn(`${provider.name} provider unavailable. No more fallbacks.`);
           }
        }
      } catch (e: any) {
        if (i < this.providers.length - 1) {
           logger.error(`${provider.name} request failed (${e.message}). Falling back to ${this.providers[i + 1].name}`);
        } else {
           logger.error(`${provider.name} request failed. No more fallbacks.`);
        }
      }
    }

    // Both failed
    if (this.fallbackCache) {
      logger.warn('All live providers failed. Using last known successful cache.');
      return { ...this.fallbackCache, cached: true, priceStatus: 'delayed' };
    }

    // No fallback cache
    return {
      goldPricePerGram: null,
      goldPricePerOunce: null,
      silverPricePerGram: null,
      silverPricePerOunce: null,
      currency: 'INR',
      timestamp: null,
      source: 'None',
      cached: false,
      priceStatus: 'unavailable',
      reason: 'All providers failed and no cache available'
    };
  }
}
