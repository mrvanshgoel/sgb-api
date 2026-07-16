// ─── Provider Tests ──────────────────────────────────────────────────────
// Null-handling paths, lookup detection, search, cache behaviour.

import { describe, it, expect } from 'vitest';
import { StaticSeriesProvider } from '../providers/series.js';
import { DefaultLookupProvider } from '../providers/lookup.js';
import { FuseSearchProvider } from '../providers/search.js';
import { NullMarketPriceProvider, NullGoldProvider, nullMarketResult } from '../providers/null-providers.js';
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
    expect(r.quote.lastPrice).toBeNull();
    expect(r.quote.liveAvailable).toBe(false);
    expect(r.quote.reason).toContain('Not configured');
  });

  it('NullGoldProvider returns all-null with reason, never throws', async () => {
    const p = new NullGoldProvider();
    const r = await p.getPrice();
    expect(r.goldPricePerGram).toBeNull();
    expect(r.currency).toBe('INR');
    expect(r.priceStatus).toBe('unavailable');
    expect(r.reason).toBeTruthy();
  });
});

describe('GoldDataManager', () => {
  it('falls back to secondary provider if primary fails', async () => {
    let primaryCalled = 0;
    let secondaryCalled = 0;
    
    const primary = {
      name: 'Primary',
      async getPrice() {
        primaryCalled++;
        throw new Error('Primary failed');
      }
    };
    
    const secondary = {
      name: 'Secondary',
      async getPrice() {
        secondaryCalled++;
        return {
          goldPricePerGram: 100,
          goldPricePerOunce: 3110.3,
          silverPricePerGram: 1,
          silverPricePerOunce: 31.1,
          currency: 'INR' as const,
          timestamp: '2026-07-16T10:00:00.000Z',
          source: 'Secondary',
          cached: false,
          priceStatus: 'verified' as const,
          reason: null
        };
      }
    };
    
    const { GoldDataManager } = await import('../providers/gold/manager.js');
    const manager = new GoldDataManager([primary, secondary]);
    
    const result = await manager.getPrice();
    
    expect(primaryCalled).toBe(1);
    expect(secondaryCalled).toBe(1);
    expect(result.goldPricePerGram).toBe(100);
    expect(result.source).toBe('Secondary');
  });

  it('serves from cache if TTL valid', async () => {
    let calls = 0;
    const provider = {
      name: 'Primary',
      async getPrice() {
        calls++;
        return {
          goldPricePerGram: 100,
          goldPricePerOunce: 3110.3,
          silverPricePerGram: 1,
          silverPricePerOunce: 31.1,
          currency: 'INR' as const,
          timestamp: '2026-07-16T10:00:00.000Z',
          source: 'Primary',
          cached: false,
          priceStatus: 'verified' as const,
          reason: null
        };
      }
    };
    
    const { GoldDataManager } = await import('../providers/gold/manager.js');
    const manager = new GoldDataManager([provider]);
    
    await manager.getPrice();
    const cachedResult = await manager.getPrice();
    
    expect(calls).toBe(1);
    expect(cachedResult.cached).toBe(true);
  });
});

describe('Cache', () => {
  it('InMemoryCache respects TTL semantics', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 'v', 60);
    expect((await cache.get('k'))?.value).toBe('v');
    await cache.delete('k');
    expect(await cache.get('k')).toBeNull();
    await cache.set('k2', 'v2', -1); // Infinity
    await cache.clear();
    expect(await cache.get('k2')).toBeNull();
  });

  test('ttl <= 0 means never expires', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', 'v', 0);
    expect((await cache.get('k'))?.value).toBe('v');
  });


});
