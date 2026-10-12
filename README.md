# Kanban Dependency Map for Hermes Agent

Interactive, **read-only** dependency graph for the [NousResearch Hermes Agent](https://github.com/NousResearch/hermes-agent) **web dashboard** (`hermes dashboard`). Select any local Kanban board and see which task must finish before another one can run.

- 🗺️ **Dependency flowchart** with arrows from prerequisites to dependent tasks.
- 🔀 **Two directions**, left-to-right or top-to-bottom; parallel tasks appear at the same graph level.
- 🔎 **Filter/search** by title, task ID, status, profile, and tenant.
- 🧭 **Zoom, pan and fit** to viewport; click a task to inspect direct dependencies and highlight its upstream/downstream chains.
- 🔄 **Auto-refresh every 8 seconds** while the tab is visible, plus a manual Refresh button.
- 🔒 **Read-only backend:** opens the existing Hermes SQLite board using `mode=ro`; never creates or changes tasks, statuses, links or schedules. No external services or CDNs.

> **Compatibility:** The **web dashboard** SDK (`hermes dashboard`). Hermes **Desktop** uses a different plugin SDK and is not supported by this package. Requires a Hermes version with dashboard UI plugins, Kanban multi-board support and a `task_links` table, as described in the current upstream documentation. Older builds might lack these capabilities.

## Install

### Option A — install directly from GitHub (recommended)

Run this on the machine where Hermes is installed:

```bash
hermes plugins install libaniocv/Kanban-Dependency-Map --enable
```

The repository includes the `plugin.yaml` and `__init__.py` required for native plugin discovery, as well as the separate `dashboard/` extension. The plugin has no model tools or hooks to enable, but the package can still be managed via `hermes plugins`.

Restart `hermes dashboard` after installation so the extension manifests are reloaded. In your browser, open **Dependency Map** from the Hermes sidebar.

### Option B — manual installation

```bash
git clone https://github.com/libaniocv/Kanban-Dependency-Map.git \
  ~/.hermes/plugins/kanban-dependency-map
```

If you use a custom `HERMES_HOME`, install under `$HERMES_HOME/plugins/kanban-dependency-map` instead. Then restart the dashboard. When manually installed, you can optionally run:

```bash
hermes plugins enable kanban-dependency-map
```

### Initialize a board, if needed

```bash
hermes kanban init
hermes dashboard
```

The plugin does not automatically create boards or databases. If you have several boards, select one in the **Board** control at the top of the page. The app only reads local boards known to your Hermes installation.

## How to use

1. Start `hermes dashboard`, open **Dependency Map** on the left and choose a **Board**.
2. Follow each arrow **prerequisite → dependent task**. Cards show status color, task ID and assigned Hermes profile.
3. Drag the empty canvas to move around; use your mouse wheel or the `+`/`−` buttons to zoom; click **Fit** to center the graph.
4. Click a task to see direct parents and children, plus the number of upstream and downstream tasks. Use **Graph scope** to limit the map to its direct neighbors or complete connected chain.
5. Use the search, status, profile and tenant filters to focus on a subset. Links remain visible only when both endpoint tasks pass the filters. **Include archived** reveals archived tasks.
6. Choose **Open Kanban** to modify tasks or dependencies in Hermes's original Kanban interface. This plugin never changes board data.

### Reading the dependency direction

```text
Design (#A) ────────┬──► Implement API (#B) ───┐
                   └──► Implement UI  (#C) ───┴──► Integration tests (#D)
```

Both B and C require A to finish; D requires B and C. The graphic is based on Hermes's `task_links` (`parent_id → child_id`). It does **not** infer semantic dependencies from task descriptions or GitHub issues. Nodes without links still appear as independent tasks.

### Statuses

Known statuses are color coded: `done` green, `running` blue, `blocked` red, `ready` cyan, `todo` amber, `triage` violet and `archived` gray. Unknown/custom statuses use a neutral violet fallback. A board containing a link cycle is displayed with a warning; the layout won't hang.

## Security and limitations

- The graph API exposes only the minimal task fields needed for display. Task bodies, run logs, results, filesystem paths and environment variables are **not** included.
- Requests use the dashboard plugin API's normal authentication middleware. **Do not expose Hermes's dashboard to an untrusted network**, particularly when running third-party plugins.
- All database access uses SQLite **read-only mode** with a consistent read transaction. The plugin does not use an LLM or send data off-host.
- To avoid falsely presenting an incomplete graph, boards above **12,000 tasks** or **60,000 links** produce an explicit limit error instead of silent truncation. For very large graphs, apply filters after loading; browsers can still slow down when rendering thousands of cards.
- The layout is a lightweight self-contained layered graph layout. It provides prerequisite ordering but is not a critical-path duration estimator. It makes no claim about task durations.
- Auto-refresh uses **8-second polling**, not push/WebSocket delivery. The time shown is the most recent successful sync. Updates made without task events may require manual refresh.
- Tasks in a different board are not shown and cannot be connected across boards.

## Troubleshooting

| Problem | Suggested action |
| --- | --- |
| Tab not visible | Restart `hermes dashboard`; check `dashboard/manifest.json` is inside the installed plugin directory. |
| No boards | Run `hermes kanban init` or create/select boards in Hermes Kanban. |
| Board unavailable / 404 | It may have been archived or deleted; choose another board. |
| Auth / API 401 | Refresh and log in to the Hermes dashboard. |
| Graph API 503 | Check that the board SQLite schema is initialized and compatible with the current Hermes version. |
| Graph fails after install | Check the dashboard console/network panel and confirm the installed Hermes exposes dashboard plugin APIs. |

## Development

Requires Node.js 20+ for tests/build and Python with `pytest` and `fastapi` for backend tests. **Runtime does not require Node.js.** The compiled bundle is committed to the repository and loaded directly by Hermes.

```bash
npm test
npm run build
python -m pip install 'fastapi>=0.110,<1' 'pytest>=8,<10'
python -m pytest -q tests/test_plugin_api.py
```

- `src/layout.js`: pure graph filtering, neighborhood and hierarchical layout logic.
- `src/plugin.js`: React dashboard UI using the browser's Hermes plugin SDK.
- `scripts/build.mjs`: concatenates the source into self-contained `dashboard/dist/index.js`.
- `dashboard/dist/style.css`: theme-friendly, prefixed styles.
- `dashboard/manifest.json`: plugin page registration.
- `dashboard/plugin_api.py`: `GET /boards`, `GET /graph`; board-scoped SQLite reads.
- `plugin.yaml`, `__init__.py`: native package discovery marker; no additional agent tools.

## Upstream references

- [Hermes dashboard extension specification](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/extending-the-dashboard.md)
- [Hermes Kanban documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
- [Kanban API source](https://github.com/NousResearch/hermes-agent/blob/main/plugins/kanban/dashboard/plugin_api.py)

## License

MIT — see [LICENSE](LICENSE).
