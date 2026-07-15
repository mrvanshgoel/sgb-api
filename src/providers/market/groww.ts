// ─── Groww Trade API Market Price Provider ───────────────────────────────
// Uses Groww's OFFICIAL, documented Trade API with the user's OWN
// credentials (paid Trading API subscription). Never scrapes.
//
// Docs: https://groww.in/trade-api/docs/curl/live-data
//   GET https://api.groww.in/v1/live-data/quote
//     ?exchange=NSE&segment=CASH&trading_symbol=SGBFEB32IV
//   Headers: Authorization: Bearer <token>, Accept: application/json,
//            X-API-VERSION: 1.0
//   Rate limits (live data): 10 req/sec, 300 req/min.
//
// SGBs are NSE CASH-segment instruments (series GB) and are present in
// Groww's official instrument master with buy/sell allowed.
//
// Field mapping (verified against the docs' response schema):
//   last_price        → marketPrice
//   ohlc.high/low     → dayHigh / dayLow
//   volume            → volume
//   bid_price         → bid
//   offer_price       → ask ("offer" in Groww's terminology)
//   last_trade_time   → priceTimestamp (epoch ms)
//   day_change        → used to derive previousClose (last_price - day_change)
//
// NOTE: the docs do not define a literal "previous_close" field; ohlc.close
// is documented only as "Closing price". We therefore derive previousClose
// from day_change when present, else null — never guess.

import type { SGBRecord, MarketPriceResult } from '../../types/index.js';
import type { MarketPriceProvider } from '../interfaces.js';
import { nullMarketResult } from '../null-providers.js';

const QUOTE_URL = 'https://api.groww.in/v1/live-data/quote';

interface GrowwOhlc {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

interface GrowwQuotePayload {
  last_price?: number;
  ohlc?: GrowwOhlc | string;
  volume?: number;
  bid_price?: number;
  offer_price?: number;
  last_trade_time?: number;
  day_change?: number;
}

export class GrowwMarketPriceProvider implements MarketPriceProvider {
  readonly name = 'groww';

  constructor(
    private apiKey: string,
    private accessToken: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async getPrice(record: SGBRecord): Promise<MarketPriceResult> {
    const token = this.accessToken || this.apiKey;
    if (!token) {
      return nullMarketResult(
        'Groww provider selected but GROWW_ACCESS_TOKEN / GROWW_API_KEY not set',
      );
    }

    try {
      const url = new URL(QUOTE_URL);
      url.searchParams.set('exchange', 'NSE');
      url.searchParams.set('segment', 'CASH');
      url.searchParams.set('trading_symbol', record.tradingSymbol);

      const res = await this.fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-API-VERSION': '1.0',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return nullMarketResult(`Groww API returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as { status?: string; payload?: GrowwQuotePayload };
      if (body.status !== 'SUCCESS' || !body.payload) {
        return nullMarketResult(`Groww API returned status '${body.status ?? 'unknown'}'`);
      }

      const p = body.payload;
      const ohlc = parseOhlc(p.ohlc);
      const lastPrice = numOrNull(p.last_price);
      const dayChange = numOrNull(p.day_change);

      return {
        marketPrice: lastPrice,
        // Docs define no previous_close field; derive from day_change only.
        previousClose:
          lastPrice !== null && dayChange !== null
            ? Math.round((lastPrice - dayChange) * 100) / 100
            : null,
        dayHigh: numOrNull(ohlc?.high),
        dayLow: numOrNull(ohlc?.low),
        volume: numOrNull(p.volume),
        valueTraded: null, // not provided by Groww quote API — null by design
        bid: numOrNull(p.bid_price),
        ask: numOrNull(p.offer_price),
        priceSource: 'Groww Trade API (official)',
        priceTimestamp: p.last_trade_time ? new Date(p.last_trade_time).toISOString() : null,
        priceDelay: 'Real-time',
        priceStatus: lastPrice !== null ? 'verified' : 'unavailable',
        reason: lastPrice !== null ? null : 'Groww returned no last_price for this symbol',
      };
    } catch (err) {
      return nullMarketResult(
        `Groww API request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

/**
 * The docs show ohlc as a nested object in the schema but a string like
 * "{open: 149.50,high: 150.50,...}" in the example — handle both.
 */
function parseOhlc(ohlc: GrowwOhlc | string | undefined): GrowwOhlc | null {
  if (!ohlc) return null;
  if (typeof ohlc === 'object') return ohlc;
  const out: GrowwOhlc = {};
  for (const key of ['open', 'high', 'low', 'close'] as const) {
    const m = new RegExp(`${key}\\s*:\\s*([0-9.]+)`).exec(ohlc);
    if (m) out[key] = Number(m[1]);
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
