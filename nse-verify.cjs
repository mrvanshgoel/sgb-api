const https = require('https');

async function getCookies() {
  return new Promise((resolve, reject) => {
    https.get('https://www.nseindia.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    }, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
      resolve(cookieStr);
    }).on('error', reject);
  });
}

async function getQuote(cookieStr) {
  return new Promise((resolve, reject) => {
    const url = 'https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV';
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.nseindia.com/get-quotes/equity?symbol=SGBJUL28IV',
        'Cookie': cookieStr
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        data: data
      }));
    }).on('error', reject);
  });
}

async function run() {
  console.log("--- Fetching Cookies from NSE ---");
  let cookies;
  try {
    cookies = await getCookies();
    console.log("Cookies obtained:", cookies ? "YES" : "NO");
  } catch(e) {
    console.log("Error getting cookies:", e.message);
    return;
  }

  console.log("\n--- Fetching JSON Endpoint ---");
  try {
    const response = await getQuote(cookies);
    console.log("HTTP status:", response.status);
    console.log("Response headers:", JSON.stringify(response.headers, null, 2));
    
    if (response.data) {
        console.log("\nFirst 500 characters of JSON:");
        console.log(response.data.substring(0, 500));
        
        try {
            const json = JSON.parse(response.data);
            const ltp = json?.equityResponse?.[0]?.orderBook?.lastPrice;
            console.log(`\nParsed LTP: ${ltp}`);
        } catch(e) {
            console.log("\nFailed to parse JSON:", e.message);
        }
    } else {
        console.log("\nNo data received.");
    }
  } catch(e) {
    console.log("Error fetching quote:", e.message);
  }
}

run();
