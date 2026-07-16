const puppeteer = require('puppeteer');
const https = require('https');

async function testNodeJSFetch(url, headers, cookies) {
  console.log(`\n--- Testing Node.js fetch ---`);
  console.log(`Target: ${url}`);
  
  const options = {
    headers: {
      ...headers,
      'Cookie': cookies,
      'Host': 'www.nseindia.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://www.nseindia.com/get-quotes/equity?symbol=SGBJUL28IV'
    }
  };

  return new Promise((resolve) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Node.js Response Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
           console.log(`Node.js Response Data (first 300 chars): ${data.substring(0, 300)}`);
        }
        resolve(res.statusCode);
      });
    }).on('error', (err) => {
      console.log(`Node.js fetch error: ${err.message}`);
      resolve(null);
    });
  });
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

  console.log(`Visiting NSE India SGB Page to get cookies...`);
  try {
    await page.goto('https://www.nseindia.com', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch(e) {
    console.log(`Navigation error: ${e.message}`);
  }

  const cookiesArr = await page.cookies();
  const cookiesStr = cookiesArr.map(c => `${c.name}=${c.value}`).join('; ');
  console.log(`\nExtracted cookies!`);
  
  const endpoint = 'https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=GB&symbol=SGBJUL28IV';
  await testNodeJSFetch(endpoint, {}, cookiesStr);
  
  await browser.close();
}

run();
