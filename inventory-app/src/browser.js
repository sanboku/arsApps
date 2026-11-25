'use strict';

/*
 * ブラウザ内で動くテスト用モード。
 * - データは PGlite (PostgreSQL 互換) でこのブラウザの IndexedDB に保存する
 * - 画面の fetch('/api/...') をこのファイルで受け取り、同じ業務処理(src/routes.js)で応答する
 * サーバーもDBアカウントも不要。データは「この端末・このブラウザ」にだけ残る。
 */

import { PGlite } from '@electric-sql/pglite';
const { applySchema, wrapPglite } = require('./db-core');
const { dispatch } = require('./routes');
const { HttpError } = require('./errors');

const DB_NAME = 'inventory-local';

async function openLocalDb() {
  // ビルドでサイト直下にコピーした WebAssembly とデータを読み込む
  const [wasmModule, fsBundle] = await Promise.all([
    WebAssembly.compileStreaming(fetch('/pglite.wasm')),
    fetch('/pglite.data').then((r) => r.blob()),
  ]);
  const pg = new PGlite(`idb://${DB_NAME}`, { wasmModule, fsBundle });
  const db = wrapPglite(pg);
  await applySchema(db);
  return db;
}

let dbPromise = null;
const getDb = () => (dbPromise ||= openLocalDb());

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const originalFetch = window.fetch.bind(window);

window.fetch = async function localFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

  const method = (init.method || 'GET').toUpperCase();
  try {
    const body = init.body ? JSON.parse(init.body) : {};
    const db = await getDb();
    const headers = new Headers(init.headers || {});
    const m = /^Bearer\s+(\S+)$/i.exec(headers.get('Authorization') || '');
    const { status, data } = await dispatch(db, method, url.pathname, url.searchParams, body, m ? m[1] : null);
    return json(status, data);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'ブラウザ内のデータベースでエラーが発生しました' });
  }
};

document.documentElement.dataset.localDb = '1';

// テスト用: データを全部消して作り直す
window.inventoryLocalReset = async function inventoryLocalReset() {
  if (dbPromise) {
    const db = await dbPromise;
    dbPromise = null;
    await db.close();
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(`/pglite/${DB_NAME}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
};
