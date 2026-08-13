---
name: whiteboard-design
description: Create, open, inspect, revise, arrange, and export editable local whiteboards, UI wireframes, flowcharts, mind maps, architecture sketches, journeys, and freeform visual boards with the My Whiteboard MCP tools. Use whenever the user asks to draw, sketch, diagram, map, wireframe, visualize, brainstorm on a board, or modify a board previously created by this plugin.
---

# Whiteboard Design

Build editable visual structure, not a flattened picture. Store every board locally and make changes through the `my-whiteboard` tools.

## Workflow

1. For a new board, call `create_board`. Use the closest template when one exists.
2. Add the full first-pass composition in one `add_elements` call when practical.
3. Call `render_board` so the user can inspect and edit the canvas inline or fullscreen. Use `open_board` as a fallback when inline UI is unavailable.
4. Before changing an existing board, call `query_elements`; when the user says “selected/current elements,” call `get_board_context`. Update only the relevant IDs.
5. Use `layout_board` for repeated cards or nodes. Preserve deliberate manual positioning elsewhere.
6. Export only when requested. JSON is the editable source; SVG and PNG are delivery formats.
7. Use `get_storage_info` when the user asks where boards are saved. Use `set_storage_directory` only after the user names or approves the destination.
8. Use `get_board_history` before restoring a prior version. Call `restore_board_version` only after the user identifies the target revision.

## Visual rules

- Establish hierarchy with size, spacing, and at most one strong accent color.
- Use 8 px spacing increments and leave at least 24 px between unrelated groups.
- Keep text labels concise. Put detailed explanation beside the board, not inside every shape.
- Use stable, descriptive IDs such as `email-input` or `decision-approved` when supplying IDs.
- Prefer solid fills and low-roughness geometry for UI work; use warmer notes and looser spacing for brainstorming.
- Keep important content inside the board dimensions.

## Editing rules

- Query first; never guess IDs on an existing board.
- Patch only changed fields with `update_elements`.
- Use `delete_elements` only when the user asked to remove content or removal is necessary for the requested redesign.
- Treat edits made in the browser as authoritative; re-query after the user says they changed the board.

## Supported elements

Use `rectangle`, `ellipse`, `diamond`, `text`, `note`, `arrow`, and `line`. Read [schema.md](references/schema.md) only when constructing non-trivial element payloads or debugging validation.

## Local privacy

Boards default to the user's Documents folder in `My Whiteboards`. The user may point storage at a OneDrive, Dropbox, iCloud Drive, or other synced folder with `set_storage_directory`; do not claim sync is active unless that directory is actually managed by a sync provider. `open_board` returns a loopback URL accessible only while the local MCP server is running.

## Cloud collaboration

The editor can sign in to the configured Supabase project for cross-device sync, version history, share links, and Realtime updates. Treat the local JSON file as the offline source and Supabase as the authenticated synchronization layer. Never request or expose the Supabase secret/service-role key in the canvas; client access must use the publishable key and RLS.
