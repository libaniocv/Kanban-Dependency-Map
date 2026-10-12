"""API tests using the real FastAPI module + a fake Hermes board locator.

Hermes itself is not required in CI; no test touches the user's ~/.hermes data.
"""

import importlib.util
import sqlite3
import sys
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

API = Path(__file__).resolve().parents[1] / 'dashboard' / 'plugin_api.py'


@pytest.fixture
def api(tmp_path, monkeypatch):
    db = tmp_path / 'kanban.db'
    with sqlite3.connect(db) as conn:
        conn.executescript('''
        CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, priority INTEGER,
          assignee TEXT, tenant TEXT, created_at INTEGER, completed_at INTEGER,
          block_kind TEXT, body TEXT);
        CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
        CREATE TABLE task_events (id INTEGER PRIMARY KEY);
        INSERT INTO tasks VALUES
          ('a','Setup','done',1,'planner','work',1,10,NULL,'private text'),
          ('b','Implement','running',2,'worker','work',2,NULL,NULL,'secret result');
        INSERT INTO task_links VALUES ('a','b');
        INSERT INTO task_events VALUES (42);
        ''')
    kdb = types.ModuleType('hermes_cli.kanban_db')
    kdb.DEFAULT_BOARD = 'default'
    kdb._normalize_board_slug = lambda slug: slug if slug in ('default', 'sample') else (_raise(ValueError('bad slug')))
    kdb.get_current_board = lambda: 'sample'
    kdb.board_exists = lambda slug: slug in ('sample', 'default')
    kdb.read_board_metadata = lambda slug: {'name': 'Sample Project', 'archived': False}
    kdb.kanban_db_path = lambda board: db
    kdb.list_boards = lambda include_archived=False: [{'slug': 'sample', 'name': 'Sample Project', 'archived': False}]
    parent = types.ModuleType('hermes_cli')
    parent.kanban_db = kdb
    monkeypatch.setitem(sys.modules, 'hermes_cli', parent)
    monkeypatch.setitem(sys.modules, 'hermes_cli.kanban_db', kdb)
    spec = importlib.util.spec_from_file_location('kdm_plugin_api_test', API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, db, kdb


def _raise(error):
    raise error


def test_board_listing_exposes_only_name_and_slug(api):
    mod, _, _ = api
    assert mod.list_boards() == {'boards': [{'slug': 'sample', 'name': 'Sample Project'}], 'current': 'sample'}


def test_graph_preserves_edges_and_redacts_task_bodies(api):
    mod, db, _ = api
    result = mod.read_graph('sample')
    assert result['board'] == 'sample'
    assert result['event_id'] == 42
    assert result['edges'] == [{'source': 'a', 'target': 'b'}]
    assert result['nodes'][0]['title'] == 'Setup'
    assert 'body' not in result['nodes'][0]
    assert 'private text' not in str(result)
    # Connecting through mode=ro cannot create/migrate any files or task records.
    with sqlite3.connect(db) as conn:
        assert conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0] == 2


def test_invalid_board_and_archived_board_rejected(api):
    mod, _, kdb = api
    with pytest.raises(HTTPException) as error:
        mod._board_slug('../../secret')
    assert error.value.status_code == 400
    kdb.read_board_metadata = lambda slug: {'archived': True}
    with pytest.raises(HTTPException) as error:
        mod._board_slug('sample')
    assert error.value.status_code == 404


def test_missing_database_is_not_created(api, tmp_path):
    mod, _, kdb = api
    missing = tmp_path / 'absent.db'
    kdb.kanban_db_path = lambda board: missing
    with pytest.raises(HTTPException) as error:
        mod.read_graph('sample')
    assert error.value.status_code == 404
    assert not missing.exists()


def test_graph_limits_fail_instead_of_truncating(api, monkeypatch):
    mod, _, _ = api
    monkeypatch.setattr(mod, 'MAX_NODES', 1)
    with pytest.raises(HTTPException) as error:
        mod.read_graph('sample')
    assert error.value.status_code == 413
