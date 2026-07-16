// ─── Provider Factory / Composition Root ────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config } from './config/index.js';
import type { SGBRecord } from './types/index.js';
import type { AppDeps } from './build-app.js';
import type { GoldProvider } from './providers/interfaces.js';
import { InMemoryCache, type CacheProvider } from './cache/index.js';
import { StaticSeriesProvider } from './providers/series.js';
import { DefaultLookupProvider } from './providers/lookup.js';
import { FuseSearchProvider } from './providers/search.js';
import { NullGoldProvider } from './providers/null-providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadSeriesData(): SGBRecord[] {
  const dataPath = path.join(__dirname, 'data', 'sgb-series.json');
  const file = JSON.parse(readFileSync(dataPath, 'utf-8')) as { series: SGBRecord[] };
  return file.series;
}

import { CoinGeckoGoldProvider } from './providers/gold/coingecko.js';
import { YahooFinanceGoldProvider } from './providers/gold/yahoo.js';
import { GoldDataManager } from './providers/gold/manager.js';

async function buildGoldProvider(): Promise<GoldProvider> {
  const providers = [
    new CoinGeckoGoldProvider(),
    new YahooFinanceGoldProvider()
  ];
  return new GoldDataManager(providers);
}

export async function buildDefaultDeps(): Promise<AppDeps> {
  const cacheProvider: CacheProvider = new InMemoryCache();
  const seriesProvider = new StaticSeriesProvider(loadSeriesData());
  const searchProvider = new FuseSearchProvider(seriesProvider);
  const lookupProvider = new DefaultLookupProvider(seriesProvider, searchProvider);

  const goldProvider = await buildGoldProvider();

  return {
    seriesProvider,
    lookupProvider,
    goldProvider,
    searchProvider,
    cacheProvider,
  };
}
