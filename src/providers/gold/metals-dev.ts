// ─── metals.dev Gold Price Provider ──────────────────────────────────────
// Independent gold spot price, entirely separate from SGB data.
//
// Docs: https://metals.dev/docs
//   GET https://api.metals.dev/v1/latest?api_key=<KEY>&currency=INR&unit=g
//   Response: { status: "success", currency, unit,
//               metals: { gold, silver, ... , ibja_gold, mcx_gold, ... },
//               timestamps: { metal: "<ISO8601>", currency: "<ISO8601>" } }
// Free tier: 100 requests/month — the 15-minute cache TTL keeps a single
// instance within quota during market hours.

import type { GoldPriceResult } from '../../types/index.js';
import type { GoldProvider } from '../interfaces.js';
import { nullGoldResult } from '../null-providers.js';

const LATEST_URL = 'https://api.metals.dev/v1/latest';
const GRAMS_PER_TROY_OUNCE = 31.1034768;

interface MetalsDevResponse {
  status?: string;
  currency?: string;
  unit?: string;
  metals?: { gold?: number };
  timestamps?: { metal?: string };
  error_code?: number;
  error_message?: string;
}

export class MetalsDevGoldProvider implements GoldProvider {
  readonly name = 'metals.dev';

  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async getPrice(): Promise<GoldPriceResult> {
    if (!this.apiKey) {
      return nullGoldResult('metals.dev provider selected but METALS_API_KEY not set');
    }

    try {
      const url = new URL(LATEST_URL);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('currency', 'INR');
      url.searchParams.set('unit', 'g');

      const res = await this.fetchImpl(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return nullGoldResult(`metals.dev returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as MetalsDevResponse;
      if (body.status !== 'success') {
        return nullGoldResult(
          `metals.dev returned status '${body.status ?? 'unknown'}'${body.error_message ? `: ${body.error_message}` : ''}`,
        );
      }

      const gold = body.metals?.gold;
      if (typeof gold !== 'number' || !Number.isFinite(gold)) {
        return nullGoldResult('metals.dev response missing gold price');
      }
      if (body.currency !== 'INR') {
        return nullGoldResult(`metals.dev returned unexpected currency '${body.currency}'`);
      }

      // We requested unit=g; only convert to per-ounce (per-gram × 31.1034768,
      // an exact unit definition — not an estimate).
      return {
        pricePerGram: round2(gold),
        pricePerOunce: round2(gold * GRAMS_PER_TROY_OUNCE),
        currency: 'INR',
        timestamp: body.timestamps?.metal ?? null,
        source: 'metals.dev',
        priceStatus: 'verified',
        reason: null,
      };
    } catch (err) {
      return nullGoldResult(
        `metals.dev request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
