'use strict';

const { badRequest, conflict, notFound } = require('./errors');
const { transaction } = require('./db');
const { today, addDays } = require('./dates');
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
function parseLines(db, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw badRequest('明細を1行以上入力してください');
  return rawLines.map((line) => {
    const product = masters.findProduct(db, line.product_id);
    const qty = v.positiveInt(line.qty, '数量');
    const unitPrice = v.integer(line.unit_price ?? product.unit_price, '単価', { min: 0 });
    return { product, qty, unit_price: unitPrice, amount: qty * unitPrice };
  });
}

/** 入力を検証して保存用の値にまとめる */
function parseHeader(db, input) {
  const customer = masters.requireRow(db, 'customers', v.id(input.customer_id, '取引先'), '取引先');
  const location = masters.requireRow(db, 'locations', v.id(input.location_id, '出荷拠点'), '出荷拠点');
  const issueDate = v.date(input.issue_date || today(), '発行日');
  const dueDate = v.date(input.due_date || addDays(issueDate, 30), '支払期日');
  if (dueDate < issueDate) throw badRequest('支払期日は発行日以降にしてください');
  return {
    customer,
    location,
    issueDate,
    dueDate,
    note: v.text(input.note, '備考', { max: 500 }),
    lines: parseLines(db, input.lines),
  };
}

function writeLines(db, invoiceId, lines) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
  for (const l of lines) {
    db.prepare(
      'INSERT INTO invoice_lines (invoice_id, product_id, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?)'
    ).run(invoiceId, l.product.id, l.qty, l.unit_price, l.amount);
  }
}

function requireStatus(invoice, allowed, action) {
  if (!allowed.includes(invoice.status)) {
    throw conflict(`${STATUS_LABEL[invoice.status]}の請求書は${action}できません`);
  }
}

function loadInvoice(db, id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(v.id(id, '請求書'));
  if (!row) throw notFound('請求書が見つかりません');
  return row;
}

/** 請求書番号 INV-YYYYMM-0001 を発行日の年月で採番する(発行時に確定) */
function nextNumber(db, issueDate) {
  const prefix = `INV-${issueDate.slice(0, 4)}${issueDate.slice(5, 7)}-`;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?').get(`${prefix}%`);
  return prefix + String(n + 1).padStart(4, '0');
}

function createDraft(db, input) {
  const h = parseHeader(db, input);
  const t = totalsOf(h.lines);
  return transaction(db, () => {
    const info = db
      .prepare(
        `INSERT INTO invoices (status, customer_id, location_id, issue_date, due_date, note, subtotal, tax, total)
         VALUES ('draft', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(h.customer.id, h.location.id, h.issueDate, h.dueDate, h.note, t.subtotal, t.tax, t.total);
    const id = Number(info.lastInsertRowid);
    writeLines(db, id, h.lines);
    return getInvoice(db, id);
  });
}

function updateDraft(db, id, input) {
  const current = loadInvoice(db, id);
  requireStatus(current, ['draft'], '編集');
  const h = parseHeader(db, input);
  const t = totalsOf(h.lines);
  return transaction(db, () => {
    db.prepare(
      `UPDATE invoices SET customer_id = ?, location_id = ?, issue_date = ?, due_date = ?, note = ?,
              subtotal = ?, tax = ?, total = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?`
    ).run(h.customer.id, h.location.id, h.issueDate, h.dueDate, h.note, t.subtotal, t.tax, t.total, current.id);
    writeLines(db, current.id, h.lines);
    return getInvoice(db, current.id);
  });
}

function deleteDraft(db, id) {
  const current = loadInvoice(db, id);
  requireStatus(current, ['draft'], '削除');
  transaction(db, () => {
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(current.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(current.id);
  });
}

/** 発行: 採番し、出荷拠点の在庫を明細数量分減らす。在庫不足なら発行不可。 */
function issue(db, id) {
  const current = loadInvoice(db, id);
  requireStatus(current, ['draft'], '発行');
  return transaction(db, () => {
    const lines = db
      .prepare(
        `SELECT il.product_id, il.qty, p.sku, p.name FROM invoice_lines il
           JOIN products p ON p.id = il.product_id WHERE il.invoice_id = ? ORDER BY il.id`
      )
      .all(current.id);
    const number = nextNumber(db, current.issue_date);
    for (const l of lines) {
      stock.take(db, {
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
    db.prepare(
      "UPDATE invoices SET status = 'issued', number = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(number, current.id);
    return getInvoice(db, current.id);
  });
}

function markPaid(db, id) {
  const current = loadInvoice(db, id);
  requireStatus(current, ['issued'], '入金済にでき');
  db.prepare(
    "UPDATE invoices SET status = 'paid', paid_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(current.id);
  return getInvoice(db, current.id);
}

/** 取消: 発行時に減らした在庫を戻す。 */
function voidInvoice(db, id) {
  const current = loadInvoice(db, id);
  requireStatus(current, ['issued', 'paid'], '取消');
  return transaction(db, () => {
    const lines = db
      .prepare('SELECT product_id, qty FROM invoice_lines WHERE invoice_id = ?')
      .all(current.id);
    for (const l of lines) {
      stock.give(db, {
        productId: l.product_id,
        holder: { locationId: current.location_id },
        qty: l.qty,
        kind: 'invoice_void',
        refType: 'invoice',
        refId: current.id,
        note: current.number,
      });
    }
    db.prepare(
      "UPDATE invoices SET status = 'void', updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(current.id);
    return getInvoice(db, current.id);
  });
}

function getInvoice(db, id) {
  const inv = db
    .prepare(
      `SELECT i.*, c.name AS customer_name, c.address AS customer_address, c.email AS customer_email,
              l.name AS location_name
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         JOIN locations l ON l.id = i.location_id
        WHERE i.id = ?`
    )
    .get(v.id(id, '請求書'));
  if (!inv) return null;
  inv.status_label = STATUS_LABEL[inv.status];
  inv.lines = db
    .prepare(
      `SELECT il.product_id, p.sku, p.name AS product_name, p.unit, il.qty, il.unit_price, il.amount
         FROM invoice_lines il JOIN products p ON p.id = il.product_id
        WHERE il.invoice_id = ? ORDER BY il.id`
    )
    .all(inv.id);
  return inv;
}

function listInvoices(db, { status = null } = {}) {
  const rows = db
    .prepare(
      `SELECT i.id FROM invoices i
        WHERE (? IS NULL OR i.status = ?)
        ORDER BY i.id DESC LIMIT 300`
    )
    .all(status, status);
  return rows.map((r) => getInvoice(db, r.id));
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
