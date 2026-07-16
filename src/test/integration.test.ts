// ─── Integration Tests ───────────────────────────────────────────────────
// Real Fastify instance with fixture data injected; hits every route and
// validates response shapes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../build-app.js';
import { InMemoryCache } from '../cache/index.js';
import { StaticSeriesProvider } from '../providers/series.js';
import { DefaultLookupProvider } from '../providers/lookup.js';
import { FuseSearchProvider } from '../providers/search.js';
import { NullMarketPriceProvider, NullGoldProvider } from '../providers/null-providers.js';
import { allFixtures } from './fixtures.js';
import { marketPriceResultSchema, goldPriceResultSchema } from '../types/schemas.js';

let app: FastifyInstance;

beforeAll(async () => {
  const seriesProvider = new StaticSeriesProvider(allFixtures);
  const searchProvider = new FuseSearchProvider(seriesProvider);
  const deps: AppDeps = {
    seriesProvider,
    searchProvider,
    lookupProvider: new DefaultLookupProvider(seriesProvider, searchProvider),
    marketPriceProvider: new NullMarketPriceProvider(),
    goldProvider: new NullGoldProvider(),
    cacheProvider: new InMemoryCache(),
  };
  app = await buildApp(deps, { logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /series', () => {
  it('returns all series with derived fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/series' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(3);
    expect(body.series[0].derived).toBeDefined();
    expect(body.series[0].couponSchedule[0].status).toMatch(/^(paid|upcoming)$/);
    expect(body.series[0].provenance.sourceDocument).toBeTruthy();
  });
});

describe('GET /series/:symbol', () => {
  it('returns a single series', async () => {
    const res = await app.inject({ method: 'GET', url: '/series/SGBTESTA' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rbiSeries).toBe('2019-20 Series IX');
  });

  it('404s with structured error for unknown symbol', async () => {
    const res = await app.inject({ method: 'GET', url: '/series/UNKNOWN' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('Not Found');
    expect(body.statusCode).toBe(404);
  });
});

describe('GET /isin/:isin', () => {
  it('returns series by ISIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/isin/IN0020TEST01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tradingSymbol).toBe('SGBTESTA');
  });

  it('400s for malformed ISIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/isin/NOT_AN_ISIN!' });
    expect(res.statusCode).toBe(400);
  });

  it('404s for valid-format unknown ISIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/isin/IN0020999999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /security/:code', () => {
  it('returns series by security code', async () => {
    const res = await app.inject({ method: 'GET', url: '/security/800001' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tradingSymbol).toBe('SGBTESTA');
  });
});

describe('GET /lookup/:identifier', () => {
  it('resolves ISIN with matchedBy', async () => {
    const res = await app.inject({ method: 'GET', url: '/lookup/IN0020TEST02' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matchedBy).toBe('isin');
    expect(body.record.tradingSymbol).toBe('SGBTESTB');
  });

  it('resolves series name with URL-encoded spaces', async () => {
    const res = await app.inject({ method: 'GET', url: '/lookup/2019-20%20Series%20IX' });
    expect(res.statusCode).toBe(200);
    expect(res.json().matchedBy).toBe('seriesName');
  });

  it('returns suggestions for ambiguous input', async () => {
    const res = await app.inject({ method: 'GET', url: '/lookup/SGBTEST' });
    const body = res.json();
    // Either fuzzy-resolved a single record or returned suggestions
    expect(body.record !== null || (body.suggestions && body.suggestions.length > 0)).toBe(true);
  });

  it('404s with empty result for garbage', async () => {
    const res = await app.inject({ method: 'GET', url: '/lookup/zzzzqqqqxxxx' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.record).toBeNull();
  });
});

describe('GET /search', () => {
  it('searches with query', async () => {
    const res = await app.inject({ method: 'GET', url: '/search?q=2019-20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThan(0);
    expect(body.results[0].derived).toBeDefined();
  });

  it('400s when q missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/search' });
    expect(res.statusCode).toBe(400);
    expect(res.json().statusCode).toBe(400);
  });

  it('applies filters', async () => {
    const res = await app.inject({ method: 'GET', url: '/search?q=SGB&exchange=BSE' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const r of body.results) expect(r.exchange).toContain('BSE');
  });

  it('rejects invalid filter values with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/search?q=SGB&exchange=LSE' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /market/:symbol — null-safety contract', () => {
  it('returns 200 with null-shaped payload when no provider configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/market/SGBTESTA' });
    expect(res.statusCode).toBe(200); // NEVER an exception for missing data
    const body = res.json();
    expect(body.symbol).toBe('SGBTESTA');
    expect(body.marketPrice).toBeNull();
    expect(body.priceStatus).toBe('unavailable');
    expect(body.reason).toBeTruthy();
    // Validate full contract shape
    const { symbol: _symbol, ...priceFields } = body;
    expect(() => marketPriceResultSchema.parse(priceFields)).not.toThrow();
  });

  it('404s for unknown symbol (resource, not data, missing)', async () => {
    const res = await app.inject({ method: 'GET', url: '/market/UNKNOWN' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /gold — null-safety contract', () => {
  it('returns 200 with null-shaped payload when no provider configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/gold' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pricePerGram).toBeNull();
    expect(body.currency).toBe('INR');
    expect(body.priceStatus).toBe('unavailable');
    expect(() => goldPriceResultSchema.parse(body)).not.toThrow();
  });
});

describe('GET /health', () => {
  it('reports status and provider names', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.seriesCount).toBe(3);
    expect(body.marketDataProvider).toBe('NSE Official');
    expect(body.goldPriceProvider).toBe('null');
    expect(body.cacheProvider).toBe('in-memory');
  });
});

describe('GET /docs & OpenAPI', () => {
  it('serves Swagger UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(res.statusCode);
  });

  it('serves the OpenAPI JSON spec', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/series']).toBeDefined();
    expect(spec.paths['/lookup/{identifier}']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('404s with structured body', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });
});
