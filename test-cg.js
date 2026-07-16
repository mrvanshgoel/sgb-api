async function test() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether-gold,kinesis-silver&vs_currencies=inr');
    const json = await res.json();
    console.log(json);
  } catch (e) {
    console.error(e);
  }
}
test();
