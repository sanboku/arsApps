# arsApps 開発メモ

軽貨物運送会社の事務所向け社内ポータル（サンプル版）。Vite + React + TypeScript、データは localStorage（`src/store.ts` の `useDB`）。

## 必ず守ること
- **機能・画面・操作を変更したら、同じコミットで `docs/manual.md`（操作説明書）を更新する。**
  - 該当箇所の説明を直し、「最終更新」の日付と「更新履歴」の表に1行追加する。
  - 画面が大きく変わった場合は `docs/images/` のスクリーンショットも撮り直す（1366x768、初期サンプルデータ）。`npm run build` → `npx vite preview --port 4173` を起動して `node scripts/take-screenshots.cjs`（画面の文言を変えたらスクリプト側も直す）。
- 要件や仕様の変更は `docs/requirements.md` にも反映する。
- 利用者は非エンジニアの事務所スタッフ。UI文言・説明書は平易な日本語で書く。

## 開発
- `npm install` → `npm run dev`（ログイン: admin / password）
- 利用者は `npm run auto`（`scripts/auto-update.mjs`）で起動しており、作業ブランチへの push を30秒以内に自動で取り込む。**push = 利用者の画面に即反映**なので、`npm run build` が通った状態でだけ push する。
- `npm run build` で型チェック＋ビルド。コミット前に必ず通す。
- データ構造（`src/types.ts`）に項目を追加したら、`store.ts` の `load()` で古いデータに既定値を補う。互換性のない変更のときだけ `KEY` のバージョンを上げる（利用者のテストデータが消える）。
