import { MarketPriceProvider } from '../../interfaces.js';
import type { SGBRecord, FullMarketData } from '../../../types/index.js';
import { nseSessionManager } from './session.js';
import * as https from 'https';

export class NseMarketPriceProvider implements MarketPriceProvider {
  public readonly name = 'NSE Official';

  public async getPrice(record: SGBRecord): Promise<FullMarketData> {
    const symbol = record.tradingSymbol;
    if (!symbol) {
      return this.createNullData('No trading symbol');
    }

    try {
      let data = await this.fetchData(symbol);
      return this.parseResponse(data, symbol);
    } catch (e: any) {
      // Retry once on 401/403 which indicates expired cookies
      if (e.message.includes('401') || e.message.includes('403')) {
        try {
          await nseSessionManager.forceRefresh();
          let data = await this.fetchData(symbol);
          return this.parseResponse(data, symbol);
        } catch (e2: any) {
          return this.createNullData(e2.message);
        }
      }
      return this.createNullData(e.message);
    }
  }

  public async getMultiple(records: SGBRecord[]): Promise<Map<string, FullMarketData>> {
    const results = new Map<string, FullMarketData>();
    // Parallel fetches using the same session cookie
    const promises = records.map(async (record) => {
      if (record.tradingSymbol) {
        const data = await this.getPrice(record);
        results.set(record.tradingSymbol, data);
      }
    });
    
    // Batch in chunks if we have many to avoid rate limits
    const CHUNK_SIZE = 5;
    for (let i = 0; i < promises.length; i += CHUNK_SIZE) {
      await Promise.all(promises.slice(i, i + CHUNK_SIZE));
    }
    
    return results;
  }

  private async fetchData(symbol: string): Promise<any> {
    const cookies = await nseSessionManager.getCookie();
    const url = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=${symbol}`;
    
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
          'Cookie': cookies
        }
      }, (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error(`NSE returned ${res.statusCode}`));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`NSE returned ${res.statusCode}`));
        }
        
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(rawData));
          } catch(e) {
            reject(new Error("Failed to parse NSE JSON"));
          }
        });
      }).on('error', reject);
    });
  }

  private parseResponse(json: any, expectedSymbol: string): FullMarketData {
    const response = json?.equityResponse?.[0];
    if (!response) {
      return this.createNullData('Invalid JSON format');
    }

    const meta = response.metaData || {};
    const orderBook = response.orderBook || {};
    const trade = response.tradeInfo || {};
    const sec = response.secInfo || {};
    const priceInfo = response.priceInfo || {};

    const lastPrice = orderBook.lastPrice ?? null;

    return {
      quote: {
        lastPrice: lastPrice,
        previousClose: meta.previousClose ?? null,
        change: meta.change ?? null,
        changePercent: meta.pChange ?? null,
        open: meta.open ?? null,
        high: meta.dayHigh ?? null,
        low: meta.dayLow ?? null,
        averagePrice: meta.averagePrice ?? null,
        volume: trade.totalTradedVolume ?? null,
        valueTraded: trade.totalTradedValue ?? null,
        lastUpdated: response.lastUpdateTime ?? null,
        source: this.name,
        cached: false,
        latencyMs: 0,
        liveAvailable: lastPrice !== null
      },
      depth: {
        buyPrice1: orderBook.buyPrice1 ?? null,
        buyQuantity1: orderBook.buyQuantity1 ?? null,
        buyPrice2: orderBook.buyPrice2 ?? null,
        buyQuantity2: orderBook.buyQuantity2 ?? null,
        buyPrice3: orderBook.buyPrice3 ?? null,
        buyQuantity3: orderBook.buyQuantity3 ?? null,
        buyPrice4: orderBook.buyPrice4 ?? null,
        buyQuantity4: orderBook.buyQuantity4 ?? null,
        buyPrice5: orderBook.buyPrice5 ?? null,
        buyQuantity5: orderBook.buyQuantity5 ?? null,
        sellPrice1: orderBook.sellPrice1 ?? null,
        sellQuantity1: orderBook.sellQuantity1 ?? null,
        sellPrice2: orderBook.sellPrice2 ?? null,
        sellQuantity2: orderBook.sellQuantity2 ?? null,
        sellPrice3: orderBook.sellPrice3 ?? null,
        sellQuantity3: orderBook.sellQuantity3 ?? null,
        sellPrice4: orderBook.sellPrice4 ?? null,
        sellQuantity4: orderBook.sellQuantity4 ?? null,
        sellPrice5: orderBook.sellPrice5 ?? null,
        sellQuantity5: orderBook.sellQuantity5 ?? null,
        totalBuyQuantity: orderBook.totalBuyQuantity ?? null,
        totalSellQuantity: orderBook.totalSellQuantity ?? null,
        buySellRatio: (orderBook.totalBuyQuantity && orderBook.totalSellQuantity) 
           ? (orderBook.totalBuyQuantity / orderBook.totalSellQuantity) : null,
        spread: (orderBook.sellPrice1 && orderBook.buyPrice1) 
           ? (orderBook.sellPrice1 - orderBook.buyPrice1) : null
      },
      trade: {
        volume: trade.totalTradedVolume ?? null,
        vwap: meta.averagePrice ?? null,
        previousClose: meta.previousClose ?? null,
        open: meta.open ?? null,
        upperCircuit: priceInfo.upperCircuit ?? null, // NSE API might not provide circuit limits in this response, check priceBand
        lowerCircuit: priceInfo.lowerCircuit ?? null,
        fiftyTwoWeekHigh: priceInfo.yearHigh ?? null,
        fiftyTwoWeekLow: priceInfo.yearLow ?? null,
        faceValue: trade.faceValue ?? null,
        series: meta.series ?? null,
        isin: meta.isinCode ?? null,
        securityCode: null // BSE only
      }
    };
  }

  private createNullData(reason: string): FullMarketData {
    return {
      quote: {
        lastPrice: null,
        previousClose: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        averagePrice: null,
        volume: null,
        valueTraded: null,
        lastUpdated: null,
        source: this.name,
        cached: false,
        latencyMs: 0,
        liveAvailable: false,
        reason
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
        buySellRatio: null, spread: null
      },
      trade: {
        volume: null, vwap: null, previousClose: null,
        open: null, upperCircuit: null, lowerCircuit: null,
        fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
        faceValue: null, series: null, isin: null, securityCode: null
      }
    };
  }
}
