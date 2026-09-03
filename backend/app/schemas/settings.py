"""システム設定・データソース関連のAPIスキーマ (Phase 1.5)。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class DataSourceOut(BaseModel):
    root: str
    exists: bool


class DataSourceUpdateIn(BaseModel):
    root: str = Field(min_length=1, max_length=1024)
    admin_password: str


class DataSourceTestIn(BaseModel):
    # root を省略した場合は現在保存されているルートをテストする。
    root: str | None = None
    admin_password: str


class DataSourceTestOut(BaseModel):
    success: bool
    message: str


class ProductInfoOut(BaseModel):
    product_no: str
    exists: bool
    ccv_resolved: bool


class NormalizedRectOut(BaseModel):
    x: float
    y: float
    w: float
    h: float


class PanelPreviewOut(BaseModel):
    """product_df.csvの1行相当。盤領域Overlay + 右ペイン盤パラメータ表示用 (Phase 1.8/1.9)。"""

    # 所属ページ番号。盤選択時の識別・右ペイン表示に使う (Phase 1.9, 要件19)。
    page_no: int
    ban_menno: int
    ban_no: int
    # 盤領域Overlay内ラベル・Tooltip・右ペイン表示用 (盤領域内表示の追加指示、Phase 1.9)。
    ban_meisyou: str
    ban_type: str
    # 右ペイン「盤パラメータ」表示用の物理寸法 (Phase 1.9, 要件12)。
    ban_h1: float | None = None
    ban_h2: float | None = None
    ban_w: float | None = None
    ban_d: float | None = None
    normalized_rect: NormalizedRectOut


class ProductDrawingOut(BaseModel):
    page_no: int
    # Phase 1.8で追加。左ペインのPNGサムネイル・盤領域Overlay用の項目。
    thumbnail_url: str
    drawing_type: str | None = None
    # ZUMEIそのもの (連番接尾辞を除去しない)。中央Viewerの見出し表示用。
    drawing_name: str | None = None
    panels: list[PanelPreviewOut] = []


class EstimatePanelInfoOut(BaseModel):
    """estcode_df.csv 1行相当。右ペイン上部「盤情報」表示用 (Phase 1.14指示書26章)。
    CSVの生データをそのまま渡さず、正規化済みの表示用モデルへ変換してから返す。
    PAGE列を持たない製番単位のデータのため、製番配下の全盤ぶんをまとめて返す
    (Frontend側で選択中盤のBAN_MENNO/BAN_NOと突き合わせる)。"""

    model: str | None = None
    ban_menno: int
    ban_no: int
    ban_meisyou: str | None = None
    ban_h: float | None = None
    ban_w: float | None = None
    ban_d: float | None = None
    ban_connect: str | None = None
    sort_order: int | None = None


class DetectedPreviewItemOut(BaseModel):
    """detected_df.csv (YOLO検出結果) 1行相当。中央Viewerへの検出BBoxプレビュー
    表示用 (Phase 1.12指示書11章)。CSVの生データをそのまま渡さず、正規化済みの
    表示用モデルへ変換してから返す。DBの`detections`テーブルとは無関係の
    別データ源であり、`id`はDBのDetection.idとは異なる体系
    (ページ内のYOLO_INDEXそのもの) であることに注意。"""

    id: int
    page_no: int
    class_name: str
    confidence: float
    normalized_rect: NormalizedRectOut
    # 常に "detected_csv" 固定。既存`Detection.source_type` ('ai'/'manual') とは
    # 別の体系であることを明示し、Frontend側で誤って混同しないようにする。
    source: str = "detected_csv"


class ProductSearchOut(BaseModel):
    """製番の前方一致検索結果 (Phase 1.8, 要件3)。"""

    matches: list[str]
    truncated: bool


class AdminActionErrorOut(BaseModel):
    detail: str
