"""積算資料PDF Help配信API (Issue #19 Phase 3)。

作業者が積算作業中に参照する「積算資料PDF」を、Git管理対象外の固定パス
(`app.config.HELP_PDF_PATH`)からread-onlyで配信する。積算コードMasterを
置き換えるものではなく、あくまでHelp/参考資料として扱う。

配信対象は常に`HELP_PDF_PATH`固定の1ファイルのみであり、リクエストから
パスを組み立てることは一切しない(任意パスをURLから直接指定できる設計には
しない)。書き込み・アップロード・削除の機能はこのrouterには無い(read-only)。
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import HELP_PDF_PATH
from app.schemas.help import HelpPdfStatusOut

router = APIRouter(prefix="/api/help", tags=["help"])


def get_help_pdf_path() -> Path:
    """積算資料PDFの配置パスを返すFastAPI依存関数。

    `app.dependency_overrides`経由でテスト用の一時パスへ差し替えられるように
    するため、エンドポイント内で`HELP_PDF_PATH`を直接参照せずこの関数を介する
    (実業務の積算資料PDFはリポジトリに含めないため、テストではダミーPDFを使う)。
    """
    return HELP_PDF_PATH


@router.get("/estimate-pdf/status", response_model=HelpPdfStatusOut)
def read_help_pdf_status(path: Path = Depends(get_help_pdf_path)) -> HelpPdfStatusOut:
    """積算資料PDFが配置されているかどうかだけを軽量に返す(ファイル自体は読まない)。

    Frontend側はHelp modalを開いた時点でまずこれを呼び、`available=false`の
    場合はPDFファイル自体をリクエストせず「資料未配置」の案内を表示する
    (modalを開くまでPDFを読み込まない、閉じた状態では実PDFファイルへの
    リクエストを発生させないための設計)。
    """
    return HelpPdfStatusOut(available=path.is_file())


@router.get("/estimate-pdf/file")
def read_help_pdf_file(path: Path = Depends(get_help_pdf_path)):
    """積算資料PDFの実ファイルを返す(read-only)。

    ファイルが存在しない場合は500等で落とさず、404 + 明確な`detail`メッセージを
    返す(Frontend側はこれを見て「資料未配置」表示へ切り替える)。
    """
    if not path.is_file():
        raise HTTPException(status_code=404, detail="積算資料PDFが配置されていません。")
    return FileResponse(str(path), media_type="application/pdf")
