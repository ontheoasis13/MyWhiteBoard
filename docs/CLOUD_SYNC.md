# Optional Supabase Sync

My Whiteboard is local-first. Cloud sync is an opt-in replica of the same Semantic Workspace model, not another canvas state.

## Database

Apply migrations in order:

1. `001_whiteboard_cloud.sql` — Beta 5 compatibility only
2. `002_semantic_workspace.sql` — Workspace metadata, Entities, Event Log, RLS, Realtime and atomic apply RPC
3. `003_workspace_security_hardening.sql` — explicit grants, non-overlapping policies and removal of duplicate Project JSON
4. `004_workspace_write_boundary.sql` — prevents direct Workspace Version writes outside authenticated RPCs

The configured project already has all three migrations applied.

## Client configuration

Set these before Codex starts:

```text
SUPABASE_URL=https://wketdxmdrdkmaryahnwk.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN=<Supabase Auth user JWT>
```

Do not use a Secret/Service Role Key. `MY_WHITEBOARD_SUPABASE_ACCESS_TOKEN` must represent the signed-in user so RLS remains active.

## Sync protocol

- `cloud_push` flattens Boards into versioned Board metadata and independent Board Element rows.
- A cloud transaction increments Workspace Version once and records ordered events.
- Each create/update/delete checks the target Entity Version; unrelated entities do not conflict.
- `cloud_pull` reads only events after the stored Cloud Workspace Version.
- Pull refuses to overwrite unsynchronized local changes. Same-version/different-content states are surfaced as conflicts.
- `.my-whiteboard/cloud.json` stores only Workspace IDs and cursors, never credentials.

## Backend

The optional `cloud/` Node backend uses `@supabase/server` to verify callers and `createContextClient` to preserve user RLS. `/api/boards` returns `410`; new integrations use `/api/workspaces`.
