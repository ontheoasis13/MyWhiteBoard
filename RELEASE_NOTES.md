# Release Notes

## Public Beta 5 — 2026-08-13

- Fixed Codex launch blocking by removing forced iframe embedding for loopback whiteboards.
- `render_board` now returns a direct editable local URL; `open_board` remains the explicit fallback.

## Public Beta 4 — 2026-08-13

- Project code boards now scan source files and relative imports to seed editable module nodes and dependency arrows.
- Added a bounded file scan with exclusions for generated and dependency directories.

## Public Beta 3 — 2026-08-13

- Added project-scoped code boards under `.codex/whiteboards`
- Added code links for files, symbols, line numbers, implementation status, risks, and tests
- Added board analysis for linked files, dependencies, dangling edges, risks, and test references
- Added code metadata fields to the inspector and a project-board registry
- Hardened UTF-8 request handling for Chinese and other multibyte board content

## Public Beta 2 — 2026-08-13

- Corrected the GitHub marketplace source to `ontheoasis13/MyWhiteBoard`
- Added repository and homepage metadata to the plugin manifest
- Verified the latest Chinese contact-form board and its 20 revision snapshots
- Revalidated the plugin and its JSON, SVG, and PNG export smoke tests

## Public Beta 1 — 2026-08-13

- Editable local-first whiteboard canvas
- Multi-select, grouping, locking, alignment, layers, duplicate, undo, and redo
- Local autosave and revision history
- JSON, SVG, and PNG export
- Codex MCP tools and inline/fullscreen plugin UI
- Supabase email authentication
- Cross-device board sync
- Viewer/editor sharing
- Realtime collaboration
- Row-level security for private and shared boards

Known beta limitations:

- Cloud service availability depends on the operator's Supabase project and quota
- Email confirmation delivery may vary by provider
- Concurrent edits may require refreshing or reopening a board when a client reconnects
- Stored document formats and cloud behavior may change before the stable release
