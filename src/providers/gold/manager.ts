import { GoldProvider } from '../interfaces.js';
import type { GoldPriceResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class GoldDataManager implements GoldProvider {
  public readonly name = 'GoldDataManager';
  private cache: { data: GoldPriceResult | null, timestamp: number, staleAt: number, expiresAt: number } = { data: null, timestamp: 0, staleAt: 0, expiresAt: 0 };
  private activeFetch: Promise<GoldPriceResult> | null = null;
  private readonly STALE_MS = 60 * 1000; // 60 seconds
  private readonly CACHE_MS = 120 * 1000; // 2 minutes (background refresh window)
  
  public stats = {
    lastSuccess: null as Date | null,
    lastFailure: null as Date | null,
    consecutiveFailures: 0,
    currentProvider: 'None'
  };

  constructor(private providers: GoldProvider[]) {}

  public getHealth() {
    let status = 'healthy';
    if (this.stats.consecutiveFailures > 0) status = 'degraded';
    if (this.stats.consecutiveFailures > 5) status = 'dead';
    return {
      provider: this.stats.currentProvider,
      status,
      lastSuccess: this.stats.lastSuccess?.toISOString() || null,
      lastFailure: this.stats.lastFailure?.toISOString() || null,
      consecutiveFailures: this.stats.consecutiveFailures
    };
  }

  private async backgroundFetch(): Promise<GoldPriceResult> {
    if (this.activeFetch) return this.activeFetch;

    const promise = (async () => {
      const now = Date.now();
      for (let i = 0; i < this.providers.length; i++) {
        const provider = this.providers[i];
        try {
          const result = await provider.getPrice();
          
          if (result.priceStatus === 'verified') {
            logger.info(`Live gold/silver quote received from ${provider.name}`);
            
            this.cache = {
              data: result,
              timestamp: now,
              staleAt: now + this.STALE_MS,
              expiresAt: now + this.CACHE_MS
            };
            
            this.stats.lastSuccess = new Date();
            this.stats.consecutiveFailures = 0;
            this.stats.currentProvider = provider.name;

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

      this.stats.lastFailure = new Date();
      this.stats.consecutiveFailures++;

      // If all providers fail, do not overwrite a good cache with null
      const existing = this.cache.data;
      if (existing) {
        // Extend stale time a bit to prevent immediate refetch loop
        this.cache.staleAt = Date.now() + 10000;
        return existing;
      }
      
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
        reason: 'All gold providers failed'
      } as GoldPriceResult;
    })().finally(() => {
      this.activeFetch = null;
    });

    this.activeFetch = promise;
    return promise;
  }

  public async getPrice(): Promise<GoldPriceResult> {
    const now = Date.now();
    
    if (this.cache.data) {
      const cacheAgeSeconds = Math.floor((now - this.cache.timestamp) / 1000);
      const cachedData = { ...this.cache.data, cached: true, cacheAgeSeconds };

      if (now < this.cache.staleAt) {
        logger.info('Cache hit: Gold & Silver');
        return cachedData;
      } else if (now < this.cache.expiresAt) {
        logger.info('Stale cache hit: Gold & Silver, triggering background refresh');
        this.backgroundFetch().catch(err => logger.error(err as Error));
        return cachedData;
      }
    }

    if (this.activeFetch) {
       const result = await this.activeFetch;
       return { ...result, cached: false };
    }

    return await this.backgroundFetch();
  }
}
