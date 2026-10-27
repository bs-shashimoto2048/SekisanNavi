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
  material.csv               (材料一覧。設計データの*.boxspec由来。無い製番もある。下記「material.csv」参照)
  product_df.csv             (ページ・盤ごとの図面座標・縮尺情報)
  WIRING.SCR                 (未調査。AutoCADスクリプトと推測されるが未確認)
  0_S0.pdf                   (共通製作仕様書。以前は 共通製作仕様書.pdf。SekisanNaviData が出力する。無い製番もある)
  0_A1.pdf                   (設計作図完了シート。以前は通常のページ「0」として 0.pdf。無い製番もある)
                              0_S0 / 0_A1 は数値の図面ページ番号ではなく、通常の 0.pdf とも別のファイル。図面一覧の最上段に
                              (共通製作仕様書 → 設計作図完了シートの順で)固定表示する。対応PNG
                              (0_S0__preview.png / 0_A1__preview.png)は一覧のサムネイル、PDFは専用の経路
                              /api/products/{製番}/design-documents/{0_S0|0_A1}/file で配信する(ファイルが無ければ項目を出さない)。
                              ページ番号の一覧(list_page_numbers)には含めない。通常の 0.pdf(従来の出力)は、ページ番号 0 を
                              開けない(resolve_page_file が 0 以下を拒否する)ため、この一覧には出さず、design.csv の「0」の行として従来どおり扱う
  dwg\
    16.dwg / 18.dwg / 21.dwg ... (元CAD図面。参考資料PDFによれば「DWGは扱わず
    DXFへ変換して図枠寸法取得にのみ利用する」とのこと)
