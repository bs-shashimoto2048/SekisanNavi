# data-source.md — 実データソース調査 (Phase 1.5)

`\\beans-f1\ShareData\estimatic\a_product\output\` 配下を **read-only** で調査した結果を記録する。
確認できなかった事項は推測で埋めず「未確認」と明記する (要件21)。

## 1. ルートディレクトリ構成

```
\\beans-f1\ShareData\estimatic\
  a_product\
    AIモデル学習画像\
    _backup\               (旧資料・学習データのバックアップ等)
    logs\                  (推論APIサーバーのアプリケーションログ, app_YYYY-MM-DD.log)
    model\                 (学習済みYOLOモデル本体, 例: estimatic_a_20250826.pt)
    output\                ← 本システムが参照するルート (要件8のパスと一致)
      A1AA0379\
      A1AA0484\
      ...(製番ディレクトリが914件、2026-08-28調査時点)
    server.yaml            (推論APIサーバーの設定。output のパス等を含む)
  c_product\ , d_product\ , test\  (他製品ラインの並列ディレクトリ。今回は未調査)
```

`output\` 直下には製番名のディレクトリが914件、フラットに並んでいる (サブフォルダによる
年月等の階層分けはない)。ページング等を考慮せず全件をFrontendへ送らない設計とした
理由はこの件数による (要件16)。

## 2. 製番ディレクトリの内部構造 (例: A1GV2421)

```
output\A1GV2421\
  16.dxf / 16.jpeg / 16.pdf / 16.png / 16_detected.png / 16_detected.txt
  18.dxf / 18.jpeg / 18.pdf / 18.png / 18_detected.png / 18_detected.txt
  21.* ... 30.* (同様のセット。ページ番号は連番とは限らない)
  A1GV2421_df.csv            (baninfから読み取った盤情報一覧)
  A1GV2421_df_cubicle.csv    (内部機器配置図由来の盤情報)
  A1GV2421_df_foundation.csv (基礎図由来の盤情報)
  A1GV2421_df_outline.csv    (外形図由来の盤情報)
  detected_df.csv            (YOLO検出結果。CAD実座標系)
  estcode_df.csv             (積算コード集計用DataFrame)
  product_df.csv             (ページ・盤ごとの図面座標・縮尺情報)
  WIRING.SCR                 (未調査。AutoCADスクリプトと推測されるが未確認)
  共通製作仕様書.pdf
  dwg\
    16.dwg / 18.dwg / 21.dwg ... (元CAD図面。参考資料PDFによれば「DWGは扱わず
    DXFへ変換して図枠寸法取得にのみ利用する」とのこと)
