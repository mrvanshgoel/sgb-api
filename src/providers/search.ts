// ─── Fuzzy/Structured Search Provider ────────────────────────────────────
// Fuse.js over series name, symbol, ISIN, security code, aliases, plus
// structured filters (years, exchange, active-only) and numeric matching
// on issue price / years extracted from the query.

import Fuse from 'fuse.js';
import type { SGBRecord, SearchFilters } from '../types/index.js';
import type { SearchProvider, SeriesProvider } from './interfaces.js';
import { todayIST } from '../services/derived.js';

export class FuseSearchProvider implements SearchProvider {
  private fuse: Fuse<SGBRecord>;

  constructor(private series: SeriesProvider) {
    this.fuse = new Fuse(series.getAll(), {
      keys: [
        { name: 'rbiSeries', weight: 2 },
        { name: 'tradingSymbol', weight: 2 },
        { name: 'isin', weight: 1.5 },
        { name: 'securityCode', weight: 1 },
        { name: 'aliases', weight: 1.5 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
    });
  }

  search(query: string, filters?: SearchFilters): SGBRecord[] {
    const q = query.trim();
    let results: SGBRecord[];

    // Pure numeric query → try issue price and year semantics first
    if (/^\d+(\.\d+)?$/.test(q)) {
      const n = Number(q);
      const numeric = this.series.getAll().filter((r) => {
        const issueYear = Number(r.issueDate.slice(0, 4));
        const maturityYear = Number(r.maturityDate.slice(0, 4));
        return r.issuePrice === n || issueYear === n || maturityYear === n;
      });
      results = numeric.length > 0 ? numeric : this.fuse.search(q).map((x) => x.item);
    } else {
      results = this.fuse.search(q).map((x) => x.item);
    }

    return applyFilters(results, filters);
  }
}

function applyFilters(records: SGBRecord[], filters?: SearchFilters): SGBRecord[] {
  if (!filters) return records;
  let out = records;
  if (filters.exchange) {
    out = out.filter((r) => r.exchange.includes(filters.exchange!));
  }
  if (filters.issueYear !== undefined) {
    out = out.filter((r) => Number(r.issueDate.slice(0, 4)) === filters.issueYear);
  }
  if (filters.maturityYear !== undefined) {
    out = out.filter((r) => Number(r.maturityDate.slice(0, 4)) === filters.maturityYear);
  }
  if (filters.activeOnly) {
    const today = todayIST();
    out = out.filter((r) => r.maturityDate > today);
  }
  return out;
}