```

### material.csv (材料一覧)

SekisanNaviData が設計データの`*.boxspec`(CP932)から作る、製番直下の材料一覧CSV。
**cp932・BOMなし**。列は固定(順序も契約):

    PAGE, SOURCE_FILE, SYMBOL_NAME, CABTYPE, COMPONENT_CODE, COMPONENT_NAME, MATERIAL_SPEC

- 1行 = ページ × 材料シンボル(`BSP-STEELA-*`) × 構成部。構成部は9種
  (`STEEL-BASE` 基礎ベース / `STEEL-SIDE` 側板 / `STEEL-ROOF` 屋根・天井板 /
  `STEEL-PANEL` パネル(背面板) / `STEEL-DIVIDE` 仕切り板 / `STEEL-FRAME` 組枠 /
  `STEEL-BOTTOM` 底板 / `STEEL-INSIDEPANEL` 補助・内部パネル / `STEEL-DOOR` 扉板)。
  未知の`STEEL-*`キーは行として残り、`COMPONENT_NAME`が空になる。
- `MATERIAL_SPEC`の`未記載`(.boxspecに記載なし。キーが無い、または値が空)と
  `無し`(明示値)は意味が違う。Sekisan Naviは値を加工せず、画面でも区別して表示する。
- `CABTYPE`(箱体型式)は空のことがある(.boxspecに無い、または複数あって対応が決められない場合)。
- `.boxspec`が無い製番、または解析に失敗した製番では`material.csv`自体が存在しない。
  Sekisan Naviは「材料情報なし」と表示し、他の画面・CSVの読み込みには影響しない。
- 読み込みは`GET /api/products/{製番}/materials`(`app/services/material_csv.py`)。読み取りのみで、
  積算ロジック・AI検出結果の積算反映・他のCSV契約には関与しない。
- 図面情報パネルの折りたたみ「鋼材」欄は `GET /api/products/{製番}/steel`(`app/services/steel_outline.py`)で、
  **製番の外形図1ページぶん**だけを返す(選択中の図面ページには連動しない)。外形図 = `product_df.csv` の ZUMEI から連番を除いた図面種別が「外形図」と完全一致するページ。
  複数ある場合は情報量が最大のページ: ①材料仕様が実際に記載された行数(空・`未記載`・`無し`を除く)→ ②CABTYPE のある行数 → ③構成部名のある行数 → ④総行数、
  同点はページ番号(整数)が小さい方。`PAGE` は文字列のまま扱い、`product_df.csv` のページ(整数)と対応づけるのは先頭ゼロの無い整数表記(`16`)だけ
  (`01`・`x1` は対応づけない。`01` と `1` は別ページ)。
  `status`(ok/empty/missing/invalid/no_outline)で結果を返し、例外文言・実パス・製番・ファイル名は応答に含めない。
  CABTYPE と箱体型式(estcode_df の MODEL)の照合は、全角→半角・前後の空白除去・大文字化の後の**完全一致だけ**を「一致」とし、
  未一致・CABTYPE なし・箱体型式なしは固定文言で表示する(画面側 `SteelSection.tsx`)。

サンプル数点 (A1AA0722, A1AB2225, A1AB2395) でも同一パターン (フラットなページファイル群 +
`dwg\` サブディレクトリ + `WIRING.SCR` + 各種CSV) であることを確認した。

### design.csv (設計情報。図面一覧の基準)

SekisanNaviData が設計データのページ情報 `.db` から作る製番直下の CSV(cp932・BOMなし、見出し24列)。1行=1ページ。
図面一覧(左ペイン)は、この `ページ番号` と `図名` を基準に作る:

- **ページ番号は文字列のキー**として扱う。数値化・先頭ゼロの除去・再採番はしない(`01` と `1` は別のページ)。
  `{ページ番号}.pdf` との照合は大文字小文字を区別しない(キーは実在する PDF のファイル名の綴り)。
- 対応する PDF がある行だけを表示する(PDF の無い行・ページ番号が空の行・重複する行は表示しない)。
- 並び順: 先頭が 0 の数字(`0`, `01`, `02` …)→ 先頭ゼロの無い数字(`1`, `2`, … 数値の昇順)→ 英字始まり(大文字小文字を区別しないアルファベット順)→ その他。
  同じ数値なら先頭ゼロが多い表記を先、大文字小文字を除いて同じキーなら元の表記の文字列順(毎回同じ順)。
- 図名は字間の空白を整えて表示する(`外    形    図` → `外形図`)。ページ番号の表記は加工しない。
- 面番号/盤番号は `product_df.csv` の `BAN_MENNO`/`BAN_NO`(`1/1` の形、複数は `、` 区切り・重複を除き出現順)。
  `design.csv` には面番号/盤番号の列が無く、`product_df.csv` に行が無いページ(書類ページ等)には番号を出さない(推測しない)。
- 表示の種類: 推論用 PNG(`{数値}.png`)があるページは従来どおり元 PNG・推論結果・盤領域/検出枠、無いページは「表示用プレビュー PNG」
  (`{PDF名}__preview.png`)を表示し、枠は出さない。新しいデータ作成ではPNGを製番フォルダ直下に出力する。旧隔離データとの互換用に、製番フォルダ内に無い場合は
  `{PREVIEW_ROOT}/{製番}/`(環境変数 `SEKISAN_NAVI_PREVIEW_ROOT`)も参照する。プレビューPNGが無い図面は「画像なし」。バックエンドは読み取りのみ。
- 図面の選択: 製番を選んだあと、図面一覧を開く前に「表示する図面を選択」の画面を出す(design.csv のページ番号の元表記・図名・表示の種類を並べ、既定はすべて選択済み)。
  「開く」で確定すると、選んだ図面だけが左ペインのサムネイル一覧に載る(並び順・表示の種類は変えない)。確定するまで中央にも図面は出ない。
  選択は **ブラウザーの localStorage**(キー `sekisan-navi:design-selection:v1:{製番}`、値は「外した図面のキー」のみ)に保存し、サーバー・DB・共有先へは書かない
  (別の PC・別のブラウザーとは共有されない)。保存済みなら、再読み込みでは画面を出さずに復元し、製番を選び直したときは選択画面を出す。一覧の「図面の選択」でいつでも選び直せる。
- `design.csv` が無い・読めない・見出しが違う・表示できる行が無いときは、固定文言で知らせて従来の図面一覧(数値名の PDF)に戻る。
  例外の詳細・実パスは画面にも API 応答にも出さない。
- API: `GET /api/products/{製番}/design-pages`(一覧)、`GET /api/products/{製番}/design-pages/{キー}/image`(図面画像。一覧にあるキーだけ受け付ける)、
  `GET /api/products/{製番}/design-documents/{0_S0|0_A1}/image`(書類サムネイル)、`GET /api/products/{製番}/design-documents/{0_S0|0_A1}/file`(PDF)。

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

**[2026-09 Issue #38 追記]** 上記の検算で確認できているのは、`BAN_H1`が
矢視の種別(正面図/背面図)に関わらず座標変換に使われる列である、という事実の
みである。盤情報floating panel(`PanelInfo.tsx`)は`BAN_H1`を「正面高さ」、
`BAN_H2`を「背面高さ」として扱い「2300 / 2000」のように表示するが、**この
正面/背面という意味付けはUI仕様上の前提であり、product_df.csv側のデータ
定義として確定した事実ではない**(`BAN_H2`は座標変換には一切使われておらず、
その役割を実データ提供元の定義書等で確認できていない)。詳細は
`docs/ui-spec.md`「5. PanelInfo」章、Issue #38 Phase 1報告コメント参照。

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

### 6.1 Issue #40 Phase 6-D/6-Eでの追加確認

- **`estcode_df.csv`の追加19列は実データに存在する(確定)**: 実製番A1GV2421の
  `estcode_df.csv`を直接確認したところ、`PANEL`/`TRANS`/`IN_PANEL`/`SHIELD`/
  `DOOR_FRONT`/`DOOR_BACK`/`DOOR_STACK`/`DOOR_SIDE`/`DOOR_SMALL`/`FAN_ROOF`/
  `FAN_DOOR`/`MAIN_LINE`/`WIRE_MESH`/`STACK_PLATE`/`DRAWER_DEVICE`/
  `VCT_STAND`/`BUS_DUCT`/`PASSAGE`/`INPUT_CU_COEFF`の19列が実在し、全5盤分に
  値が入っていることを確認した(本節冒頭の「暫定」は、Sekisan Navi側が
  これらを未パースだった状態を指していたもので、実データ自体への疑義では
  なくなった)。Phase 6-Eで`app/services/estcode_df.py`/
  `app/services/design_data_context.py`まで読み込みを接続した
  (`docs/architecture.md`参照)。
- **AI対応リストの正式なクラス一覧(20件)を確認**: `20250707_A製品自動化検討_
  対応仕分け.xlsx`のAI対応リストシートに、`names`(内部key)・`検出対象`
  (日本語)・`条件・備考`が揃った20クラスの一覧があり、本節冒頭の
  「Class ID 0〜19」(20 ID)と件数が一致する: `door_w`/`panel`/`transformer`/
  `partition`/`sidedoor_l`/`sidedoor_r`/`narrow_door`/`small_door`/`2doors`/
  `3doors`/`stack_plate`/`drawer_device`/`roof_fan`/`roof_fan_l`/`roof_fan_r`/
  `door_fan`/`bus_duct`/`rotate_panel`/`passage`/`vct_stand`。
- **`.boxspec`/`.baninf`ファイルは現行のデータ参照ルートに存在しない**:
  「対応仕分け」Excelのプログラム対応リストシートが18101〜18115(底板)の
  判定根拠として挙げる`.boxspec`(`STEEL-BOTTOM`列)・`.baninf`(`ZUMEI`列)
  というファイル形式を、実製番A1GV2421のディレクトリ配下で探したが
  1件も見つからなかった(`*.dxf`/`*.pdf`/`*.png`/`*_detected.*`/各種`.csv`/
  `dwg\`のみ)。別のデータパイプライン由来のファイルである可能性が高い。

## 7. データ量・読み込み速度

- 製番1件あたりのデータ量: 概ね10〜50MB程度 (サンプルしたA1GV2421は約25MB、12ページ)。
  ページ数・図面枚数に比例して増える。
- ディレクトリ一覧・ファイル一覧の取得は数百ms程度で完了 (`ls` 実行で0.176秒)。
- 実PDFファイル (111KB程度) の取得もBackend経由で問題なく高速に完了することを確認した。
- 914製番全件の総データ量は **未確認**。大量同時アクセス時の速度は **確定 (確認済み、下記)**。
- **[Issue #40 追加修正: 製番選択の検索高速化で判明]** 製番検索 (`GET /api/products/search`)
  の実測で、`output\` 直下の914件に対する`os.listdir()`自体は約15msと高速だが、
  各エントリに対する`Path.resolve()`+`is_dir()`(パストラバーサル対策のルート内
  確認・実在確認、`app/services/data_source.py::search_product_dirs`)はUNC共有
  越しに1件あたり数msかかり、914件全件を検証すると検索1回あたり約5.7〜7.6秒
  (8回計測、中央値6.3秒・最大7.6秒)かかることを計測で確認した。絞り込み
  クエリの有無に関わらず全件を検証していたため、入力のたびにこの数秒が
  かかっていた。この検証済み一覧をプロセス内で60秒キャッシュする方式へ
  変更し、TTL内の2回目以降の検索を高速化した。
- **[追加修正: 初回走査・TTL失効直後の走査そのものの高速化]** 上記キャッシュ
  だけでは「TTL失効後の最初の1回」は依然数秒かかっていた。実測の結果、
  遅かったのは`os.listdir()`ではなく、名前一覧取得後に1件ずつ個別へ
  `Path.resolve()`→別途`is_dir()`と2回ネットワーク往復していたことだったため、
  `os.scandir()`+`DirEntry.stat(follow_symlinks=False)`(ディレクトリ列挙
  時に取得済みのファイル属性をそのまま使う、追加のネットワーク往復なし)へ
  置き換えた。実測(同じ914件、8回計測)で中央値0.0157秒・最大0.0182秒
  まで短縮(旧方式比で約400倍)。安全性検証として、Windowsの
  `DirEntry.is_symlink()`は通常のシンボリックリンクは検出するが
  **NTFSジャンクション(`mklink /J`)は検出しない**ことを実機で確認したため、
  安全性判定には`is_symlink()`ではなく`st_file_attributes`の
  `FILE_ATTRIBUTE_REPARSE_POINT`ビット(シンボリックリンク・ジャンクション
  双方を含む)を用いている(`_is_reparse_point`)。この属性が立っている
  エントリのみ、従来どおり`Path.resolve()`+ルート内確認+実在確認の低速経路へ
  回す(実データでは0件)。

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
| estcode_df.csvの追加19列が実データに存在するか | 確定 (Phase 6-D/6-E、6.1章参照。実在を確認、Sekisan Navi側の読み込みも接続済み) |
| `.boxspec`/`.baninf`ファイルがデータ参照ルート配下に存在するか | 確定 (Phase 6-E、6.1章参照。**存在しない**ことを確認) |
| 914製番全件の構造一貫性 | **未確認** (サンプル4件のみ確認) |
| ネットワーク切断時の挙動 | **未確認** (設計上は例外を握りつぶし友好的メッセージを返す想定のみ) |
