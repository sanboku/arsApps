'use strict';

// Vercel のサーバーレス関数。/api/* へのリクエストをすべてここで受ける。
// DB 接続は関数の起動ごとに1回だけ行う(再利用される)。
const { openDatabase } = require('../src/db');
const { createHandler } = require('../src/app');

let handlerPromise;

module.exports = async (req, res) => {
  if (!handlerPromise) handlerPromise = openDatabase().then((db) => createHandler(db));
  const handle = await handlerPromise;
  return handle(req, res);
};
