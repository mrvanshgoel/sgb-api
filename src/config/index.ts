// ─── Application Configuration ──────────────────────────────────────────

import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Market data provider: 'null' | 'groww'
  // 'null' (default) returns null-shaped responses — honest absence of data.
  marketDataProvider: process.env.MARKET_DATA_PROVIDER || 'null',

  // Gold price provider: 'null' | 'metals'
  goldPriceProvider: process.env.GOLD_PRICE_PROVIDER || 'null',

  // Groww official Trade API (user's own credentials — never scraped)
  growwApiKey: process.env.GROWW_API_KEY || '',
  growwAccessToken: process.env.GROWW_ACCESS_TOKEN || '',

  // metals.dev API
  metalsApiKey: process.env.METALS_API_KEY || '',

  // Redis (optional; used by the Redis cache if a self-hoster wires one in)
  redisUrl: process.env.REDIS_URL || '',

  // Cache TTLs (seconds)
  marketDataTtl: parseInt(process.env.MARKET_DATA_TTL || '300', 10),
  goldPriceTtl: parseInt(process.env.GOLD_PRICE_TTL || '900', 10),

  get isDev(): boolean {
    return this.nodeEnv === 'development';
  },

  get isProd(): boolean {
    return this.nodeEnv === 'production';
  },
} as const;
