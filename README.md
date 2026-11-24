# arsApps — 社内ポータル（サンプル版）

軽貨物運送会社の事務所向け社内Webアプリのサンプルです。
トップページから「案件予定表」「ドライバー管理」「請求先管理」「請求・支払管理」「車両管理」に移動できます。

## 起動方法

```bash
npm install
npm run dev      # http://localhost:5173 を開く
```

ログイン: `admin` / `password`（サンプル用の簡易ログイン）

### 修正を自動で取り込みながら使う（おすすめ）

```bash
npm run auto
```

- アプリを起動してブラウザを開き、**30秒ごとに GitHub の最新版を確認して自動で取り込みます**。開いている画面も自動で更新されます。
- 使う部品が変わった修正のときは、自動で `npm install` してアプリを再起動します。
- 止めるときはターミナルで `Ctrl + C`。確認の間隔は環境変数 `AUTO_UPDATE_INTERVAL`（秒）で変えられます。
- 手元でファイルを書き換えていると、上書きしないよう取り込みを止めて案内を表示します（不要なら `git restore .`）。
- 最初の1回だけ、作業ブランチに切り替えておいてください（`git checkout claude/gifted-dijkstra-a03kvl`）。

## サンプル版の制約

- データはブラウザの localStorage に保存（他のPC・スマホとは共有されない）。
  初期データに戻すには、ブラウザの開発者ツールで localStorage の `arsapps-db-v3` を削除する。
- ログインは画面上のチェックのみ。本番では Supabase Auth 等に置き換える。
- ドラッグ&ドロップはPCブラウザ向け。スマホではカードをタップして日付・担当を変更する。

- 操作説明書：[docs/manual.md](docs/manual.md)
- 本番化の方針・要件：[docs/requirements.md](docs/requirements.md)
