'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const masters = require('../src/masters');
const stock = require('../src/stock');
const transfers = require('../src/transfers');
const invoices = require('../src/invoices');
const { HttpError } = require('../src/errors');

let db;
let tokyo;
let osaka;
let pen;
let box;
let acme;

const qtyAt = (productId, holder) => stock.balance(db, productId, holder);
const countOf = async (sql, params = []) => (await db.get(sql, params)).n;

beforeEach(async () => {
  db = await openDatabase({ memory: true });
  tokyo = (await masters.saveLocation(db, { code: 'TKY', name: '東京倉庫' })).id;
  osaka = (await masters.saveLocation(db, { code: 'OSK', name: '大阪倉庫' })).id;
  pen = (await masters.saveProduct(db, { sku: 'PEN-01', name: 'ボールペン', unit: '本', unit_price: 100 })).id;
  box = (await masters.saveProduct(db, { sku: 'BOX-01', name: '段ボール', unit: '枚', unit_price: 250 })).id;
  acme = (await masters.saveCustomer(db, { name: 'アクメ商事', address: '東京都', email: 'a@example.com' })).id;
  // 初期入庫(台帳に直接記録)
  await stock.give(db, { productId: pen, holder: { locationId: tokyo }, qty: 50, kind: 'receipt' });
  await stock.give(db, { productId: box, holder: { locationId: tokyo }, qty: 10, kind: 'receipt' });
});

after(() => db && db.close());

describe('マスタ', () => {
  test('拠点コードの重複は 409', async () => {
    await assert.rejects(
      () => masters.saveLocation(db, { code: 'TKY', name: '重複' }),
      (e) => e instanceof HttpError && e.status === 409
    );
  });

  test('必須項目の未入力は 400', async () => {
    await assert.rejects(() => masters.saveProduct(db, { sku: '', name: 'x' }), (e) => e.status === 400);
  });

  test('無効化した拠点は通常の一覧に出ない', async () => {
    await masters.saveLocation(db, { code: 'OLD', name: '旧倉庫', active: false }, null);
    const active = await masters.listLocations(db);
    const all = await masters.listLocations(db, { includeInactive: true });
    assert.equal(active.some((l) => l.code === 'OLD'), false);
    assert.equal(all.some((l) => l.code === 'OLD'), true);
  });
});

describe('拠点間の在庫移動', () => {
  test('東京→大阪へ移動すると両拠点の残高が変わり、合計は変わらない', async () => {
    await transfers.createTransfer(db, {
      kind: 'transfer',
      from_location_id: tokyo,
      to_location_id: osaka,
      lines: [{ product_id: pen, qty: 20 }],
    });
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 30);
    assert.equal(await qtyAt(pen, { locationId: osaka }), 20);
    assert.equal(await countOf('SELECT SUM(qty)::int AS n FROM stock_movements WHERE product_id = ?', [pen]), 50);
  });

  test('在庫不足の移動は 409 になり、途中の行も含めて何も変わらない', async () => {
    await assert.rejects(
      () => transfers.createTransfer(db, {
        kind: 'transfer',
        from_location_id: tokyo,
        to_location_id: osaka,
        lines: [{ product_id: pen, qty: 10 }, { product_id: box, qty: 99 }],
      }),
      (e) => e.status === 409 && /在庫が不足/.test(e.message)
    );
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 50);
    assert.equal(await qtyAt(pen, { locationId: osaka }), 0);
    assert.equal(await countOf('SELECT COUNT(*)::int AS n FROM transfers'), 0);
  });

  test('同一拠点への移動は拒否する', async () => {
    await assert.rejects(
      () => transfers.createTransfer(db, { kind: 'transfer', from_location_id: tokyo, to_location_id: tokyo, lines: [{ product_id: pen, qty: 1 }] }),
      (e) => e.status === 400
    );
  });

  test('同一品目の複数行は合算して在庫チェックされる', async () => {
    await assert.rejects(
      () => transfers.createTransfer(db, {
        kind: 'transfer',
        from_location_id: tokyo,
        to_location_id: osaka,
        lines: [{ product_id: box, qty: 6 }, { product_id: box, qty: 6 }],
      }),
      (e) => e.status === 409
    );
  });
});

describe('サンプル品の払出と戻し', () => {
  test('払出でお客様の保有数が増え、貸出残に出る', async () => {
    await transfers.createTransfer(db, {
      kind: 'sample_out',
      from_location_id: tokyo,
      customer_id: acme,
      lines: [{ product_id: pen, qty: 5 }],
    });
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 45);
    assert.equal(await qtyAt(pen, { customerId: acme }), 5);
    const loans = await transfers.sampleLoans(db);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].qty, 5);
  });

  test('一部返却すると貸出残が減り、返却先拠点の在庫が増える', async () => {
    await transfers.createTransfer(db, { kind: 'sample_out', from_location_id: tokyo, customer_id: acme, lines: [{ product_id: pen, qty: 5 }] });
    await transfers.createTransfer(db, { kind: 'sample_return', customer_id: acme, to_location_id: osaka, lines: [{ product_id: pen, qty: 2 }] });
    assert.equal(await qtyAt(pen, { customerId: acme }), 3);
    assert.equal(await qtyAt(pen, { locationId: osaka }), 2);
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 45);
  });

  test('貸出数を超える返却は 409', async () => {
    await transfers.createTransfer(db, { kind: 'sample_out', from_location_id: tokyo, customer_id: acme, lines: [{ product_id: pen, qty: 1 }] });
    await assert.rejects(
      () => transfers.createTransfer(db, { kind: 'sample_return', customer_id: acme, to_location_id: tokyo, lines: [{ product_id: pen, qty: 2 }] }),
      (e) => e.status === 409
    );
    assert.equal(await qtyAt(pen, { customerId: acme }), 1);
  });

  test('不正な操作種別は 400', async () => {
    await assert.rejects(() => transfers.createTransfer(db, { kind: 'hack', lines: [] }), (e) => e.status === 400);
  });
});

