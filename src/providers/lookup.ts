// ─── Universal Lookup Provider ───────────────────────────────────────────
// Auto-detects which identifier type was supplied and resolves it.
// Detection order: ISIN → security code → trading symbol → series name /
// alias → fuzzy fallback (suggestions).

import type { SGBRecord, LookupResult } from '../types/index.js';
import type { LookupProvider, SeriesProvider, SearchProvider } from './interfaces.js';

const ISIN_RE = /^IN[A-Z0-9]{10}$/i; // GoI SGB ISINs are IN0020...; accept IN + 10 alnum
const SECURITY_CODE_RE = /^\d{6}$/; // BSE scrip codes are 6-digit numeric
const SERIES_NAME_RE = /^(\d{4})\s*-\s*(\d{2})\s+series\s+([IVX]+|\d+)$/i; // e.g. "2020-21 Series IV"

export class DefaultLookupProvider implements LookupProvider {
  constructor(
    private series: SeriesProvider,
    private search: SearchProvider,
  ) {}

  resolve(rawIdentifier: string): LookupResult {
    const identifier = rawIdentifier.trim();

    // 1. ISIN — pattern-gated so a 12-char symbol can't shadow it
    if (ISIN_RE.test(identifier)) {
      const record = this.series.getByISIN(identifier);
      if (record) return { record, matchedBy: 'isin', suggestions: null };
    }

    // 2. Security code (BSE numeric scrip code)
    if (SECURITY_CODE_RE.test(identifier)) {
      const record = this.series.getBySecurityCode(identifier);
      if (record) return { record, matchedBy: 'securityCode', suggestions: null };
    }

    // 3. Trading symbol — exact index lookup is unambiguous, no gate needed
    {
      const record = this.series.getBySymbol(identifier);
      if (record) return { record, matchedBy: 'tradingSymbol', suggestions: null };
    }

    // 4. Series name — case-insensitive, whitespace-tolerant, roman or arabic numerals
    const seriesMatch = this.matchSeriesName(identifier);
    if (seriesMatch) return { record: seriesMatch, matchedBy: 'seriesName', suggestions: null };

    // 4b. Exact alias
    const aliasMatch = this.matchAlias(identifier);
    if (aliasMatch) return { record: aliasMatch, matchedBy: 'alias', suggestions: null };

    // 5. Fuzzy fallback — didYouMean-style suggestions
    const suggestions = this.search.search(identifier).slice(0, 5);
    if (suggestions.length === 1) {
      return { record: suggestions[0], matchedBy: 'fuzzy', suggestions: null };
    }
    return { record: null, matchedBy: null, suggestions };
  }

  private matchSeriesName(identifier: string): SGBRecord | null {
    const m = SERIES_NAME_RE.exec(identifier);
    if (!m) return null;
    const normalized = `${m[1]}-${m[2]} series ${toRoman(m[3])}`.toLowerCase();
    return (
      this.series
        .getAll()
        .find((r) => r.rbiSeries.toLowerCase().replace(/\s+/g, ' ') === normalized) ?? null
    );
  }

  private matchAlias(identifier: string): SGBRecord | null {
    const needle = identifier.toLowerCase().replace(/\s+/g, ' ');
    return (
      this.series
        .getAll()
        .find((r) => r.aliases.some((a) => a.toLowerCase().replace(/\s+/g, ' ') === needle)) ??
      null
    );
  }
}

/** Convert "4" → "IV"; pass roman numerals through uppercased. */
function toRoman(s: string): string {
  if (/^\d+$/.test(s)) {
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    const n = Number(s);
    return romans[n - 1] ?? s;
  }
  return s.toUpperCase();
}
