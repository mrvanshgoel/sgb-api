// ─── Market failover tests ───────────────────────────────────────────────
// NSE-first, SGBAnalyzer-fallback behaviour and cache semantics. These use
// injected fake providers so no network is touched.

import { describe, it, expect, vi } from 'vitest';
import { MarketDataManager } from '../providers/market/manager.js';
import { SgbAnalyzerProvider } from '../providers/market/sgbanalyzer/provider.js';
import type { MarketPriceProvider } from '../providers/interfaces.js';
import type { SGBRecord, FullMarketData } from '../types/index.js';
import { fixtureA } from './fixtures.js';

function liveData(source: string, lastPrice: number): FullMarketData {
  const base = nullData(source, null);
  base.quote.lastPrice = lastPrice;
  base.quote.liveAvailable = true;
  return base;
}

function nullData(source: string, reason: string | null): FullMarketData {
  return {
    quote: {
      lastPrice: null, previousClose: null, change: null, changePercent: null,
      open: null, high: null, low: null, averagePrice: null, volume: null, valueTraded: null,
      lastUpdated: null, source, cached: false, latencyMs: 0, liveAvailable: false, reason,
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

class FakeProvider implements MarketPriceProvider {
  public calls = 0;
  constructor(public readonly name: string, private responder: () => FullMarketData) {}
  async getPrice(): Promise<FullMarketData> {
    this.calls++;
    return this.responder();
  }
  async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const map = new Map<string, FullMarketData>();
    for (const r of records) {
      if (r.tradingSymbol) map.set(r.tradingSymbol, await this.getPrice());
    }
    return map;
  }
}

describe('MarketDataManager failover', () => {
  it('returns the NSE quote when NSE succeeds and never calls the fallback', async () => {
    const nse = new FakeProvider('NSE Official', () => liveData('NSE Official', 6000));
    const sgba = new FakeProvider('SGBAnalyzer', () => liveData('SGBAnalyzer', 5900));
    const mgr = new MarketDataManager(nse, sgba);

    const result = await mgr.getQuote(fixtureA);

    expect(result.quote.source).toBe('NSE Official');
    expect(result.quote.lastPrice).toBe(6000);
    expect(nse.calls).toBe(1);
    expect(sgba.calls).toBe(0);
  });

  it('falls back to SGBAnalyzer when NSE returns 403 (no client retry)', async () => {
    const nse = new FakeProvider('NSE Official', () => nullData('NSE Official', 'NSE returned 403'));
    const sgba = new FakeProvider('SGBAnalyzer', () => liveData('SGBAnalyzer', 5900));
    const mgr = new MarketDataManager(nse, sgba);

    const result = await mgr.getQuote(fixtureA);

    expect(result.quote.source).toBe('SGBAnalyzer');
    expect(result.quote.lastPrice).toBe(5900);
    expect(nse.calls).toBe(1);
    expect(sgba.calls).toBe(1);
  });

  it('returns null-shaped data when both NSE and SGBAnalyzer are unavailable', async () => {
    const nse = new FakeProvider('NSE Official', () => nullData('NSE Official', 'NSE returned 403'));
    const sgba = new FakeProvider('SGBAnalyzer', () => nullData('SGBAnalyzer', 'SGBAnalyzer request timed out'));
    const mgr = new MarketDataManager(nse, sgba);

    const result = await mgr.getQuote(fixtureA);

    expect(result.quote.liveAvailable).toBe(false);
    expect(result.quote.source).toBe('SGBAnalyzer');
    expect(result.quote.reason).toContain('timed out');
  });

  it('serves the second call from cache without re-hitting the fallback', async () => {
    const nse = new FakeProvider('NSE Official', () => nullData('NSE Official', 'NSE returned 403'));
    const sgba = new FakeProvider('SGBAnalyzer', () => liveData('SGBAnalyzer', 5900));
    const mgr = new MarketDataManager(nse, sgba);

    const first = await mgr.getQuote(fixtureA);
    const second = await mgr.getQuote(fixtureA);

    expect(first.quote.cached).toBe(false);
    expect(second.quote.cached).toBe(true);
    // NSE never caches a failure long (10s stale) so it is retried; the fallback
    // success is cached (30s) and served without a second network call.
    expect(sgba.calls).toBe(1);
  });
});

describe('SgbAnalyzerProvider CSV mapping', () => {
  const CSV = [
    '"Symbol","ISIN","Issue Price","Fair Value","Ask Price","Average Trading Volume"',
    '"SGBTESTA","IN0020TEST01",4000,14396.44,14040.82,374.42',
  ].join('\n');

  it('maps Ask Price to the ask side of the book, never to lastPrice; leaves unavailable fields null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => CSV,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new SgbAnalyzerProvider();
      const result = await provider.getPrice(fixtureA);

      expect(result.quote.source).toBe('SGBAnalyzer');
      // Ask Price is a quote, not a trade — it must live on the ask side only.
      expect(result.depth.sellPrice1).toBe(14040.82);
      // No last traded price, no day volume, no valuation leaks into market fields.
      expect(result.quote.lastPrice).toBeNull();
      expect(result.quote.volume).toBeNull();
      expect(result.trade.volume).toBeNull();
      expect(result.quote.previousClose).toBeNull();
      expect(result.quote.open).toBeNull();
      expect(result.quote.high).toBeNull();
      expect(result.quote.low).toBeNull();
      expect(result.quote.change).toBeNull();
      expect(result.quote.changePercent).toBeNull();
      expect(result.quote.averagePrice).toBeNull();
      expect(result.quote.valueTraded).toBeNull();
      // We still surface that a genuine live ask quote is available.
      expect(result.quote.liveAvailable).toBe(true);
      expect(result.trade.isin).toBe('IN0020TEST01');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null-shaped data with a reason when the CSV endpoint fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new SgbAnalyzerProvider();
      const result = await provider.getPrice(fixtureA);
      expect(result.quote.liveAvailable).toBe(false);
      expect(result.quote.reason).toContain('503');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('SgbAnalyzerProvider analytics mapping', () => {
  // Full 18-column CSV row for SGBTESTA mirroring the live SGBJUL28IV values.
  const CSV = [
    '"Symbol","ISIN","Issue Price","Maturity Date","Years To Maturity","Interest Date 1","Interest Date 2","Interest Payable","Interest Value","No of Remaining Interest Payments","Total Remaining Interest","Present Value of Future Interest Payments","Fair Value","Ask Price","Average Trading Volume","Discount to Fair Value","Discount to Gold Price","Total Yield to Maturity"',
    '"SGBTESTA","IN0020200146",4852,"Jul 2028",1.995442009893455,"July14","January14",2.5,60.65,4,242.6,225.4420181304492,14396.442018130449,14040.82,374.42857142857144,0.024702076921685866,0.009186366523181165,0.013218227334266253',
  ].join('\n');

  it('maps every CSV column to rendered-page field names, percentages × 100', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => CSV });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new SgbAnalyzerProvider();
      const a = await provider.getAnalytics(fixtureA);

      expect(a.symbol).toBe(fixtureA.tradingSymbol);
      expect(a.isin).toBe('IN0020200146');
      expect(a.currentPrice).toBe(14040.82); // Ask Price — best quote, not LTP
      expect(a.fairValue).toBe(14396.442018130449);
      expect(a.issuePrice).toBe(4852);
      // Percentages rendered as on the page: fraction × 100, 2-dp rounded.
      expect(a.discountPercent).toBe(2.47);
      expect(a.yieldYtmPercent).toBe(1.32);
      expect(a.discountToGoldPercent).toBe(0.92);
      expect(a.yearsToMaturity).toBe(1.995442009893455);
      expect(a.maturity).toBe('Jul 2028');
      expect(a.interestRate).toBe(2.5); // already a percentage on the page
      expect(a.interestPerUnit).toBe(60.65);
      expect(a.nextInterest).toBe('July14');
      expect(a.interestDate2).toBe('January14');
      expect(a.remainingPayments).toBe(4);
      expect(a.totalInterestLeft).toBe(242.6);
      expect(a.pvFutureInterest).toBe(225.4420181304492);
      expect(a.avgTradingVolume).toBe(374.42857142857144);
      expect(a.source).toBe('SGBAnalyzer');
      expect(a.reason).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null-shaped analytics with a reason when the symbol is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '"Symbol","ISIN","Ask Price"\n"SOMEOTHER","IN0000000000",100',
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const provider = new SgbAnalyzerProvider();
      const a = await provider.getAnalytics(fixtureA);
      expect(a.currentPrice).toBeNull();
      expect(a.discountPercent).toBeNull();
      expect(a.reason).toContain('not listed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
