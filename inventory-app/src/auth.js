'use strict';

/*
 * 従業員ID + PIN のログイン。
 * - PIN は PBKDF2-SHA256 でハッシュ化して保存する(平文では保存しない)
 * - ログイン用のトークンはランダム値。DB には SHA-256 のハッシュだけを保存する
 * - 連続で間違えると一定時間ロックする
 * Node / ブラウザ両方で動くよう、Web Crypto (globalThis.crypto) だけを使う。
 */

const { HttpError, badRequest, conflict } = require('./errors');
const v = require('./validate');

const PBKDF2_ITERATIONS = 200000;
const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const ROLES = ['admin', 'staff'];

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
const nowIso = () => new Date().toISOString();
const plusMinutesIso = (min) => new Date(Date.now() + min * 60000).toISOString();

function validatePin(pin) {
  const s = String(pin ?? '');
  if (!/^\d{4,6}$/.test(s)) throw badRequest('PINは4〜6桁の数字で入力してください');
  return s;
}

async function derive(pin, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

async function hashPin(pin) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

async function verifyPin(pin, stored) {
  const [scheme, iterations, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2-sha256') return false;
  const actual = await derive(pin, fromHex(saltHex), Number(iterations));
  const expected = fromHex(hashHex);
  // 定数時間に近い比較(長さが同じ前提で全ビットを比べる)
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

async function sha256Hex(text) {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const publicEmployee = (e) => ({ id: e.id, code: e.code, name: e.name, role: e.role, active: e.active });

async function activeAdminCount(db) {
  const row = await db.get("SELECT COUNT(*)::int AS n FROM employees WHERE role = 'admin' AND active = TRUE");
  return row.n;
}

async function createSession(db, employeeId) {
  const token = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
  await db.run('INSERT INTO sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)', [
    await sha256Hex(token),
    employeeId,
    new Date(Date.now() + SESSION_HOURS * 3600000).toISOString(),
  ]);
  return token;
}

/** トークンから従業員を取り出す。無効・期限切れ・無効化済みなら null */
async function resolveSession(db, token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT e.* FROM sessions s JOIN employees e ON e.id = s.employee_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND e.active = TRUE`,
    [await sha256Hex(token), nowIso()]
  );
  return row || null;
}

async function logout(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(token)]);
  return { ok: true };
}

async function status(db) {
  const row = await db.get('SELECT COUNT(*)::int AS n FROM employees');
  return { initialized: row.n > 0 };
}

/** 初回のみ。管理者を1人作ってそのままログインする */
async function setup(db, input) {
  const code = parseCode(input.code);
  const name = v.text(input.name, '氏名', { required: true, max: 50 });
  const pin = validatePin(input.pin);
  return db.tx(async (t) => {
    const row = await t.get('SELECT COUNT(*)::int AS n FROM employees');
    if (row.n > 0) throw conflict('すでに初期設定が完了しています');
    const created = await t.get(
      "INSERT INTO employees (code, name, role, pin_hash) VALUES (?, ?, 'admin', ?) RETURNING *",
      [code, name, await hashPin(pin)]
    );
    return { token: await createSession(t, created.id), employee: publicEmployee(created) };
  });
}

function parseCode(value) {
  const code = v.text(value, '従業員ID', { required: true, max: 20 });
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw badRequest('従業員IDは英数字・_・- のみ使えます');
  return code;
}

async function login(db, input) {
  const code = String(input.code ?? '').trim();
  const pin = String(input.pin ?? '');
  const wrong = () => new HttpError(401, 'IDまたはPINが違います');
  const emp = code ? await db.get('SELECT * FROM employees WHERE code = ?', [code]) : null;
  if (!emp || !emp.active) throw wrong();
  if (emp.locked_until && emp.locked_until > nowIso()) {
    throw new HttpError(429, `試行回数が多すぎるため一時的にロックされています。${LOCK_MINUTES}分後に再度お試しください`);
  }
  if (!(await verifyPin(pin, emp.pin_hash))) {
    const failures = emp.failed_count + 1;
    const lock = failures >= MAX_FAILURES;
    await db.run('UPDATE employees SET failed_count = ?, locked_until = ? WHERE id = ?', [
      lock ? 0 : failures, lock ? plusMinutesIso(LOCK_MINUTES) : null, emp.id,
    ]);
    throw wrong();
  }
  await db.run('UPDATE employees SET failed_count = 0, locked_until = NULL WHERE id = ?', [emp.id]);
  return { token: await createSession(db, emp.id), employee: publicEmployee(emp) };
}

/** 自分のPINを変更する */
async function changeOwnPin(db, employee, input) {
  const current = await db.get('SELECT * FROM employees WHERE id = ?', [employee.id]);
  if (!(await verifyPin(String(input.current_pin ?? ''), current.pin_hash))) {
    throw new HttpError(401, '現在のPINが違います');
  }
  const pin = validatePin(input.new_pin);
  await db.run('UPDATE employees SET pin_hash = ? WHERE id = ?', [await hashPin(pin), employee.id]);
  return { ok: true };
}

// ---- 従業員の管理(管理者のみ) ----

function listEmployees(db) {
  return db.all('SELECT id, code, name, role, active, failed_count, locked_until FROM employees ORDER BY code');
}

async function saveEmployee(db, input, id = null) {
  const role = ROLES.includes(input.role) ? input.role : 'staff';
  const name = v.text(input.name, '氏名', { required: true, max: 50 });
  const active = input.active !== false;
  const pin = input.pin ? validatePin(input.pin) : null;

  return db.tx(async (t) => {
    if (id == null) {
      if (!pin) throw badRequest('PINを入力してください');
      const code = parseCode(input.code);
      const dup = await t.get('SELECT id FROM employees WHERE code = ?', [code]);
      if (dup) throw conflict('その従業員IDはすでに使われています');
      const row = await t.get(
        'INSERT INTO employees (code, name, role, active, pin_hash) VALUES (?, ?, ?, ?, ?) RETURNING id',
        [code, name, role, active, await hashPin(pin)]
      );
      return publicEmployee(await t.get('SELECT * FROM employees WHERE id = ?', [row.id]));
    }

    const current = await t.get('SELECT * FROM employees WHERE id = ?', [id]);
    if (!current) throw new HttpError(404, '従業員が見つかりません');
    // 管理者が0人になる変更は禁止
    const losesAdmin = current.role === 'admin' && current.active && (role !== 'admin' || !active);
    if (losesAdmin && (await activeAdminCount(t)) <= 1) {
      throw conflict('最後の有効な管理者は無効化・権限変更できません');
    }
    await t.run('UPDATE employees SET name = ?, role = ?, active = ? WHERE id = ?', [name, role, active, id]);
    if (pin) {
      await t.run('UPDATE employees SET pin_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?', [
        await hashPin(pin), id,
      ]);
    }
    if (!active) await t.run('DELETE FROM sessions WHERE employee_id = ?', [id]);
    const updated = await t.get('SELECT * FROM employees WHERE id = ?', [id]);
    return publicEmployee(updated);
  });
}

module.exports = {
  ROLES, publicEmployee,
  status, setup, login, logout, resolveSession, changeOwnPin,
  listEmployees, saveEmployee,
  hashPin, verifyPin, // テスト用
};
