"""積算資料PDF Help配信API (Issue #19 Phase 3)。

実業務の積算資料PDFはリポジトリに含めないため、いずれのテストも一時ディレクトリに
生成した最小のダミーPDFファイルのみを使う(実資料は一切使用・作成しない)。
"""
import pytest

from app.api.routers.help_pdf import get_help_pdf_path
from app.main import app

# 中身の妥当性(PDF構造そのもの)は検証対象外のため、配信経路確認に十分な
# 最小限のバイト列のみを使う。
_DUMMY_PDF_BYTES = b"%PDF-1.4\n%%EOF\n"


@pytest.fixture()
def help_pdf_path(tmp_path, client):
    """Help PDFの配置パスをテスト用の一時パスへ差し替える。

    ファイルを実際に書き込むかどうかは各テストに委ねる(書き込まなければ
    「未配置」の状態を再現できる)。
    """
    path = tmp_path / "estimate-help.pdf"
    app.dependency_overrides[get_help_pdf_path] = lambda: path
    yield path
    del app.dependency_overrides[get_help_pdf_path]


def test_status_true_when_pdf_exists(client, help_pdf_path):
    help_pdf_path.write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/estimate-pdf/status")

    assert res.status_code == 200
    assert res.json() == {"available": True}


def test_status_false_when_pdf_missing(client, help_pdf_path):
    # help_pdf_path自体は作成しない (未配置の状態)。

    res = client.get("/api/help/estimate-pdf/status")

    assert res.status_code == 200
    assert res.json() == {"available": False}


def test_status_does_not_read_file_contents(client, help_pdf_path, monkeypatch):
    """存在確認のみでファイル内容は読まないこと(`Path.is_file`のみを使う設計の確認)。"""
    help_pdf_path.write_bytes(_DUMMY_PDF_BYTES)

    from app.api.routers import help_pdf as help_pdf_module

    def _fail_if_opened(*args, **kwargs):
        raise AssertionError("status確認でファイルを開くべきではない")

    monkeypatch.setattr(help_pdf_module.Path, "open", _fail_if_opened, raising=False)

    res = client.get("/api/help/estimate-pdf/status")
    assert res.status_code == 200
    assert res.json() == {"available": True}


def test_file_served_when_pdf_exists(client, help_pdf_path):
    help_pdf_path.write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/estimate-pdf/file")

    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content == _DUMMY_PDF_BYTES


def test_file_returns_404_not_500_when_pdf_missing(client, help_pdf_path):
    # help_pdf_path自体は作成しない (未配置の状態)。

    res = client.get("/api/help/estimate-pdf/file")

    assert res.status_code == 404
    assert "配置されていません" in res.json()["detail"]


def test_file_endpoint_ignores_client_supplied_path(client, help_pdf_path):
    """任意パスをURLから直接指定できる設計にしないことの確認。

    パス/クエリでファイルパスを渡す仕組み自体が存在しないため、それらしい
    クエリを付けても無視され、常に固定パス(`HELP_PDF_PATH`相当)が使われる。
    """
    help_pdf_path.write_bytes(_DUMMY_PDF_BYTES)

    res = client.get(
        "/api/help/estimate-pdf/file",
        params={"path": "/etc/passwd", "file": "../../../etc/passwd"},
    )

    assert res.status_code == 200
    assert res.content == _DUMMY_PDF_BYTES


def test_help_router_has_no_write_endpoints():
    """書き込み・アップロード・削除エンドポイントが存在しないことの確認。"""
    from app.api.routers.help_pdf import router

    methods = {method for route in router.routes for method in route.methods}
    assert methods <= {"GET", "HEAD"}
    assert "GET" in methods
