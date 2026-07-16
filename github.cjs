const https = require('https');

https.get('https://api.github.com/users/ganapativs/repos?per_page=100', {
  headers: {
    'User-Agent': 'NodeJS'
  }
}, (res) => {
  let d = '';
  res.on('data', c => d+=c);
  res.on('end', () => {
    try {
      const repos = JSON.parse(d);
      const matches = repos.filter(r => r.name.toLowerCase().includes('sgb') || (r.description && r.description.toLowerCase().includes('sgb')));
      console.log(matches.map(r => r.name + ' - ' + r.description));
    } catch(e) {
      console.log(d.substring(0, 100));
    }
  });
});
