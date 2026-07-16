import { MarketPriceProvider } from '../../interfaces.js';
import type { SGBRecord, FullMarketData, SgbAnalytics } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

// ─── SGBAnalyzer fallback provider ─────────────────────────────────────────
// Used only when the NSE Official provider is unreachable (401/403/timeout/
// network error/malformed response) from blocked cloud egress IPs. Consumes the
// single structured endpoint sgbanalyzer.com exposes — /api/sgbs/csv — which is
// the exact source the site's own /live table fetches (verified in bundle
// chunk 776: `fetch("/api/sgbs/csv",{cache:"no-store"})` with the column map
// { askPrice:"Ask Price", avgTradingVolumeLast7Days:"Avg Volume",
//   fairValue:"Fair Value", ... }). No other market-data endpoint exists on the
// whole site (full investigation: RSC/__NEXT_DATA__ only embed 2 sample rows;
// /sgb/[symbol] and /live both client-fetch this same CSV; Supabase references
// are auth-only; no GraphQL/websocket/EventSource carries quotes). No HTML
// scraping is needed because the structured CSV is the primary source.
//
// Rendered-DOM check (headless Chrome, post-JS, /sgb/sgbjul28iv, sgbjan30ix,
// sgbaug30): the page shows exactly ONE price — "Current Price / Market price" —
// and it is byte-identical to the CSV's Ask Price column (14040.82 / 14087.51 /
// 14192.33). Every other metric (fair value, discount, yield) is login-gated and
// is just a CSV valuation column. The rendered page exposes NO last traded price,
// previous close, open, high, low, average traded price, today's volume, value
// traded, change, change %, timestamp, bid, ask quantity, or market depth. A
// scraper would therefore add zero fields over the CSV, so none is implemented.
//
// CRITICAL ACCURACY NOTE — the CSV holds VALUATION metrics, not live trades:
//   "Ask Price"                -> best sell-side QUOTE, NOT a last traded price.
//                                 Mapped to depth.sellPrice1 only. lastPrice
//                                 stays null — SGBAnalyzer has no LTP.
//   "Average Trading Volume"   -> a rolling 7-day AVERAGE (field
//                                 avgTradingVolumeLast7Days on the site), NOT a
//                                 day's traded volume. Surfaced only in the
//                                 non-standard field; quote.volume stays null.
//   "Fair Value"               -> a computed valuation, NOT a market price. Not
//                                 mapped to any live field.
// The CSV carries no last price, previous close, open, high, low, average traded
// price, traded volume, traded value, change, change %, or update timestamp.
// Every one of those stays null. We never map a quote/valuation to a trade field
// and never invent, infer, estimate, or calculate a value.

const CSV_URL = 'https://sgbanalyzer.com/api/sgbs/csv';
const FETCH_TIMEOUT_MS = 10 * 1000;
const CSV_TTL_MS = 25 * 1000; // brief shared cache so getMultiple issues one request

interface SgbaRow {
  askPrice: number | null; // best sell-side quote (NOT a last traded price)
  avgTradingVolume7d: number | null; // rolling 7-day average (NOT day volume)
  isin: string | null;
  // Valuation columns surfaced verbatim as analytics (rendered-page names below).
  issuePrice: number | null;
  maturityDate: string | null;
  yearsToMaturity: number | null;
  interestDate1: string | null;
  interestDate2: string | null;
  interestPayable: number | null; // % p.a. — already a percentage on the page
  interestValue: number | null;
  remainingPayments: number | null;
  totalRemainingInterest: number | null;
  pvFutureInterest: number | null;
  fairValue: number | null;
  discountToFairValue: number | null; // CSV fraction; page shows × 100
  discountToGoldPrice: number | null; // CSV fraction; page shows × 100
  totalYieldToMaturity: number | null; // CSV fraction; page shows × 100
}

export class SgbAnalyzerProvider implements MarketPriceProvider {
  public readonly name = 'SGBAnalyzer';

