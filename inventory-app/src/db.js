'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { applySchema, wrapPglite, wrapPool, NOW_SQL } = require('./db-core');

async function openPg(url) {
  const { Pool } = require('pg');
  // サーバーレス(Vercel)では接続を1本に絞る
  const pool = new Pool({ connectionString: url, max: process.env.VERCEL ? 1 : 5 });
  return wrapPool(pool);
}

async function openPglite(dataDir) {
  const { PGlite } = require('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  return wrapPglite(dataDir ? new PGlite(dataDir) : new PGlite());
}

/**
 * データベースを開き、テーブルを作成する。
 *  - memory: true      → テスト用のメモリDB
 *  - DATABASE_URL 設定 → 外部の PostgreSQL (Neon など)
 *  - それ以外          → ローカルの PGlite (data/pgdata に保存、インストール不要)
 */
async function openDatabase({ memory = false } = {}) {
  let db;
  if (memory) db = await openPglite(null);
  else if (process.env.DATABASE_URL) db = await openPg(process.env.DATABASE_URL);
  else db = await openPglite(process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pgdata'));
  await applySchema(db);
  return db;
}

module.exports = { openDatabase, NOW_SQL };
