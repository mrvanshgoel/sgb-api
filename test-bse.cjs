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
  console.log("Fetching BSE home page for cookies...");
  const homeRes = await fetch('https://www.bseindia.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  
  const cookies = homeRes.setCookie.map(c => c.split(';')[0]).join('; ');
  console.log("Got BSE cookies:", cookies);
  
  const apiUrl = 'https://api.bseindia.com/BseIndiaAPI/api/StockReach/w?scripcode=800324';
  console.log("Fetching API:", apiUrl);
  
  const apiRes = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cookie': cookies,
      'Referer': 'https://www.bseindia.com/'
    }
  });
  
  console.log("API Status:", apiRes.status);
  try {
    const json = JSON.parse(apiRes.data);
    console.log("Price:", json.CurrVal); // Just checking if it parsed
  } catch (e) {
    console.log("API Data (first 200 chars):", apiRes.data.substring(0, 200));
  }
}

run();
