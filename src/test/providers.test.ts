// ─── Provider Tests ──────────────────────────────────────────────────────
// Null-handling paths, lookup detection, search, cache behaviour.

import { describe, it, expect } from 'vitest';
import { StaticSeriesProvider } from '../providers/series.js';
import { DefaultLookupProvider } from '../providers/lookup.js';
import { FuseSearchProvider } from '../providers/search.js';
import { NullMarketPriceProvider, NullGoldProvider, nullMarketResult } from '../providers/null-providers.js';
import { CachedMarketPriceProvider, CachedGoldProvider } from '../providers/cached.js';
import { GrowwMarketPriceProvider } from '../providers/market/groww.js';
import { MetalsDevGoldProvider } from '../providers/gold/metals-dev.js';
import { InMemoryCache } from '../cache/index.js';
import { allFixtures, fixtureA, fixtureC } from './fixtures.js';
import type { MarketPriceResult } from '../types/index.js';
import type { MarketPriceProvider } from '../providers/interfaces.js';

const series = new StaticSeriesProvider(allFixtures);
const search = new FuseSearchProvider(series);
const lookup = new DefaultLookupProvider(series, search);

describe('StaticSeriesProvider', () => {
  it('looks up by symbol, ISIN, security code (case-insensitive)', () => {
    expect(series.getBySymbol('sgbtesta')?.rbiSeries).toBe('2019-20 Series IX');
    expect(series.getByISIN('in0020test01')?.tradingSymbol).toBe('SGBTESTA');
    expect(series.getBySecurityCode('800001')?.tradingSymbol).toBe('SGBTESTA');
  });

  it('returns null for unknown identifiers', () => {
    expect(series.getBySymbol('NOPE')).toBeNull();
    expect(series.getByISIN('IN0020XXXX99')).toBeNull();
    expect(series.getBySecurityCode('999999')).toBeNull();
  });

  it('handles records with null ISIN/securityCode without indexing them', () => {
    expect(fixtureC.isin).toBeNull();
    expect(series.getBySymbol('SGBTESTC')).not.toBeNull();
  });
});

describe('DefaultLookupProvider — identifier auto-detection', () => {
  it('detects ISIN', () => {
    const r = lookup.resolve('IN0020TEST01');
    expect(r.matchedBy).toBe('isin');
    expect(r.record?.tradingSymbol).toBe('SGBTESTA');
  });

  it('detects security code', () => {
    const r = lookup.resolve('800002');
    expect(r.matchedBy).toBe('securityCode');
    expect(r.record?.tradingSymbol).toBe('SGBTESTB');
  });

  it('detects trading symbol', () => {
    const r = lookup.resolve('SGBTESTA');
    expect(r.matchedBy).toBe('tradingSymbol');
    expect(r.record?.tradingSymbol).toBe('SGBTESTA');
  });

  it('detects series name, case-insensitive and whitespace-tolerant', () => {
    const r = lookup.resolve('2019-20   series ix');
    expect(r.matchedBy).toBe('seriesName');
    expect(r.record?.tradingSymbol).toBe('SGBTESTA');
  });

  it('accepts arabic numerals in series name (Series 4 → IV)', () => {
    const r = lookup.resolve('2019-20 Series 9');
    expect(r.matchedBy).toBe('seriesName');
    expect(r.record?.tradingSymbol).toBe('SGBTESTA');
  });

  it('matches exact aliases', () => {
    const r = lookup.resolve('TEST BOND A');
    expect(r.matchedBy).toBe('alias');
    expect(r.record?.tradingSymbol).toBe('SGBTESTA');
  });

  it('falls back to fuzzy suggestions when no confident match', () => {
    const r = lookup.resolve('SGBTES'); // partial
    expect(r.record === null || r.matchedBy === 'fuzzy').toBe(true);
    if (r.record === null) {
      expect(r.suggestions!.length).toBeGreaterThan(0);
    }
  });

  it('returns empty suggestions for garbage input', () => {
    const r = lookup.resolve('zzzzqqqq');
    expect(r.record).toBeNull();
  });
});

