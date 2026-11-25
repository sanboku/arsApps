'use strict';

const { conflict, notFound } = require('./errors');
const v = require('./validate');

/** UNIQUE 制約違反を分かりやすいメッセージに変換する */
function uniqueGuard(message, fn) {
  try {
    return fn();
  } catch (err) {
    if (/UNIQUE constraint failed/.test(err.message)) throw conflict(message);
    throw err;
  }
}

function requireRow(db, table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw notFound(`${label}が見つかりません (id=${id})`);
  return row;
}

// ---- 拠点 ----
function listLocations(db, { includeInactive = false } = {}) {
  return db
    .prepare(`SELECT * FROM locations WHERE ? = 1 OR active = 1 ORDER BY code`)
    .all(includeInactive ? 1 : 0);
}

function saveLocation(db, input, id = null) {
  const data = {
    code: v.text(input.code, '拠点コード', { required: true, max: 20 }),
    name: v.text(input.name, '拠点名', { required: true, max: 100 }),
    address: v.text(input.address, '住所', { max: 200 }),
    active: input.active === false ? 0 : 1,
  };
  return uniqueGuard('拠点コードが重複しています', () => {
    if (id == null) {
      const info = db
        .prepare('INSERT INTO locations (code, name, address, active) VALUES (?, ?, ?, ?)')
        .run(data.code, data.name, data.address, data.active);
      return requireRow(db, 'locations', Number(info.lastInsertRowid), '拠点');
    }
    requireRow(db, 'locations', id, '拠点');
    db.prepare('UPDATE locations SET code = ?, name = ?, address = ?, active = ? WHERE id = ?').run(
      data.code, data.name, data.address, data.active, id
    );
    return requireRow(db, 'locations', id, '拠点');
  });
}

// ---- 品目 ----
function listProducts(db, { includeInactive = false } = {}) {
  return db
    .prepare(`SELECT * FROM products WHERE ? = 1 OR active = 1 ORDER BY sku`)
    .all(includeInactive ? 1 : 0);
}

function findProduct(db, id) {
  return requireRow(db, 'products', v.id(id, '品目'), '品目');
}

function saveProduct(db, input, id = null) {
  const data = {
    sku: v.text(input.sku, 'SKU', { required: true, max: 40 }),
    name: v.text(input.name, '品名', { required: true, max: 100 }),
    unit: v.text(input.unit, '単位', { max: 10 }) || '個',
    unit_price: v.integer(input.unit_price ?? 0, '標準単価', { min: 0 }),
    active: input.active === false ? 0 : 1,
  };
  return uniqueGuard('SKUが重複しています', () => {
    if (id == null) {
      const info = db
        .prepare('INSERT INTO products (sku, name, unit, unit_price, active) VALUES (?, ?, ?, ?, ?)')
        .run(data.sku, data.name, data.unit, data.unit_price, data.active);
      return requireRow(db, 'products', Number(info.lastInsertRowid), '品目');
    }
    requireRow(db, 'products', id, '品目');
    db.prepare('UPDATE products SET sku = ?, name = ?, unit = ?, unit_price = ?, active = ? WHERE id = ?').run(
      data.sku, data.name, data.unit, data.unit_price, data.active, id
    );
    return requireRow(db, 'products', id, '品目');
  });
}

// ---- 取引先 ----
function listCustomers(db, { includeInactive = false } = {}) {
  return db
    .prepare(`SELECT * FROM customers WHERE ? = 1 OR active = 1 ORDER BY name`)
    .all(includeInactive ? 1 : 0);
}

function saveCustomer(db, input, id = null) {
  const data = {
    name: v.text(input.name, '取引先名', { required: true, max: 100 }),
    address: v.text(input.address, '住所', { max: 200 }),
    email: v.text(input.email, 'メール', { max: 100 }),
    active: input.active === false ? 0 : 1,
  };
  if (id == null) {
    const info = db
      .prepare('INSERT INTO customers (name, address, email, active) VALUES (?, ?, ?, ?)')
      .run(data.name, data.address, data.email, data.active);
    return requireRow(db, 'customers', Number(info.lastInsertRowid), '取引先');
  }
  requireRow(db, 'customers', id, '取引先');
  db.prepare('UPDATE customers SET name = ?, address = ?, email = ?, active = ? WHERE id = ?').run(
    data.name, data.address, data.email, data.active, id
  );
  return requireRow(db, 'customers', id, '取引先');
}

module.exports = {
  requireRow,
  listLocations, saveLocation,
  listProducts, findProduct, saveProduct,
  listCustomers, saveCustomer,
};
