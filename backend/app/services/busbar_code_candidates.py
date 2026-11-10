"""Build EstimateResult rows from explicitly selected main-circuit busbar codes."""
from __future__ import annotations

import sqlite3

from app.domain.estimate_rules import ApplicableUnit, EstimateResultCandidate, JudgmentMethod, JudgmentScope
from app.repositories.estimate_busbar_selections import list_selections
from app.repositories.master import get_master_item_by_code
from app.domain.master_categories import COPPER_BUS_CODE_CATEGORIES
from app.domain.busbar_selections import busbar_result_key


def build_busbar_candidates(conn: sqlite3.Connection, product_no: str) -> list[EstimateResultCandidate]:
    candidates: list[EstimateResultCandidate] = []
    for selection in list_selections(conn, product_no):
        master = get_master_item_by_code(conn, selection.code)
        # Missing or no-longer-supported master entries are not turned into a
        # fabricated zero-price line. The endpoint rejects these on writes; this
        # guard also handles master changes after a selection was saved.
        if master is None or master.category not in COPPER_BUS_CODE_CATEGORIES:
            continue
        candidates.append(
            EstimateResultCandidate(
                product_no=product_no,
                result_key=busbar_result_key(selection.ban_menno, selection.row_id),
                master_item_id=master.id,
                code=master.code,
                quantity=1,
                applicable_unit=ApplicableUnit.FACE,
                initial_factor=selection.factor,
                judgment_method=JudgmentMethod.DESIGN_DATA,
                judgment_scope=JudgmentScope.DESIGN_DATA,
                # The UI selection is face-level, not tied to an individual
                # cabinet. Keep it product-scoped in target filtering and state
                # the face in the reason instead of assigning it to a panel.
                target_panel_ban_menno=None,
                target_panel_ban_no=None,
                target_drawing_page_id=None,
                judgment_reason=f"図面情報で選択: 面{selection.ban_menno} 主回路銅帯 ({selection.row_id})",
                source_rule_id=None,
                unit_price=master.total_price_a,
                # Current master schema has no authoritative busbar labor base.
                # Keep NULL so the UI displays '—' until a unit_labor value is
                # provided by an established calculation source.
                unit_labor=None,
            )
        )
    return candidates
