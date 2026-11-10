"""Persist the selected main-circuit busbar code and factor per UI row."""


def apply(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS estimate_busbar_selections (
            product_no TEXT NOT NULL,
            ban_menno INTEGER NOT NULL,
            row_id TEXT NOT NULL,
            code TEXT NOT NULL,
            factor REAL NOT NULL DEFAULT 1.0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (product_no, ban_menno, row_id)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_estimate_busbar_selections_product "
        "ON estimate_busbar_selections(product_no)"
    )