  private cachedRows: Map<string, SgbaRow> | null = null;
  private cachedAt = 0;
  private inFlight: Promise<Map<string, SgbaRow>> | null = null;

  public async getPrice(record: SGBRecord): Promise<FullMarketData> {
    const symbol = record.tradingSymbol;
    if (!symbol) {
      return this.createNullData('No trading symbol');
    }

    try {
      const startTime = Date.now();
      const rows = await this.loadRows();
      const latency = Date.now() - startTime;

      const row = rows.get(symbol.toUpperCase());
      if (!row) {
        logger.warn(`SGBAnalyzer has no row for ${symbol}`);
        return this.createNullData('Symbol not listed on SGBAnalyzer');
      }

      logger.info('SGBAnalyzer quote received');
      const parsed = this.mapRow(row);
      parsed.quote.latencyMs = latency;
      return parsed;
    } catch (e: any) {
      logger.warn(`SGBAnalyzer request failed: ${e.message}`);
      return this.createNullData(e.message);
    }
  }

  public async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const results = new Map<string, FullMarketData>();
    let rows: Map<string, SgbaRow>;
    try {
      rows = await this.loadRows();
    } catch (e: any) {
      logger.warn(`SGBAnalyzer request failed: ${e.message}`);
      for (const record of records) {
        if (record.tradingSymbol) {
          results.set(record.tradingSymbol, this.createNullData(e.message));
        }
      }
      return results;
    }

