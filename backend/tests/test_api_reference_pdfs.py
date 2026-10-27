"""「資料」ウィンドウ(複数PDF参照)配信API。

実業務PDFは一切使わず、一時ディレクトリに生成した最小のダミーPDFのみを使う。
"""
import pytest

from app.api.routers.reference_pdfs import get_reference_pdf_dir
from app.main import app

_DUMMY_PDF_BYTES = b"%PDF-1.4\n%%EOF\n"


@pytest.fixture()
def reference_pdf_dir(tmp_path, client):
    """資料フォルダの配置パスをテスト用の一時ディレクトリへ差し替える。

    ディレクトリ自体を作るかどうかは各テストに委ねる(作らなければ
    「フォルダが存在しない」状態を再現できる)。
    """
    directory = tmp_path / "reference-pdfs"
    app.dependency_overrides[get_reference_pdf_dir] = lambda: directory
    yield directory
    del app.dependency_overrides[get_reference_pdf_dir]


def test_list_returns_folder_exists_false_when_directory_missing(client, reference_pdf_dir):
    # reference_pdf_dir自体は作成しない。

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    assert res.json() == {"folder_exists": False, "items": []}


def test_list_returns_empty_items_when_directory_exists_but_has_no_pdfs(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    assert res.json() == {"folder_exists": True, "items": []}


def test_list_returns_multiple_valid_pdfs_sorted_by_code_then_target(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "20000_換気扇.pdf").write_bytes(_DUMMY_PDF_BYTES)
    (reference_pdf_dir / "44249_主回路銅帯_入力.pdf").write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    body = res.json()
    assert body["folder_exists"] is True
    assert body["items"] == [
        {"filename": "20000_換気扇.pdf", "code": "20000", "target": "換気扇", "valid": True},
        {
            "filename": "44249_主回路銅帯_入力.pdf",
            "code": "44249",
            "target": "主回路銅帯_入力",
            "valid": True,
        },
    ]


def test_list_marks_filename_without_underscore_as_invalid_without_crashing(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "nounderscorehere.pdf").write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    body = res.json()
    assert body["items"] == [
        {"filename": "nounderscorehere.pdf", "code": None, "target": None, "valid": False}
    ]


def test_list_is_case_insensitive_for_pdf_extension(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "44249_入力.PDF").write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    assert len(res.json()["items"]) == 1


def test_list_ignores_non_pdf_files(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "44249_入力.pdf").write_bytes(_DUMMY_PDF_BYTES)
    (reference_pdf_dir / "readme.txt").write_text("not a pdf")

    res = client.get("/api/help/reference-pdfs")

    assert res.status_code == 200
    assert len(res.json()["items"]) == 1


def test_file_served_when_pdf_exists(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "44249_入力.pdf").write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/reference-pdfs/44249_入力.pdf")

    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content == _DUMMY_PDF_BYTES


def test_file_returns_404_not_500_when_pdf_missing(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()

    res = client.get("/api/help/reference-pdfs/missing.pdf")

    assert res.status_code == 404


def test_file_returns_404_when_folder_itself_is_missing(client, reference_pdf_dir):
    # reference_pdf_dir自体は作成しない。

    res = client.get("/api/help/reference-pdfs/anything.pdf")

    assert res.status_code == 404


def test_file_endpoint_rejects_path_traversal_attempts(client, reference_pdf_dir, tmp_path):
    reference_pdf_dir.mkdir()
    (tmp_path / "outside.pdf").write_bytes(_DUMMY_PDF_BYTES)

    res = client.get("/api/help/reference-pdfs/..%2Foutside.pdf")

    assert res.status_code == 404


def test_file_endpoint_rejects_non_pdf_extension(client, reference_pdf_dir):
    reference_pdf_dir.mkdir()
    (reference_pdf_dir / "x.txt").write_text("not a pdf")

    res = client.get("/api/help/reference-pdfs/x.txt")

    assert res.status_code == 404


def test_reference_pdfs_router_has_no_write_endpoints():
    """書き込み・アップロード・削除エンドポイントが存在しないことの確認。"""
    from app.api.routers.reference_pdfs import router

    methods = {method for route in router.routes for method in route.methods}
    assert methods <= {"GET", "HEAD"}
    assert "GET" in methods
