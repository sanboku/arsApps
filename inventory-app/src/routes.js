'use strict';

const { HttpError, notFound } = require('./errors');
const masters = require('./masters');
const stock = require('./stock');
const transfers = require('./transfers');
const invoices = require('./invoices');

/**
 * ルーティング表。[メソッド, パス正規表現, ハンドラ(db, ctx), 成功時ステータス]
 */
function buildRoutes() {
  const r = [];
  const add = (method, pattern, handler, status = 200) => r.push({ method, pattern, handler: async (db, c) => handler(db, c), status });

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
  add('GET', /^\/api\/stock$/, async (db) => ({
    locations: await masters.listLocations(db),
    products: await masters.listProducts(db),
    customers: await masters.listCustomers(db),
    balances: await stock.allBalances(db),
    sample_loans: await transfers.sampleLoans(db),
  }));
  add('POST', /^\/api\/stock\/adjustments$/, (db, c) => stock.adjust(db, c.body), 201);
  add('GET', /^\/api\/movements$/, (db) =>
    db.all(
      `SELECT m.*, p.sku, p.name AS product_name, l.name AS location_name, c.name AS customer_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN locations l ON l.id = m.location_id
         LEFT JOIN customers c ON c.id = m.customer_id
        ORDER BY m.id DESC LIMIT 200`
    )
  );

  // 在庫移動・サンプル
  add('GET', /^\/api\/transfers$/, (db) => transfers.listTransfers(db));
  add('POST', /^\/api\/transfers$/, (db, c) => transfers.createTransfer(db, c.body), 201);
  add('GET', /^\/api\/sample-loans$/, (db) => transfers.sampleLoans(db));

  // 請求書
  add('GET', /^\/api\/invoices$/, (db, c) => invoices.listInvoices(db, { status: c.query.get('status') }));
  add('POST', /^\/api\/invoices$/, (db, c) => invoices.createDraft(db, c.body), 201);
  add('GET', /^\/api\/invoices\/(\d+)$/, async (db, c) => (await invoices.getInvoice(db, c.params[0])) || notFoundInvoice());
  add('PUT', /^\/api\/invoices\/(\d+)$/, (db, c) => invoices.updateDraft(db, c.params[0], c.body));
  add('DELETE', /^\/api\/invoices\/(\d+)$/, async (db, c) => {
    await invoices.deleteDraft(db, c.params[0]);
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

/**
 * API を1件処理する。ブラウザでもサーバーでも同じ処理を使う。
 * 戻り値: { status, data }。業務エラーは HttpError として投げる。
 */
async function dispatch(db, method, pathname, query, body) {
  const matches = ROUTES.filter((route) => route.pattern.test(pathname));
  if (matches.length === 0) return { status: 404, data: { error: 'APIが見つかりません' } };
  const route = matches.find((m) => m.method === method);
  if (!route) return { status: 405, data: { error: '許可されていないメソッドです' } };
  const params = pathname.match(route.pattern).slice(1);
  const data = await route.handler(db, { params, body, query });
  return { status: route.status, data };
}

module.exports = { dispatch };
