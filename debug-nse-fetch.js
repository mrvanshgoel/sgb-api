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
  console.log(`Homepage Response Status: ${res.status}`);
  
  const setCookieHeader = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  console.log(`Raw Set-Cookie Header:`, setCookieHeader);
  
  if (setCookieHeader.length === 0) {
    throw new Error("No set-cookie header received from NSE");
  }
  
  const cookies = setCookieHeader.map(c => c.split(';')[0].trim()).join('; ');
  console.log(`Formatted Cookie String: ${cookies}`);

  console.log("\n=== 2. Requesting JSON Endpoint ===");
  const quoteUrl = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV`;
  
  const quoteHeaders = {
    'User-Agent': headers['User-Agent'], // MATCHES EXACTLY
    'Accept': '*/*',
    'Accept-Language': headers['Accept-Language'], // MATCHES EXACTLY
    'Referer': 'https://www.nseindia.com/',
    'Cookie': cookies
  };
  
  console.log(`Req URL: ${quoteUrl}`);
  console.log(`Req headers:`, quoteHeaders);

  const quoteRes = await fetch(quoteUrl, { headers: quoteHeaders });
  console.log(`Quote Response Status: ${quoteRes.status}`);

  if (quoteRes.status !== 200) {
    const text = await quoteRes.text();
    console.log(`Quote Response Body (first 300 bytes):\n${text.substring(0, 300)}`);
  } else {
    const json = await quoteRes.json();
    console.log(`Quote Response Success! Last Price: ${json.data?.[0]?.lastPrice}`);
  }
}

run().catch(console.error);
