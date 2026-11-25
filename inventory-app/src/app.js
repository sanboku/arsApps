'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');
const { dispatch } = require('./routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  // Vercel など、フレームワークが本文を解析済みの場合はそれを使う
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); } catch { return Promise.reject(new HttpError(400, 'JSONの形式が不正です')); }
    }
    return Promise.resolve(req.body && typeof req.body === 'object' ? req.body : {});
  }
  if (req.readableEnded) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'リクエストが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSONの形式が不正です'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * HTTPリクエストハンドラを作る。db は openDatabase() の戻り値。
 */
function createHandler(db) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '許可されていないメソッドです' });
        return serveStatic(res, url.pathname);
      }
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const { status, data } = await dispatch(db, req.method, url.pathname, url.searchParams, body);
      return sendJson(res, status, data);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'サーバーエラーが発生しました' });
    }
  };
}

module.exports = { createHandler };
