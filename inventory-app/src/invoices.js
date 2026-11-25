'use strict';

const { badRequest, conflict, notFound } = require('./errors');
const { today, addDays } = require('./dates');
const { NOW_SQL } = require('./db-core');
const masters = require('./masters');
const stock = require('./stock');
const v = require('./validate');

/** 消費税率(10%)。税額は1請求書単位で切り捨て。 */
const TAX_RATE = 0.1;
const STATUS_LABEL = { draft: '下書き', issued: '発行済', paid: '入金済', void: '取消' };

function totalsOf(lines) {
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const tax = Math.floor(subtotal * TAX_RATE);
  return { subtotal, tax, total: subtotal + tax };
}

/** 請求明細を検証し、金額を計算する。単価省略時は品目の標準単価を使う。 */
async function parseLines(db, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw badRequest('明細を1行以上入力してください');
  const result = [];
  for (const line of rawLines) {
    const product = await masters.findProduct(db, line.product_id);
    const qty = v.positiveInt(line.qty, '数量');
    const unitPrice = v.integer(line.unit_price ?? product.unit_price, '単価', { min: 0 });
    result.push({ product, qty, unit_price: unitPrice, amount: qty * unitPrice });
  }
  return result;
}

/** 入力を検証して保存用の値にまとめる */
async function parseHeader(db, input) {
  const customer = await masters.requireRow(db, 'customers', v.id(input.customer_id, '取引先'), '取引先');
  const location = await masters.requireRow(db, 'locations', v.id(input.location_id, '出荷拠点'), '出荷拠点');
  const issueDate = v.date(input.issue_date || today(), '発行日');
  const dueDate = v.date(input.due_date || addDays(issueDate, 30), '支払期日');
  if (dueDate < issueDate) throw badRequest('支払期日は発行日以降にしてください');
  return {
    customer,
    location,
    issueDate,
    dueDate,
    note: v.text(input.note, '備考', { max: 500 }),
    lines: await parseLines(db, input.lines),
  };
}

async function writeLines(db, invoiceId, lines) {
  await db.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);
  for (const l of lines) {
    await db.run(
      'INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, l.product.id, l.qty, l.unit_price, l.amount]
    );
  }
}

function requireStatus(invoice, allowed, action) {
  if (!allowed.includes(invoice.status)) {
    throw conflict(`${STATUS_LABEL[invoice.status]}の請求書は${action}できません`);
  }
}

async function loadInvoice(db, id) {
  const row = await db.get('SELECT * FROM invoices WHERE id = ?', [v.id(id, '請求書')]);
  if (!row) throw notFound('請求書が見つかりません');
  return row;
}

/** 請求書番号 INV-YYYYMM-0001 を発行日の年月で採番する(発行時に確定) */
async function nextNumber(db, issueDate) {
  const prefix = `INV-${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}-`;
  const row = await db.get('SELECT COUNT(*)::int AS n FROM invoices WHERE number LIKE ?', [`${prefix}%`]);
  return prefix + String(row.n + 1).padStart(4, '0');
}

