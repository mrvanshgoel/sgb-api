async function testYahoo() {
  try {
    const goldRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d');
    const goldJson = await goldRes.json();
    const goldUsd = goldJson.chart.result[0].meta.regularMarketPrice;

    const inrRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1m&range=1d');
    const inrJson = await inrRes.json();
    const usdInr = inrJson.chart.result[0].meta.regularMarketPrice;

    console.log(`Gold USD/oz: $${goldUsd}`);
    console.log(`USD/INR: ₹${usdInr}`);
    console.log(`Gold INR/oz: ₹${goldUsd * usdInr}`);
    console.log(`Gold INR/g: ₹${(goldUsd * usdInr) / 31.1034768}`);
  } catch(e) { console.error(e); }
}
testYahoo();
