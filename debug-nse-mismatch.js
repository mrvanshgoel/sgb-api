async function run() {
  console.log("=== 1. Requesting NSE Homepage using fetch ===");
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };

  const res = await fetch('https://www.nseindia.com', { headers });
  const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookies = setCookieHeader.map(c => c.split(';')[0].trim()).join('; ');

  console.log("\n=== 2. Requesting JSON Endpoint with MISMATCHED UA ===");
  const quoteUrl = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV`;
  
  const quoteHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36', // Mismatched UA!
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5', // Mismatched Accept-Language!
    'Referer': 'https://www.nseindia.com/',
    'Cookie': cookies
  };
  
  const quoteRes = await fetch(quoteUrl, { headers: quoteHeaders });
  console.log(`Quote Response Status: ${quoteRes.status}`);

  if (quoteRes.status !== 200) {
    console.log(`Mismatched UA got rejected with ${quoteRes.status}`);
  } else {
    console.log(`Mismatched UA succeeded (Akamai didn't care)`);
  }
}

run().catch(console.error);
