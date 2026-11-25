'use strict';

const http = require('node:http');
const { openDatabase } = require('./db');
const { createHandler } = require('./app');

function createServer(db) {
  return http.createServer(createHandler(db));
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  openDatabase().then((db) => {
    createServer(db).listen(port, () => {
      console.log(`在庫管理アプリ: http://localhost:${port}`);
    });
  });
}

module.exports = { createServer };
