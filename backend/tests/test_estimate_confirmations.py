"""積算確定snapshot (Issue #4 Phase B-1) のテスト。

設計は `docs/decision-snapshot-design.md` を参照。Phase B-1では確定操作を
呼び出すAPI・読み出しAPIを追加しないため、`save_confirmation()`を
repository層から直接呼び出し、結果は`estimate_confirmations`/
`estimate_confirmation_items`テーブルへの直接SQLで検証する
(既存の`test_decision_events.py`と同じ手法)。
"""
import sqlite3

import pytest

from app.db.connection import get_connection
from app.db.master_importer import import_master_excel
from app.db.migrate import run_migrations
from app.db.seed import seed
from app.domain.models import (
    DetectionSourceType,
    DetectionStatus,
    EstimateConfirmationItemInput,
    EstimateTargetType,
)
from app.repositories.estimate_confirmations import save_confirmation


def _confirmations(db_path) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM estimate_confirmations ORDER BY id").fetchall()
    conn.close()
    return rows


def _items_for(db_path, confirmation_id: int) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM estimate_confirmation_items WHERE confirmation_id = ? ORDER BY id",
        (confirmation_id,),
    ).fetchall()
    conn.close()
    return rows


def _panel_item(**overrides) -> EstimateConfirmationItemInput:
    base = dict(
        target_id="panel:1:1",
        target_type=EstimateTargetType.PANEL,
        code="11002",
        source_type=DetectionSourceType.MANUAL,
        status=DetectionStatus.REVIEWED,
        detection_id=1,
        drawing_page_id=1,
        ban_menno=1,
        ban_no=1,
        panel_name="高圧受電盤",
        master_item_id=1,
        category="箱･単独",
        model="OS2-9",
        rating=None,
        quantity=1,
        unit_price=12000.0,
        amount=12000.0,
        bbox_x=0.1,
        bbox_y=0.1,
        bbox_w=0.05,
        bbox_h=0.05,
        page_no=1,
    )
    base.update(overrides)
    return EstimateConfirmationItemInput(**base)


# --- migration ---


def test_migration_creates_estimate_confirmation_tables(db_path):
    conn = sqlite3.connect(db_path)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    conn.close()
    assert "estimate_confirmations" in tables
    assert "estimate_confirmation_items" in tables


# --- save_confirmation: 基本 ---


def test_save_confirmation_creates_header_and_item_rows(db_path):
    with get_connection(db_path) as conn:
        result = save_confirmation(conn, product_no="A1GV2421", items=[_panel_item()])

    assert result.product_no == "A1GV2421"
    assert result.confirmed_at
    assert len(result.items) == 1

    headers = _confirmations(db_path)
    assert len(headers) == 1
    assert headers[0]["product_no"] == "A1GV2421"
    assert headers[0]["confirmed_at"]

    items = _items_for(db_path, headers[0]["id"])
    assert len(items) == 1
    item = items[0]
    assert item["target_id"] == "panel:1:1"
    assert item["target_type"] == "panel"
    assert item["ban_menno"] == 1
    assert item["ban_no"] == 1
    assert item["panel_name"] == "高圧受電盤"
    assert item["code"] == "11002"
    assert item["category"] == "箱･単独"
    assert item["model"] == "OS2-9"
    assert item["source_type"] == "manual"
    assert item["status"] == "reviewed"
    assert item["quantity"] == 1
    assert item["unit_price"] == 12000.0
    assert item["amount"] == 12000.0
    assert item["bbox_x"] == 0.1
    assert item["page_no"] == 1


def test_save_confirmation_with_multiple_items_preserves_each_row_independently(db_path):
    items = [
        _panel_item(detection_id=1, code="11002", target_id="panel:1:1", ban_menno=1, ban_no=1),
        _panel_item(
            detection_id=2,
            code="18311",
            target_id="product",
            target_type=EstimateTargetType.PRODUCT,
            ban_menno=None,
            ban_no=None,
            panel_name=None,
            unit_price=None,
            amount=None,
        ),
    ]
    with get_connection(db_path) as conn:
        result = save_confirmation(conn, product_no="A1GV2421", items=items)

    assert len(result.items) == 2
    stored = _items_for(db_path, result.id)
    assert [row["code"] for row in stored] == ["11002", "18311"]
    assert stored[1]["target_type"] == "product"
    # unit_price/amount不明はNULLのまま(0円へ捏造しない。既存の積算集約と同じ規則)
    assert stored[1]["unit_price"] is None
    assert stored[1]["amount"] is None


def test_save_confirmation_with_no_items_still_creates_header_only(db_path):
    with get_connection(db_path) as conn:
        result = save_confirmation(conn, product_no="A1GV2421", items=[])

    assert result.items == []
    headers = _confirmations(db_path)
    assert len(headers) == 1
    assert _items_for(db_path, headers[0]["id"]) == []


# --- append-only: 再確定は上書きせず新規行を追加する ---


