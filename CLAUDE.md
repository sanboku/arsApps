# arsApps 開発メモ

軽貨物運送会社の事務所向け社内ポータル（サンプル版）。Vite + React + TypeScript、データは localStorage（`src/store.ts` の `useDB`）。

## 必ず守ること
- **機能・画面・操作を変更したら、同じコミットで `docs/manual.md`（操作説明書）を更新する。**
  - 該当箇所の説明を直し、「最終更新」の日付と「更新履歴」の表に1行追加する。
  - 画面が大きく変わった場合は `docs/images/` のスクリーンショットも撮り直す（1366x768、初期サンプルデータ）。
- 要件や仕様の変更は `docs/requirements.md` にも反映する。
- 利用者は非エンジニアの事務所スタッフ。UI文言・説明書は平易な日本語で書く。

## 開発
- `npm install` → `npm run dev`（ログイン: admin / password）
- `npm run build` で型チェック＋ビルド。コミット前に必ず通す。
- データ構造（`src/types.ts`）に項目を追加したら、`store.ts` の `load()` で古いデータに既定値を補う。互換性のない変更のときだけ `KEY` のバージョンを上げる（利用者のテストデータが消える）。
