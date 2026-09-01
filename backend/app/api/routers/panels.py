import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_db
from app.repositories.panels import get_panel, list_panels
from app.schemas.common import PanelOut

router = APIRouter(prefix="/api/panels", tags=["panels"])


def _to_out(panel) -> PanelOut:
    return PanelOut(
        id=panel.id,
        panel_no=panel.panel_no,
        name=panel.name,
        primary_drawing_page_id=panel.primary_drawing_page_id,
        attributes=[a.__dict__ for a in panel.attributes],
    )


@router.get("", response_model=list[PanelOut])
def read_panels(conn: sqlite3.Connection = Depends(get_db)) -> list[PanelOut]:
    return [_to_out(p) for p in list_panels(conn)]


@router.get("/{panel_id}", response_model=PanelOut)
def read_panel(panel_id: int, conn: sqlite3.Connection = Depends(get_db)) -> PanelOut:
    panel = get_panel(conn, panel_id)
    if panel is None:
        raise HTTPException(status_code=404, detail="panel not found")
    return _to_out(panel)
