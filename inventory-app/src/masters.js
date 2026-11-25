'use strict';

const { conflict, notFound } = require('./errors');
const v = require('./validate');

/** 一意制約違反(23505)を分かりやすいメッセージに変換する */
async function uniqueGuard(message, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === '23505') throw conflict(message);
    throw err;
  }
}

async function requireRow(db, table, id, label) {
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw notFound(`${label}が見つかりません (id=${id})`);
  return row;
}

// ---- 拠点 ----
function listLocations(db, { includeInactive = false } = {}) {
  return db.all('SELECT * FROM locations WHERE (?::boolean OR active) ORDER BY code', [includeInactive]);
}

async function saveLocation(db, input, id = null) {
  const data = {
    code: v.text(input.code, '拠点コード', { required: true, max: 20 }),
    name: v.text(input.name, '拠点名', { required: true, max: 100 }),
    address: v.text(input.address, '住所', { max: 200 }),
    active: input.active !== false,
  };
  return uniqueGuard('拠点コードが重複しています', async () => {
    if (id == null) {
      const row = await db.get(
        'INSERT INTO locations (code, name, address, active) VALUES (?, ?, ?, ?) RETURNING id',
        [data.code, data.name, data.address, data.active]
      );
      return requireRow(db, 'locations', row.id, '拠点');
    }
    await requireRow(db, 'locations', id, '拠点');
    await db.run('UPDATE locations SET code = ?, name = ?, address = ?, active = ? WHERE id = ?', [
      data.code, data.name, data.address, data.active, id,
    ]);
    return requireRow(db, 'locations', id, '拠点');
  });
}

// ---- 品目 ----
function listProducts(db, { includeInactive = false } = {}) {
  return db.all('SELECT * FROM products WHERE (?::boolean OR active) ORDER BY sku', [includeInactive]);
}

function findProduct(db, id) {
  return requireRow(db, 'products', v.id(id, '品目'), '品目');
}

async function saveProduct(db, input, id = null) {
  const data = {
    sku: v.text(input.sku, 'SKU', { required: true, max: 40 }),
    name: v.text(input.name, '品名', { required: true, max: 100 }),
    unit: v.text(input.unit, '単位', { max: 10 }) || '個',
    unit_price: v.integer(input.unit_price ?? 0, '標準単価', { min: 0 }),
    active: input.active !== false,
  };
  return uniqueGuard('SKUが重複しています', async () => {
    if (id == null) {
      const row = await db.get(
        'INSERT INTO products (sku, name, unit, unit_price, active) VALUES (?, ?, ?, ?, ?) RETURNING id',
        [data.sku, data.name, data.unit, data.unit_price, data.active]
      );
      return requireRow(db, 'products', row.id, '品目');
    }
    await requireRow(db, 'products', id, '品目');
    await db.run('UPDATE products SET sku = ?, name = ?, unit = ?, unit_price = ?, active = ? WHERE id = ?', [
      data.sku, data.name, data.unit, data.unit_price, data.active, id,
    ]);
    return requireRow(db, 'products', id, '品目');
  });
}

// ---- 取引先 ----
function listCustomers(db, { includeInactive = false } = {}) {
  return db.all('SELECT * FROM customers WHERE (?::boolean OR active) ORDER BY name', [includeInactive]);
}

async function saveCustomer(db, input, id = null) {
  const data = {
    name: v.text(input.name, '取引先名', { required: true, max: 100 }),
    address: v.text(input.address, '住所', { max: 200 }),
    email: v.text(input.email, 'メール', { max: 100 }),
    active: input.active !== false,
  };
  if (id == null) {
    const row = await db.get(
      'INSERT INTO customers (name, address, email, active) VALUES (?, ?, ?, ?) RETURNING id',
      [data.name, data.address, data.email, data.active]
    );
    return requireRow(db, 'customers', row.id, '取引先');
  }
  await requireRow(db, 'customers', id, '取引先');
  await db.run('UPDATE customers SET name = ?, address = ?, email = ?, active = ? WHERE id = ?', [
    data.name, data.address, data.email, data.active, id,
  ]);
  return requireRow(db, 'customers', id, '取引先');
}

module.exports = {
  requireRow,
  listLocations, saveLocation,
  listProducts, findProduct, saveProduct,
  listCustomers, saveCustomer,
};
