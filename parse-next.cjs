const https = require('https');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ data, headers: res.headers }));
      res.on('error', reject);
    });
  });
}

async function run() {
  const result = await fetch('https://sgb.vercel.app/');
  const match = result.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    console.log("buildId:", json.buildId);
    
    // fetch the next data
    const dataUrl = `https://sgb.vercel.app/_next/data/${json.buildId}/index.json`;
    console.log("fetching:", dataUrl);
    const dataResult = await fetch(dataUrl);
    console.log("headers:", dataResult.headers);
    // Is there an x-vercel-cache header?
  }
}
run();
