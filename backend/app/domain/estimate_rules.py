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


@dataclass
class StandardConditionField:
    """設計データ条件1件 (Issue #40 11章「標準ルール」の最小構造)。

    例: `{"field": "ban_w", "operator": ">=", "value": 900}`。
    `field`は`app.services.design_data_context.DesignDataContext`の属性名と
    対応させる。演算子は`==`/`!=`/`>=`/`<=`/`>`/`<`のみサポートする
    (資料からより複雑な条件式の機械可読な仕様を確認できていないため、
    Phase 2ではこれ以上の表現力を持たせない)。
    """

    field: str
    operator: str
    value: float | str


@dataclass
class StandardCondition:
    """標準ルールの判定条件 (AND結合のみ。OR/NOTは持たない)。

    - `required_evidence_types`: このリストの図面情報種別(key)が、
      判定範囲(judgment_scope)内にすべて存在すること。
    - `design_data_conditions`: 設計データ条件(すべて満たすこと)。
    両方空の場合は「常に成立」する条件として扱う(design_dataのみで判定可能な
    コードで、根拠となる図面情報が不要なケースを表現するため)。
    """

    required_evidence_types: list[str] = field(default_factory=list)
    design_data_conditions: list[StandardConditionField] = field(default_factory=list)


@dataclass
class EstimateResult:
    """積算結果1件 (Issue #40 12章の標準モデル)。"""

    id: int
    product_no: str
    result_key: str
    master_item_id: int | None
    code: str
    quantity: float
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
    "DrawingEvidenceType",
    "EstimateRuleMaster",
    "StandardConditionField",
    "StandardCondition",
    "EstimateResult",
    "EstimateResultEvidence",
    "EvidenceRef",
    "EstimateResultCandidate",
]
