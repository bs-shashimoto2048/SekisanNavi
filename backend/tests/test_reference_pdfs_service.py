"""`app.services.reference_pdfs`のテスト(「資料」ポップアップ機能)。

DBは一切使わない。すべて`tmp_path`に合成した一時フォルダ/ファイルのみで
検証する(実業務PDFは使用・作成しない)。
"""
from app.services.reference_pdfs import (
    list_reference_pdfs,
    parse_reference_pdf_filename,
    resolve_reference_pdf_path,
)


class TestParseFilename:
    def test_splits_at_first_underscore(self):
        assert parse_reference_pdf_filename("44249_主回路銅帯_入力.pdf") == ("44249", "主回路銅帯_入力")

    def test_case_insensitive_extension(self):
        assert parse_reference_pdf_filename("44249_入力.PDF") == ("44249", "入力")
        assert parse_reference_pdf_filename("44249_入力.Pdf") == ("44249", "入力")

    def test_returns_none_none_when_no_underscore(self):
        assert parse_reference_pdf_filename("44249.pdf") == (None, None)

    def test_returns_none_none_when_code_is_empty(self):
        assert parse_reference_pdf_filename("_入力.pdf") == (None, None)

    def test_returns_none_none_when_target_is_empty(self):
        assert parse_reference_pdf_filename("44249_.pdf") == (None, None)

    def test_returns_none_none_for_non_pdf_extension(self):
        assert parse_reference_pdf_filename("44249_入力.txt") == (None, None)

    def test_preserves_additional_underscores_in_target(self):
        code, target = parse_reference_pdf_filename("18302_側面扉_追加_備考.pdf")
        assert code == "18302"
        assert target == "側面扉_追加_備考"


class TestListReferencePdfs:
    def test_folder_does_not_exist(self, tmp_path):
        missing = tmp_path / "does_not_exist"
        result = list_reference_pdfs(missing)
        assert result.folder_exists is False
        assert result.items == []

    def test_folder_exists_but_empty(self, tmp_path):
        result = list_reference_pdfs(tmp_path)
        assert result.folder_exists is True
        assert result.items == []

    def test_lists_valid_pdfs_case_insensitive_extension(self, tmp_path):
        (tmp_path / "44249_主回路銅帯_入力.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "18302_側面扉.PDF").write_bytes(b"%PDF-1.4")
        result = list_reference_pdfs(tmp_path)
        assert result.folder_exists is True
        filenames = {item.filename for item in result.items}
        assert filenames == {"44249_主回路銅帯_入力.pdf", "18302_側面扉.PDF"}
        assert all(item.valid for item in result.items)

    def test_ignores_non_pdf_files_and_subdirectories(self, tmp_path):
        (tmp_path / "44249_入力.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "readme.txt").write_text("not a pdf")
        (tmp_path / "subdir").mkdir()
        (tmp_path / "subdir" / "99999_サブ.pdf").write_bytes(b"%PDF-1.4")
        result = list_reference_pdfs(tmp_path)
        filenames = {item.filename for item in result.items}
        assert filenames == {"44249_入力.pdf"}

    def test_malformed_filename_without_underscore_is_marked_invalid_not_skipped(self, tmp_path):
        (tmp_path / "no_underscore_name_but_only_one_word.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "plainname.pdf").write_bytes(b"%PDF-1.4")
        result = list_reference_pdfs(tmp_path)
        plain = next(item for item in result.items if item.filename == "plainname.pdf")
        assert plain.valid is False
        assert plain.code is None
        assert plain.target is None

    def test_sorts_valid_items_by_code_then_target(self, tmp_path):
        (tmp_path / "20000_b.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "10000_b.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "10000_a.pdf").write_bytes(b"%PDF-1.4")
        result = list_reference_pdfs(tmp_path)
        assert [item.filename for item in result.items] == [
            "10000_a.pdf",
            "10000_b.pdf",
            "20000_b.pdf",
        ]

    def test_invalid_items_are_listed_after_valid_items_sorted_by_filename(self, tmp_path):
        (tmp_path / "99999_z.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "bbb.pdf").write_bytes(b"%PDF-1.4")
        (tmp_path / "aaa.pdf").write_bytes(b"%PDF-1.4")
        result = list_reference_pdfs(tmp_path)
        assert [item.filename for item in result.items] == ["99999_z.pdf", "aaa.pdf", "bbb.pdf"]


class TestResolveReferencePdfPath:
    def test_resolves_an_existing_file(self, tmp_path):
        target = tmp_path / "44249_入力.pdf"
        target.write_bytes(b"%PDF-1.4")
        resolved = resolve_reference_pdf_path(tmp_path, "44249_入力.pdf")
        assert resolved == target

    def test_returns_none_when_file_does_not_exist(self, tmp_path):
        assert resolve_reference_pdf_path(tmp_path, "missing.pdf") is None

    def test_rejects_path_traversal(self, tmp_path):
        (tmp_path.parent / "outside.pdf").write_bytes(b"%PDF-1.4")
        assert resolve_reference_pdf_path(tmp_path, "../outside.pdf") is None

    def test_rejects_absolute_path_like_strings(self, tmp_path):
        assert resolve_reference_pdf_path(tmp_path, "/etc/passwd") is None

    def test_rejects_embedded_path_separators(self, tmp_path):
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "x.pdf").write_bytes(b"%PDF-1.4")
        assert resolve_reference_pdf_path(tmp_path, "sub/x.pdf") is None
        assert resolve_reference_pdf_path(tmp_path, "sub\\x.pdf") is None

    def test_rejects_non_pdf_extension(self, tmp_path):
        (tmp_path / "x.txt").write_text("not a pdf")
        assert resolve_reference_pdf_path(tmp_path, "x.txt") is None

    def test_rejects_empty_filename(self, tmp_path):
        assert resolve_reference_pdf_path(tmp_path, "") is None

    def test_accepts_case_insensitive_pdf_extension(self, tmp_path):
        target = tmp_path / "x.PDF"
        target.write_bytes(b"%PDF-1.4")
        assert resolve_reference_pdf_path(tmp_path, "x.PDF") == target