    for (const record of records) {
      const symbol = record.tradingSymbol;
      if (!symbol) continue;
      const row = rows.get(symbol.toUpperCase());
      results.set(symbol, row ? this.mapRow(row) : this.createNullData('Symbol not listed on SGBAnalyzer'));
    }
    return results;
  }

  /** Full SGBAnalyzer valuation analytics for one symbol (rendered-page names). */
  public async getAnalytics(record: SGBRecord): Promise<SgbAnalytics> {
    const symbol = record.tradingSymbol;
    if (!symbol) {
      return this.createNullAnalytics('(unknown)', 'No trading symbol');
    }
    try {
      const rows = await this.loadRows();
      const row = rows.get(symbol.toUpperCase());
      if (!row) {
        return this.createNullAnalytics(symbol, 'Symbol not listed on SGBAnalyzer');
      }
      return this.mapAnalytics(symbol, row);
    } catch (e: any) {
      logger.warn(`SGBAnalyzer analytics request failed: ${e.message}`);
      return this.createNullAnalytics(symbol, e.message);
    }
  }

  public async getAllAnalytics(records: SGBRecord[]): Promise<Map<string, SgbAnalytics>> {
    const results = new Map<string, SgbAnalytics>();
    let rows: Map<string, SgbaRow>;
    try {
      rows = await this.loadRows();
    } catch (e: any) {
      logger.warn(`SGBAnalyzer analytics request failed: ${e.message}`);
      for (const record of records) {
        if (record.tradingSymbol) {
          results.set(record.tradingSymbol, this.createNullAnalytics(record.tradingSymbol, e.message));
        }
      }
      return results;
    }

    for (const record of records) {
      const symbol = record.tradingSymbol;
      if (!symbol) continue;
      const row = rows.get(symbol.toUpperCase());
      results.set(
        symbol,
        row ? this.mapAnalytics(symbol, row) : this.createNullAnalytics(symbol, 'Symbol not listed on SGBAnalyzer')
      );
    }
    return results;
  }

  private mapAnalytics(symbol: string, row: SgbaRow): SgbAnalytics {
    // Percentages are surfaced as the rendered page shows them: the CSV stores
    // fractions, the page shows them × 100 (0.0247 -> 2.47). Interest Payable is
    // already a percentage on the page ("2.5% p.a."), so it is left as-is.
    return {
      symbol,
      isin: row.isin,
      currentPrice: row.askPrice,
      fairValue: row.fairValue,
      issuePrice: row.issuePrice,
      discountPercent: this.toPercent(row.discountToFairValue),
      yieldYtmPercent: this.toPercent(row.totalYieldToMaturity),
      discountToGoldPercent: this.toPercent(row.discountToGoldPrice),
      yearsToMaturity: row.yearsToMaturity,
      maturity: row.maturityDate,
      interestRate: row.interestPayable,
      interestPerUnit: row.interestValue,
      nextInterest: row.interestDate1,
      interestDate2: row.interestDate2,
      remainingPayments: row.remainingPayments,
      totalInterestLeft: row.totalRemainingInterest,
      pvFutureInterest: row.pvFutureInterest,
      avgTradingVolume: row.avgTradingVolume7d,
      source: this.name,
      cached: false,
      reason: null,
    };
  }

  private toPercent(fraction: number | null): number | null {
    if (fraction === null) return null;
    // Round to 2 decimals to match the rendered page (2.47%, 1.32%, 0.92%).
    return Math.round(fraction * 100 * 100) / 100;
  }

  private createNullAnalytics(symbol: string, reason: string): SgbAnalytics {
    return {
      symbol,
      isin: null,
      currentPrice: null,
      fairValue: null,
      issuePrice: null,
      discountPercent: null,
      yieldYtmPercent: null,
      discountToGoldPercent: null,
      yearsToMaturity: null,
      maturity: null,
      interestRate: null,
      interestPerUnit: null,
      nextInterest: null,
      interestDate2: null,
      remainingPayments: null,
      totalInterestLeft: null,
      pvFutureInterest: null,
      avgTradingVolume: null,
      source: this.name,
      cached: false,
      reason,
    };
  }

  private async loadRows(): Promise<Map<string, SgbaRow>> {
    const now = Date.now();
    if (this.cachedRows && now - this.cachedAt < CSV_TTL_MS) {
      return this.cachedRows;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    logger.info('Requesting SGBAnalyzer CSV');
    this.inFlight = this.fetchRows()
      .then((rows) => {
        this.cachedRows = rows;
        this.cachedAt = Date.now();
        return rows;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async fetchRows(): Promise<Map<string, SgbaRow>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(CSV_URL, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`SGBAnalyzer returned ${res.status}`);
      }
      const text = await res.text();
      const rows = this.parseCsv(text);
      if (rows.size === 0) {
        throw new Error('SGBAnalyzer CSV had no rows');
      }
      return rows;
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error('SGBAnalyzer request timed out');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseCsv(text: string): Map<string, SgbaRow> {
    const map = new Map<string, SgbaRow>();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return map;

    const header = this.splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iSymbol = idx('symbol');
    const iIsin = idx('isin');
    const iAsk = idx('ask price');
    const iVol = idx('average trading volume');
    const iIssue = idx('issue price');
    const iMaturityDate = idx('maturity date');
    const iYears = idx('years to maturity');
    const iIntDate1 = idx('interest date 1');
    const iIntDate2 = idx('interest date 2');
    const iIntPayable = idx('interest payable');
    const iIntValue = idx('interest value');
    const iRemaining = idx('no of remaining interest payments');
    const iTotalInterest = idx('total remaining interest');
    const iPvInterest = idx('present value of future interest payments');
    const iFair = idx('fair value');
    const iDiscFair = idx('discount to fair value');
    const iDiscGold = idx('discount to gold price');
    const iYtm = idx('total yield to maturity');
    if (iSymbol === -1) return map;

    const num = (i: number, cells: string[]) => this.toNumber(i === -1 ? undefined : cells[i]);
    const str = (i: number, cells: string[]) => (i === -1 ? '' : (cells[i] ?? '')).trim() || null;

    for (let i = 1; i < lines.length; i++) {
      const cells = this.splitCsvLine(lines[i]);
      const symbol = (cells[iSymbol] ?? '').trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, {
        askPrice: num(iAsk, cells),
        avgTradingVolume7d: num(iVol, cells),
        isin: str(iIsin, cells),
        issuePrice: num(iIssue, cells),
        maturityDate: str(iMaturityDate, cells),
        yearsToMaturity: num(iYears, cells),
        interestDate1: str(iIntDate1, cells),
        interestDate2: str(iIntDate2, cells),
        interestPayable: num(iIntPayable, cells),
        interestValue: num(iIntValue, cells),
        remainingPayments: num(iRemaining, cells),
        totalRemainingInterest: num(iTotalInterest, cells),
        pvFutureInterest: num(iPvInterest, cells),
        fairValue: num(iFair, cells),
        discountToFairValue: num(iDiscFair, cells),
        discountToGoldPrice: num(iDiscGold, cells),
        totalYieldToMaturity: num(iYtm, cells),
      });
    }
    return map;
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.replace(/^"|"$/g, ''));
  }

  private toNumber(value: string | undefined): number | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  private mapRow(row: SgbaRow): FullMarketData {
    // Ask Price is a best sell-side quote — it maps to the ask side of the order
    // book, never to lastPrice. SGBAnalyzer exposes no last traded price, so
    // quote.lastPrice stays null. The one genuine live datum is this ask quote.
    const ask = row.askPrice;
    const hasLiveData = ask !== null;
    return {
      quote: {
        lastPrice: null, // SGBAnalyzer has no LTP; do not substitute the ask
        previousClose: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        averagePrice: null,
        volume: null, // CSV "Average Trading Volume" is a 7-day average, not day volume
        valueTraded: null,
        lastUpdated: null,
        source: this.name,
        cached: false,
        latencyMs: 0,
        liveAvailable: hasLiveData,
        reason: hasLiveData ? 'Ask quote only (no last traded price from SGBAnalyzer)' : 'No ask price for symbol',
      },
      depth: {
        buyPrice1: null, buyQuantity1: null,
        buyPrice2: null, buyQuantity2: null,
        buyPrice3: null, buyQuantity3: null,
        buyPrice4: null, buyQuantity4: null,
        buyPrice5: null, buyQuantity5: null,
        sellPrice1: ask, sellQuantity1: null, // best ask quote — its true meaning
        sellPrice2: null, sellQuantity2: null,
        sellPrice3: null, sellQuantity3: null,
        sellPrice4: null, sellQuantity4: null,
        sellPrice5: null, sellQuantity5: null,
        totalBuyQuantity: null, totalSellQuantity: null,
        buySellRatio: null, spread: null,
      },
      trade: {
        volume: null, // no true traded volume available
        vwap: null,
        previousClose: null,
        open: null,
        upperCircuit: null,
        lowerCircuit: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        faceValue: null,
        series: null,
        isin: row.isin,
        securityCode: null,
      },
    };
  }

  private createNullData(reason: string): FullMarketData {
    return {
      quote: {
        lastPrice: null, previousClose: null, change: null, changePercent: null,
        open: null, high: null, low: null, averagePrice: null, volume: null, valueTraded: null,
        lastUpdated: null, source: this.name, cached: false, latencyMs: 0, liveAvailable: false, reason,
      },
      depth: {
        buyPrice1: null, buyQuantity1: null, buyPrice2: null, buyQuantity2: null, buyPrice3: null, buyQuantity3: null, buyPrice4: null, buyQuantity4: null, buyPrice5: null, buyQuantity5: null,
        sellPrice1: null, sellQuantity1: null, sellPrice2: null, sellQuantity2: null, sellPrice3: null, sellQuantity3: null, sellPrice4: null, sellQuantity4: null, sellPrice5: null, sellQuantity5: null,
        totalBuyQuantity: null, totalSellQuantity: null, buySellRatio: null, spread: null,
      },
      trade: {
        volume: null, vwap: null, previousClose: null, open: null, upperCircuit: null, lowerCircuit: null,
        fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, faceValue: null, series: null, isin: null, securityCode: null,
      },
    };
  }
}
