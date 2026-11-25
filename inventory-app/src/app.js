'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HttpError, notFound } = require('./errors');
const masters = require('./masters');
const stock = require('./stock');
const transfers = require('./transfers');
const invoices = require('./invoices');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * ルーティング表。[メソッド, パス正規表現, ハンドラ(db, ctx), 成功時ステータス]
 */
function buildRoutes() {
  const r = [];
  const add = (method, pattern, handler, status = 200) => r.push({ method, pattern, handler, status });

  // 拠点
  add('GET', /^\/api\/locations$/, (db, c) => masters.listLocations(db, { includeInactive: c.query.get('all') === '1' }));
  add('POST', /^\/api\/locations$/, (db, c) => masters.saveLocation(db, c.body), 201);
  add('PUT', /^\/api\/locations\/(\d+)$/, (db, c) => masters.saveLocation(db, c.body, Number(c.params[0])));

  // 品目
  add('GET', /^\/api\/products$/, (db, c) => masters.listProducts(db, { includeInactive: c.query.get('all') === '1' }));
  add('POST', /^\/api\/products$/, (db, c) => masters.saveProduct(db, c.body), 201);
  add('PUT', /^\/api\/products\/(\d+)$/, (db, c) => masters.saveProduct(db, c.body, Number(c.params[0])));

  // 取引先
  add('GET', /^\/api\/customers$/, (db, c) => masters.listCustomers(db, { includeInactive: c.query.get('all') === '1' }));
  add('POST', /^\/api\/customers$/, (db, c) => masters.saveCustomer(db, c.body), 201);
  add('PUT', /^\/api\/customers\/(\d+)$/, (db, c) => masters.saveCustomer(db, c.body, Number(c.params[0])));

  // 在庫
  add('GET', /^\/api\/stock$/, (db) => ({
    locations: masters.listLocations(db),
    products: masters.listProducts(db),
    customers: masters.listCustomers(db),
    balances: stock.allBalances(db),
    sample_loans: transfers.sampleLoans(db),
  }));
  add('POST', /^\/api\/stock\/adjustments$/, (db, c) => stock.adjust(db, c.body), 201);
  add('GET', /^\/api\/movements$/, (db) =>
    db.prepare(
      `SELECT m.*, p.sku, p.name AS product_name, l.name AS location_name, c.name AS customer_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN locations l ON l.id = m.location_id
         LEFT JOIN customers c ON c.id = m.customer_id
        ORDER BY m.id DESC LIMIT 200`
    ).all()
  );

  // 在庫移動・サンプル
  add('GET', /^\/api\/transfers$/, (db) => transfers.listTransfers(db));
  add('POST', /^\/api\/transfers$/, (db, c) => transfers.createTransfer(db, c.body), 201);
  add('GET', /^\/api\/sample-loans$/, (db) => transfers.sampleLoans(db));

  // 請求書
  add('GET', /^\/api\/invoices$/, (db, c) => invoices.listInvoices(db, { status: c.query.get('status') }));
  add('POST', /^\/api\/invoices$/, (db, c) => invoices.createDraft(db, c.body), 201);
  add('GET', /^\/api\/invoices\/(\d+)$/, (db, c) => invoices.getInvoice(db, c.params[0]) || notFoundInvoice());
  add('PUT', /^\/api\/invoices\/(\d+)$/, (db, c) => invoices.updateDraft(db, c.params[0], c.body));
  add('DELETE', /^\/api\/invoices\/(\d+)$/, (db, c) => {
    invoices.deleteDraft(db, c.params[0]);
    return { ok: true };
  });
  add('POST', /^\/api\/invoices\/(\d+)\/issue$/, (db, c) => invoices.issue(db, c.params[0]));
  add('POST', /^\/api\/invoices\/(\d+)\/paid$/, (db, c) => invoices.markPaid(db, c.params[0]));
  add('POST', /^\/api\/invoices\/(\d+)\/void$/, (db, c) => invoices.voidInvoice(db, c.params[0]));

  return r;
}

const notFoundInvoice = () => {
  throw notFound('請求書が見つかりません');
};

const ROUTES = buildRoutes();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'リクエストが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSONの形式が不正です'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * HTTPリクエストハンドラを作る。db は openDatabase() の戻り値。
 */
function createHandler(db) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '許可されていないメソッドです' });
        return serveStatic(res, url.pathname);
      }

      const matches = ROUTES.filter((route) => route.pattern.test(url.pathname));
      if (matches.length === 0) return sendJson(res, 404, { error: 'APIが見つかりません' });
      const route = matches.find((m) => m.method === req.method);
      if (!route) return sendJson(res, 405, { error: '許可されていないメソッドです' });

      const params = url.pathname.match(route.pattern).slice(1);
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const data = route.handler(db, { params, body, query: url.searchParams });
      return sendJson(res, route.status, data);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'サーバーエラーが発生しました' });
    }
  };
}

module.exports = { createHandler };
