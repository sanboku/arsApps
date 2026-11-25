'use strict';

/*
 * テスト用の静的サイトを dist/ に作る。
 * dist/ を置くだけで、データはブラウザ内(IndexedDB)に保存されるため、
 * サーバーやデータベースの契約は不要。
 *   npm run build   →   dist/ を Vercel などに配置
 */

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

/*
 * PGlite の中には Node 専用のコード(node:module など)が含まれる。
 * ブラウザでは実行されない部分なので、空のモジュールに差し替える。
 */
const nodeBuiltinStub = {
  name: 'node-builtin-stub',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'export const createRequire = () => () => ({}); export default {};',
      loader: 'js',
    }));
  },
};

async function main() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

  // 業務ロジックとブラウザ用の入口をまとめる
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'browser.js')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    outfile: path.join(dist, 'local-db.js'),
    logLevel: 'warning',
    plugins: [nodeBuiltinStub],
    // IIFE 形式では import.meta.url が空になるため、ページの URL で代用する
    define: { 'import.meta.url': 'location.href' },
  });

  // PGlite の WebAssembly とデータファイル(サイト直下に置く)
  const pgliteDir = path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist');
  for (const file of ['pglite.wasm', 'initdb.wasm', 'pglite.data']) {
    fs.copyFileSync(path.join(pgliteDir, file), path.join(dist, file));
  }

  // ブラウザ用の読み込みを app.js より前に差し込む
  const indexPath = path.join(dist, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('<script src="/app.js">')) throw new Error('index.html に app.js の読み込みが見つかりません');
  fs.writeFileSync(indexPath, html.replace('<script src="/app.js">', '<script src="/local-db.js"></script>\n  <script src="/app.js">'));

  console.log('dist/ を作成しました');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
