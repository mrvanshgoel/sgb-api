const https = require('https');

function fetchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      }
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  const query = {
    symbols: { tickers: ["NSE:SGBJUL28IV", "BSE:SGBJUL28IV"] },
    columns: ["close", "change", "change_abs", "volume", "high", "low"]
  };
  const body = JSON.stringify(query);
  const data = await fetchJSON('https://scanner.tradingview.com/india/scan', body);
  console.log(data);
}
run();