def test_saving_twice_creates_two_independent_confirmations_without_overwriting(db_path):
    with get_connection(db_path) as conn:
        first = save_confirmation(conn, product_no="A1GV2421", items=[_panel_item(code="11002")])
    with get_connection(db_path) as conn:
        second = save_confirmation(conn, product_no="A1GV2421", items=[_panel_item(code="18311")])

    assert first.id != second.id
    headers = _confirmations(db_path)
    assert len(headers) == 2
    assert {h["id"] for h in headers} == {first.id, second.id}

    # 1回目のitemsは2回目の保存によって書き換えられていない
    first_items = _items_for(db_path, first.id)
    second_items = _items_for(db_path, second.id)
    assert [row["code"] for row in first_items] == ["11002"]
    assert [row["code"] for row in second_items] == ["18311"]


# --- transaction: header/itemsが中途半端に残らないこと ---


def test_rollback_removes_both_header_and_items_together(db_path):
    class _DeliberateFailure(Exception):
        pass

    with pytest.raises(_DeliberateFailure):
        with get_connection(db_path) as conn:
            save_confirmation(conn, product_no="A1GV2421", items=[_panel_item()])
            # get_connection()のwithブロックを異常終了させ、commitではなく
            # rollbackが起きることを強制する(test_decision_events.pyと同じ手法)。
            raise _DeliberateFailure()

    assert _confirmations(db_path) == []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    remaining_items = conn.execute("SELECT * FROM estimate_confirmation_items").fetchall()
    conn.close()
    assert remaining_items == []


# --- FK方針: confirmation_idは強制、detection_id/drawing_page_idは強制しない ---


def test_confirmation_id_foreign_key_is_enforced(db_path):
    """`confirmation_id`は実在するheader行を指す必要がある(設計6章: header行が
    先にINSERTされる設計のためFKを有効化している)。存在しないconfirmation_id
    への直接INSERTはFK違反で失敗することを確認する。"""
    with get_connection(db_path) as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO estimate_confirmation_items
                    (confirmation_id, target_id, target_type, code, source_type, status)
                VALUES (?, 'product', 'product', '11002', 'manual', 'reviewed')
                """,
                (999999,),
            )


def test_confirmation_item_survives_detection_deletion(db_path):
    """detection_idは意図的にFK制約を持たないため、確定後に参照先のDetectionが
    削除されてもsnapshot行自体は影響を受けない(設計6章、decision_eventsと
    同じ歴史的参照の考え方)。"""
    from app.repositories.detections import create_manual_detection, delete_detection

    with get_connection(db_path) as conn:
        page_id = conn.execute("SELECT id FROM drawing_pages WHERE page_no = 16").fetchone()["id"]
        master_item_id = conn.execute("SELECT id FROM estimate_master_items LIMIT 1").fetchone()["id"]

    with get_connection(db_path) as conn:
        detection = create_manual_detection(
            conn,
            drawing_page_id=page_id,
            master_item_id=master_item_id,
            class_name="TEST",
            bbox_x=0.1,
            bbox_y=0.1,
            bbox_w=0.05,
            bbox_h=0.05,
        )

    with get_connection(db_path) as conn:
        result = save_confirmation(
            conn,
            product_no="A1GV2421",
            items=[_panel_item(detection_id=detection.id, drawing_page_id=page_id, master_item_id=master_item_id)],
        )

    with get_connection(db_path) as conn:
        assert delete_detection(conn, detection.id) is True

    # Detection本体は消えているが、確定snapshotの行はdetection_idを保持したまま残る
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    remaining_detection = conn.execute(
        "SELECT * FROM detections WHERE id = ?", (detection.id,)
    ).fetchone()
    conn.close()
    assert remaining_detection is None

    items = _items_for(db_path, result.id)
    assert len(items) == 1
    assert items[0]["detection_id"] == detection.id


# --- 再現性: Master再UPSERT後もsnapshotの値自体は変化しない ---


def test_confirmation_values_are_frozen_even_after_master_item_price_changes(db_path):
    with get_connection(db_path) as conn:
        master_row = conn.execute(
            "SELECT id, code, total_price_a FROM estimate_master_items LIMIT 1"
        ).fetchone()
    master_item_id = master_row["id"]
    original_price = master_row["total_price_a"]

    with get_connection(db_path) as conn:
        result = save_confirmation(
            conn,
            product_no="A1GV2421",
            items=[
                _panel_item(
                    master_item_id=master_item_id,
                    code=master_row["code"],
                    unit_price=original_price,
                    amount=original_price,
                )
            ],
        )

    # Master Excel再インポート相当: 既存コードの価格が事後的に上書きされる状況を再現する
    new_price = (original_price or 0) + 999999
    with get_connection(db_path) as conn:
        conn.execute(
            "UPDATE estimate_master_items SET total_price_a = ? WHERE id = ?",
            (new_price, master_item_id),
        )

    # 保存済みのconfirmation行自体は変化しない(設計7章)
    items = _items_for(db_path, result.id)
    assert items[0]["unit_price"] == original_price
    assert items[0]["amount"] == original_price
    assert items[0]["unit_price"] != new_price
