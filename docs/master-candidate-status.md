# 実マスタ投入候補ステータス (Issue #40 Phase 6-D/6-F)

本ドキュメントは、`drawing_evidence_types`/`estimate_rule_masters`へ投入する
「実マスタ投入候補」の現状を人間が読める形でまとめたものである。

**機械可読な正本は以下のJSONファイル**であり、本ドキュメントはそのサマリに過ぎない
(内容に齟齬がある場合はJSON側を正とする)。

- `backend/data_candidates/phase6f_drawing_evidence_types.json`
- `backend/data_candidates/phase6f_estimate_rules.json`

**重要(繰り返し強調)**:

- これらのJSONは**本番seedではない**。`backend/db/seed.py`・`app/db/master_importer.py`
  等のアプリ起動パスから一切ロードされない、レビュー専用の候補ファイルである。
- 本番DB・本番seedへは、本ドキュメント作成時点では一切投入していない。
- 「技術的に動作確認できた」ことと「本番投入可能」は別の基準であり、混同しない
  (下記`status`の定義参照)。

## status の定義

| status | 意味 |
|---|---|
| `ready` | 資料の成立条件を技術的に完全表現でき、評価器(`app/services/estimate_rule_evaluator.py`)が対応する範囲(judgment_scope/quantity_method/calc_type)のみで、業務的な簡略化・未確認事項が無い |
| `needs_business_confirmation` | 技術的には動作するが、資料の条件の一部を簡略化している、複数解釈がある、または業務判断が必要 |
| `blocked` | 必要な判定ロジック・データソース・評価器機能のいずれかが欠けており、現時点では実装・投入ができない |

2026-10時点(Phase 6-F)で、**`ready`判定の候補は1件もない**。全候補が
`needs_business_confirmation`または`blocked`である。これはPhase 6-D/6-E/6-Fで
評価器の表現力をかなり引き上げた後でもなお、実マスタ投入には業務側確認
(AI classの統合方法、型式文字列パターンの確認、コードマッピングの確定等)が
不可欠であることを示す、意図した結果である。

## validator

候補JSONの構造的な妥当性(重複key/code、未知enum、evidence参照の整合性、
`allowed_factors`の型、`condition`スキーマ、`source_refs`の非空、
`status`/`blocker`の整合、`ready`なのに評価器未対応の組合せを使っていないか)は
`backend/tools/validate_candidate_manifests.py`で機械的にチェックできる
(本番DBへは一切接続しない)。

```bash
cd backend
.venv/Scripts/python tools/validate_candidate_manifests.py
```

## drawing_evidence_types 候補サマリ (16件)

| key | 表示名 | status | 主な理由(blocker) |
|---|---|---|---|
| side_door | 側面扉 | needs_business_confirmation | 18302の標準含有枚数との差分算出が未実装 |
| narrow_door | 観音扉(狭幅) | blocked | 対応コード(18303)の紐付けが推定止まり |
| small_door | 小扉 | blocked | 屋内(18305)/屋外(18306)の判別不可 |
| stack_doors | 段積扉 | blocked | 対応コード(18307/18329)の紐付けが推定止まり |
| roof_fan_top | 換気扇(天井取付) | needs_business_confirmation | roof_fan/roof_fan_l/roof_fan_rの3class統合方法が未確定 |
| door_fan | 換気扇(扉取付) | blocked | 対応コード(18312)の紐付けが推定止まり |
| vct | VCT | blocked | 18323に必要な位置関係判定(POSITION)が未実装 |
| ch | CH(ケーブルヘッド) | blocked | 対応AI classが資料から特定できない、position未実装 |
| transformer | トランス | blocked | 18313/18314の使い分け基準が資料にない |
| panel_internal | 内部パネル | blocked | 18001〜18016個々の判定基準が資料にない |
| rotate_panel | 回転パネル | blocked | 静止図面だけでは機構判別が困難 |
| partition | 仕切り板 | blocked | 資料のファイル名範囲と記載内容が不一致 |
| stack_plate | 段積み板 | blocked | 対応コードの紐付けが推定止まり |
| drawer_device | 引出装置 | needs_business_confirmation | IA/OA型式のMODEL文字列パターンが実データ未確認 |
| bus_duct | バスダクト | blocked | 成立条件の積極的な記載が資料にない |
| passage | 盤内通路 | needs_business_confirmation | 型式だけで通路有無を断定してよいか業務未確認 |

## estimate_rule_masters 候補サマリ (11件)

| code | 名称 | status | 主な理由(blocker) |
|---|---|---|---|
| 18302 | 側面扉(追加) | needs_business_confirmation | 標準含有枚数との差分算出が未実装 |
| 18311 | 換気扇上部取付 | needs_business_confirmation | AI class統合方法が未確定 |
| 18305 | 小扉(屋内操作用) | blocked | 屋内/屋外の判別不可 |
| 18323 | VCT架台 | blocked | position scope未実装 |
| 18322 | 盤内通路(IS,OS系) | needs_business_confirmation | OR条件(Phase 6-Fで技術対応済み)だが型式のみでの断定が業務未確認 |
| 18321 | 盤内通路(IA,OA系) | blocked | 18322と同じ業務未確認 + IA/OA型式パターン未確認 |
| 18101-18115 | 底板(なしの場合減額) | blocked | `.boxspec`/`.baninf`データソースが現行環境に存在しない |
| 18501-18521 | 金網 | blocked | 個別コード⇔サイズ対応表が資料にない |
| 19959-19962 | 箱体価格倍率 | blocked | 評価器がper_product/multiply_price未実装 |
| 44241-44833 | 主回路銅帯 入力係数 | blocked | 資料自身が「保留」区分、custom handler前提 |
| 18304 | 背面扉ナシ・ビス止め | blocked | 資料自身が「保留」区分、情報不足 |

## 技術的実装状況との対応(「動く」≠「投入可能」の具体例)

| 候補 | 技術的に動作確認済みか | 資料条件を完全表現できるか | 業務確認が必要か | 本番投入可能か |
|---|---|---|---|---|
| 18302 | ○(検証DB上で確認済み) | △(差分算出省略) | ○ | **不可** |
| 18311 | ○(検証DB上で確認済み) | △(3class統合省略) | ○ | **不可** |
| 18305 | ○(検証DB上で確認済み) | △(屋内外不明のまま) | ○ | **不可** |
| 18323 | ○(簡略版のみ確認) | ×(位置関係省略) | ○ | **不可** |
| 18322 | ○(IS/OS両枝、実データ+合成データで確認済み) | ○(Phase 6-FでOR対応完了) | ○(型式のみ断定可否) | **不可** |
| 18101-18115 | ×(データソース無し) | × | ○ | **不可** |

詳細な根拠資料・条件構造は各JSONファイルの`source_refs`/`condition`フィールドを参照。

## 関連ドキュメント

- `docs/architecture.md` — 評価器(StandardCondition OR対応含む)の仕組み
- `docs/known-limitations.md` — 評価器の対応状況・既知の制約一覧
- `docs/data-source.md` 6.1章 — AI class一覧・`.boxspec`/`.baninf`調査結果
