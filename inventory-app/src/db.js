'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sku        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '個',
  unit_price INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 在庫台帳。在庫数は「拠点 or 取引先(サンプル保有)」ごとの SUM(qty) で求める。
-- 数量の移動は必ず2行(減る側 / 増える側)で記録し、全体の合計が変わらないようにする。
CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER REFERENCES locations(id),
  customer_id INTEGER REFERENCES customers(id),
  qty         INTEGER NOT NULL CHECK (qty <> 0),
  kind        TEXT NOT NULL CHECK (kind IN ('receipt','adjust','transfer','sample_out','sample_return','invoice_issue','invoice_void')),
  ref_type    TEXT,
  ref_id      INTEGER,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  CHECK ((location_id IS NULL) <> (customer_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_movements_location ON stock_movements(product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_movements_customer ON stock_movements(product_id, customer_id);

CREATE TABLE IF NOT EXISTS transfers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL CHECK (kind IN ('transfer','sample_out','sample_return')),
  from_location_id INTEGER REFERENCES locations(id),
  to_location_id   INTEGER REFERENCES locations(id),
  customer_id      INTEGER REFERENCES customers(id),
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS transfer_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  number      TEXT UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('draft','issued','paid','void')),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  issue_date  TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  subtotal    INTEGER NOT NULL DEFAULT 0,
  tax         INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  paid_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  amount     INTEGER NOT NULL
);
`;

/**
 * DBを開いてスキーマを作成する。file に ':memory:' を渡すとメモリDB。
 * @param {string} [file]
 */
function openDatabase(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventory.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** 関数を1トランザクションで実行する。例外時はロールバック。 */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
