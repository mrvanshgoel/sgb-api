// ─── API Routes ──────────────────────────────────────────────────────────
// All routes. Contracts:
//   • Malformed request        → 4xx with structured error body
//   • Unknown series           → 404 (the resource genuinely doesn't exist)
//   • Missing/unavailable DATA → 200 with null-shaped payload + reason

import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../build-app.js';
import { isDebug } from '../utils/logger.js';
import { toSeriesResponse, todayIST } from '../services/derived.js';
import {
  sgbRecordJson,
  marketPriceJson,
  goldPriceJson,
  errorJson,
  healthJson,
  providerHealthJson,
  lookupResultJson,
  quoteResponseJson,
  analyticsResponseJson,
  marketDepthJson,
  tradeInfoJson,
  statsJson,
  combinedLookupJson
} from './json-schemas.js';

export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { seriesProvider, lookupProvider, goldProvider, searchProvider, cacheProvider } = deps;

  // ── GET /series ────────────────────────────────────────────────────────
  app.get(
    '/series',
    {
      schema: {
        tags: ['series'],
        summary: 'All SGB series ever issued',
        response: {
          200: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
              asOf: { type: 'string', format: 'date' },
              series: { type: 'array', items: sgbRecordJson },
            },
          },
        },
      },
    },
    async () => {
      const today = todayIST();
      const all = seriesProvider.getAll();
      return {
        count: all.length,
        asOf: today,
        series: all.map((r) => toSeriesResponse(r, today)),
      };
    },
  );

  // ── GET /series/:symbol ────────────────────────────────────────────────
  app.get<{ Params: { symbol: string } }>(
    '/series/:symbol',
    {
      schema: {
        tags: ['series'],
        summary: 'Single series by trading symbol',
        params: {
          type: 'object',
          properties: { symbol: { type: 'string', minLength: 1, maxLength: 30 } },
          required: ['symbol'],
        },
        response: { 200: sgbRecordJson, 404: errorJson },
      },
    },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `No SGB series with trading symbol '${request.params.symbol}'. Try GET /lookup/{identifier} or GET /search?q=...`,
          statusCode: 404,
        });
      }
      return toSeriesResponse(record);
    },
  );

  // ── GET /isin/:isin ────────────────────────────────────────────────────
  app.get<{ Params: { isin: string } }>(
    '/isin/:isin',
    {
      schema: {
        tags: ['series'],
        summary: 'Single series by ISIN',
        params: {
          type: 'object',
          properties: { isin: { type: 'string', pattern: '^[A-Za-z]{2}[A-Za-z0-9]{10}$' } },
          required: ['isin'],
        },
        response: { 200: sgbRecordJson, 400: errorJson, 404: errorJson },
      },
    },
    async (request, reply) => {
      const record = seriesProvider.getByISIN(request.params.isin);
      if (!record) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `No SGB series with ISIN '${request.params.isin}'`,
          statusCode: 404,
        });
      }
      return toSeriesResponse(record);
    },
  );

  // ── GET /security/:securityCode ────────────────────────────────────────
  app.get<{ Params: { securityCode: string } }>(
    '/security/:securityCode',
    {
      schema: {
        tags: ['series'],
        summary: 'Single series by exchange security code',
        params: {
          type: 'object',
          properties: { securityCode: { type: 'string', minLength: 1, maxLength: 30 } },
          required: ['securityCode'],
        },
        response: { 200: sgbRecordJson, 404: errorJson },
      },
    },
    async (request, reply) => {
      const record = seriesProvider.getBySecurityCode(request.params.securityCode);
      if (!record) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `No SGB series with security code '${request.params.securityCode}'`,
          statusCode: 404,
        });
      }
      return toSeriesResponse(record);
    },
  );

  // ── GET /lookup/:identifier ────────────────────────────────────────────
  app.get<{ Params: { identifier: string } }>(
    '/lookup/:identifier',
    {
      schema: {
        tags: ['lookup'],
        summary: 'Universal auto-detecting lookup',
        description:
          'Accepts any identifier (ISIN, security code, trading symbol, series name, alias). ' +
          'Detects the format automatically; falls back to fuzzy suggestions. ' +
          '`matchedBy` reports which detection matched.',
        params: {
          type: 'object',
          properties: { identifier: { type: 'string', minLength: 1, maxLength: 100 } },
          required: ['identifier'],
        },
        response: { 200: lookupResultJson, 404: lookupResultJson },
      },
    },
    async (request, reply) => {
      const result = lookupProvider.resolve(request.params.identifier);
      const today = todayIST();
      const body = {
        record: result.record ? toSeriesResponse(result.record, today) : null,
        matchedBy: result.matchedBy,
        suggestions: result.suggestions
          ? result.suggestions.map((r) => toSeriesResponse(r, today))
          : null,
      };
      // No confident match and no suggestions → 404; suggestions → 200
      if (!result.record && (!result.suggestions || result.suggestions.length === 0)) {
        return reply.status(404).send(body);
      }
      return body;
    },
  );

  // ── GET /search ────────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      q: string;
      exchange?: 'NSE' | 'BSE';
      maturityYear?: number;
      issueYear?: number;
      activeOnly?: boolean;
    };
  }>(
    '/search',
    {
      schema: {
        tags: ['lookup'],
        summary: 'Fuzzy/structured search',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 200 },
            exchange: { type: 'string', enum: ['NSE', 'BSE'] },
            maturityYear: { type: 'integer', minimum: 2015, maximum: 2040 },
            issueYear: { type: 'integer', minimum: 2015, maximum: 2030 },
            activeOnly: { type: 'boolean', default: false },
          },
          required: ['q'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              count: { type: 'integer' },
              results: { type: 'array', items: sgbRecordJson },
            },
          },
          400: errorJson,
        },
      },
    },
    async (request) => {
      const { q, exchange, maturityYear, issueYear, activeOnly } = request.query;
      const results = searchProvider.search(q, { exchange, maturityYear, issueYear, activeOnly });
      const today = todayIST();
      return {
        query: q,
        count: results.length,
        results: results.map((r) => toSeriesResponse(r, today)),
      };
    },
  );

  // ── GET /market/:symbol ────────────────────────────────────────────────
  app.get<{ Params: { symbol: string } }>(
    '/market/:symbol',
    {
      schema: {
        tags: ['market'],
        summary: 'Live market data for a series (Legacy)',
        params: {
          type: 'object',
          properties: { symbol: { type: 'string', minLength: 1, maxLength: 30 } },
          required: ['symbol'],
        },
        response: { 200: marketPriceJson, 404: errorJson },
      },
    },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `No SGB series with trading symbol '${request.params.symbol}'`,
          statusCode: 404,
        });
      }
      
      const { marketDataManager } = await import('../providers/market/manager.js');
      const data = await marketDataManager.getQuote(record);
      const quote = data.quote;
      const analytics = await marketDataManager.getAnalytics(record);

      return {
        symbol: record.tradingSymbol,
        marketPrice: quote.lastPrice,
        previousClose: quote.previousClose,
        dayHigh: quote.high,
        dayLow: quote.low,
        volume: quote.volume,
        valueTraded: quote.valueTraded,
        bid: data.depth.buyPrice1,
        ask: data.depth.sellPrice1,
        priceSource: quote.source,
        priceTimestamp: quote.lastUpdated,
        priceDelay: quote.cached ? 'Delayed' : 'Real-time',
        priceStatus: quote.liveAvailable ? 'verified' : 'unavailable',
        reason: quote.reason || null,
        analytics
      };
    },
  );

  // ── GET /gold ──────────────────────────────────────────────────────────
  app.get(
    '/gold',
    {
      schema: {
        tags: ['gold'],
        summary: 'Live gold price (independent of SGB data)',
        response: { 200: goldPriceJson },
      },
    },
    async () => goldProvider.getPrice(),
  );

  // ── GET /health ────────────────────────────────────────────────────────
  app.get(
    '/health',
    {
      schema: { tags: ['meta'], summary: 'Service health check', response: { 200: healthJson } },
    },
    async () => {
      const { marketDataManager } = await import('../providers/market/manager.js');
      const mStats = marketDataManager.getHealth();
      return {
        status: mStats.healthy ? ('ok' as const) : ('degraded' as const),
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        seriesCount: seriesProvider.getAll().length,
        marketDataProvider: mStats.provider,
        goldPriceProvider: goldProvider.name,
        cacheProvider: cacheProvider.name,
      };
    },
  );

  // ── GET / ──────────────────────────────────────────────────────────────
  app.get('/', { schema: { hide: true } }, async () => ({
    name: 'SGB API',
    description: 'Open-source Sovereign Gold Bond (SGB) API for India',
    docs: '/docs',
    endpoints: [
      'GET /series',
      'GET /series/{symbol}',
      'GET /isin/{isin}',
      'GET /security/{securityCode}',
      'GET /lookup/{identifier}',
      'GET /search?q=...',
      'GET /market/{symbol} (Legacy)',
      'GET /price/{symbol}',
      'GET /prices?symbols=SGBJUL28IV,SGBAUG28V',
      'GET /depth/{symbol}',
      'GET /trade/{symbol}',
      'GET /gold',
      'GET /health',
      'GET /provider/health',
      'GET /stats',
      'GET /docs',
    ],
  }));

  // ── GET /price/:symbol ────────────────────────────────────────────────
  app.get<{ Params: { symbol: string } }>(
    '/price/:symbol',
    { schema: { response: { 200: quoteResponseJson, 404: errorJson } } },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) return reply.status(404).send({ error: 'Not Found', message: 'Symbol not found', statusCode: 404 });
      
      const { marketDataManager } = await import('../providers/market/manager.js');
      const start = Date.now();
      const data = await marketDataManager.getQuote(record);
      data.quote.latencyMs = Date.now() - start;

      const analytics = await marketDataManager.getAnalytics(record);
      return { symbol: record.tradingSymbol, market: data.quote, analytics };
    }
  );

  // ── GET /analytics/:symbol ────────────────────────────────────────────
  // SGBAnalyzer valuation analytics (rendered-page field names). Valuation
  // metrics, not live trades — see SgbAnalyzerProvider for the exact mapping.
  app.get<{ Params: { symbol: string } }>(
    '/analytics/:symbol',
    { schema: { response: { 200: analyticsResponseJson, 404: errorJson } } },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) return reply.status(404).send({ error: 'Not Found', message: 'Symbol not found', statusCode: 404 });

      const { marketDataManager } = await import('../providers/market/manager.js');
      const analytics = await marketDataManager.getAnalytics(record);
      return { symbol: record.tradingSymbol, analytics };
    }
  );

  // ── GET /analytics ────────────────────────────────────────────────────
  // Bulk analytics. Without ?symbols= returns every series in the dataset.
  app.get<{ Querystring: { symbols?: string } }>(
    '/analytics',
    async (request) => {
      const { marketDataManager } = await import('../providers/market/manager.js');
      const records = request.query.symbols
        ? request.query.symbols.split(',').map((s) => s.trim()).map((s) => seriesProvider.getBySymbol(s)).filter((r) => r !== null) as any[]
        : seriesProvider.getAll();
      const dataMap = await marketDataManager.getAllAnalytics(records);
      const results: any[] = [];
      dataMap.forEach((analytics, symbol) => results.push({ symbol, analytics }));
      return { results };
    }
  );

  // ── GET /prices ───────────────────────────────────────────────────────
  app.get<{ Querystring: { symbols: string } }>(
    '/prices',
    async (request, reply) => {
      if (!request.query.symbols) {
         return reply.status(400).send({ error: 'Bad Request', message: 'Missing symbols query param', statusCode: 400 });
      }
      const { marketDataManager } = await import('../providers/market/manager.js');
      const symbols = request.query.symbols.split(',').map(s => s.trim());
      const records = symbols.map(s => seriesProvider.getBySymbol(s)).filter(r => r !== null) as any[];
      const dataMap = await marketDataManager.getMultipleQuotes(records);
      const results: any[] = [];
      dataMap.forEach((data, symbol) => results.push({ symbol, market: data.quote }));
      return { results };
    }
  );

  // ── GET /debug/network ────────────────────────────────────────────────
  app.get('/debug/network', async () => {
    const { execSync } = await import('node:child_process');
    try {
      const nslookup = execSync('nslookup www.nseindia.com', { timeout: 5000 }).toString();
      const curl = execSync('curl -I -m 5 https://www.nseindia.com/', { timeout: 5000 }).toString();
      return { nslookup, curl };
    } catch (e: any) {
      return { error: e.message, stdout: e.stdout?.toString(), stderr: e.stderr?.toString() };
    }
  });

  // ── GET /depth/:symbol ────────────────────────────────────────────────
  app.get<{ Params: { symbol: string } }>(
    '/depth/:symbol',
    { schema: { response: { 200: marketDepthJson, 404: errorJson } } },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) return reply.status(404).send({ error: 'Not Found', message: 'Symbol not found', statusCode: 404 });
      const { marketDataManager } = await import('../providers/market/manager.js');
      const data = await marketDataManager.getQuote(record);
      return data.depth;
    }
  );

  // ── GET /trade/:symbol ────────────────────────────────────────────────
  app.get<{ Params: { symbol: string } }>(
    '/trade/:symbol',
    { schema: { response: { 200: tradeInfoJson, 404: errorJson } } },
    async (request, reply) => {
      const record = seriesProvider.getBySymbol(request.params.symbol);
      if (!record) return reply.status(404).send({ error: 'Not Found', message: 'Symbol not found', statusCode: 404 });
      const { marketDataManager } = await import('../providers/market/manager.js');
      const data = await marketDataManager.getQuote(record);
      return data.trade;
    }
  );

  // ─── GET /provider/health ──────────────────────────────────────────────────
  app.get('/provider/health', { schema: { response: { 200: providerHealthJson } } }, async () => {
    const { marketDataManager } = await import('../providers/market/manager.js');
    
    return {
      nse: marketDataManager.getHealth(),
      gold: deps.goldProvider.getHealth?.() || { status: 'dead', provider: 'None', consecutiveFailures: 0, lastSuccess: null, lastFailure: null }
    };
  });
  
  // ── GET /stats ────────────────────────────────────────────────────────
  app.get('/stats', { schema: { response: { 200: statsJson } } }, async () => {
    const { marketDataManager } = await import('../providers/market/manager.js');
    const mStats = marketDataManager.getHealth();
    return {
       totalRequests: mStats.cacheStats.hit + mStats.cacheStats.miss,
       cacheHitPercent: mStats.cacheHitRate,
       providerLatency: 0,
       refreshCount: mStats.sessionStats.refreshCount,
       failureCount: mStats.sessionStats.failureCount,
       cookieAgeSeconds: mStats.cookieAgeSeconds,
       uptime: process.uptime()
    };
  });

  // ─── GET /debug/nse ──────────────────────────────────────────────────────────
  app.get('/debug/nse', async (request, reply) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch('https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://www.nseindia.com/market-data/sovereign-gold-bond',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const body = await res.text();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: body.substring(0, 1000)
      };
    } catch (err: any) {
      return {
        error: err.name,
        message: err.message
      };
    }
  });

  // ─── GET /debug/nse-trace ─────────────────────────────────────────────────────
  // DEBUG-only. Runs one real quote through the live NSE session with request
  // tracing armed, then returns the full outbound sequence (URLs, order, status,
  // redirects, cookie-jar names + deltas, final redacted headers) so our behavior
  // can be compared request-by-request against hi-imcodeman/stock-nse-india.
  app.get<{ Querystring: { symbol?: string } }>('/debug/nse-trace', async (request, reply) => {
    if (!isDebug) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Route GET /debug/nse-trace not found',
        statusCode: 404,
      });
    }

    const symbol = (request.query.symbol || 'SGBJUL28IV').toUpperCase();
    const record = seriesProvider.getBySymbol(symbol);

    const { nseTracer } = await import('../providers/market/nse/trace.js');
    const { marketDataManager } = await import('../providers/market/manager.js');

    nseTracer.arm();
    let quoteError: string | null = null;
    let liveAvailable = false;
    let lastPrice: number | null = null;
    try {
      // Use a minimal record if the symbol isn't in the dataset, so the trace
      // still exercises the real request sequence for an arbitrary symbol.
      const target = record ?? ({ tradingSymbol: symbol } as any);
      const data = await marketDataManager.getQuote(target);
      liveAvailable = data.quote.liveAvailable;
      lastPrice = data.quote.lastPrice;
      quoteError = data.quote.reason || null;
    } catch (e: any) {
      quoteError = e?.message ?? String(e);
    }
    const trace = nseTracer.snapshot();
    nseTracer.disarm();

    return {
      symbol,
      symbolInDataset: !!record,
      result: { liveAvailable, lastPrice, reason: quoteError },
      health: marketDataManager.getHealth(),
      requestCount: trace.length,
      trace,
    };
  });
}
