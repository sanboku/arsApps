'use strict';

const { badRequest } = require('./errors');
const masters = require('./masters');
const stock = require('./stock');
const v = require('./validate');

const KINDS = {
  transfer: '拠点間移動',
  sample_out: 'サンプル払出(拠点→お客様)',
  sample_return: 'サンプル返却(お客様→拠点)',
};

/** 同一品目の行をまとめ、品目情報を付与する */
async function normalizeLines(db, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw badRequest('明細を1行以上入力してください');
  const totals = new Map();
  for (const line of rawLines) {
    const productId = v.id(line.product_id, '品目');
    const qty = v.positiveInt(line.qty, '数量');
    totals.set(productId, (totals.get(productId) || 0) + qty);
  }
  const result = [];
  for (const [productId, qty] of totals) {
    result.push({ product: await masters.findProduct(db, productId), qty });
  }
  return result;
}

async function locationOf(db, value, label) {
  return (await masters.requireRow(db, 'locations', v.id(value, label), label)).id;
}

async function customerOf(db, value) {
  return (await masters.requireRow(db, 'customers', v.id(value, '取引先'), '取引先')).id;
}

/**
 * 在庫移動を登録する。
 *  - transfer:      拠点A → 拠点B
 *  - sample_out:    拠点 → お客様(サンプル貸出)
 *  - sample_return: お客様 → 拠点(サンプル戻し)
 * 減る側の保持数が足りない場合は 409 で全体を取り消す。
 */
async function createTransfer(db, input) {
  const kind = input.kind;
  if (!KINDS[kind]) throw badRequest('操作種別が不正です');
  const note = v.text(input.note, '備考', { max: 500 });

  let fromLocation = null;
  let toLocation = null;
  let customer = null;
  let source;
  let destination;

  if (kind === 'transfer') {
    fromLocation = await locationOf(db, input.from_location_id, '移動元拠点');
    toLocation = await locationOf(db, input.to_location_id, '移動先拠点');
    if (fromLocation === toLocation) throw badRequest('移動元と移動先が同じ拠点です');
    source = { locationId: fromLocation };
    destination = { locationId: toLocation };
  } else if (kind === 'sample_out') {
    fromLocation = await locationOf(db, input.from_location_id, '払出元拠点');
    customer = await customerOf(db, input.customer_id);
    source = { locationId: fromLocation };
    destination = { customerId: customer };
  } else {
    customer = await customerOf(db, input.customer_id);
    toLocation = await locationOf(db, input.to_location_id, '返却先拠点');
    source = { customerId: customer };
    destination = { locationId: toLocation };
  }

  const lines = await normalizeLines(db, input.lines);

  return db.tx(async (t) => {
    const header = await t.get(
      'INSERT INTO transfers (kind, from_location_id, to_location_id, customer_id, note) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [kind, fromLocation, toLocation, customer, note]
    );
    const transferId = header.id;

    for (const { product, qty } of lines) {
      await stock.take(t, {
        productId: product.id,
        productLabel: `${product.sku} ${product.name}`,
        holder: source,
        qty,
        kind,
        refType: 'transfer',
        refId: transferId,
        note,
      });
      await stock.give(t, {
        productId: product.id,
        holder: destination,
        qty,
        kind,
        refType: 'transfer',
        refId: transferId,
        note,
      });
      await t.run('INSERT INTO transfer_lines (transfer_id, product_id, qty) VALUES (?, ?, ?)', [
        transferId, product.id, qty,
      ]);
    }
    return getTransfer(t, transferId);
  });
}

async function getTransfer(db, id) {
  const header = await db.get(
    `SELECT t.*, fl.name AS from_location_name, tl.name AS to_location_name, c.name AS customer_name
       FROM transfers t
       LEFT JOIN locations fl ON fl.id = t.from_location_id
       LEFT JOIN locations tl ON tl.id = t.to_location_id
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.id = ?`,
    [id]
  );
  if (!header) return null;
  header.lines = await db.all(
    `SELECT tl.product_id, tl.qty, p.sku, p.name, p.unit
       FROM transfer_lines tl JOIN products p ON p.id = tl.product_id
      WHERE tl.transfer_id = ? ORDER BY tl.id`,
    [id]
  );
  header.kind_label = KINDS[header.kind];
  return header;
}

async function listTransfers(db, limit = 100) {
  const ids = await db.all('SELECT id FROM transfers ORDER BY id DESC LIMIT ?', [limit]);
  const result = [];
  for (const r of ids) result.push(await getTransfer(db, r.id));
  return result;
}

/** お客様ごとのサンプル貸出残 */
function sampleLoans(db) {
  return db.all(
    `SELECT c.id AS customer_id, c.name AS customer_name, p.id AS product_id,
            p.sku, p.name AS product_name, p.unit, SUM(m.qty)::int AS qty
       FROM stock_movements m
       JOIN customers c ON c.id = m.customer_id
       JOIN products p ON p.id = m.product_id
      WHERE m.customer_id IS NOT NULL
      GROUP BY c.id, p.id
     HAVING SUM(m.qty) <> 0
      ORDER BY c.name, p.sku`
  );
}

module.exports = { KINDS, createTransfer, getTransfer, listTransfers, sampleLoans };
