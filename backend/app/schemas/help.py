"""積算資料PDF Help APIのスキーマ (Issue #19 Phase 3)。"""
from pydantic import BaseModel


class HelpPdfStatusOut(BaseModel):
    """積算資料PDFの配置状況。ファイルの中身は一切含まず、存在有無のみを
    軽量に返す (Frontend側がmodalを開くまで実PDFファイルを要求しないために使う)。"""

    available: bool
