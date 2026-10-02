"""Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化。

ドメインモデル定義。既存の `app.domain.models` (Detection/EstimateMasterItem等)
は変更せず、新しい概念(図面情報マスタ/ルールマスタ/積算結果/根拠)をこの
モジュールへ独立して追加する。

**命名の注意**: `app.domain.rule_engine`(`suggest_estimate_candidates`)という
既存の別モジュールが既に存在するが、これはPhase 1.5時点の
「AIクラス名→コード候補の暫定対応表」という全く別の未使用スケルトンであり、
Issue #40のルールエンジンとは無関係(混同を避けるため、このモジュール・
関連serviceは意図的に別名にしている。既存モジュール・そのテストは変更しない)。

各Enumの内部値(英語スネークケース)は自由に決めてよい(Issue #40指示)。
UI表示用の日本語ラベルは、この段階ではUIを一切実装しないため定義しない
(Phase 3/4で`docs/ui-spec.md`と合わせて確定する)。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum


class EvidenceUsage(str, Enum):
    """図面情報の用途 (Issue #40 2-2章)。"""

    ESTIMATE_TARGET = "estimate_target"  # 積算対象(単独でコード/数量へ反映)
    CONDITION = "condition"              # 判定条件(単独ではコードにならない)
    BOTH = "both"                        # 両方


class JudgmentMethod(str, Enum):
    """判定方法 (Issue #40 1章)。UI表示は「設計データ/図面判定/要確認」。"""

    DESIGN_DATA = "design_data"
    DRAWING_JUDGMENT = "drawing_judgment"
    NEEDS_CONFIRMATION = "needs_confirmation"


class JudgmentScope(str, Enum):
    """判定範囲 (Issue #40 4章)。UI表示は「位置/範囲/盤全体/図面全体/製番全体/設計データ」。"""

    POSITION = "position"
    RANGE = "range"
    PANEL = "panel"
    DRAWING = "drawing"
    PRODUCT = "product"
    DESIGN_DATA = "design_data"


class ApplicableUnit(str, Enum):
    """適用単位 (Issue #40 5章)。UI例: 1面/1台/1製番/1か所/1枚/実数量/その他。"""

    FACE = "face"
    UNIT = "unit"
    PRODUCT = "product"
    LOCATION = "location"
    SHEET = "sheet"
    ACTUAL_QUANTITY = "actual_quantity"
    OTHER = "other"


class QuantityMethod(str, Enum):
    """数量算定方式 (Issue #40 6章)。

    Phase 2の評価器(`app.services.estimate_rule_evaluator`)が実際に計算する
    のは`PER_EVIDENCE`のみ(「根拠1件につき1」。現行のDetection単純カウントと
    同じ、資料上も確認が不要な自明な方式)。他の値は将来の拡張のために列挙
    するのみで、評価器は未実装のためneeds_confirmationへフォールバックする
    (推測で式を作らない。Issue #40 6章/13-1章)。
    """

    PER_EVIDENCE = "per_evidence"              # 根拠1件につき1
    PER_FACE = "per_face"                       # 1面につき1
    PER_UNIT = "per_unit"                       # 1台につき1
    PER_PRODUCT = "per_product"                 # 1製番につき1
    PER_CONDITION_GROUP = "per_condition_group"  # 条件成立グループにつき1
    PER_COMBINATION_SET = "per_combination_set"  # 複数BBoxの組合せ1セットにつき1
    DIFF_FROM_STANDARD = "diff_from_standard"   # 標準構成との差分加算/減算
    CUSTOM = "custom"                           # その他専用算定


class CalcType(str, Enum):
    """価格・工数の計算種別 (Issue #40 13-2章)。

    Phase 2の評価器が実際に計算するのは`DIRECT`のみ
    (`単価/工数 × 数量 × 係数`。Issue #40 13-2章が「基本算出モデル」として
    明示している式であり、推測ではない)。他の値は列挙のみで、評価器は
    price/labor=Noneのまま`needs_confirmation`として扱う。
    """

    DIRECT = "direct"
    ADD = "add"
    SUBTRACT = "subtract"
    MULTIPLY_PRICE = "multiply_price"
    MULTIPLY_LABOR = "multiply_labor"
    MULTIPLY_BOTH = "multiply_both"
    CUSTOM = "custom"


class ProcessingMode(str, Enum):
    """処理方式 (Issue #40 11章のハイブリッド方式)。"""

    STANDARD = "standard"
    CUSTOM = "custom"


class EvidenceKind(str, Enum):
    """積算結果の根拠種別 (Issue #40 12章 evidence refs)。"""

    DETECTION = "detection"
    DESIGN_DATA = "design_data"


class EstimateResultStatus(str, Enum):
    """積算結果の確認状態。既存`DetectionStatus`と語彙を揃えている
    (auto以外はDetectionStatusと同じ値)。"""

    AUTO = "auto"
    REVIEWED = "reviewed"
    NEEDS_REVIEW = "needs_review"
    EXCLUDED = "excluded"


class PositionRelation(str, Enum):
    """2つの図面情報(BBox)間の相対位置関係 (Issue #40 Phase 6-G指示2:
    POSITIONの汎用ルール表現)。`app.domain.geometry`の同名predicate
    (`is_above`/`is_below`/`is_left_of`/`is_right_of`/`overlaps`)へ
    そのまま対応する。業務的な意味づけ(「18323はCHがVCTの上にあれば成立」
    等)は一切持たず、純粋に幾何学的な関係のみを表す。"""

    ABOVE = "above"
    BELOW = "below"
    LEFT_OF = "left_of"
    RIGHT_OF = "right_of"
    OVERLAPS = "overlaps"


class MatchMode(str, Enum):
    """`EvidenceRelation`を複数BBoxの組合せに対してどう適用するかの戦略
    (Issue #40 Phase 6-G指示3)。

    値は列挙するが、Phase 6-Gで実際に評価器が実装するのは`ANY_PAIR`のみ
    (`QuantityMethod`/`CalcType`等、既存のenum値と評価器実装状況が1対1で
    対応しない既存パターンと同じ)。`EVERY_PAIR`/`ONE_TO_ONE`/
    `NEAREST_PAIR`は、どのペアリング規則が業務的に正しいかを資料から
    確認できておらず、**推測で実装しない**(指示3「これを勝手に業務決定
    しない」)。"""

    ANY_PAIR = "any_pair"
    EVERY_PAIR = "every_pair"
    ONE_TO_ONE = "one_to_one"
    NEAREST_PAIR = "nearest_pair"


# Phase 6-Gで評価器が実際にサポートするmatch_mode(docstring参照)。
SUPPORTED_MATCH_MODES: frozenset[MatchMode] = frozenset({MatchMode.ANY_PAIR})


@dataclass
class DrawingEvidenceType:
    """図面情報マスタ1件 (Issue #40 10-1章)。"""

    id: int
    key: str
    display_name: str
    category: str | None
    usage: EvidenceUsage
    default_judgment_scope: JudgmentScope
    description: str | None
    enabled: bool


@dataclass
class EstimateRuleMaster:
    """積算コード/ルールマスタ1件 (Issue #40 10-2章)。

    `master_item_id`経由で既存`EstimateMasterItem`(品名/型式/定格/価格内訳)
    と1:1に対応する。品名・型式・定格等をここへ複製しない。
    """

    id: int
    master_item_id: int
    judgment_method: JudgmentMethod
    judgment_scope: JudgmentScope
    applicable_unit: ApplicableUnit | None
    quantity_method: QuantityMethod
    initial_factor: float
    allowed_factors: list[float] | None
    judgment_condition: "StandardCondition | None"
    judgment_reason_template: str | None
    calc_type: CalcType
    processing_mode: ProcessingMode
    custom_handler_key: str | None
    auto_display: bool
    enabled: bool
    note: str | None = None


# 設計データ条件で使える演算子 (Issue #40 11章「標準ルール」の最小構造)。
# Phase 6-Eで`starts_with`/`in`を追加した(Phase 6-Dで判明した「型式がIS*/OS*系」
# 「複数候補値のいずれか」という資料上の条件を、`model == "IS2"`のような
# デモ専用の固定値一致へ単純化せずに表現できるようにするため)。
STANDARD_CONDITION_OPERATORS: frozenset[str] = frozenset(
    {"==", "!=", ">=", "<=", ">", "<", "starts_with", "in"}
)


@dataclass
class StandardConditionField:
    """設計データ条件1件 (Issue #40 11章「標準ルール」の最小構造)。

    例: `{"field": "ban_w", "operator": ">=", "value": 900}`、
    `{"field": "model", "operator": "starts_with", "value": "IS"}`、
    `{"field": "model", "operator": "in", "value": ["IS1", "IS2", "OS1"]}`。
    `field`は`app.services.design_data_context.DesignDataContext`の属性名と
    対応させる。

    演算子は`==`/`!=`/`>=`/`<=`/`>`/`<`/`starts_with`/`in`のみサポートする
    (資料からより複雑な条件式の機械可読な仕様を確認できていないため、
    これ以上の表現力は持たせない)。

    **型安全性(Issue #40 Phase 6-E指示3-A)**: `starts_with`は`value`が文字列の
    場合のみ、`in`は`value`がlist/tupleの場合のみ許可する(暗黙の型変換は
    行わない)。不正な組合せは生成時に`ValueError`で即座に失敗させる
    (DBに壊れた条件を保存してしまい、評価時に初めて気づく事態を避けるため)。
    一方、**評価時**に実際の設計データ値(`DesignDataContext`側の値)が期待と
    異なる型だった場合は、例外にはせず単に「条件不成立」として扱う
    (既存の`>=`等が`None`を「不成立」として扱うのと同じ考え方。
    `app.services.estimate_rule_evaluator._OPERATORS`参照)。
    """

    field: str
    operator: str
    value: float | str | list | tuple

    def __post_init__(self) -> None:
        if self.operator not in STANDARD_CONDITION_OPERATORS:
            raise ValueError(
                f"未知の演算子です: {self.operator!r} "
                f"(サポート対象: {sorted(STANDARD_CONDITION_OPERATORS)})"
            )
        if self.operator == "starts_with" and not isinstance(self.value, str):
            raise ValueError(
                f"演算子 'starts_with' のvalueは文字列である必要があります: {self.value!r}"
            )
        if self.operator == "in" and not isinstance(self.value, (list, tuple)):
            raise ValueError(
                f"演算子 'in' のvalueはlist/tupleである必要があります: {self.value!r}"
            )


@dataclass
class EvidenceRelation:
    """2種類の図面情報(evidence_type_key)間に要求する相対位置関係
    (Issue #40 Phase 6-G指示2: 「Evidence AとEvidence Bの位置関係」を
    `StandardCondition`で表現できる汎用position condition基盤)。

    例: `{"left_type": "ch", "relation": "above", "right_type": "vct",
    "tolerance": 0.0}` は「`ch`種別の根拠が`vct`種別の根拠より上にある」
    という関係を表す(`app.domain.geometry.is_above`へそのまま対応)。

    **業務ルールを含まない**: このdataclass自体は「18323はCHがVCTの上に
    あれば成立する」といった特定コードの業務解釈を一切持たない。資料で
    確定できる業務ルールが無い限り、候補マニフェストへ実際の関係を
    投入しない(Issue #40 Phase 6-G指示2末尾)。

    **arbitrary evalは禁止**: `relation`は`PositionRelation`の明示的な
    列挙値のみを許可し、文字列式の評価・SQL動的生成は一切行わない。

    **tolerance**: 有限の数値(NaN/+Infinity/-Infinity禁止、DSL/JSON境界で
    扱えない値のため)のみ許可する。負値は意味を変える可能性があるが、
    資料根拠なしに解釈・禁止を決めないため、今回は現状の型チェックのみとし、
    符号自体は制限しない(Issue #40 PR #51レビュー指摘)。

    **`overlaps`はtolerance=0.0のみサポート**: `PositionRelation.OVERLAPS`は
    `app.domain.geometry.overlaps`が2矩形の交差判定のみを行い、tolerance
    引数を受け取らない。`overlaps`に対してtoleranceを与えた場合に何を
    意味するか(矩形を膨張させる、等)は資料から確認できないため、今回は
    推測で意味を定義せず、`OVERLAPS`かつ`tolerance != 0.0`の組合せを
    `is_standard_rule_supported`(単一の真実源)で明示的にunsupportedとする
    (Issue #40 PR #51レビュー指摘: silent ignore禁止)。このdataclass自体は
    construct時点ではこの組合せを許可する(構造としては妥当なため)。
    """

    left_type: str
    relation: PositionRelation
    right_type: str
    tolerance: float = 0.0

    def __post_init__(self) -> None:
        if not isinstance(self.relation, PositionRelation):
            try:
                self.relation = PositionRelation(self.relation)
            except ValueError:
                raise ValueError(
                    f"未知のrelationです: {self.relation!r} "
                    f"(サポート対象: {[r.value for r in PositionRelation]})"
                ) from None
        if not isinstance(self.left_type, str) or self.left_type == "":
            raise ValueError(f"left_typeは空でない文字列である必要があります: {self.left_type!r}")
        if not isinstance(self.right_type, str) or self.right_type == "":
            raise ValueError(f"right_typeは空でない文字列である必要があります: {self.right_type!r}")
        if isinstance(self.tolerance, bool) or not isinstance(self.tolerance, (int, float)):
            raise ValueError(f"toleranceは数値である必要があります: {self.tolerance!r}")
        if not math.isfinite(self.tolerance):
            raise ValueError(f"toleranceは有限の数値である必要があります(NaN/Infinity不可): {self.tolerance!r}")


@dataclass
class StandardCondition:
    """標準ルールの判定条件 (Issue #40 Phase 6-FでOR表現、Phase 6-Gで
    位置関係(position)表現を追加)。

    - `required_evidence_types`: このリストの図面情報種別(key)が、
      判定範囲(judgment_scope)内にすべて存在すること(AND)。
    - `design_data_conditions`: 設計データ条件(すべて満たすこと、AND)。
    - `design_data_any_of`: Issue #40 Phase 6-F追加。
      「ANDグループのリスト」で、**いずれか1つのグループが丸ごと成立すれば
      よい**(OR)。各グループ内の条件同士はAND。例えば
      `model starts_with "IS"` **または** `model starts_with "OS"`は
      `[[StandardConditionField("model", "starts_with", "IS")],
        [StandardConditionField("model", "starts_with", "OS")]]`と表現する
      (各グループが単一条件の場合は、単純なOR-of-single-conditionsになる)。
      空リスト(既定値)は「OR制約なし」を意味し、既存の
      `design_data_conditions`(AND)のみの挙動と完全に同じになる
      (Phase 6-E以前のDB保存済みJSONとの後方互換性はこれで保たれる:
      `design_data_any_of`キーが無いJSONは空リストとしてパースされる)。
    - `evidence_relations`: Issue #40 Phase 6-G追加。`EvidenceRelation`の
      リストで、すべての関係が成立すること(AND)。`match_mode`
      (既定`ANY_PAIR`)が、複数BBoxが存在する場合に「どのペアで関係が
      成立すればよいか」を決める(`match_mode`のdocstring参照)。
      空リスト(既定値)は「位置関係の制約なし」を意味し、Phase 6-F以前の
      挙動と完全に同じになる(後方互換)。
    - `match_mode`: `evidence_relations`の適用戦略。既定`MatchMode.ANY_PAIR`。

    全体の成立条件は
    `required_evidence_types`(AND) かつ `design_data_conditions`(AND) かつ
    (`design_data_any_of`が空、または、いずれか1グループがAND成立) かつ
    `evidence_relations`(すべてAND成立)という構造。これ以上複雑な
    OR/NOTの組合せは資料から必要性を確認できていないため持たせない。

    **禁止事項(Issue #40 Phase 6-F/6-G指示)**: 文字列式のeval、SQL文字列の
    動的生成は一切行わない。条件は常にこの明示的な構造化データ
    (dataclass/JSON)としてのみ表現する。

    全てが空の場合は「常に成立」する条件として扱う(design_dataのみで判定可能な
    コードで、根拠となる図面情報が不要なケースを表現するため)。
    """

    required_evidence_types: list[str] = field(default_factory=list)
    design_data_conditions: list[StandardConditionField] = field(default_factory=list)
    design_data_any_of: list[list[StandardConditionField]] = field(default_factory=list)
    evidence_relations: list[EvidenceRelation] = field(default_factory=list)
    match_mode: MatchMode = MatchMode.ANY_PAIR

    def __post_init__(self) -> None:
        for group in self.design_data_any_of:
            if not group:
                raise ValueError(
                    "design_data_any_of の各グループは1件以上の条件を持つ必要があります"
                    "(空グループは常に成立してしまうため禁止)"
                )
        if not isinstance(self.match_mode, MatchMode):
            try:
                self.match_mode = MatchMode(self.match_mode)
            except ValueError:
                raise ValueError(
                    f"未知のmatch_modeです: {self.match_mode!r} "
                    f"(サポート対象: {[m.value for m in MatchMode]})"
                ) from None


@dataclass
class EstimateResult:
    """積算結果1件 (Issue #40 12章の標準モデル)。"""

    id: int
    product_no: str
    result_key: str
    master_item_id: int | None
    code: str
    # [Issue #40 Phase 6後半] `quantity`は従来通り「計算に使う現在の数量」を
    # 表す列として維持する(既存の集約・表示コードは今後もこの列を読むだけで
    # 手修正を自動的に反映する)。`current_quantity`はその別名として常に
    # 同じ値を持つ(repository層が書き込み時に同期させる)。`initial_quantity`
    # は評価器が算出した自動値そのもの(手修正の有無に関わらず再評価のたびに
    # 最新化される)。
    quantity: float
    initial_quantity: float
    current_quantity: float
    quantity_overridden: bool
    quantity_override_reason: str | None
    # [PR #46レビュー指摘対応] 係数側のfactor_updated_at/factor_updated_byと
    # 同じ考え方で、数量override実行時のactor/日時を追跡する(推奨案A)。
    quantity_updated_at: str | None
    quantity_updated_by: str | None
    applicable_unit: ApplicableUnit | None
    initial_factor: float
    current_factor: float
    factor_overridden: bool
    factor_override_reason: str | None
    factor_updated_at: str | None
    factor_updated_by: str | None
    judgment_method: JudgmentMethod
    judgment_scope: JudgmentScope
    target_panel_ban_menno: int | None
    target_panel_ban_no: int | None
    target_drawing_page_id: int | None
    judgment_reason: str | None
    source_rule_id: int | None
    unit_price: float | None
    unit_labor: float | None
    price: float | None
    labor: float | None
    status: EstimateResultStatus
    evidence: list["EstimateResultEvidence"] = field(default_factory=list)


@dataclass
class EstimateResultEvidence:
    """積算結果⇔根拠の多対多、1行分 (Issue #40 9章/12章)。"""

    id: int
    estimate_result_id: int
    evidence_kind: EvidenceKind
    detection_id: int | None
    design_data_ref: str | None


@dataclass
class EvidenceRef:
    """`EstimateResultCandidate.evidence`1件分の入力 (DB採番前)。"""

    evidence_kind: EvidenceKind
    detection_id: int | None = None
    design_data_ref: str | None = None


@dataclass
class EstimateResultCandidate:
    """評価器(`app.services.estimate_rule_evaluator`)が算出した「この製番に
    今あるべき積算結果」1件分の入力(DB採番前)。

    `result_key`が同じ既存行がある場合、Repository側
    (`app.repositories.estimate_results.replace_results_for_product`)が
    UPSERTする。その際、既存行の`factor_overridden=1`であれば
    `current_factor`/`factor_overridden`/`factor_override_reason`/
    `factor_updated_at`/`factor_updated_by`は**この候補の値で上書きしない**
    (Issue #40 7-3章: 「再判定で初期係数が変化しても、同じ積算結果が存続する
    限り作業者の手修正を勝手に上書きしない」)。`initial_factor`/`quantity`/
    `judgment_reason`等、手修正の対象ではない列は毎回この候補の値で更新する。

    `unit_price`/`unit_labor`は「係数適用前」の単価/工数であり、実際に
    `estimate_results.price`/`labor`へ書き込む値はRepository側が
    `unit_price/unit_labor × quantity × 適用すべき係数`で計算する。
    「適用すべき係数」は行が新規か、既存の手修正済み行かによって
    (initial_factorかcurrent_factorか)異なるため、この計算は候補生成時点
    (Evaluator)ではなくUPSERT時点(Repository)で行う(Issue #40 7-3章の
    手修正保護と矛盾しないようにするため)。calc_type='direct'以外、または
    単価が不明な場合は`unit_price=None`とし、Repositoryはprice=Noneのまま
    保存する(0円へ捏造しない)。
    """

    product_no: str
    result_key: str
    master_item_id: int | None
    code: str
    quantity: float
    applicable_unit: ApplicableUnit | None
    initial_factor: float
    judgment_method: JudgmentMethod
    judgment_scope: JudgmentScope
    target_panel_ban_menno: int | None
    target_panel_ban_no: int | None
    target_drawing_page_id: int | None
    judgment_reason: str | None
    source_rule_id: int | None
    unit_price: float | None
    unit_labor: float | None
    evidence: list[EvidenceRef] = field(default_factory=list)
    # Issue #40 Phase 5: 積算結果の確認状態。既定は"auto"(通常の自動算出)。
    # 旧Detection互換変換(`app.services.legacy_detection_adapter`)、および
    # 新旧経路が同一コードを同時に算出した場合の「一意に判断できないため
    # 要確認として残す」判定(`app.services.estimate_result_pipeline`)が、
    # NEEDS_REVIEWを明示的に設定する用途で使う(13章「推測でdedupeしない」)。
    status: EstimateResultStatus = EstimateResultStatus.AUTO


__all__ = [
    "EvidenceUsage",
    "JudgmentMethod",
    "JudgmentScope",
    "ApplicableUnit",
    "QuantityMethod",
    "CalcType",
    "ProcessingMode",
    "EvidenceKind",
    "EstimateResultStatus",
    "PositionRelation",
    "MatchMode",
    "SUPPORTED_MATCH_MODES",
    "DrawingEvidenceType",
    "EstimateRuleMaster",
    "STANDARD_CONDITION_OPERATORS",
    "StandardConditionField",
    "EvidenceRelation",
    "StandardCondition",
    "EstimateResult",
    "EstimateResultEvidence",
    "EvidenceRef",
    "EstimateResultCandidate",
]
