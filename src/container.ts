// ─── Provider Factory / Composition Root ────────────────────────────────
// Chooses provider implementations from config. Self-hosters who want a
// custom provider skip this and call buildApp() with their own instances.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config } from './config/index.js';
import type { SGBRecord } from './types/index.js';
import type { AppDeps } from './build-app.js';
import type { MarketPriceProvider, GoldProvider } from './providers/interfaces.js';
import { InMemoryCache, type CacheProvider } from './cache/index.js';
import { StaticSeriesProvider } from './providers/series.js';
import { DefaultLookupProvider } from './providers/lookup.js';
import { FuseSearchProvider } from './providers/search.js';
import { NullMarketPriceProvider, NullGoldProvider } from './providers/null-providers.js';
import { CachedMarketPriceProvider, CachedGoldProvider } from './providers/cached.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadSeriesData(): SGBRecord[] {
  const dataPath = path.join(__dirname, 'data', 'sgb-series.json');
  const file = JSON.parse(readFileSync(dataPath, 'utf-8')) as { series: SGBRecord[] };
  return file.series;
}

async function buildMarketProvider(): Promise<MarketPriceProvider> {
  switch (config.marketDataProvider) {
    case 'groww': {
      const { GrowwMarketPriceProvider } = await import('./providers/market/groww.js');
      return new GrowwMarketPriceProvider(config.growwApiKey, config.growwAccessToken);
    }
    case 'null':
    default:
      return new NullMarketPriceProvider();
  }
}

async function buildGoldProvider(): Promise<GoldProvider> {
  switch (config.goldPriceProvider) {
    case 'metals': {
      const { MetalsDevGoldProvider } = await import('./providers/gold/metals-dev.js');
      return new MetalsDevGoldProvider(config.metalsApiKey);
    }
    case 'null':
    default:
      return new NullGoldProvider();
  }
}

export async function buildDefaultDeps(): Promise<AppDeps> {
  const cacheProvider: CacheProvider = new InMemoryCache();
  const seriesProvider = new StaticSeriesProvider(loadSeriesData());
  const searchProvider = new FuseSearchProvider(seriesProvider);
  const lookupProvider = new DefaultLookupProvider(seriesProvider, searchProvider);

  const marketPriceProvider = new CachedMarketPriceProvider(
    await buildMarketProvider(),
    cacheProvider,
    config.marketDataTtl,
  );
  const goldProvider = new CachedGoldProvider(
    await buildGoldProvider(),
    cacheProvider,
    config.goldPriceTtl,
  );

  return {
    seriesProvider,
    lookupProvider,
    marketPriceProvider,
    goldProvider,
    searchProvider,
    cacheProvider,
  };
}
