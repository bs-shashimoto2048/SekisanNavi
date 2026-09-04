"""ドメインモデル定義 (PoC)。

ここでのモデルはAPIスキーマ(app/schemas)と同一の形をしているが、
役割は別である:
  - domain.models  : 業務上の概念そのもの。Repository/RuleEngineが扱う。
  - schemas        : APIの入出力契約。将来UI都合で変わってもdomainへ波及させない。

PoC規模では両者はほぼ同じ形になるが、意図的に分離しておくことで
「画面レイアウト変更がDomainロジックまで変更する構造にしない」(要件15)を満たす。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class AnalysisStatus(str, Enum):
    """案件の解析状態。暫定候補 (要件9)。"""

    NOT_ANALYZED = "not_analyzed"      # 未解析
    ANALYZING = "analyzing"            # 解析中
    NEEDS_REVIEW = "needs_review"      # 確認待ち
    CONFIRMED = "confirmed"            # 確定


class AttributeSource(str, Enum):
    """盤属性の取得元 (要件12)。"""

    DESIGN_DATA = "design_data"
    AI = "ai"
    MANUAL = "manual"


class DetectionStatus(str, Enum):
    """検出結果の確認状態 (暫定)。"""

    PENDING = "pending"             # 未確認 (通常表示)
    REVIEWED = "reviewed"           # 確認済み
    NEEDS_REVIEW = "needs_review"   # 要確認 (Phase 1.5で追加)
    EXCLUDED = "excluded"           # 除外


class DetectionSourceType(str, Enum):
    """Detectionの取得方法 (Phase 1.6で追加)。

    EstimateSourceType (program/ai/manual) とは別に定義する。Detectionは
    そもそもprogram由来では発生しない (要件6: programソースのEstimateItemは
    Detectionを介さない) ため、aiとmanualのみを候補とする。
    """

    AI = "ai"
    MANUAL = "manual"


class DecisionEventType(str, Enum):
    """判断・修正データ保存(Issue #4 Phase A)のevent種別。

    move/resizeは記録時に区別せず 'bbox_edit' へ統合する
    (docs/decision-event-design.md 4.1章: 既存Frontend/Undo実装が
    move/resizeを区別する情報を持たないため。前後のw/h比較で分析時に
    判別できる)。leader_label(引出線ラベル)の移動・積算コード変更・
    盤所属変更・要確認確定・状態変更はPhase Aの対象外(対応するAPIが
    現状存在しないか、Issue #4本文のPhase A対象一覧に含まれていないため)。
    """

    CREATE = "create"
    DELETE = "delete"
    BBOX_EDIT = "bbox_edit"


class DrawingPageSourceType(str, Enum):
    """図面ページの取得元 (Phase 1.5)。"""

    PLACEHOLDER = "placeholder"     # 実ファイルなし、プレースホルダー描画
    PRODUCT_FILE = "product_file"   # データ参照ルート配下の実PDFファイル


class EstimateSourceType(str, Enum):
    """積算結果の取得方法 (要件6)。"""

    PROGRAM = "program"
    AI = "ai"
    MANUAL = "manual"


class EstimateStatus(str, Enum):
    """積算結果の確認状態 (要件6)。"""

    AUTO = "auto"
    CONFIRMED = "confirmed"
    NEEDS_REVIEW = "needs_review"
    EXCLUDED = "excluded"


@dataclass
class ProjectInfo:
    id: int
    seiri_no: str
    seiban: str
    panel_name: str
    analysis_status: AnalysisStatus


@dataclass
class DrawingPage:
    id: int
    drawing_file_id: int
    page_no: int
    drawing_type: str
    drawing_name: str
    thumbnail_url: str | None
    image_url: str | None
    page_width: int
    page_height: int
    display_order: int
    source_type: DrawingPageSourceType = DrawingPageSourceType.PLACEHOLDER
    product_no: str | None = None
    source_page_no: int | None = None


@dataclass
class PanelAttribute:
    id: int
    panel_id: int
    key: str
    label: str
    value: str
    unit: str | None
    source: AttributeSource
    display_order: int


@dataclass
class PanelArea:
    """盤範囲 (Panel Overlay)。仕様未確定 (data-model.md参照)。

    Detectionとは独立したOverlay Layerとして扱う。座標は
    drawing_pages上のPDFページ原寸に対する 0.0〜1.0 の正規化座標。
    1つの盤が同一ページ内で複数の範囲 (正面/背面/側面等) を持つ場合を
    想定し、panel_id×drawing_page_idごとに複数件存在しうる。
    """

    id: int
    panel_id: int
    drawing_page_id: int
    area_x: float
    area_y: float
    area_w: float
    area_h: float
    label: str | None


@dataclass
class Panel:
    id: int
    panel_no: str
    name: str
    primary_drawing_page_id: int | None
    attributes: list[PanelAttribute] = field(default_factory=list)


@dataclass
class Detection:
    """AI等による検出。

    bbox_x/y/w/h は Phase 1.5 より 0.0〜1.0 の正規化座標
    (該当 drawing_page のPDFページ原寸に対する比率) として扱う。
    画面の拡大・縮小・ウィンドウサイズ変更から独立させるための設計判断。
    (architecture.md 「Overlay座標系」参照)
    """

    id: int
    drawing_page_id: int
    panel_id: int | None
    class_name: str
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    confidence: float | None
    status: DetectionStatus
    source_type: DetectionSourceType = DetectionSourceType.AI
    # Manual追加時に選択されていた積算Master Itemへの参照 (Phase 1.6)。
    # 表示名称・価格情報はここへコピーせず、参照のみ保持する (要件11)。
    master_item_id: int | None = None
    # 引出線ラベル帯(「コード 型式」)の表示位置 (Phase 1.11)。BBox本体の座標
    # (bbox_x/y/w/h)とは独立した0.0〜1.0正規化座標。未設定(None)の場合、
    # Frontend側がBBox右上角を基準に初期位置を自動計算する (指示書12章/13章)。
    leader_label_x: float | None = None
    leader_label_y: float | None = None
    # master_item_idからJOINして得るcategory (Phase 1.11)。色はここへ固定値として
    # 持たず、Frontend側でcategory→presentation(color)を都度解決する (要件2)。
    # Repository層でのJOIN結果を素通しするだけの表示用フィールドであり、
    # Detection自体の永続化カラムではない。
    master_item_category: str | None = None
    # master_item_idからJOINして得るmodel (Phase 1.11)。引出線ラベル「コード 型式」
    # (指示書14章)の表示に使う。class_nameは登録時にMaster Itemのcodeで固定されて
    # いるため (指示書11章と同じ「コピーせず参照」方針)、型式はこちらから都度取得する。
    master_item_model: str | None = None
    # master_item_idからJOINして得るcode (Phase 1.11 追加修正)。class_nameは登録時点の
    # コピーであり将来のMaster Item側の変更に追従しないため、引出線表示は
    # 可能な限りこちらのライブJOIN結果を優先する (指示書12章/14章)。
    master_item_code: str | None = None


@dataclass
class DecisionEvent:
    """判断・修正データの最小event記録 (Issue #4 Phase A-1)。

    `detections`テーブルへのcreate/delete/bbox move・resizeの事実だけを
    append-onlyで記録する。current state(`detections`本体)とは責務を分離し、
    このモデル自体はどのAPIからも返さない(Phase A-1では読み出しAPIを
    追加しない。docs/decision-event-design.md 10章のPhase A-2で検討する)。

    `detection_id`は意図的に外部キーを持たない設計であるため、参照先の
    Detectionが既に削除されていても、このモデル自体の情報
    (drawing_page_id/source_type/master_item_id/before_bbox_*)だけで
    解釈できるよう、イベント発生時点の値を非正規化コピーとして保持する
    (`docs/decision-event-design.md` 6章参照)。
    """

    id: int
    occurred_at: str
    event_type: DecisionEventType
    detection_id: int
    drawing_page_id: int
    source_type: DetectionSourceType
    master_item_id: int | None
    before_bbox_x: float | None
    before_bbox_y: float | None
    before_bbox_w: float | None
    before_bbox_h: float | None
    after_bbox_x: float | None
    after_bbox_y: float | None
    after_bbox_w: float | None
    after_bbox_h: float | None


@dataclass
class EstimateMasterItem:
    """積算コードMaster。

    Phase 1.7より `data/master/estimate_master_a.xlsx` (Sheet2, 912行) を正式な
    参照元とする (`app/db/master_importer.py` 参照)。実データ調査の結果、
    以下が判明したためドメインモデルへ反映している:
      - Excel側に `item_name` に相当する列は存在しない (Phase 1時点の独自項目だった
        ため削除した)。
      - `category` (品名) が空欄の行が1件だけ存在する (社内向けの注記行) ため
        Optionalとする。
    価格・工数の内訳列 (total_price_a 以降) は、値が存在しない項目は None のまま
    保持する (指示書3章: 勝手な計算値・ダミー値を生成しない)。
    """

    id: int
    code: str
    category: str | None
    model: str | None
    rating: str | None
    note: str | None
    total_price_a: float | None = None      # 総合価格A
    box_parts_price: float | None = None    # 箱・部品価格
    painting_price: float | None = None     # 塗装価格
    setup_a: float | None = None            # 設A
    sheet_metal_price: float | None = None  # 板金
    assembly_price: float | None = None     # 組立
    inspection_price: float | None = None   # 検査


@dataclass
class EstimateReference:
    id: int
    estimate_item_id: int
    drawing_page_id: int
    detection_id: int | None
    panel_id: int | None
    reason: str | None


@dataclass
class EstimateItem:
    id: int
    code: str
    category: str
    item_name: str
    model: str | None
    rating: str | None
    quantity: float
    unit: str | None
    source_type: EstimateSourceType
    confidence: float | None
    status: EstimateStatus
    references: list[EstimateReference] = field(default_factory=list)


class EstimateTargetType(str, Enum):
    """積算対象の種類 (Issue #4 Phase B-1)。

    Frontend `types/estimateAggregation.ts::EstimateTargetType`
    ('product'/'panel'/'tie') と同じ3値を、確定snapshot側でも
    非正規化コピーとして保存するために使う(`docs/decision-snapshot-design.md`
    4章/5章)。Backend側はこの対象種別を独自に判定しない
    (BBox所属判定`assignDetectionToPanel`はFrontend側のロジックのままであり、
    確定操作の呼び出し側が既に確定した結果をそのまま渡す想定)。
    """

    PRODUCT = "product"
    PANEL = "panel"
    TIE = "tie"


@dataclass
class EstimateConfirmationItemInput:
    """`save_confirmation()`への入力1行分 (Issue #4 Phase B-1)。

    Detection 1件 = 1行の粒度(積算明細`detailItems`相当)で渡す。
    id/confirmation_idはINSERT時にDBが払い出すため、入力側は持たない
    (`docs/decision-snapshot-design.md` 4章)。呼び出し側(将来のPhase B-2の
    確定API)が、その時点の`detections`×`estimate_master_items`×
    `product_df.csv`/`estcode_df.csv`から解決済みの値をここへ集めて渡す。
    """

    target_id: str
    target_type: EstimateTargetType
    code: str
    source_type: DetectionSourceType
    status: DetectionStatus
    detection_id: int | None = None
    drawing_page_id: int | None = None
    ban_menno: int | None = None
    ban_no: int | None = None
    panel_name: str | None = None
    master_item_id: int | None = None
    category: str | None = None
    model: str | None = None
    rating: str | None = None
    quantity: float = 1
    unit_price: float | None = None
    amount: float | None = None
    bbox_x: float | None = None
    bbox_y: float | None = None
    bbox_w: float | None = None
    bbox_h: float | None = None
    page_no: int | None = None


@dataclass
class EstimateConfirmationItem(EstimateConfirmationItemInput):
    """保存後の確定snapshot明細行 (`save_confirmation()`の戻り値要素)。

    `EstimateConfirmationItemInput`にDB採番済みの`id`/`confirmation_id`を
    加えたもの。読み出しAPIはPhase B-1のスコープ外のため、このモデル自体は
    どのAPIからも返さない(`docs/decision-snapshot-design.md` 11章)。
    """

    id: int = 0
    confirmation_id: int = 0


@dataclass
class EstimateConfirmation:
    """積算確定snapshotのheader (Issue #4 Phase B-1)。

    `estimate_confirmations`の1行 = 1回の確定操作。製番(`product_no`)単位で
    その時点の積算結果一式を丸ごと固定する(`docs/decision-snapshot-design.md`
    3章)。再確定のたびに新しい行を追加するappend-only設計であり、既存行を
    更新・削除する操作は用意しない(同8章/9章)。
    """

    id: int
    product_no: str
    confirmed_at: str
    items: list[EstimateConfirmationItem] = field(default_factory=list)
