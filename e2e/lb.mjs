// Round-robin HTTP proxy that mimics Vercel's multiple serverless instances locally:
// every request goes to the next backend, and each backend has its own /tmp database.
// Usage: node lb.mjs 8090 8001 8002 [8003 ...]
import http from 'node:http';

const [listen, ...ports] = process.argv.slice(2).map(Number);
let i = 0;
http
  .createServer((req, res) => {
    const port = ports[i++ % ports.length];
    const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, { ...r.headers, 'x-machinemd-instance': String(port) });
      r.pipe(res);
    });
    up.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: `upstream ${port}: ${e.message}` }));
    });
    req.pipe(up);
  })
  .listen(listen, () => console.log(`round-robin :${listen} -> ${ports.join(', ')}`));