async function createDraft(db, input) {
  const h = await parseHeader(db, input);
  const t = totalsOf(h.lines);
  return db.tx(async (tx) => {
    const row = await tx.get(
      `INSERT INTO invoices (status, customer_id, location_id, issue_date, due_date, note, subtotal, tax, total)
       VALUES ('draft', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [h.customer.id, h.location.id, h.issueDate, h.dueDate, h.note, t.subtotal, t.tax, t.total]
    );
    await writeLines(tx, row.id, h.lines);
    return getInvoice(tx, row.id);
  });
}

async function updateDraft(db, id, input) {
  const current = await loadInvoice(db, id);
  requireStatus(current, ['draft'], '編集');
  const h = await parseHeader(db, input);
  const t = totalsOf(h.lines);
  return db.tx(async (tx) => {
    await tx.run(
      `UPDATE invoices SET customer_id = ?, location_id = ?, issue_date = ?, due_date = ?, note = ?,
              subtotal = ?, tax = ?, total = ?, updated_at = ${NOW_SQL}
        WHERE id = ?`,
      [h.customer.id, h.location.id, h.issueDate, h.dueDate, h.note, t.subtotal, t.tax, t.total, current.id]
    );
    await writeLines(tx, current.id, h.lines);
    return getInvoice(tx, current.id);
  });
}

async function deleteDraft(db, id) {
  const current = await loadInvoice(db, id);
  requireStatus(current, ['draft'], '削除');
  await db.tx(async (tx) => {
    await tx.run('DELETE FROM invoice_lines WHERE invoice_id = ?', [current.id]);
    await tx.run('DELETE FROM invoices WHERE id = ?', [current.id]);
  });
}

/** 発行: 採番し、出荷拠点の在庫を明細数量分減らす。在庫不足なら発行不可。 */
async function issue(db, id) {
  const current = await loadInvoice(db, id);
  requireStatus(current, ['draft'], '発行');
  return db.tx(async (tx) => {
    const lines = await tx.all(
      `SELECT il.product_id, il.qty, p.sku, p.name FROM invoice_lines il
         JOIN products p ON p.id = il.product_id WHERE il.invoice_id = ? ORDER BY il.id`,
      [current.id]
    );
    const number = await nextNumber(tx, current.issue_date);
    for (const l of lines) {
      await stock.take(tx, {
        productId: l.product_id,
        productLabel: `${l.sku} ${l.name}`,
        holder: { locationId: current.location_id },
        qty: l.qty,
        kind: 'invoice_issue',
        refType: 'invoice',
        refId: current.id,
        note: number,
      });
    }
    await tx.run(`UPDATE invoices SET status = 'issued', number = ?, updated_at = ${NOW_SQL} WHERE id = ?`, [
      number, current.id,
    ]);
    return getInvoice(tx, current.id);
  });
}

async function markPaid(db, id) {
  const current = await loadInvoice(db, id);
  requireStatus(current, ['issued'], '入金済にでき');
  await db.run(
    `UPDATE invoices SET status = 'paid', paid_at = ${NOW_SQL}, updated_at = ${NOW_SQL} WHERE id = ?`,
    [current.id]
  );
  return getInvoice(db, current.id);
}

/** 取消: 発行時に減らした在庫を戻す。 */
async function voidInvoice(db, id) {
  const current = await loadInvoice(db, id);
  requireStatus(current, ['issued', 'paid'], '取消');
  return db.tx(async (tx) => {
    const lines = await tx.all('SELECT product_id, qty FROM invoice_lines WHERE invoice_id = ?', [current.id]);
    for (const l of lines) {
      await stock.give(tx, {
        productId: l.product_id,
        holder: { locationId: current.location_id },
        qty: l.qty,
        kind: 'invoice_void',
        refType: 'invoice',
        refId: current.id,
        note: current.number,
      });
    }
    await tx.run(`UPDATE invoices SET status = 'void', updated_at = ${NOW_SQL} WHERE id = ?`, [current.id]);
    return getInvoice(tx, current.id);
  });
}

async function getInvoice(db, id) {
  const inv = await db.get(
    `SELECT i.*, c.name AS customer_name, c.address AS customer_address, c.email AS customer_email,
            l.name AS location_name
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       JOIN locations l ON l.id = i.location_id
      WHERE i.id = ?`,
    [v.id(id, '請求書')]
  );
  if (!inv) return null;
  inv.status_label = STATUS_LABEL[inv.status];
  inv.lines = await db.all(
    `SELECT il.product_id, p.sku, p.name AS product_name, p.unit, il.qty, il.unit_price, il.amount
       FROM invoice_lines il JOIN products p ON p.id = il.product_id
      WHERE il.invoice_id = ? ORDER BY il.id`,
    [inv.id]
  );
  return inv;
}

async function listInvoices(db, { status = null } = {}) {
  const rows = status
    ? await db.all('SELECT id FROM invoices WHERE status = ? ORDER BY id DESC LIMIT 300', [status])
    : await db.all('SELECT id FROM invoices ORDER BY id DESC LIMIT 300');
  const result = [];
  for (const r of rows) result.push(await getInvoice(db, r.id));
  return result;
}

module.exports = {
  TAX_RATE,
  STATUS_LABEL,
  createDraft,
  updateDraft,
  deleteDraft,
  issue,
  markPaid,
  voidInvoice,
  getInvoice,
  listInvoices,
};
