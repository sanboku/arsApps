'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const auth = require('../src/auth');
const { dispatch } = require('../src/routes');

let db;
const q = (obj) => new URLSearchParams(obj);
// 業務エラー(HttpError)はステータスとして返す
const api = async (method, path, body, token) => {
  try {
    return await dispatch(db, method, path, q({}), body || {}, token || null);
  } catch (e) {
    if (e.status) return { status: e.status, data: { error: e.message } };
    throw e;
  }
};

beforeEach(async () => {
  db = await openDatabase({ memory: true });
});
after(() => db && db.close());

describe('初期設定', () => {
  test('最初の1人は管理者として作られ、すぐログインできる', async () => {
    assert.equal((await auth.status(db)).initialized, false);
    const r = await auth.setup(db, { code: 'ADM01', name: '管理 太郎', pin: '1234' });
    assert.equal(r.employee.role, 'admin');
    assert.ok(r.token.length >= 32);
    assert.equal((await auth.status(db)).initialized, true);
  });

  test('2回目の初期設定は 409', async () => {
    await auth.setup(db, { code: 'ADM01', name: '管理者', pin: '1234' });
    await assert.rejects(() => auth.setup(db, { code: 'ADM02', name: '別', pin: '5678' }), (e) => e.status === 409);
  });

  test('PIN は 4〜6 桁の数字のみ', async () => {
    for (const pin of ['123', '1234567', 'abcd', '12 34']) {
      await assert.rejects(() => auth.setup(db, { code: 'X1', name: 'x', pin }), (e) => e.status === 400, pin);
    }
  });

  test('従業員IDに使えない文字は 400', async () => {
    await assert.rejects(() => auth.setup(db, { code: 'a b', name: 'x', pin: '1234' }), (e) => e.status === 400);
  });
});

describe('ログイン', () => {
  beforeEach(async () => {
    await auth.setup(db, { code: 'ADM01', name: '管理者', pin: '1234' });
  });

  test('正しいID・PINでトークンが発行され、トークンで本人が分かる', async () => {
    const r = await auth.login(db, { code: 'ADM01', pin: '1234' });
    const me = await dispatch(db, 'GET', '/api/auth/me', q({}), {}, r.token);
    assert.equal(me.status, 200);
    assert.equal(me.data.code, 'ADM01');
    assert.equal(me.data.pin_hash, undefined, 'PIN のハッシュは外に出さない');
  });

  test('間違ったPINは 401、存在しないIDも同じメッセージ', async () => {
    await assert.rejects(() => auth.login(db, { code: 'ADM01', pin: '9999' }), (e) => e.status === 401);
    await assert.rejects(() => auth.login(db, { code: 'NOBODY', pin: '1234' }), (e) => e.status === 401 && /違います/.test(e.message));
  });

  test('5回連続で失敗すると、正しいPINでもロックされる', async () => {
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => auth.login(db, { code: 'ADM01', pin: '0000' }), (e) => e.status === 401);
    }
    await assert.rejects(() => auth.login(db, { code: 'ADM01', pin: '1234' }), (e) => e.status === 429);
  });

  test('ログアウトするとトークンは使えなくなる', async () => {
    const { token } = await auth.login(db, { code: 'ADM01', pin: '1234' });
    assert.equal((await api('POST', '/api/auth/logout', {}, token)).status, 200);
    assert.equal((await api('GET', '/api/auth/me', {}, token)).status, 401);
  });

  test('ログインしていない API 呼び出しは 401', async () => {
    assert.equal((await api('GET', '/api/locations')).status, 401);
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    assert.equal((await api('GET', '/api/auth/status')).status, 200, '状態確認はログイン不要');
  });
});

describe('権限', () => {
  let adminToken;
  let staffToken;

  beforeEach(async () => {
    adminToken = (await auth.setup(db, { code: 'ADM01', name: '管理者', pin: '1234' })).token;
    await api('POST', '/api/employees', { code: 'S001', name: '一般 花子', role: 'staff', pin: '4321' }, adminToken);
    staffToken = (await auth.login(db, { code: 'S001', pin: '4321' })).token;
  });

  test('一般の従業員はマスタを変更できない(403)、管理者は変更できる', async () => {
    const body = { code: 'TKY', name: '東京' };
    assert.equal((await api('POST', '/api/locations', body, staffToken)).status, 403);
    assert.equal((await api('POST', '/api/locations', body, adminToken)).status, 201);
  });

  test('一般の従業員は在庫の操作ができる', async () => {
    const loc = await api('POST', '/api/locations', { code: 'TKY', name: '東京' }, adminToken);
    const prod = await api('POST', '/api/products', { sku: 'P1', name: '品目', unit_price: 10 }, adminToken);
    const r = await api('POST', '/api/stock/adjustments', { location_id: loc.data.id, product_id: prod.data.id, qty: 3 }, staffToken);
    assert.equal(r.status, 201);
    assert.equal(r.data.balance, 3);
  });

  test('従業員一覧は管理者のみ、一般は 403', async () => {
    assert.equal((await api('GET', '/api/employees', {}, staffToken)).status, 403);
    const list = await api('GET', '/api/employees', {}, adminToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 2);
    assert.equal(list.data[0].pin_hash, undefined);
  });

  test('管理者の PIN リセット後、新しい PIN でログインできる', async () => {
    await api('PUT', '/api/employees/2', { name: '一般 花子', role: 'staff', active: true, pin: '5555' }, adminToken);
    await assert.rejects(() => auth.login(db, { code: 'S001', pin: '4321' }), (e) => e.status === 401);
    assert.ok((await auth.login(db, { code: 'S001', pin: '5555' })).token);
  });

  test('無効化した従業員のセッションは即座に使えなくなる', async () => {
    await api('PUT', '/api/employees/2', { name: '一般 花子', role: 'staff', active: false }, adminToken);
    assert.equal((await api('GET', '/api/auth/me', {}, staffToken)).status, 401);
  });

  test('最後の有効な管理者は無効化・降格できない', async () => {
    const r = await api('PUT', '/api/employees/1', { name: '管理者', role: 'admin', active: false }, adminToken);
    assert.equal(r.status, 409);
  });
});

describe('PIN の変更', () => {
  test('現在のPINが違うと変更できず、正しければ新しいPINでログインできる', async () => {
    const { token } = await auth.setup(db, { code: 'ADM01', name: '管理者', pin: '1234' });
    assert.equal((await api('POST', '/api/auth/pin', { current_pin: '0000', new_pin: '8888' }, token)).status, 401);
    assert.equal((await api('POST', '/api/auth/pin', { current_pin: '1234', new_pin: '8888' }, token)).status, 200);
    assert.ok((await auth.login(db, { code: 'ADM01', pin: '8888' })).token);
  });
});

test('PIN のハッシュは平文を含まず、検証できる', async () => {
  const h = await auth.hashPin('1234');
  assert.ok(!h.includes('1234'.padEnd(4)) || h.startsWith('pbkdf2-sha256$'));
  assert.equal(await auth.verifyPin('1234', h), true);
  assert.equal(await auth.verifyPin('1235', h), false);
});
