// ─── Static Series Provider ──────────────────────────────────────────────
// Serves the hand-verified SGB dataset from src/data/sgb-series.json.
// All lookups are O(1) via prebuilt indexes. Static data never expires.

import type { SGBRecord } from '../types/index.js';
import type { SeriesProvider } from './interfaces.js';

export class StaticSeriesProvider implements SeriesProvider {
  readonly name = 'static-json';
  private records: SGBRecord[];
  private bySymbol = new Map<string, SGBRecord>();
  private byISIN = new Map<string, SGBRecord>();
  private bySecurityCode = new Map<string, SGBRecord>();

  constructor(records: SGBRecord[]) {
    this.records = records;
    for (const r of records) {
      this.bySymbol.set(r.tradingSymbol.toUpperCase(), r);
      if (r.isin) this.byISIN.set(r.isin.toUpperCase(), r);
      if (r.securityCode) this.bySecurityCode.set(r.securityCode.toUpperCase(), r);
    }
  }

  getAll(): SGBRecord[] {
    return this.records;
  }

  getBySymbol(symbol: string): SGBRecord | null {
    return this.bySymbol.get(symbol.trim().toUpperCase()) ?? null;
  }

  getByISIN(isin: string): SGBRecord | null {
    return this.byISIN.get(isin.trim().toUpperCase()) ?? null;
  }

  getBySecurityCode(code: string): SGBRecord | null {
    return this.bySecurityCode.get(code.trim().toUpperCase()) ?? null;
  }
}
