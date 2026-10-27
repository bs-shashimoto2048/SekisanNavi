"""「資料」ウィンドウ(複数PDF参照)配信API。

`app.config.REFERENCE_PDF_DIR`配下のPDFのみをread-onlyで一覧・配信する
(旧「積算資料PDF Help」単一固定ファイルAPIは資料機能の一本化によりこちらへ
統合し廃止した)。

配信エンドポイントはリクエストのファイル名を`app.services.reference_pdfs.
resolve_reference_pdf_path`で検証してからのみ読む(任意パスをURLから直接
指定できる設計にしない。指定フォルダ外のファイルは読めない)。
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import REFERENCE_PDF_DIR
from app.schemas.reference_pdfs import ReferencePdfItemOut, ReferencePdfListOut
from app.services.reference_pdfs import list_reference_pdfs, resolve_reference_pdf_path

router = APIRouter(prefix="/api/help/reference-pdfs", tags=["help"])


def get_reference_pdf_dir() -> Path:
    """資料フォルダの配置パスを返すFastAPI依存関数。

    `app.dependency_overrides`経由でテスト用の一時フォルダへ差し替えられる
    ようにするため、エンドポイント内で`REFERENCE_PDF_DIR`を直接参照しない。
    """
    return REFERENCE_PDF_DIR


@router.get("", response_model=ReferencePdfListOut)
def read_reference_pdfs(directory: Path = Depends(get_reference_pdf_dir)) -> ReferencePdfListOut:
    """資料フォルダ直下のPDF一覧。フォルダが存在しない場合も例外にせず
    `folder_exists=False`を返す(Frontend側がポップアップ内で案内を出す)。"""
    result = list_reference_pdfs(directory)
    return ReferencePdfListOut(
        folder_exists=result.folder_exists,
        items=[ReferencePdfItemOut(**item.__dict__) for item in result.items],
    )


@router.get("/{filename}")
def read_reference_pdf_file(
    filename: str, directory: Path = Depends(get_reference_pdf_dir)
):
    """資料フォルダ配下の1PDFを配信する(read-only)。

    `filename`は`resolve_reference_pdf_path`で検証し、パス区切り文字・
    親ディレクトリ参照・`.pdf`以外の拡張子・フォルダ外のファイルはすべて
    404として扱う(任意ファイル配信を許さない)。
    """
    resolved = resolve_reference_pdf_path(directory, filename)
    if resolved is None:
        raise HTTPException(status_code=404, detail="指定されたPDFが見つかりません。")
    return FileResponse(str(resolved), media_type="application/pdf")
