import { MarketPriceProvider } from '../../interfaces.js';
import type { SGBRecord, FullMarketData } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

// ─── SGBAnalyzer fallback provider ─────────────────────────────────────────
// Used only when the NSE Official provider is unreachable (401/403/timeout/
// network error/malformed response) from blocked cloud egress IPs. Consumes the
// single structured endpoint sgbanalyzer.com exposes — /api/sgbs/csv — which is
// the same source its own /live page renders from. No HTML scraping.
//
// The CSV carries these per-symbol columns (verified against the live site):
//   Symbol, ISIN, Issue Price, Maturity Date, ..., Fair Value,
//   Ask Price, Average Trading Volume, ...
// It does NOT carry a true traded last price, previous close, OHLC, change,
// value traded or an update timestamp. We map only what genuinely exists:
//   Ask Price              -> quote.lastPrice   (best available live price proxy)
//   Average Trading Volume -> quote.volume / trade.volume
//   ISIN                   -> trade.isin
// Everything unavailable stays null. We never invent values.

const CSV_URL = 'https://sgbanalyzer.com/api/sgbs/csv';
const FETCH_TIMEOUT_MS = 8 * 1000;
const CSV_TTL_MS = 25 * 1000; // brief shared cache so getMultiple issues one request

interface SgbaRow {
  askPrice: number | null;
  averageVolume: number | null;
  isin: string | null;
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
    const iSymbol = header.indexOf('symbol');
    const iIsin = header.indexOf('isin');
    const iAsk = header.indexOf('ask price');
    const iVol = header.indexOf('average trading volume');
    if (iSymbol === -1) return map;

    for (let i = 1; i < lines.length; i++) {
      const cells = this.splitCsvLine(lines[i]);
      const symbol = (cells[iSymbol] ?? '').trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, {
        askPrice: this.toNumber(iAsk === -1 ? undefined : cells[iAsk]),
        averageVolume: this.toNumber(iVol === -1 ? undefined : cells[iVol]),
        isin: (iIsin === -1 ? '' : (cells[iIsin] ?? '')).trim() || null,
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
    const lastPrice = row.askPrice;
    const volume = row.averageVolume;
    return {
      quote: {
        lastPrice,
        previousClose: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        averagePrice: null,
        volume,
        valueTraded: null,
        lastUpdated: null,
        source: this.name,
        cached: false,
        latencyMs: 0,
        liveAvailable: lastPrice !== null,
      },
      depth: {
        buyPrice1: null, buyQuantity1: null,
        buyPrice2: null, buyQuantity2: null,
        buyPrice3: null, buyQuantity3: null,
        buyPrice4: null, buyQuantity4: null,
        buyPrice5: null, buyQuantity5: null,
        sellPrice1: null, sellQuantity1: null,
        sellPrice2: null, sellQuantity2: null,
        sellPrice3: null, sellQuantity3: null,
        sellPrice4: null, sellQuantity4: null,
        sellPrice5: null, sellQuantity5: null,
        totalBuyQuantity: null, totalSellQuantity: null,
        buySellRatio: null, spread: null,
      },
      trade: {
        volume,
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
