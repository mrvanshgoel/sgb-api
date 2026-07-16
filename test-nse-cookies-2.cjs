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
      if (res.statusCode === 200 || res.statusCode === 403) {
         const cookies = res.headers['set-cookie'] || [];
         const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
         resolve(cookieStr);
      } else {
         reject(new Error(`Failed to get cookies: ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function getQuote(cookieStr) {
  return new Promise((resolve, reject) => {
    https.get('https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.nseindia.com/get-quotes/equity?symbol=SGBJUL28IV',
        'Cookie': cookieStr
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data+=c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function run() {
  try {
    const cookies = await getCookies();
    console.log("Cookies:", cookies);
    const quote = await getQuote(cookies);
    console.log("Status:", quote.status);
    console.log("Data:", quote.data.substring(0, 500));
  } catch(e) {
    console.log("Error:", e.message);
  }
}

run();
