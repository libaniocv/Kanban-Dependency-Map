"""Read-only graph API for the Hermes web dashboard.

GET /api/plugins/kanban-dependency-map/boards
GET /api/plugins/kanban-dependency-map/graph?board=<slug>

Uses the canonical Hermes board locator, and opens the database with SQLite
``mode=ro`` to guarantee that graph requests never initialize, migrate, or
mutate the Kanban scheduler's state.
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from hermes_cli import kanban_db

router = APIRouter()

# Do not silently return a partial graph (partial dependencies are misleading).
MAX_NODES = 12000
MAX_EDGES = 60000


def _board_slug(board: Optional[str]) -> str:
    if not board:
        board = kanban_db.get_current_board()
    try:
        slug = kanban_db._normalize_board_slug(board)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid board slug") from exc
    if not slug:
        raise HTTPException(status_code=400, detail="Invalid board slug")
    if slug != kanban_db.DEFAULT_BOARD and not kanban_db.board_exists(slug):
        raise HTTPException(status_code=404, detail="Board not found")
    if kanban_db.read_board_metadata(slug).get("archived"):
        raise HTTPException(status_code=404, detail="Board archived")
    return slug


def _db_file(slug: str) -> Path:
    db_path = Path(kanban_db.kanban_db_path(board=slug))
    if not db_path.is_file():
        raise HTTPException(status_code=404, detail="Board database not initialized; run hermes kanban init")
    return db_path


def read_graph(slug: str) -> dict[str, Any]:
    """Read tasks and edges in one consistent, read-only SQLite transaction."""
    path = _db_file(slug)
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=10)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only = ON")
            conn.execute("PRAGMA busy_timeout = 10000")
            conn.execute("BEGIN")
            count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            if count > MAX_NODES:
                raise HTTPException(status_code=413, detail=f"Board has more than {MAX_NODES} tasks; graph limit reached")
            # SELECT explicit columns: do not disclose bodies/results/workspaces/credentials.
            nodes = [dict(row) for row in conn.execute(
                "SELECT id, title, status, priority, assignee, tenant, created_at, "
                "completed_at, block_kind FROM tasks ORDER BY created_at, id"
            )]
            edge_count = conn.execute("SELECT COUNT(*) FROM task_links").fetchone()[0]
            if edge_count > MAX_EDGES:
                raise HTTPException(status_code=413, detail=f"Board has more than {MAX_EDGES} links; graph limit reached")
            edges = [{"source": row[0], "target": row[1]} for row in conn.execute(
                "SELECT l.parent_id, l.child_id FROM task_links l "
                "JOIN tasks p ON p.id = l.parent_id "
                "JOIN tasks c ON c.id = l.child_id "
                "ORDER BY l.parent_id, l.child_id"
            )]
            event_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM task_events").fetchone()[0]
            conn.execute("COMMIT")
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="Kanban database unavailable or incompatible") from exc
    meta = kanban_db.read_board_metadata(slug)
    return {
        "board": slug,
        "board_name": meta.get("name") or slug,
        "nodes": nodes,
        "edges": edges,
        "event_id": int(event_id),
        "fetched_at": int(time.time()),
    }


@router.get("/boards")
def list_boards():
    """Return minimal metadata; no filesystem paths or project secrets."""
    boards = []
    for entry in kanban_db.list_boards(include_archived=False):
        if entry.get("archived"):
            continue
        boards.append({"slug": entry["slug"], "name": entry.get("name") or entry["slug"]})
    return {"boards": boards, "current": kanban_db.get_current_board()}


@router.get("/graph")
def graph(board: Optional[str] = Query(None, max_length=128)):
    return read_graph(_board_slug(board))
