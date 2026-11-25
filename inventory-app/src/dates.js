'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** ローカル時刻の今日を YYYY-MM-DD で返す */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD に日数を加算する */
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

module.exports = { today, addDays };
