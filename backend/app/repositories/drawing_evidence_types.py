"""図面情報マスタ (Issue #40 Phase 2、10-1章) の最小book-keeping。

Phase 2では実データを1件も投入しない(Issue #40指示: 個別コードの大量実装は
Phase 3以降)。ここではテスト・将来の管理画面/投入スクリプトから使う
CRUDの基礎のみを用意する。
"""
from __future__ import annotations

import sqlite3

from app.domain.estimate_rules import DrawingEvidenceType, EvidenceUsage, JudgmentScope

_COLUMNS = """
    id, key, display_name, category, usage, default_judgment_scope,
    description, enabled
"""


def _row_to_evidence_type(row: sqlite3.Row) -> DrawingEvidenceType:
    return DrawingEvidenceType(
        id=row["id"],
        key=row["key"],
        display_name=row["display_name"],
        category=row["category"],
        usage=EvidenceUsage(row["usage"]),
        default_judgment_scope=JudgmentScope(row["default_judgment_scope"]),
        description=row["description"],
        enabled=bool(row["enabled"]),
    )


def list_evidence_types(
    conn: sqlite3.Connection, *, enabled_only: bool = False
) -> list[DrawingEvidenceType]:
    sql = f"SELECT {_COLUMNS} FROM drawing_evidence_types"
    if enabled_only:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id"
    rows = conn.execute(sql).fetchall()
    return [_row_to_evidence_type(r) for r in rows]


def get_evidence_type_by_key(conn: sqlite3.Connection, key: str) -> DrawingEvidenceType | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM drawing_evidence_types WHERE key = ?", (key,)
    ).fetchone()
    return _row_to_evidence_type(row) if row else None


def create_evidence_type(
    conn: sqlite3.Connection,
    *,
    key: str,
    display_name: str,
    category: str | None,
    usage: EvidenceUsage,
    default_judgment_scope: JudgmentScope,
    description: str | None,
    enabled: bool = True,
) -> DrawingEvidenceType:
    conn.execute(
        """
        INSERT INTO drawing_evidence_types
            (key, display_name, category, usage, default_judgment_scope, description, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (key, display_name, category, usage.value, default_judgment_scope.value, description, int(enabled)),
    )
    result = get_evidence_type_by_key(conn, key)
    assert result is not None
    return result


__all__ = [
    "list_evidence_types",
    "get_evidence_type_by_key",
    "create_evidence_type",
]
