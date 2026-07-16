const puppeteer = require('puppeteer');

async function intercept(url) {
  console.log(`\n========================================`);
  console.log(`Visiting: ${url}`);
  console.log(`========================================`);
  
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Enable request interception
  await page.setRequestInterception(true);
  
  page.on('request', request => {
    const rType = request.resourceType();
    if (rType === 'xhr' || rType === 'fetch') {
      console.log(`[REQ] ${request.method()} ${request.url()}`);
      const headers = request.headers();
      // Print interesting headers
      if (headers['authorization']) console.log(`      Auth: ${headers['authorization']}`);
      if (headers['x-api-key']) console.log(`      X-API-Key: ${headers['x-api-key']}`);
    }
    request.continue();
  });
  
  page.on('response', async response => {
    const request = response.request();
    const rType = request.resourceType();
    
    if (rType === 'xhr' || rType === 'fetch') {
      const url = request.url();
      const status = response.status();
      console.log(`[RES] ${status} ${url}`);
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json') || url.includes('.json')) {
          const text = await response.text();
          console.log(`      Data: ${text.substring(0, 300)}...`);
        }
      } catch (e) {
        // ignore
      }
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait an extra 3 seconds for any polling or delayed fetches
    await new Promise(r => setTimeout(r, 3000));
  } catch (err) {
    console.log("Error visiting page:", err.message);
  }

  await browser.close();
}

async function run() {
  await intercept('https://sgbanalyzer.com/live');
  await intercept('https://sgb.vercel.app/');
}

run();
