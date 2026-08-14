---
name: whiteboard-design
description: Create, open, inspect, revise, analyze, migrate, and export editable semantic whiteboards, code architecture diagrams, UI wireframes, flowcharts, mind maps, journeys, and freeform boards with the Agent-neutral My Whiteboard MCP tools. Use whenever the user asks to draw, sketch, diagram, map, wireframe, visualize, brainstorm on a board, inspect a selected board object, or modify a board previously created by this plugin.
---

# Whiteboard Design

Build editable semantic structure, not a flattened picture. `Semantic Board State` in `<project>/.my-whiteboard/workspace.json` is the only authoritative board state. Excalidraw is a visual adapter; Legacy SVG is import/fallback data only.

## Standard workflow

1. Call `project_create` once for a project root. Call `project_get` or `workspace_get` before editing an existing workspace.
2. Call `board_create` for a new board. Use stable IDs and select the closest `board_type`, such as `flowchart`, `architecture`, `wireframe`, or `mindmap`.
3. Add the first meaningful composition in one `board_apply` transaction when practical. Every update or delete must include the element's current `expected_version`.
4. Call `workspace_open` to return the direct, token-protected local Web Workspace URL. Never request an iframe or MCP embedded resource: the workspace is deliberately standalone.
5. When the user refers to the selected/current object, call `selection_get`. Use only the returned semantic IDs and references.
6. Re-read with `board_get` after the user edits in Excalidraw. Treat Semantic Board State—not the raw Excalidraw scene—as authoritative.
7. Call `board_export` only when requested. JSON is the editable semantic source; SVG and PNG are delivery formats.
8. For incremental Agent context, call `workspace_get_changes` with the last seen Workspace Version.

## Single-Agent Workspace

- Call `agent_connect` at the start of substantive work so the workspace records the client, capabilities, status, and last-seen time.
- Use `context_apply`, `tasks_apply`, `decisions_apply`, and `artifacts_apply` for their matching collections. Batch related changes and include `expected_version` on every update or delete.
- Record durable goals, constraints, and code findings as Context; actionable work as Tasks; architectural choices and rationale as Decisions; and files, URIs, exports, or boards as Artifacts.
- Assign a Task only to an Agent already present in the workspace. Create dependency Tasks before referring to them with `dependsOn`.

## Code workspace workflow

- Use `code_board_create` with the repository root to scan bounded source files and imports into a semantic architecture board.
- Call `code_board_analyze` before presenting the architecture as complete. Preserve its linked file, language, import, and risk metadata.
- Use the user's persisted selection as focused coding context. Do not read unrelated board elements when `selection_get` already identifies the target.
- Commit `.my-whiteboard/workspace.json` only when the user wants the workspace shared through version control. Ignore transient `.my-whiteboard/lock` files.

## Concurrency rules

- Workspace Version orders Event Log and Delta reads; it is not a global write lock.
- Entity Version protects individual objects. Always send `expected_version` for updates and deletes.
- On `VERSION_CONFLICT`, stop overwriting, call `board_get` or `workspace_get`, compare the changed entity, then apply a new explicit patch.
- Unrelated entities may be updated concurrently without conflict.

## Multi-Agent collaboration

- Call `agent_sync` with the last seen Workspace Version when an Agent resumes. Use the returned Delta instead of rereading the entire Event Log.
- Call `handoff_create` only after both Agents and every referenced Task, Artifact, and Board exist. The sender and recipient must be different.
- The recipient calls `handoff_update` with the current `expected_version` to accept or complete the work. On conflict, re-read the handoff from `workspace_get` before retrying.
- Use `message_send` for durable Agent updates, requests, responses, and conflict notices; use `messages_get` with an Agent/channel filter and version cursor for focused inbox reads.

## Legacy migration

- Call `legacy_discover` before `legacy_import`.
- Import is copy-only and idempotent by source hash. Never edit or delete `.codex/whiteboards` during migration.
- After import, all new edits go to Semantic Board State. Do not create live two-way synchronization with Legacy SVG.

## Optional cloud sync

- Call `cloud_status` before any cloud operation. Local work never requires cloud configuration.
- Use `cloud_push` before `cloud_pull` when the local Workspace has unsynchronized changes.
- Use `cloud_get_changes` for a read-only Cloud Workspace Delta. Workspace Version orders cloud events; Entity Version still protects individual objects.
- On a cloud conflict, do not force an overwrite. Read the local Workspace and cloud Delta, then resolve the named Entity explicitly.
- Never accept, request, print, or store a Supabase Secret/Service Role Key. Cloud tools use only a Publishable Key and a signed-in user's JWT supplied to the MCP server environment.

## Visual rules

- Establish hierarchy with size, spacing, and at most one strong accent color.
- Use 8 px spacing increments and leave at least 24 px between unrelated groups.
- Keep labels concise; store detailed meaning in semantic properties and project context.
- Prefer stable descriptive IDs such as `auth-service`, `email-input`, or `decision-approved`.
- Use `node`, `edge`, `text`, `note`, `section`, and `group` semantic kinds. Read [schema.md](references/schema.md) for non-trivial payloads.

## Privacy and portability

The local workspace and loopback URL stay on the user's machine. The URL works only while this MCP server process is running and includes a short-lived secret token. Never expose a Supabase Secret/Service Role Key or user JWT in a board, log, tool result, repository, or browser client. Cloud sync is opt-in and must be reported as unavailable when `cloud_status` says it is not configured.
