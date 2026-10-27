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


class MaterialRowOut(BaseModel):
    """material.csv 1行相当 (製番の材料一覧。ページ × 材料シンボル × 構成部)。
    `material_spec`の`未記載`(記載なし)と`無し`(明示値)は意味が違うため、元の文字列のまま返す。"""

    page: str
    source_file: str = ""
    symbol_name: str = ""
    cabtype: str = ""
    component_code: str
    component_name: str = ""
    material_spec: str = ""


class SteelItemOut(BaseModel):
    """鋼材欄の1行(構成部 × 材料仕様)。`material_spec` の `未記載`/`無し` は元の文字列のまま返す。
    製番・ファイル名・実パスは含めない。"""

    symbol_name: str = ""
    cabtype: str = ""
    component_name: str = ""
    material_spec: str = ""


class SteelOutlineOut(BaseModel):
    """図面情報の「鋼材」欄用。製番の「外形図」のうち、情報量が最大の1ページぶんだけを返す(選択中の図面には連動しない)。
    status: ok / empty(データ行なし) / missing(material.csvなし) / invalid(読めない・列不足) / no_outline(外形図のデータなし)。
    `source_page` は material.csv の PAGE の表記のまま(文字列)。"""

    status: str
    source_page: str | None = None
    source_drawing_name: str | None = None
    items: list[SteelItemOut] = []


class BoxTypeSymbolMatchOut(BaseModel):
    """箱体型式解析で特定できた記号1件(1項目1行表示用)。"""

    group: str
    code: str
    meaning: str


class BoxTypeSpecConflictOut(BaseModel):
    """同一の積算対象項目に対して異なる値を主張する記号があった場合の記録。"""

    field: str
    values: list[list[str]]


class BoxTypeAnalysisOut(BaseModel):
    """箱体型式(キュービクル等)の記号解析結果 (Issue #40 追加機能)。
    `app/services/box_type_parser.py::BoxTypeAnalysis`のAPI外部契約。
    正本資料「QS-SA020-N 箱体記号一覧表 N版」に基づく解析であり、型式の記号
    だけから製作可否・正式承認・未記載の仕様を確定するものではない
    (不明・競合・曖昧な箇所は`conflicts`/`warnings`/`requires_review`に残す)。"""

    raw: str
    normalized: str
    status: str
    requires_review: bool
    primary: BoxTypeSymbolMatchOut | None = None
    aux_matches: list[BoxTypeSymbolMatchOut] = []
    segments: list[list[str]] = []
    unparsed: list[str] = []

    box_category: str | None = None
    product_category: str | None = None
    environment: str | None = None
    usage: str | None = None
    structure: str | None = None

    material: str | None = None
    coating: str | None = None
    surface_treatment: str | None = None
    base_finish: str | None = None
    certification: str | None = None
    ip55: bool = False
    processing_target: str

    custom_estimate_conditions: list[str] = []
    other_notes: list[str] = []
    notes: list[str] = []
    conflicts: list[BoxTypeSpecConflictOut] = []
    warnings: list[str] = []

    alternatives: list["BoxTypeAnalysisOut"] = []
    candidate_index: int = 0


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
    #: [追加機能: 箱体型式解析] `model`を解析した結果。`model`がNoneの場合は
    #: Noneのまま返す(解析対象が無いため)。
    box_type_analysis: BoxTypeAnalysisOut | None = None


class DesignPageOut(BaseModel):
    """design.csvの1行(対応するPDFがあるもの)。`key`は実在するPDFのファイル名(拡張子を除く)の綴りで、
    `page_label`はdesign.csvの「ページ番号」(文字列。先頭ゼロ・大文字小文字はそのまま)。
    mode: inference=推論用PNGあり(`inference_page_no`で従来の表示) / preview=表示用プレビューPNGで表示 /
    unavailable=表示用の画像が未作成。"""

    key: str
    page_label: str
    drawing_name: str = ""
    mode: str
    inference_page_no: int | None = None
    #: 元データ(product_df.csvのBAN_MENNO/BAN_NO)の「面番号/盤番号」(`1/1`の形、重複を除き出現順)。
    #: 元データに無いページ(書類ページ等)は空。再採番・加工はしない。
    ban_labels: list[str] = []


class DesignDocumentOut(BaseModel):
    """図面一覧の最上段に固定表示する書類。`key`は`0_S0`(共通製作仕様書)・`0_A1`(設計作図完了シート)のどちらかだけ
    (ページ番号ではない)。PDFが実在するものだけが返る。サムネイルは`/design-documents/{key}/image`、PDFは`/design-documents/{key}/file`。"""

    key: str
    kind: str
    label: str


class DesignPagesOut(BaseModel):
    """design.csvを基準にした図面一覧。ファイルが無い・空・不正でもエラーにはせず`status`で返す
    (例外文言・実パスは含めない)。status: ok / empty / missing / invalid"""

    status: str
    items: list[DesignPageOut] = []
    skipped_rows: int = 0
    #: 最上段に固定表示する書類(共通製作仕様書 → 設計作図完了シートの順。無いものは含まれない)。design.csvの状態とは独立。
    documents: list[DesignDocumentOut] = []


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
