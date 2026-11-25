'use strict';

/* DB の共通部分(ブラウザ・サーバー両方で使う)。Node 固有の API は使わない。 */

/** 日本時間の現在時刻(YYYY-MM-DD HH:MM:SS)。SQL 文の中で使う */
const NOW_SQL = `to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS products (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '個',
  unit_price INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
);

-- 在庫台帳。在庫数は「拠点 or 取引先(サンプル保有)」ごとの SUM(qty) で求める。
-- 数量の移動は必ず2行(減る側 / 増える側)で記録し、全体の合計が変わらないようにする。
CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER REFERENCES locations(id),
  customer_id INTEGER REFERENCES customers(id),
  qty         INTEGER NOT NULL CHECK (qty <> 0),
  kind        TEXT NOT NULL CHECK (kind IN ('receipt','adjust','transfer','sample_out','sample_return','invoice_issue','invoice_void')),
  ref_type    TEXT,
  ref_id      INTEGER,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (${NOW_SQL}),
  CHECK ((location_id IS NULL) <> (customer_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_movements_location ON stock_movements(product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_movements_customer ON stock_movements(product_id, customer_id);

CREATE TABLE IF NOT EXISTS transfers (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('transfer','sample_out','sample_return')),
  from_location_id INTEGER REFERENCES locations(id),
  to_location_id   INTEGER REFERENCES locations(id),
  customer_id      INTEGER REFERENCES customers(id),
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS transfer_lines (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  created_at  TEXT NOT NULL DEFAULT (${NOW_SQL}),
  updated_at  TEXT NOT NULL DEFAULT (${NOW_SQL})
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  amount     INTEGER NOT NULL
);
`;


/** `?` を PostgreSQL の $1, $2 ... に順番に置き換える */
function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** query(sql, params) と exec(sql) から、業務コードが使う操作を組み立てる */
function makeApi({ query, exec }) {
  const api = {
    async all(sql, params = []) {
      return (await query(toPgParams(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await api.all(sql, params))[0];
    },
    async run(sql, params = []) {
      await query(toPgParams(sql), params);
    },
    exec,
  };
  return api;
}

/** テーブルを作成する(何度呼んでも安全) */
async function applySchema(db) {
  await db.exec(SCHEMA);
}

/** PGlite インスタンスを業務コード用の db にする */
function wrapPglite(pg) {
  return {
    ...makeApi({ query: (sql, params) => pg.query(sql, params), exec: (sql) => pg.exec(sql) }),
    async tx(fn) {
      return pg.transaction((t) => fn(makeApi({ query: (s, p) => t.query(s, p), exec: (s) => t.exec(s) })));
    },
    close: () => pg.close(),
  };
}

/** pg の Pool を業務コード用の db にする */
function wrapPool(pool) {
  return {
    ...makeApi({ query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql) }),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(makeApi({ query: (s, p) => client.query(s, p), exec: (s) => client.query(s) }));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

module.exports = { NOW_SQL, applySchema, wrapPglite, wrapPool };
