// ─── Provider Interfaces ─────────────────────────────────────────────────
// Every data source behind the API is a swappable provider. Self-hosters
// can implement any of these and inject them via buildApp() without
// touching core API code.

import type {
  SGBRecord,
  MarketPriceResult,
  GoldPriceResult,
  LookupResult,
  SearchFilters,
} from '../types/index.js';

export interface SeriesProvider {
  getAll(): SGBRecord[];
  getBySymbol(symbol: string): SGBRecord | null;
  getByISIN(isin: string): SGBRecord | null;
  getBySecurityCode(code: string): SGBRecord | null;
  /** Human-readable name reported by /health */
  readonly name: string;
}

export interface LookupProvider {
  resolve(identifier: string): LookupResult;
}

export interface MarketPriceProvider {
  /** MUST NOT throw. On any failure, return a null-shaped MarketPriceResult. */
  getPrice(record: SGBRecord): Promise<MarketPriceResult>;
  readonly name: string;
}

export interface GoldProvider {
  /** MUST NOT throw. On any failure, return a null-shaped GoldPriceResult. */
  getPrice(): Promise<GoldPriceResult>;
  readonly name: string;
}

export interface SearchProvider {
  search(query: string, filters?: SearchFilters): SGBRecord[];
}
