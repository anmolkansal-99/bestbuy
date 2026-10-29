import http from 'node:http';
import { detailFor } from './fixtures.js';

/** A tiny stand-in for bestbuy.ca's JSON API. Tests change `mock.products` / `mock.mode` between runs. */
export function startMock() {
  const mock = {
    products: [],
    mode: 'ok', // ok | block | html200 | badjson | wrongshape
    failPage: null, // page number that answers HTTP 500
    withDetails: true,
    hideTotals: false, // leave `total` / `totalPages` out of the answer
    ignorePage: false, // always answer with page 1, like a site that ignores the page number
    emptyPage: null, // this page number comes back empty (the totals are still reported)
    reportedTotal: null, // pretend the site's `total` is this number (while the list itself is unchanged)
    onSearch: null, // (page) => void, runs before a search is answered; lets a test change the list mid-read
    requests: [],
    port: 0,
    close: () => new Promise((resolve) => server.close(resolve)),
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://mock');
    mock.requests.push(req.url);

    if (mock.mode === 'block') {
      res.writeHead(403, { 'content-type': 'text/html' });
      return res.end('<html><body><h1>Access Denied</h1></body></html>');
    }
    if (mock.mode === 'html200') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>Please verify you are human</body></html>');
    }
    if (mock.mode === 'badjson') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"products": [');
    }
    if (mock.mode === 'wrongshape') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'hello' }));
    }

    if (u.pathname === '/api/v2/json/search') {
      const page = Number(u.searchParams.get('page') ?? 1);
      const pageSize = Number(u.searchParams.get('pageSize') ?? 24);
      if (mock.failPage === page) {
        res.writeHead(500);
        return res.end('boom');
      }
      mock.onSearch?.(page);
      const served = mock.ignorePage ? 1 : page;
      const body = {
        currentPage: page,
        pageSize,
        products: mock.emptyPage === page ? [] : mock.products.slice((served - 1) * pageSize, served * pageSize),
      };
      if (!mock.hideTotals) {
        body.total = mock.reportedTotal ?? mock.products.length;
        body.totalPages = Math.ceil(mock.products.length / pageSize);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(body));
    }

    const detail = u.pathname.match(/^\/api\/v2\/json\/product\/(\d+)$/);
    if (detail && mock.withDetails) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(detailFor(detail[1])));
    }
    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      mock.port = server.address().port;
      resolve(mock);
    });
  });
}