describe('請求書', () => {
  const draftInput = (overrides = {}) => ({
    customer_id: acme,
    location_id: tokyo,
    issue_date: '2026-11-01',
    lines: [{ product_id: pen, qty: 4 }, { product_id: box, qty: 2, unit_price: 300 }],
    ...overrides,
  });

  test('下書きは在庫を動かさず、単価省略時は標準単価・税は10%切り捨て', async () => {
    const inv = await invoices.createDraft(db, draftInput());
    assert.equal(inv.status, 'draft');
    assert.equal(inv.number, null);
    // 4*100 + 2*300 = 1000, 税 100
    assert.equal(inv.subtotal, 1000);
    assert.equal(inv.tax, 100);
    assert.equal(inv.total, 1100);
    assert.equal(inv.due_date, '2026-12-01');
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 50);
  });

  test('発行で採番され、出荷拠点の在庫が減る', async () => {
    const inv = await invoices.createDraft(db, draftInput());
    const issued = await invoices.issue(db, inv.id);
    assert.equal(issued.status, 'issued');
    assert.equal(issued.number, 'INV-202611-0001');
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 46);
    assert.equal(await qtyAt(box, { locationId: tokyo }), 8);
  });

  test('請求書番号は月ごとに連番になる', async () => {
    const a = await invoices.issue(db, (await invoices.createDraft(db, draftInput())).id);
    const b = await invoices.issue(db, (await invoices.createDraft(db, draftInput({ issue_date: '2026-11-20' }))).id);
    const c = await invoices.issue(db, (await invoices.createDraft(db, draftInput({ issue_date: '2026-12-02' }))).id);
    assert.equal(a.number, 'INV-202611-0001');
    assert.equal(b.number, 'INV-202611-0002');
    assert.equal(c.number, 'INV-202612-0001');
  });

  test('在庫不足の請求書は発行できず、下書きのまま', async () => {
    const inv = await invoices.createDraft(db, draftInput({ lines: [{ product_id: box, qty: 11 }] }));
    await assert.rejects(() => invoices.issue(db, inv.id), (e) => e.status === 409);
    assert.equal((await invoices.getInvoice(db, inv.id)).status, 'draft');
    assert.equal(await qtyAt(box, { locationId: tokyo }), 10);
  });

  test('取消で在庫が戻り、取消済みは再取消できない', async () => {
    const issued = await invoices.issue(db, (await invoices.createDraft(db, draftInput())).id);
    const voided = await invoices.voidInvoice(db, issued.id);
    assert.equal(voided.status, 'void');
    assert.equal(await qtyAt(pen, { locationId: tokyo }), 50);
    await assert.rejects(() => invoices.voidInvoice(db, issued.id), (e) => e.status === 409);
  });

  test('入金済みへの遷移は発行済みからのみ', async () => {
    const draft = await invoices.createDraft(db, draftInput());
    await assert.rejects(() => invoices.markPaid(db, draft.id), (e) => e.status === 409);
    const paid = await invoices.markPaid(db, (await invoices.issue(db, draft.id)).id);
    assert.equal(paid.status, 'paid');
    assert.ok(paid.paid_at);
  });

  test('下書きのみ編集・削除できる', async () => {
    const issued = await invoices.issue(db, (await invoices.createDraft(db, draftInput())).id);
    await assert.rejects(() => invoices.updateDraft(db, issued.id, draftInput()), (e) => e.status === 409);
    await assert.rejects(() => invoices.deleteDraft(db, issued.id), (e) => e.status === 409);

    const draft = await invoices.createDraft(db, draftInput());
    const updated = await invoices.updateDraft(db, draft.id, draftInput({ lines: [{ product_id: pen, qty: 1, unit_price: 500 }] }));
    assert.equal(updated.lines.length, 1);
    assert.equal(updated.subtotal, 500);
    await invoices.deleteDraft(db, draft.id);
    assert.equal(await invoices.getInvoice(db, draft.id), null);
  });

  test('支払期日が発行日より前なら 400', async () => {
    await assert.rejects(() => invoices.createDraft(db, draftInput({ due_date: '2026-10-01' })), (e) => e.status === 400);
  });
});

describe('入庫・在庫調整', () => {
  test('正の数量は入庫、負の数量は在庫不足なら 409', async () => {
    const r = await stock.adjust(db, { location_id: osaka, product_id: pen, qty: 7, note: '初回入庫' });
    assert.equal(r.balance, 7);
    await assert.rejects(() => stock.adjust(db, { location_id: osaka, product_id: pen, qty: -8 }), (e) => e.status === 409);
    assert.equal((await stock.adjust(db, { location_id: osaka, product_id: pen, qty: -7 })).balance, 0);
    const kinds = (await db.all('SELECT kind FROM stock_movements WHERE location_id = ? ORDER BY id', [osaka])).map((x) => x.kind);
    assert.deepEqual(kinds, ['receipt', 'adjust']);
  });

  test('0 は 400', async () => {
    await assert.rejects(() => stock.adjust(db, { location_id: osaka, product_id: pen, qty: 0 }), (e) => e.status === 400);
  });
});
