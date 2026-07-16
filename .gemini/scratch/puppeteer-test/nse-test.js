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
    }
  };

  return new Promise((resolve) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Node.js Response Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
           console.log(`Node.js Response Data (first 200 chars): ${data.substring(0, 200)}`);
        } else {
           console.log(`Node.js Response failed. WAF block likely.`);
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
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9'
  });
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

  let apiEndpoint = null;
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api/quote-equity') || url.includes('api/')) {
       if (url.includes('SGB')) {
           apiEndpoint = url;
           console.log(`\n[Found JSON Endpoint]: ${url}`);
           try {
               const json = await response.json();
               console.log(`[JSON Success] Extracted LTP: ${json.priceInfo?.lastPrice || 'Not found'}`);
           } catch(e) {
               console.log(`[JSON Error] Could not parse response as JSON`);
           }
       }
    }
  });

  console.log(`Visiting NSE India SGB Page...`);
  try {
    await page.goto('https://www.nseindia.com/get-quotes/equity?symbol=SGBJUL28IV', { waitUntil: 'networkidle2', timeout: 45000 });
  } catch(e) {
    console.log(`Navigation error or timeout: ${e.message}`);
  }

  // Get cookies
  const cookiesArr = await page.cookies();
  const cookiesStr = cookiesArr.map(c => `${c.name}=${c.value}`).join('; ');
  console.log(`\nExtracted ${cookiesArr.length} cookies from Puppeteer.`);

  if (apiEndpoint) {
     await testNodeJSFetch(apiEndpoint, {}, cookiesStr);
  } else {
     console.log('Could not identify a specific SGB API endpoint during page load.');
  }

  await browser.close();
}

run();
