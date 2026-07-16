import https from 'node:https';

async function run() {
  console.log("=== 1. Requesting NSE Homepage ===");
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };

  const cookieStr = await new Promise((resolve, reject) => {
    console.log("Req headers:", headers);
    https.get('https://www.nseindia.com', { headers }, (res) => {
      console.log(`Homepage Response Status: ${res.statusCode}`);
      console.log(`Homepage Response Headers:`, res.headers);
      
      const setCookieHeader = res.headers['set-cookie'];
      console.log(`Raw Set-Cookie Header:`, setCookieHeader);
      
      if (!setCookieHeader || setCookieHeader.length === 0) {
        return reject(new Error("No set-cookie header received from NSE"));
      }
      
      const cookies = setCookieHeader.map(c => c.split(';')[0].trim()).join('; ');
      console.log(`Formatted Cookie String: ${cookies}`);
      resolve(cookies);
    }).on('error', reject);
  });

  console.log("\n=== 2. Requesting JSON Endpoint ===");
  const quoteUrl = `https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV`;
  
  const quoteHeaders = {
    'User-Agent': headers['User-Agent'],
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': 'https://www.nseindia.com/',
    'Cookie': cookieStr
  };
  
  console.log(`Req URL: ${quoteUrl}`);
  console.log(`Req headers:`, quoteHeaders);

  await new Promise((resolve, reject) => {
    https.get(quoteUrl, { headers: quoteHeaders }, (res) => {
      console.log(`Quote Response Status: ${res.statusCode}`);
      console.log(`Quote Response Headers:`, res.headers);

      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.log(`Quote Response Body (first 300 bytes):\n${body.substring(0, 300)}`);
        } else {
          console.log(`Quote Response Success! Body length: ${body.length}`);
        }
        resolve();
      });
    }).on('error', reject);
  });
}

run().catch(console.error);