```

サンプル数点 (A1AA0722, A1AB2225, A1AB2395) でも同一パターン (フラットなページファイル群 +
`dwg\` サブディレクトリ + `WIRING.SCR` + 各種CSV) であることを確認した。

## 3. 「CCV」について (★重要・未確認)

指示書では「製番ディレクトリ内のCCVを見る」とされていたが、以下の方法で調査した結果、
**`CCV` という名称のディレクトリ・ファイルは一切確認できなかった**:

- `A1GV2421` 配下の全ファイル・ディレクトリ一覧に `CCV` は存在しない。
- `output\` 配下を `*ccv*` (大文字小文字無視) でディレクトリ名検索 → ヒットなし。
- `a_product\logs\*.log` を `ccv` でテキスト検索 → ヒットなし。
- 参考資料PDF (`積算コード集計用DataFrameカラム概要と検出要素判断基準.pdf`、
  処理フロー1〜7の説明含む) にも `CCV` という語は登場しない。

**対応方針 (暫定)**: `app/services/data_source.py` では、製番ディレクトリ配下に
`CCV` (大文字/小文字) という名前のサブディレクトリが実在すればそれを参照先として使用し、
存在しない場合は製番ディレクトリ直下を参照先とする、というフォールバック方式にした。
どちらが使われたかは `ccv_resolved` フラグとしてAPIレスポンスに含めている。

**要確認事項 (ユーザー判断が必要)**: 「CCV」が指す実体は以下のいずれかの可能性がある。
このまま実装を進めてよいか、あるいは別の実体を指しているか、要確認。

1. 単純に用語の記憶違い・入力ミスで、実際には製番ディレクトリ直下そのものを指している。
2. 現在は存在しないが将来的に追加される予定のディレクトリ名。
3. `*_df_cubicle.csv` (キュービクル関連CSV) のような、何らかの略称。
4. 本システムが未調査の `c_product`, `d_product`, `test` ディレクトリ、あるいは
   `output` 以外の場所を指している。

## 4. 図面として表示すべきファイル

- `{page}.pdf` : 単一ページのPDF (A3横, 1190.55pt × 841.89pt = 420mm × 297mm)。
  Phase 1.5のDrawing ViewerはこのPDFをそのまま表示する。
- `{page}.png` : AI解析用に図枠を切り出した画像 (例: 2077×1485px)。PDFの全体像から
  タイトル欄等の余白を除いた領域に相当するとみられるが、切り出しオフセットを示す
  数値は `product_df.csv` からは特定できなかった (**未確認**。5章参照)。
- `{page}.jpeg` : PDFを150dpiでレンダリングした画像 (例: 2481×1754px, 余白込み)。
  `detect_conversion.dpi: 150` という設定値と実際の画素数から、
  `{page}.pdf` を150dpiでレンダリングしたものとほぼ一致することを計算で確認した。
- `{page}_detected.png` : `{page}.png` にYOLO検出結果のBBoxを描画済みの画像。
- `{page}_detected.txt` : `Index$...|Device$...|Score$...|Coordinates$x1,y1:x2,y2:x3,y3:x4,y4`
  形式のテキスト。座標は `{page}.png` のピクセル座標系 (detected_df.csvとは別のCAD座標系)。
- `{page}.dxf` : 図枠寸法取得用。参考資料PDFによれば「DWGは非公開フォーマットのため
  直接扱わず、DXFへ変換したものをPythonライブラリで読む」とのこと。

**ファイル名だけで図面種別が判別できるか**: できない。ページ番号は連番になっているだけで、
「16が外形図」等の対応は `product_df.csv` (列: PAGE, ZUMEI) を突き合わせないと分からない
(要件21-8)。Phase 1.5のダミー統合では、この対応を目視調査した固定値として
`backend/app/db/seed.py` にハードコードしている (CSVの自動解析は本番Parser相当として
今回のスコープ外)。

## 5. Overlay座標系に関する調査結果 (★重要)

`architecture.md`/`data-model.md` の座標系設計の根拠となった調査結果。

- `product_df.csv` の列 `FRAME_ORG_X/Y` は実寸(mm)の図枠サイズ、`FRAME_MINI_X/Y` は
  それに対応する解析用画像 (`{page}.png`) のピクセルサイズであることを、
  実際の値 (例: 15990mm ÷ 2077px ≈ 7.6986 = 列 `SCALE_X` の値) を検算して確認した。
  Phase 1.8であらためてPIL実測を行い、`FRAME_MINI_X/Y` が実際の `{page}.png`
  ピクセルサイズと完全一致すること (例: A1GV2421 page16 → 2077×1485px) を確認済み。
- `detected_df.csv` の座標は、`{page}.png` のピクセル座標ではなく、上記スケールで
  実寸(mm)へ変換した「CAD実座標」であることを確認した
  (`{page}_detected.txt` の座標値とは異なるスケールになっている)。
- 一方で、`{page}.png` (解析用/図枠切り出し画像) が `{page}.pdf`
  (フルページ, 150dpiで2481×1754px相当) の中のどの位置を切り出したものかを示す
  オフセット情報は、調査した範囲のCSV・ログには含まれておらず **未確認** だった。
  そのため、`detected_df.csv` (AI検出結果, CAD実座標) → PDFページ上のピクセル位置、
  への厳密な変換式は今回も導出できていない (Phase 1.5時点から状況変わらず)。

このため、Phase 1.5のDetection/PanelArea (BBox・盤範囲) のダミーデータは、
実際のCAD座標変換を行わず、**実PDFページを目視確認した上で配置した近似値**のままである。
本番のAI検出結果を正確に重畳するには、上記オフセットの正体を開発チームへ確認する
必要がある (未確定事項として `implementation-plan.md` にも記載)。

### 5.1 product_df.csvの盤領域座標変換 (Phase 1.8で確定)

上記とは別に、Phase 1.8では **`product_df.csv` の盤領域 (KITEN_X/Y, DETECT_AREA_X/Y)
を左ペインPNGサムネイル上へ重畳する** ための変換式を実データ検算により確定した
(こちらは `detected_df.csv` のAI検出結果とは別の情報源であり、5章のオフセット未確認問題とは
無関係に解決できた)。

**実列構成** (`A1GV2421/product_df.csv` 等で確認。cp932エンコード、ヘッダ20列):
```
BAN_MENNO, BAN_NO, PAGE, ZUMEI, BAN_MEISYOU, BAN_TYPE, BAN_H1, BAN_H2,
BAN_W, BAN_D, KITEN_X, KITEN_Y, DETECT_AREA_X, DETECT_AREA_Y,
FRAME_ORG_X, FRAME_ORG_Y, FRAME_MINI_X, FRAME_MINI_Y, SCALE_X, SCALE_Y
```

**右上座標の式について (指示書で「推測禁止」とされた箇所)**: 当初の指示例
「FRAME_MINI_X/YをそれぞれFRAME_MINI_X/Yで割る」は自己参照になり常に1になるため
採用しなかった。実データを行ごとに検算した結果、`DETECT_AREA_X`/`DETECT_AREA_Y`
列が「KITEN_X/Yを基点とした盤領域の幅・高さ(mm)」に一致することを確認した
(正面図/背面図では `BAN_W`×`BAN_H1`、側面図では `BAN_D`×`BAN_H1` に一致。
基礎図行のようにBAN_W/H/Dが空欄でもDETECT_AREA_X/Yは必ず入っている)。
したがって:

```
left_bottom_x_mm = KITEN_X
left_bottom_y_mm = KITEN_Y
right_top_x_mm    = KITEN_X + DETECT_AREA_X
right_top_y_mm    = KITEN_Y + DETECT_AREA_Y
```

mm → `{page}.png` のpx座標は `SCALE_X`/`SCALE_Y` (mm/px、列として直接与えられている)
で割ることで得られ、さらに `FRAME_MINI_X`/`FRAME_MINI_Y` (png原寸px) で割ることで
0.0〜1.0の正規化座標になる。CAD実座標は原点が左下 (Y上向き) だが、PNG/DOMは
原点が左上 (Y下向き) のため、`dom_y = 1 - cad_y` でY軸を反転する。

実データ (A1GV2421 page16, BAN 1/1 背面図) での検算例:
KITEN_X=4650, KITEN_Y=2250, DETECT_AREA_X=900, DETECT_AREA_Y=2300,
SCALE_X≈7.6986, SCALE_Y≈7.6970, FRAME_MINI=2077×1485 → 正規化矩形
`x≈0.2908, y≈0.6019 (DOM上端), w≈0.0563, h≈0.2012`。図面を目視した配置感覚と
矛盾しない (詳細実装は `backend/app/services/product_df.py` のdocstring参照)。

## 6. AI検出クラス・積算コード対応

`積算コード集計用DataFrameカラム概要と検出要素判断基準.pdf` に、YOLOv8学習クラス
(Class ID 0〜19, 例: `roof_fan`, `panel`, `transformer`, `door_w` 等) と、対応する
積算コード候補・判断基準・サンプル製番が記載されている。ただし多くの項目に
「暫定」「対応困難」「保留」等の注記があり、確定した対応表ではない。
Phase 1.5ではこれらのクラス名を参考にダミーDetectionのclass_nameとして使用しているが、
これは実際のクラス体系そのものではない (要件23で「AIクラス体系確定」は対象外と明示)。

## 7. データ量・読み込み速度

- 製番1件あたりのデータ量: 概ね10〜50MB程度 (サンプルしたA1GV2421は約25MB、12ページ)。
  ページ数・図面枚数に比例して増える。
- ディレクトリ一覧・ファイル一覧の取得は数百ms程度で完了 (`ls` 実行で0.176秒)。
- 実PDFファイル (111KB程度) の取得もBackend経由で問題なく高速に完了することを確認した。
- 914製番全件の総データ量、および大量同時アクセス時の速度は **未確認**。

## 8. 製番ごとの構造差異

サンプルした数製番 (A1AA0722, A1AB2225, A1AB2395, A1GV2421) はいずれも同一パターン
(フラットなページファイル + `dwg\` + 各種CSV) だった。ただし914製番全件を確認した
わけではないため、古い製番や特殊な製品ラインで構造が異なる可能性は **未確認**。

## 9. ネットワーク共有が利用不能な場合の挙動

意図的に共有を切断して試すことはしていない (実データへの影響を避けるため)。
**未確認**。ただし `app/services/data_source.py` は、パス操作時の `OSError`
(`PermissionError`, `FileNotFoundError`, Windowsエラー53/67など) を捕捉し、
内部詳細を露出しない日本語メッセージへ変換して返す設計にしている。
アプリ起動時 (`main.py` の `lifespan`) は共有への接続を必須としない
(ダミーデータの投入のみを行い、実ファイルへのアクセスは各APIリクエスト時に初めて発生する)
ため、共有が一時的に利用できなくても、アプリ自体は起動・表示できる設計とした。

## 10. まとめ: 確定/暫定/未確認

| 項目 | 状態 |
|---|---|
| データ参照ルート `output\` 直下に製番ディレクトリが並ぶ構造 | 確定 (確認済み) |
| 製番ディレクトリ内に `CCV` という名前の実体がある | **未確認 (見つからず)** |
| `{page}.pdf` が単一ページの図面PDFである | 確定 (確認済み) |
| ページ番号だけでは図面種別が分からず `product_df.csv` の突合が必要 | 確定 (確認済み) |
| CAD実座標 (`detected_df.csv`) → PDFページピクセル位置の厳密な変換式 | **未確認** |
| product_df.csvの盤領域(KITEN_X/Y, DETECT_AREA_X/Y) → PNGサムネイル正規化座標の変換式 | 確定 (Phase 1.8, 5.1章参照) |
| AI検出クラス・積算コード対応表 | 暫定 (参考資料に記載はあるが多くが「保留」注記あり) |
| 914製番全件の構造一貫性 | **未確認** (サンプル4件のみ確認) |
| ネットワーク切断時の挙動 | **未確認** (設計上は例外を握りつぶし友好的メッセージを返す想定のみ) |
