import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_db
from app.repositories.project import get_project_info
from app.schemas.common import ProjectInfoOut

router = APIRouter(prefix="/api/project", tags=["project"])


@router.get("", response_model=ProjectInfoOut)
def read_project_info(conn: sqlite3.Connection = Depends(get_db)) -> ProjectInfoOut:
    info = get_project_info(conn)
    if info is None:
        raise HTTPException(status_code=404, detail="project_info not found")
    return ProjectInfoOut(**info.__dict__)
