/**
 * Test: can we hit the NSE quote API DIRECTLY with no prior homepage visit?
 * If yes, skip the homepage warmup entirely.
 */
import { Session, ClientIdentifier, initTLS, destroyTLS } from 'node-tls-client';

const SYMBOL = 'SGBJUL28IV';
const QUOTE_URL = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=${SYMBOL}`;

await initTLS();

const session = new Session({
  clientIdentifier: ClientIdentifier.chrome_120,
  timeout: 30000,
  insecureSkipVerify: false,
  disableIPV6: true,
});

console.log('--- Direct API call (NO homepage warmup) ---');

const res = await session.get(QUOTE_URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': 'https://www.nseindia.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
  },
  followRedirects: true
});

console.log('Status:', res.status);
const body = await res.text();
if (res.status === 200) {
  const json = JSON.parse(body);
  const ltp = json?.equityResponse?.[0]?.orderBook?.lastPrice;
  console.log('✅ SUCCESS (no homepage warmup needed)! LTP:', ltp);
} else {
  console.log('❌ FAILED:', res.status);
  console.log(body.substring(0, 300));
}

await session.close();
await destroyTLS();