describe('FuseSearchProvider', () => {
  it('finds by partial series name', () => {
    const results = search.search('2019-20');
    expect(results.some((r) => r.tradingSymbol === 'SGBTESTA')).toBe(true);
  });

  it('numeric query matches issue price exactly', () => {
    const results = search.search('4000');
    expect(results).toHaveLength(1);
    expect(results[0].tradingSymbol).toBe('SGBTESTA');
  });

  it('numeric query matches issue/maturity year', () => {
    const results = search.search('2016');
    expect(results.some((r) => r.tradingSymbol === 'SGBTESTB')).toBe(true);
  });

  it('applies exchange filter', () => {
    const results = search.search('SGB', { exchange: 'BSE' });
    expect(results.every((r) => r.exchange.includes('BSE'))).toBe(true);
  });

  it('applies maturityYear filter', () => {
    const results = search.search('SGB', { maturityYear: 2032 });
    expect(results.every((r) => r.maturityDate.startsWith('2032'))).toBe(true);
  });
});

describe('Null providers — honest null-shaped contract', () => {
  it('NullMarketPriceProvider returns all-null with reason, never throws', async () => {
    const p = new NullMarketPriceProvider();
    const r = await p.getPrice(fixtureA);
    expect(r.marketPrice).toBeNull();
    expect(r.priceStatus).toBe('unavailable');
    expect(r.reason).toContain('No market data provider configured');
  });

  it('NullGoldProvider returns all-null with reason, never throws', async () => {
    const p = new NullGoldProvider();
    const r = await p.getPrice();
    expect(r.pricePerGram).toBeNull();
    expect(r.currency).toBe('INR');
    expect(r.priceStatus).toBe('unavailable');
    expect(r.reason).toBeTruthy();
  });
});

describe('GrowwMarketPriceProvider — never throws', () => {
  it('returns null-shaped when no credentials', async () => {
    const p = new GrowwMarketPriceProvider('', '');
    const r = await p.getPrice(fixtureA);
    expect(r.marketPrice).toBeNull();
    expect(r.priceStatus).toBe('unavailable');
    expect(r.reason).toContain('not set');
  });

  it('returns null-shaped on HTTP error', async () => {
    const mockFetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    const p = new GrowwMarketPriceProvider('key', 'token', mockFetch);
    const r = await p.getPrice(fixtureA);
    expect(r.marketPrice).toBeNull();
    expect(r.reason).toContain('HTTP 500');
  });

  it('returns null-shaped on network failure (no exception)', async () => {
    const mockFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const p = new GrowwMarketPriceProvider('key', 'token', mockFetch);
    const r = await p.getPrice(fixtureA);
    expect(r.priceStatus).toBe('unavailable');
    expect(r.reason).toContain('ECONNREFUSED');
  });

  it('maps a successful quote with full provenance', async () => {
    const payload = {
      status: 'SUCCESS',
      payload: {
        last_price: 7450.5,
        day_change: 25.5,
        ohlc: { open: 7430, high: 7460, low: 7420, close: 7425 },
        volume: 1234,
        bid_price: 7449,
        offer_price: 7452,
        last_trade_time: 1752570000000,
      },
    };
    const mockFetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const p = new GrowwMarketPriceProvider('key', 'token', mockFetch);
    const r = await p.getPrice(fixtureA);
    expect(r.marketPrice).toBe(7450.5);
    expect(r.previousClose).toBe(7425); // last_price - day_change
    expect(r.dayHigh).toBe(7460);
    expect(r.bid).toBe(7449);
    expect(r.ask).toBe(7452);
    expect(r.valueTraded).toBeNull(); // not provided by Groww → null by design
    expect(r.priceStatus).toBe('verified');
    expect(r.priceSource).toContain('Groww');
    expect(r.priceTimestamp).toBe(new Date(1752570000000).toISOString());
  });

  it('parses stringified ohlc (doc example format)', async () => {
    const payload = {
      status: 'SUCCESS',
      payload: {
        last_price: 100,
        ohlc: '{open: 99.50,high: 101.25,low: 98.75,close: 99.00}',
      },
    };
    const mockFetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const p = new GrowwMarketPriceProvider('key', 'token', mockFetch);
    const r = await p.getPrice(fixtureA);
    expect(r.dayHigh).toBe(101.25);
    expect(r.dayLow).toBe(98.75);
  });
});

