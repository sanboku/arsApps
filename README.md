# arsApps — 社内ポータル（サンプル版）

軽貨物運送会社の事務所向け社内Webアプリのサンプルです。
トップページから「案件予定表」「ドライバー管理」「請求先管理」「請求・支払管理」「車両管理」に移動できます。

## 起動方法

```bash
npm install
npm run dev      # http://localhost:5173 を開く
```

ログイン: `admin` / `password`（サンプル用の簡易ログイン）

## サンプル版の制約

- データはブラウザの localStorage に保存（他のPC・スマホとは共有されない）。
  初期データに戻すには、ブラウザの開発者ツールで localStorage の `arsapps-db-v1` を削除する。
- ログインは画面上のチェックのみ。本番では Supabase Auth 等に置き換える。
- ドラッグ&ドロップはPCブラウザ向け。スマホではカードをタップして日付・担当を変更する。

本番化の方針・要件は [docs/requirements.md](docs/requirements.md) を参照。
