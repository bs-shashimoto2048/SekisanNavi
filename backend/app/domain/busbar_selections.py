"""Main-circuit busbar coefficient choices."""

BUSBAR_ALLOWED_FACTORS: tuple[float, ...] = (0.2, 0.5, 0.6, 0.7, 0.8, 1.0, 1.4)
BUSBAR_DEFAULT_FACTOR = 1.0


def busbar_result_key(ban_menno: int, row_id: str) -> str:
    return f"busbar:{ban_menno}:{row_id}"