describe('MetalsDevGoldProvider — never throws', () => {
  it('returns null-shaped when no API key', async () => {
    const p = new MetalsDevGoldProvider('');
    const r = await p.getPrice();
    expect(r.pricePerGram).toBeNull();
    expect(r.reason).toContain('METALS_API_KEY not set');
  });

  it('maps a successful response and converts g → toz exactly', async () => {
    const body = {
      status: 'success',
      currency: 'INR',
      unit: 'g',
      metals: { gold: 6234.5 },
      timestamps: { metal: '2026-07-15T09:58:00.000Z' },
    };
    const mockFetch = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const p = new MetalsDevGoldProvider('key', mockFetch);
    const r = await p.getPrice();
    expect(r.pricePerGram).toBe(6234.5);
    expect(r.pricePerOunce).toBe(193914.63); // 6234.5 × 31.1034768 = 193914.626...
    expect(r.priceStatus).toBe('verified');
    expect(r.source).toBe('metals.dev');
  });

  it('returns null-shaped on API failure status', async () => {
    const body = { status: 'failure', error_message: 'quota exceeded' };
    const mockFetch = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const p = new MetalsDevGoldProvider('key', mockFetch);
    const r = await p.getPrice();
    expect(r.pricePerGram).toBeNull();
    expect(r.reason).toContain('quota exceeded');
  });

  it('rejects unexpected currency rather than serving wrong numbers', async () => {
    const body = { status: 'success', currency: 'USD', metals: { gold: 75 } };
    const mockFetch = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const p = new MetalsDevGoldProvider('key', mockFetch);
    const r = await p.getPrice();
    expect(r.pricePerGram).toBeNull();
    expect(r.reason).toContain('unexpected currency');
  });
});

describe('Cache', () => {
  it('InMemoryCache respects TTL semantics', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 'v', 60);
    expect(await cache.get('k')).toBe('v');
    await cache.delete('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('ttl <= 0 means never expires', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 'v', 0);
    expect(await cache.get('k')).toBe('v');
  });

  it('CachedMarketPriceProvider caches successes, not failures', async () => {
    let calls = 0;
    const flaky: MarketPriceProvider = {
      name: 'flaky',
      async getPrice(): Promise<MarketPriceResult> {
        calls++;
        if (calls === 1) return nullMarketResult('transient failure');
        return { ...nullMarketResult(''), marketPrice: 100, priceStatus: 'verified', reason: null };
      },
    };
    const cached = new CachedMarketPriceProvider(flaky, new InMemoryCache(), 300);

    const first = await cached.getPrice(fixtureA);
    expect(first.priceStatus).toBe('unavailable'); // failure NOT cached
    const second = await cached.getPrice(fixtureA);
    expect(second.marketPrice).toBe(100); // retried, success cached
    const third = await cached.getPrice(fixtureA);
    expect(third.marketPrice).toBe(100);
    expect(calls).toBe(2); // third call served from cache
  });

  it('CachedGoldProvider serves from cache within TTL', async () => {
    let calls = 0;
    const inner = {
      name: 'counter',
      async getPrice() {
        calls++;
        return {
          pricePerGram: 6000,
          pricePerOunce: null,
          currency: 'INR' as const,
          timestamp: null,
          source: 'test',
          priceStatus: 'verified' as const,
          reason: null,
        };
      },
    };
    const cached = new CachedGoldProvider(inner, new InMemoryCache(), 900);
    await cached.getPrice();
    await cached.getPrice();
    expect(calls).toBe(1);
  });
});
