const https = require('https');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';
      const setCookie = res.headers['set-cookie'] || [];
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data, setCookie });
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log("Fetching NSE home page for cookies...");
  const homeRes = await fetch('https://www.nseindia.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  
  if (homeRes.status !== 200) {
    console.log("Failed to get home page:", homeRes.status);
    return;
  }
  
  const cookies = homeRes.setCookie.map(c => c.split(';')[0]).join('; ');
  console.log("Got cookies:", cookies);
  
  const apiUrl = 'https://www.nseindia.com/api/quote-bonds?index=equities&symbol=SGBJUL28IV';
  console.log("Fetching API:", apiUrl);
  
  const apiRes = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cookie': cookies,
      'Referer': 'https://www.nseindia.com/get-quotes/bonds?symbol=SGBJUL28IV'
    }
  });
  
  console.log("API Status:", apiRes.status);
  try {
    const json = JSON.parse(apiRes.data);
    console.log("Price:", json.priceInfo.lastPrice);
  } catch (e) {
    console.log("API Data (first 200 chars):", apiRes.data.substring(0, 200));
  }
}

run();
