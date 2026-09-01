"""API入出力スキーマ (PoC)。

domain.modelsとほぼ同型だが、APIの外部契約として別定義にしている。
理由: 将来UI側の都合でレスポンス形を変えたくなった場合でも、
domain層(Repository/RuleEngine)を変更せずに済むようにするため。
"""
from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.domain.models import (
    AnalysisStatus,
    AttributeSource,
    DetectionSourceType,
    DetectionStatus,
    DrawingPageSourceType,
    EstimateSourceType,
    EstimateStatus,
)


class ProjectInfoOut(BaseModel):
    id: int
    seiri_no: str
    seiban: str
    panel_name: str
    analysis_status: AnalysisStatus


class DrawingPageOut(BaseModel):
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
    source_type: DrawingPageSourceType
    product_no: str | None
    source_page_no: int | None


class PanelAttributeOut(BaseModel):
    id: int
    key: str
    label: str
    value: str
    unit: str | None
    source: AttributeSource
    display_order: int


class PanelOut(BaseModel):
    id: int
    panel_no: str
    name: str
    primary_drawing_page_id: int | None
    attributes: list[PanelAttributeOut]


class DetectionOut(BaseModel):
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
    source_type: DetectionSourceType
    master_item_id: int | None
    # Phase 1.11: 引出線ラベル帯の表示位置 (BBox本体とは独立)。未設定はNone。
    leader_label_x: float | None = None
    leader_label_y: float | None = None
    # Phase 1.11: master_item_idからJOINして得たcategory。色の解決はFrontend側で
    # category→presentationとして行い、ここでは色そのものは一切返さない (要件2)。
    master_item_category: str | None = None
    # Phase 1.11: master_item_idからJOINして得たmodel。引出線ラベル「コード 型式」表示用。
    master_item_model: str | None = None
    # Phase 1.11 追加修正: master_item_idからJOINして得たcode。引出線の「コード」部分は
    # class_name(登録時点のコピー)より、こちらのライブJOIN結果を優先して使う。
    master_item_code: str | None = None


class _NormalizedBBoxIn(BaseModel):
    """0.0〜1.0正規化座標のBBoxを受け取るリクエストの共通基底 (Phase 1.6/1.7)。

    過度に小さいBBoxの誤登録・誤リサイズを防ぐため下限 (0.001 = ページ原寸の0.1%)
    を設ける (要件14/19)。ページ範囲(0.0〜1.0)を超える座標も拒否する。
    """

    bbox_x: float = Field(ge=0.0, le=1.0)
    bbox_y: float = Field(ge=0.0, le=1.0)
    bbox_w: float = Field(ge=0.001, le=1.0)
    bbox_h: float = Field(ge=0.001, le=1.0)

    @model_validator(mode="after")
    def _validate_within_page(self) -> "_NormalizedBBoxIn":
        if self.bbox_x + self.bbox_w > 1.0 + 1e-6:
            raise ValueError("bbox_x + bbox_w がページ範囲(0.0〜1.0)を超えています。")
        if self.bbox_y + self.bbox_h > 1.0 + 1e-6:
            raise ValueError("bbox_y + bbox_h がページ範囲(0.0〜1.0)を超えています。")
        return self


class ManualDetectionCreateIn(_NormalizedBBoxIn):
    """Manual BBox登録リクエスト (Phase 1.6, 要件9/12)。

    source_type/statusはクライアントから指定させず、Backend側で固定する
    (常に manual / reviewed として登録する)。
    """

    drawing_page_id: int
    master_item_id: int


class DetectionBBoxUpdateIn(_NormalizedBBoxIn):
    """BBoxリサイズ・移動・引出線ラベル位置の更新リクエスト
    (Phase 1.7, 要件23。Phase 1.11でleader_label_x/yを追加)。

    Manual/AI問わず、Detectionのbbox/引出線ラベル位置のみを更新対象とする (要件24)。
    source_type/status/class_name/master_item_id等は変更しない。

    leader_label_x/yを省略(None)した場合、既存のラベル位置は変更しない
    (Move/Resize等、ラベル位置を変えない更新のため。指示書10章:
    「BBox位置 ≠ 引出線ラベル位置」を独立して更新できるようにする)。
    """

    leader_label_x: float | None = Field(default=None, ge=0.0, le=1.0)
    leader_label_y: float | None = Field(default=None, ge=0.0, le=1.0)


class EstimateMasterItemOut(BaseModel):
    id: int
    code: str
    category: str | None
    model: str | None
    rating: str | None
    note: str | None
    total_price_a: float | None
    box_parts_price: float | None
    painting_price: float | None
    setup_a: float | None
    sheet_metal_price: float | None
    assembly_price: float | None
    inspection_price: float | None


class EstimateReferenceOut(BaseModel):
    id: int
    drawing_page_id: int
    detection_id: int | None
    panel_id: int | None
    reason: str | None


class PanelAreaOut(BaseModel):
    """盤範囲 (Panel Overlay)。仕様未確定 (data-model.md参照)。"""

    id: int
    panel_id: int
    drawing_page_id: int
    area_x: float
    area_y: float
    area_w: float
    area_h: float
    label: str | None


class EstimateItemOut(BaseModel):
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
    references: list[EstimateReferenceOut]
