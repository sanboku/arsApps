'use strict';

const { badRequest } = require('./errors');

function text(value, field, { required = false, max = 200 } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (required && s === '') throw badRequest(`${field}を入力してください`);
  if (s.length > max) throw badRequest(`${field}は${max}文字以内で入力してください`);
  return s;
}

function integer(value, field, { min = 0 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min) {
    throw badRequest(`${field}は${min}以上の整数で入力してください`);
  }
  return n;
}

const positiveInt = (value, field) => integer(value, field, { min: 1 });

/** 負の値も許可する整数 */
function signedInteger(value, field) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest(`${field}は整数で入力してください`);
  return n;
}

const id = (value, field) => {
  const n = integer(value, field, { min: 1 });
  return n;
};

function date(value, field) {
  const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!ok) throw badRequest(`${field}は YYYY-MM-DD 形式で入力してください`);
  return value;
}

module.exports = { text, integer, positiveInt, signedInteger, id, date };
