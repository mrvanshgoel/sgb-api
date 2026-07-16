const https = require('https');

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data.substring(0, 500) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data.substring(0, 500) });
        }
      });
    }).on('error', reject);
  });
}

async function testYahooBSE() {
  console.log("Testing Yahoo Finance for SGBJUL28IV.BO (BSE)...");
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/SGBJUL28IV.BO?interval=1d&range=1d';
  try {
    const res = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log("Yahoo Response:", res.status, typeof res.data === 'object' ? JSON.stringify(res.data) : res.data);
  } catch (e) {
    console.log("Yahoo Error:", e.message);
  }
}

async function testBSE() {
  console.log("\nTesting BSE India API for 800324 (SGBJUL28IV)...");
  const url = 'https://api.bseindia.com/BseIndiaAPI/api/StockReach/w?scripcode=800324';
  try {
    const res = await fetchJSON(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.bseindia.com/'
      } 
    });
    console.log("BSE Response:", res.status, typeof res.data === 'object' ? JSON.stringify(res.data).substring(0, 200) : res.data);
  } catch (e) {
    console.log("BSE Error:", e.message);
  }
}

async function run() {
  await testYahooBSE();
  await testBSE();
}
run();
