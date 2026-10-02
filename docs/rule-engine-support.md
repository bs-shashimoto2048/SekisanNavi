# ルールエンジン対応状況一覧 (Issue #40 Phase 6-G)

標準rule evaluator(`backend/app/services/estimate_rule_evaluator.py`)が
`QuantityMethod`/`JudgmentScope`/`CalcType`、および位置関係条件
(`evidence_relations`)のどの値・組合せを実際に処理できるかを一覧化する。

分類は5段階:

| 分類 | 意味 |
|---|---|
| **fully supported** | 評価器が完全に計算まで行う |
| **conditionally supported** | 一部の条件・組合せに限り評価器が対応する |
| **infrastructure only** | 純粋関数・データ構造としては実装済みだが、実ルールへは未接続 |
| **business blocked** | 技術的には実装できるが、業務ルール・計算式が資料から確定できないため実装しない |
| **not implemented** | enum値の列挙のみで、評価器は一切対応しない(常に`skipped_rule_master_ids`) |

「単一の真実源」: この一覧の`JudgmentScope`/`QuantityMethod`/`CalcType`の
組合せルールは、`app.services.estimate_rule_evaluator.is_standard_rule_
supported`(および内部の`_rule_shape_supported`)がコード上で判定する内容と
完全に一致する。候補マニフェストvalidator(`backend/tools/
validate_candidate_manifests.py`)も同じ関数を使って`status=ready`の妥当性を
判定するため、本ドキュメントとコードの実装が乖離した場合はコード(および
`backend/tests/test_rule_support_helper.py`)を正とする。

## QuantityMethod

| 値 | 分類 | 備考 |
|---|---|---|
| `per_evidence` | fully supported | 根拠1件につき1行。全4 scope(PANEL/DESIGN_DATA/DRAWING/PRODUCT)で対応 |
| `per_condition_group` | fully supported | 条件成立グループにつき1行。同上 |
| `per_face` | not implemented | 列挙のみ |
| `per_unit` | not implemented | 列挙のみ |
| `per_product` | not implemented | 列挙のみ(19959-19962で必要とされるが未実装) |
| `per_combination_set` | not implemented | 列挙のみ |
| `diff_from_standard` | business blocked | 18302で必要だが、標準枚数の信頼できる数値データソースが無い(`docs/master-candidate-status.md`参照、`Ａ製品標準工数計算手順NNメモ追加.xlsx`の「箱体コードに含む」シートは構成ラベルのみで数値カウントではない) |
| `custom` | not implemented | custom handler registry(Phase 5以降予定)が空のまま |

## JudgmentScope

| 値 | 分類 | 備考 |
|---|---|---|
| `panel` | fully supported | 1盤を1グループとする評価単位。`evidence_relations`(位置関係条件)もこのscopeのみ対応 |
| `design_data` | fully supported | PANELと全く同じ評価ループ(内部実装上の違いは無い)。ただし`evidence_relations`との組合せは未対応 |
| `drawing` | conditionally supported | 「図面情報の存在判定のみ」(design_data_conditions/design_data_any_of/evidence_relationsを持たず、required_evidence_typesが1件以上)に限る |
| `product` | conditionally supported | 同上(製番全体を1グループとする) |
| `position` | not implemented | 常にskip。`evidence_relations`(PANEL scope内で使う別の仕組み)とは異なる概念 |
| `range` | not implemented | 常にskip |

## CalcType

| 値 | 分類 | 備考 |
|---|---|---|
| `direct` | fully supported | 単価×数量×係数 |
| `add` | not implemented | 列挙のみ |
| `subtract` | not implemented | 列挙のみ |
| `multiply_price` | business blocked | 19959-19962で必要だが、倍率の基準額・適用順序が資料から確定できない |
| `multiply_labor` | business blocked | 同上 |
| `multiply_both` | business blocked | 同上 |
| `custom` | not implemented | custom handler registryが空(44241-44833の主回路銅帯入力係数で必要) |

## StandardCondition の条件表現

| 機能 | 分類 | 備考 |
|---|---|---|
| `design_data_conditions`(AND、`==`/`!=`/`>=`/`<=`/`>`/`<`) | fully supported | Phase 2から対応 |
| `design_data_conditions`(`starts_with`/`in`) | fully supported | Phase 6-E追加 |
| `design_data_any_of`(OR、ANDグループのリスト) | fully supported | Phase 6-F追加。既存JSON完全互換 |
| `required_evidence_types`(図面情報の存在判定) | fully supported | 全4 scopeで対応 |
| `evidence_relations`(位置関係条件、`above`/`below`/`left_of`/`right_of`/`overlaps`) | conditionally supported | PANEL scope限定。`match_mode=any_pair`のみ(`every_pair`/`one_to_one`/`nearest_pair`はinfrastructure only、enumとしては列挙済みだが評価器は拒否する)。さらに`relation=overlaps`は`tolerance=0.0`のみサポート(`tolerance!=0`はPR #51レビュー指摘により明示的にunsupportedとする。`app.domain.geometry.overlaps`がtolerance引数を持たず、指定値が評価時にsilent ignoreされてしまうため。`above`/`below`/`left_of`/`right_of`は引き続き任意のtoleranceをサポート) |
| OR結合(design_data_any_of)とNOT | not implemented | OR(1段のみ)とANDの組合せのみ。2段以上のネスト・NOTは資料から必要性を確認できていない |

## 幾何predicate (`app/domain/geometry.py`)

| 項目 | 分類 | 備考 |
|---|---|---|
| `is_above`/`is_below`/`is_left_of`/`is_right_of`/`overlaps` | infrastructure only | 純粋関数としては実装・テスト済み。`evidence_relations`経由でPANEL scopeのルールから利用可能になったが、**特定コードの業務ルールへはまだ接続していない**(18323等は資料から確定できる具体的なルールが無いため) |

## AI class alias mapping (`backend/tools/ai_class_alias.py`)

| 項目 | 分類 | 備考 |
|---|---|---|
| `build_alias_map`/`resolve_evidence_type_for_ai_class` | infrastructure only | 候補マニフェストの`ai_class_keys`からmappingを構築する純粋関数。本番DBへの書き込み・`class_name`列の変更・実行時の自動適用は一切行わない |

## 関連ドキュメント

- `docs/master-candidate-status.md` — 候補ごとの`status`/blocker分類
- `docs/architecture.md` — 評価器全体の設計
- `docs/known-limitations.md` — 既知の制約一覧
