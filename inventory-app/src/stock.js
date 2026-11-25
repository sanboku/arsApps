'use strict';

const { badRequest, conflict } = require('./errors');
const { transaction } = require('./db');
const masters = require('./masters');
const v = require('./validate');

/**
 * 在庫の保持先。拠点 { locationId } または取引先(サンプル保有) { customerId } のどちらか一方。
 */
function holderColumn(holder) {
  if (holder.locationId != null) return { column: 'location_id', id: holder.locationId, label: '在庫' };
  return { column: 'customer_id', id: holder.customerId, label: 'お客様保有数' };
}

function balance(db, productId, holder) {
  const { column, id } = holderColumn(holder);
  // column は上の固定値のみ。ユーザー入力は含まない。
  const row = db
    .prepare(`SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_movements WHERE product_id = ? AND ${column} = ?`)
    .get(productId, id);
  return row.qty;
}

/** 1件の台帳行を追加する。qty は符号付き(減少は負)。 */
function record(db, { productId, holder, qty, kind, refType = null, refId = null, note = '' }) {
  if (!Number.isInteger(qty) || qty === 0) throw new Error('stock qty must be non-zero integer');
  db.prepare(
    `INSERT INTO stock_movements (product_id, location_id, customer_id, qty, kind, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    productId,
    holder.locationId ?? null,
    holder.customerId ?? null,
    qty,
    kind,
    refType,
    refId,
    note
  );
}

/** 保持先から qty を減らす(不足なら 409)。 */
function take(db, { productId, productLabel, holder, qty, kind, refType, refId, note }) {
  const have = balance(db, productId, holder);
  const { label } = holderColumn(holder);
  if (have < qty) {
    throw conflict(`${label}が不足しています: ${productLabel} (必要 ${qty} / 現在 ${have})`);
  }
  record(db, { productId, holder, qty: -qty, kind, refType, refId, note });
}

/** 保持先へ qty を増やす。 */
function give(db, { productId, holder, qty, kind, refType, refId, note }) {
  record(db, { productId, holder, qty, kind, refType, refId, note });
}

/** 0 でない残高の一覧(拠点・取引先別)。 */
function allBalances(db) {
  return db
    .prepare(
      `SELECT product_id, location_id, customer_id, SUM(qty) AS qty
         FROM stock_movements
        GROUP BY product_id, location_id, customer_id
       HAVING SUM(qty) <> 0`
    )
    .all();
}

/**
 * 入庫・在庫調整。qty が正なら入庫(receipt)、負なら調整の出庫(adjust, 在庫不足は 409)。
 */
function adjust(db, input) {
  const locationId = masters.requireRow(db, 'locations', v.id(input.location_id, '拠点'), '拠点').id;
  const product = masters.findProduct(db, input.product_id);
  const qty = v.signedInteger(input.qty, '数量');
  if (qty === 0) throw badRequest('数量は0以外を入力してください');
  const note = v.text(input.note, '備考', { max: 500 });
  const holder = { locationId };
  const label = `${product.sku} ${product.name}`;
  return transaction(db, () => {
    if (qty > 0) {
      give(db, { productId: product.id, holder, qty, kind: 'receipt', note });
    } else {
      take(db, { productId: product.id, productLabel: label, holder, qty: -qty, kind: 'adjust', note });
    }
    return { product_id: product.id, location_id: locationId, qty, balance: balance(db, product.id, holder) };
  });
}

module.exports = { balance, record, take, give, allBalances, adjust };
