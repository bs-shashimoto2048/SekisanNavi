# 開発・検証用 Vite の起動手順(稼働中 5174 を壊さないために)

稼働中の画面(既定: `SekisanNavi_wt_live` の Vite、ポート 5174)と同じマシンで、一時 worktree や
別ポートの Vite を起動して検証するときの手順。

## なぜ必要か(2026-11 の白画面事案)

検証用 worktree には `node_modules` を作らず、`SekisanNavi_wt_live\frontend\node_modules` へ
ジャンクション(`mklink /J`)で共有する運用があった。Vite は依存最適化キャッシュを既定で
`<プロジェクト>/node_modules/.vite` に置くため、**ジャンクション経由で起動した検証用 Vite が、
稼働中の 5174 と同じキャッシュ(`node_modules/.vite/deps`)を書き換えた**。

- キャッシュの `browserHash` が変わり、5174 は旧ハッシュ(`?v=…`)の依存要求に
  `504 Outdated Optimize Dep` を返す。
- 5174 を開いたままのタブは依存モジュールを読み込めず、画面全体が白くなる
  (新しく開いたタブは新ハッシュを取得するので正常に見える)。
- React の外側(モジュール読み込み)の失敗なので、Error Boundary では捕捉できない。

## 検証用 Vite の起動(必須: 専用 cacheDir を指定する)

`frontend/vite.config.ts` は環境変数 `VITE_CACHE_DIR` を `cacheDir` として使う。
**未設定なら従来どおり `node_modules/.vite`(5174 の既定)のまま**で、5174 の起動設定は変わらない。
検証用 Vite は必ず、検証環境専用の絶対パスを指定して起動する。

```bash
# 例: scratchpad など、node_modules の外の専用ディレクトリを使う
cd <検証用worktree>/frontend
VITE_CACHE_DIR=<専用ディレクトリ(絶対パス)>/vite-cache-5180 \
VITE_BACKEND_URL=http://127.0.0.1:8010 \
  npx vite --port 5180 --strictPort
```

PowerShell の場合:

```powershell
$env:VITE_CACHE_DIR = "<専用ディレクトリ>\vite-cache-5180"
$env:VITE_BACKEND_URL = "http://127.0.0.1:8010"
npx vite --port 5180 --strictPort
```

ルール:

- 専用 `cacheDir` は検証用 Vite ごと(ポートごと)に分け、`node_modules` の中・`SekisanNavi_wt_live` 配下には置かない。
- `--strictPort` を付け、5174 など既存ポートへ自動フォールバックしないようにする。
- `node_modules` のジャンクション自体は、`VITE_CACHE_DIR` を指定している限り使ってよい
  (読み取り専用で参照されるだけで、5174 のキャッシュは書き換わらない)。使い終わったら
  `cmd /c "rmdir node_modules"` でリンクだけを外す(中身は消えない)。`rm -rf` は使わない。
- 検証が終わったら、起動した検証用 Vite のプロセス(PID を確認してから)だけを止め、専用 `cacheDir` は不要なら削除する。
- 5174 の Vite・8010 の Backend は停止・再起動しない。共有キャッシュ(`wt_live` の `node_modules/.vite`)は消さない。

> `vitest`(`npm run test`)も `cacheDir` 配下に結果キャッシュを書く。テストは 5174 の配信に影響しないが、
> 気になる場合は同じ `VITE_CACHE_DIR` を指定して実行すればよい。

## 独立していることの確認(起動直後に実施)

検証用 Vite が 5174 のキャッシュに触れていないことを、次で確認できる。

```bash
SHARED=<wt_live>/frontend/node_modules/.vite/deps
# 起動前後で出力が同じであること(内容ハッシュ・更新時刻・browserHash)
( cd $SHARED && find . -type f -exec md5sum {} + | sort -k2 | md5sum; stat -c %y _metadata.json )
ls <専用cacheDir>/deps          # 検証用 Vite 側に _metadata.json 等が作られていること
```

## 既に 5174 のタブが白くなったとき

1. 5174 の PID・起動元を確認する(`netstat -ano | findstr :5174`、`Get-CimInstance Win32_Process`)。
2. `curl http://127.0.0.1:5174/node_modules/.vite/deps/react.js?v=<旧ハッシュ>` が 504 なら、このキャッシュ不整合。
3. 5174 の Vite プロセス**だけ**を照合のうえ再起動し(cwd=`SekisanNavi_wt_live\frontend`、
   `VITE_BACKEND_URL=http://127.0.0.1:8010`)、開いているタブをハードリロード(Ctrl+Shift+R)する。
   localStorage(銅帯選択など)は消さない。8010 は再起動しない。
