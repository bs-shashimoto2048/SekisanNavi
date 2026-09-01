import sqlite3

from app.domain.models import AnalysisStatus, ProjectInfo


def get_project_info(conn: sqlite3.Connection) -> ProjectInfo | None:
    row = conn.execute(
        "SELECT id, seiri_no, seiban, panel_name, analysis_status FROM project_info LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    return ProjectInfo(
        id=row["id"],
        seiri_no=row["seiri_no"],
        seiban=row["seiban"],
        panel_name=row["panel_name"],
        analysis_status=AnalysisStatus(row["analysis_status"]),
    )
