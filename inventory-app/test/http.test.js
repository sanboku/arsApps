'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createServer } = require('../src/server');

let server;
let db;
let base;

before(async () => {
  db = await openDatabase({ memory: true });
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test('API で拠点・品目を作り、請求書と移動の一連の流れが通る', async () => {
  const t = (await call('POST', '/api/locations', { code: 'TKY', name: '東京' })).body;
  const o = (await call('POST', '/api/locations', { code: 'OSK', name: '大阪' })).body;
  const p = (await call('POST', '/api/products', { sku: 'A-1', name: '部品A', unit_price: 1000 })).body;
  const c = (await call('POST', '/api/customers', { name: 'テスト顧客' })).body;

  const draft = await call('POST', '/api/invoices', {
    customer_id: c.id, location_id: t.id, lines: [{ product_id: p.id, qty: 1 }],
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.total, 1100);

  const issue = await call('POST', `/api/invoices/${draft.body.id}/issue`);
  assert.equal(issue.status, 409, '在庫ゼロの拠点からは発行できない');
  assert.match(issue.body.error, /在庫が不足/);

  const adjust = await call('POST', '/api/stock/adjustments', { location_id: t.id, product_id: p.id, qty: 5 });
  assert.equal(adjust.status, 201);
  assert.equal(adjust.body.balance, 5);

  const transfer = await call('POST', '/api/transfers', {
    kind: 'transfer', from_location_id: t.id, to_location_id: o.id, lines: [{ product_id: p.id, qty: 2 }],
  });
  assert.equal(transfer.status, 201);

  const stock = await call('GET', '/api/stock');
  assert.equal(stock.status, 200);
  assert.equal(stock.body.locations.length, 2);
  assert.equal(stock.body.balances.find((b) => b.location_id === o.id && b.product_id === p.id).qty, 2);

  const del = await call('DELETE', `/api/invoices/${draft.body.id}`);
  assert.deepEqual(del.body, { ok: true });
});

test('不正な入力・存在しないIDは適切なステータスを返す', async () => {
  assert.equal((await call('GET', '/api/invoices/99999')).status, 404);
  assert.equal((await call('POST', '/api/products', { sku: '', name: '' })).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/locations')).status, 405);
});

test('静的ファイルを配信し、パストラバーサルは拒否する', async () => {
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const traversal = await fetch(base + '/..%2F..%2Fpackage.json');
  assert.notEqual(traversal.status, 200);
});
