import sqlite3

from fastapi import APIRouter, Depends

from app.api.deps import get_db
from app.repositories.estimates import list_estimate_items
from app.schemas.common import EstimateItemOut

router = APIRouter(prefix="/api/estimate-items", tags=["estimates"])


@router.get("", response_model=list[EstimateItemOut])
def read_estimate_items(conn: sqlite3.Connection = Depends(get_db)) -> list[EstimateItemOut]:
    items = list_estimate_items(conn)
    return [
        EstimateItemOut(
            id=i.id,
            code=i.code,
            category=i.category,
            item_name=i.item_name,
            model=i.model,
            rating=i.rating,
            quantity=i.quantity,
            unit=i.unit,
            source_type=i.source_type,
            confidence=i.confidence,
            status=i.status,
            references=[r.__dict__ for r in i.references],
        )
        for i in items
    ]
