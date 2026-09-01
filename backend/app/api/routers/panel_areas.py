import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db
from app.repositories.panel_areas import list_panel_areas
from app.schemas.common import PanelAreaOut

router = APIRouter(prefix="/api/panel-areas", tags=["panel-areas"])


@router.get("", response_model=list[PanelAreaOut])
def read_panel_areas(
    drawing_page_id: int | None = Query(default=None),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[PanelAreaOut]:
    return [PanelAreaOut(**a.__dict__) for a in list_panel_areas(conn, drawing_page_id)]
