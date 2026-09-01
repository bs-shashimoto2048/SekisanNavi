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


class ProductSearchOut(BaseModel):
    """製番の前方一致検索結果 (Phase 1.8, 要件3)。"""

    matches: list[str]
    truncated: bool


class AdminActionErrorOut(BaseModel):
    detail: str
